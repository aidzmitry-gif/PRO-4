"""HTTP-API модуля Production. Монтируется под префиксом ``/production``."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.runtime.core import Core
from core.runtime.deps import get_core, get_session
from core.runtime.funnel import FunnelBoardOut, FunnelCard, build_board
from modules.production.models import (
    ProductionNorm,
    ProductionOrder,
    ProductionQc,
    ProductionWorker,
)
from modules.production.schemas import (
    NormCreate,
    NormOut,
    NormUpdate,
    PayrollOut,
    PayrollRow,
    ProductionOrderCreate,
    ProductionOrderOut,
    QcDecisionIn,
    QcOut,
    QcStats,
    StageUpdate,
    WorkerCreate,
    WorkerOut,
    WorkerUpdate,
)
from modules.production.stages import STAGES

router = APIRouter(tags=["production"])

# Переход в эту стадию = наряд готов → приход на склад (production → wms).
COMPLETED_STAGE = "done"

# Экономика нормо-часа (BYN): ставка работы и премия сборщику за 1 н.ч; норма дней в месяце.
WORK_RATE = 25.0
PREMIUM_RATE = 6.25
NORM_DAYS = 22

# Решения ОТК. Брак (scrap) публикует претензию в закупки.
QC_DECISIONS = ("accept", "rework", "scrap")
SCRAP_DECISION = "scrap"


def _nh_fmt(value: float) -> str:
    """Нормо-часы в русском формате: 10 → «10», 7.5 → «7,5»."""
    text = f"{round(value, 1):.1f}".replace(".", ",")
    return text[:-2] if text.endswith(",0") else text


def _to_card(r: ProductionOrder) -> FunnelCard:
    tags = [f"{r.qty} шт"] if r.qty else []
    if r.nh_per_unit:
        tags.append(f"{_nh_fmt(r.nh_per_unit * r.qty)} н.ч")
    return FunnelCard(
        id=r.id,
        code=r.number or f"ПЗ-{r.id}",
        title=r.product,
        priority=r.priority,
        owner=r.owner,
        date=r.due_date or "",
        progress=r.progress,
        insight=r.insight,
        tags=tags,
    )


@router.get("/orders", response_model=list[ProductionOrderOut])
async def list_orders(session: AsyncSession = Depends(get_session)):
    """Производственные наряды (плоский список — для аналитики и совместимости)."""
    return (
        await session.execute(select(ProductionOrder).order_by(ProductionOrder.id.desc()))
    ).scalars().all()


@router.get("/board", response_model=FunnelBoardOut)
async def board(session: AsyncSession = Depends(get_session)) -> FunnelBoardOut:
    """Канбан цеха: наряды сгруппированы по этапам производства."""
    rows = (await session.execute(select(ProductionOrder))).scalars().all()
    return build_board(STAGES, rows, _to_card)


@router.post("/orders", response_model=ProductionOrderOut, status_code=201)
async def create_order(
    payload: ProductionOrderCreate, session: AsyncSession = Depends(get_session)
):
    """Создать наряд. Номер генерируется автоматически, если не задан.

    Если ``nh_per_unit`` не задан — подставляется из утверждённой нормы
    справочника по точному названию изделия (нормо-час как базовая единица).
    """
    obj = ProductionOrder(**payload.model_dump())
    if not obj.nh_per_unit:
        norm = (
            await session.execute(
                select(ProductionNorm).where(
                    ProductionNorm.kind == "product",
                    ProductionNorm.title == obj.product,
                    ProductionNorm.status == "approved",
                )
            )
        ).scalar_one_or_none()
        if norm is not None:
            obj.nh_per_unit = norm.nh
    session.add(obj)
    await session.flush()
    if not obj.number:
        obj.number = f"ПЗ-2026-{obj.id:04d}"
    await session.commit()
    await session.refresh(obj)
    return obj


@router.patch("/orders/{order_id}", response_model=ProductionOrderOut)
async def update_order(
    order_id: int,
    payload: StageUpdate,
    core: Core = Depends(get_core),
    session: AsyncSession = Depends(get_session),
):
    """Сменить этап наряда. При «Готово → склад» — приход на склад (production → wms)."""
    obj = await session.get(ProductionOrder, order_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Наряд не найден")
    obj.stage = payload.stage
    if payload.stage == COMPLETED_STAGE:
        obj.progress = 100
        obj.made_qty = obj.qty
        core.event_bus.emit(
            session,
            "production.completed",
            {
                "item": obj.product,
                "qty": obj.qty,
                "warehouse": "Главный",
                "entity_ref": f"production:{obj.id}",
            },
        )
    await session.commit()
    await session.refresh(obj)
    return obj


# ===== Нормы и нормативы (справочник нормо-часов) =====


def _norm_status(nh: float) -> str:
    """Статус по значению нормы: 0 → нет нормы, >0 → на утверждение."""
    return "pending" if nh > 0 else "none"


@router.get("/norms", response_model=list[NormOut])
async def list_norms(kind: str | None = None, session: AsyncSession = Depends(get_session)):
    """Справочник норм; ``kind=product|operation`` — фильтр по виду."""
    query = select(ProductionNorm).order_by(ProductionNorm.title)
    if kind is not None:
        query = query.where(ProductionNorm.kind == kind)
    return (await session.execute(query)).scalars().all()


@router.post("/norms", response_model=NormOut, status_code=201)
async def create_norm(payload: NormCreate, session: AsyncSession = Depends(get_session)):
    """Создать норму: nh>0 уходит «на утверждение», nh=0 — «нет нормы»."""
    obj = ProductionNorm(**payload.model_dump(), status=_norm_status(payload.nh))
    session.add(obj)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.patch("/norms/{norm_id}", response_model=NormOut)
async def update_norm(
    norm_id: int, payload: NormUpdate, session: AsyncSession = Depends(get_session)
):
    """Правка нормы. Изменение ``nh`` возвращает её на утверждение."""
    obj = await session.get(ProductionNorm, norm_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Норма не найдена")
    data = payload.model_dump(exclude_unset=True)
    if "nh" in data and data["nh"] != obj.nh:
        obj.status = _norm_status(data["nh"])
    for field, value in data.items():
        setattr(obj, field, value)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.post("/norms/{norm_id}/approve", response_model=NormOut)
async def approve_norm(norm_id: int, session: AsyncSession = Depends(get_session)):
    """Утвердить норму. Норму без значения (nh=0) утвердить нельзя."""
    obj = await session.get(ProductionNorm, norm_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Норма не найдена")
    if obj.nh <= 0:
        raise HTTPException(status_code=409, detail="Нельзя утвердить норму без значения н.ч")
    obj.status = "approved"
    await session.commit()
    await session.refresh(obj)
    return obj


@router.delete("/norms/{norm_id}", status_code=204)
async def delete_norm(norm_id: int, session: AsyncSession = Depends(get_session)):
    """Удалить норму из справочника."""
    obj = await session.get(ProductionNorm, norm_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Норма не найдена")
    await session.delete(obj)
    await session.commit()


# ===== Выработка и оценка (табель + расчёт ЗП) =====


def _round2(value: float) -> float:
    return round(value, 2)


def _payroll_row(w: ProductionWorker) -> PayrollRow:
    """Расчёт ЗП по строке табеля: оклад × дни/22 + выработка × премия."""
    base = w.salary * w.days_worked / NORM_DAYS if NORM_DAYS else 0.0
    premium = w.nh_output * PREMIUM_RATE
    return PayrollRow(
        id=w.id,
        name=w.name,
        nh_output=w.nh_output,
        base=_round2(base),
        premium=_round2(premium),
        total=_round2(base + premium),
        contribution=_round2(w.nh_output * WORK_RATE),
    )


@router.get("/workers", response_model=list[WorkerOut])
async def list_workers(session: AsyncSession = Depends(get_session)):
    """Табель сборщиков (для экрана «Выработка и оценка»)."""
    return (
        await session.execute(select(ProductionWorker).order_by(ProductionWorker.id))
    ).scalars().all()


@router.post("/workers", response_model=WorkerOut, status_code=201)
async def create_worker(payload: WorkerCreate, session: AsyncSession = Depends(get_session)):
    """Добавить сборщика в табель."""
    obj = ProductionWorker(**payload.model_dump())
    session.add(obj)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.patch("/workers/{worker_id}", response_model=WorkerOut)
async def update_worker(
    worker_id: int, payload: WorkerUpdate, session: AsyncSession = Depends(get_session)
):
    """Правка строки табеля (дни/выработка/оклад)."""
    obj = await session.get(ProductionWorker, worker_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Сборщик не найден")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.get("/payroll", response_model=PayrollOut)
async def payroll(session: AsyncSession = Depends(get_session)) -> PayrollOut:
    """Расчёт ЗП по табелю + рейтинг вклада (лидеры по стоимости выработки первыми)."""
    workers = (
        await session.execute(select(ProductionWorker))
    ).scalars().all()
    rows = sorted((_payroll_row(w) for w in workers), key=lambda r: r.contribution, reverse=True)
    return PayrollOut(
        rows=rows,
        total_nh=_round2(sum(r.nh_output for r in rows)),
        total_base=_round2(sum(r.base for r in rows)),
        total_premium=_round2(sum(r.premium for r in rows)),
        total_payroll=_round2(sum(r.total for r in rows)),
    )


# ===== ОТК · контроль качества =====


@router.get("/qc/decisions", response_model=list[QcOut])
async def list_qc(session: AsyncSession = Depends(get_session)):
    """Журнал решений ОТК (последние — первыми)."""
    return (
        await session.execute(select(ProductionQc).order_by(ProductionQc.id.desc()))
    ).scalars().all()


@router.post("/qc/decisions", response_model=QcOut, status_code=201)
async def create_qc(
    payload: QcDecisionIn,
    core: Core = Depends(get_core),
    session: AsyncSession = Depends(get_session),
):
    """Зафиксировать решение ОТК. Брак (``scrap``) → претензия в закупки."""
    if payload.decision not in QC_DECISIONS:
        raise HTTPException(
            status_code=422, detail=f"Решение должно быть одним из {QC_DECISIONS}"
        )
    obj = ProductionQc(**payload.model_dump())
    session.add(obj)
    await session.flush()
    if obj.decision == SCRAP_DECISION:
        core.event_bus.emit(
            session,
            "production.scrap",
            {
                "item": obj.product,
                "reason": obj.reason,
                "order_code": obj.order_code,
                "entity_ref": f"production:qc:{obj.id}",
            },
        )
    await session.commit()
    await session.refresh(obj)
    return obj


@router.get("/qc/stats", response_model=QcStats)
async def qc_stats(session: AsyncSession = Depends(get_session)) -> QcStats:
    """Сводка ОТК за всё время: принято/доработка/брак и pass-rate."""
    rows = (await session.execute(select(ProductionQc))).scalars().all()
    accepted = sum(1 for r in rows if r.decision == "accept")
    rework = sum(1 for r in rows if r.decision == "rework")
    scrap = sum(1 for r in rows if r.decision == "scrap")
    total = len(rows)
    return QcStats(
        accepted=accepted,
        rework=rework,
        scrap=scrap,
        total=total,
        pass_rate=round(accepted / total * 100, 1) if total else 0.0,
    )
