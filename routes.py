"""HTTP-API модуля Production. Монтируется под префиксом ``/production``."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.runtime.core import Core
from core.runtime.deps import get_core, get_session
from core.runtime.funnel import FunnelBoardOut, FunnelCard, build_board
from modules.production.models import (
    ProductionBom,
    ProductionBomItem,
    ProductionNorm,
    ProductionOrder,
    ProductionPlan,
    ProductionQc,
    ProductionWorker,
)
from modules.production.schemas import (
    AnalyticsOut,
    BomCreate,
    BomDetailOut,
    BomItemCreate,
    BomItemOut,
    BomItemUpdate,
    BomOut,
    BomUpdate,
    NormCreate,
    NormOut,
    NormUpdate,
    PayrollOut,
    PayrollRow,
    PlanBoardOut,
    PlanCellUpdate,
    PlanMonthCell,
    PlanPositionUpsert,
    PlanRowOut,
    PlanTotalsOut,
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

# Мощность цеха: рабочих часов в месяце на одного сборщика (4 сборщика × 176 = 704 н.ч/мес).
ASSEMBLER_HOURS_PER_MONTH = 176


def _utcnow() -> datetime:
    """Наивный UTC-таймстамп (как в sales/approvals) — для хранения в DateTime-колонках."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    await require_legacy_unowned_book(session)
    return (
        await session.execute(select(ProductionOrder).order_by(ProductionOrder.id.desc()))
    ).scalars().all()


@router.get("/board", response_model=FunnelBoardOut)
async def board(session: AsyncSession = Depends(get_session)) -> FunnelBoardOut:
    """Канбан цеха: наряды сгруппированы по этапам производства."""
    await require_legacy_unowned_book(session)
    rows = (await session.execute(select(ProductionOrder))).scalars().all()
    return build_board(STAGES, rows, _to_card)


@router.post("/orders", response_model=ProductionOrderOut, status_code=201)
async def create_order(
    payload: ProductionOrderCreate, session: AsyncSession = Depends(get_session)
):
    obj = await prepare_order(payload, session)
    await session.commit()
    await session.refresh(obj)
    return obj


async def prepare_order(payload: ProductionOrderCreate, session: AsyncSession):
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
    await session.flush()
    return obj


@router.patch("/orders/{order_id}", response_model=ProductionOrderOut)
async def update_order(
    order_id: int,
    payload: StageUpdate,
    core: Core = Depends(get_core),
    session: AsyncSession = Depends(get_session),
):
    """Сменить этап наряда. При «Готово → склад» — приход на склад (production → wms)."""
    obj = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == order_id)
        .with_for_update().execution_options(populate_existing=True))
    if obj is None:
        raise HTTPException(status_code=404, detail="Наряд не найден")
    from modules.production.accounting_ownership import ProductionOrderOwnership

    if await session.get(ProductionOrderOwnership, order_id) is not None:
        raise HTTPException(409, "Выберите юрлицо наряда для смены этапа")
    transition_order(obj, payload, session, core)
    await session.commit()
    await session.refresh(obj)
    return obj


def transition_order(obj, payload, session, core, organization_id=None):
    """Caller locks the order and owns transaction and organization authority."""
    if payload.stage not in {stage['id'] for stage in STAGES}:
        raise HTTPException(422, "Неизвестный этап производства")
    if obj.stage == payload.stage:
        return obj
    if obj.stage == COMPLETED_STAGE or obj.completed_at is not None:
        raise HTTPException(status_code=409, detail="Выпуск уже завершён; требуется корректировка выпуска")
    obj.stage = payload.stage
    if payload.stage == COMPLETED_STAGE:
        obj.progress = 100
        obj.made_qty = obj.qty
        obj.completed_at = _utcnow()  # дата факта (для плана/факта по месяцам)
        core.event_bus.emit(
            session,
            "production.completed",
            {
                "item": obj.product,
                "qty": obj.qty,
                "warehouse": "Главный",
                "entity_ref": f"production:{obj.id}",
                **({"organization_id": organization_id} if organization_id is not None else {}),
            },
        )
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
    """Управленческая оценка по табелю; не бухгалтерское начисление."""
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
        calculation_scope="management_estimate",
        accounting_posting_available=False,
        statutory_payroll_certified=False,
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


# ===== Спецификации · BOM (составы изделий) =====


def _item_status(item: ProductionBomItem) -> str:
    """Обеспеченность позиции: доступно (склад − резерв) ≥ норма расхода на 1 шт."""
    return "ok" if (item.stock - item.reserved) >= item.norm_qty else "short"


def _coverage(items: list[ProductionBomItem]) -> int:
    """% обеспеченных позиций состава (нет позиций → 100%)."""
    if not items:
        return 100
    covered = sum(1 for i in items if _item_status(i) == "ok")
    return round(covered / len(items) * 100)


async def _bom_items(session: AsyncSession, bom_id: int) -> list[ProductionBomItem]:
    return list(
        (
            await session.execute(
                select(ProductionBomItem)
                .where(ProductionBomItem.bom_id == bom_id)
                .order_by(ProductionBomItem.id)
            )
        ).scalars().all()
    )


def _item_out(item: ProductionBomItem) -> BomItemOut:
    out = BomItemOut.model_validate(item)
    out.status = _item_status(item)
    return out


def _bom_out(bom: ProductionBom, items: list[ProductionBomItem]) -> BomOut:
    out = BomOut.model_validate(bom)
    out.item_count = len(items)
    out.coverage = _coverage(items)
    return out


async def _get_bom_or_404(session: AsyncSession, bom_id: int) -> ProductionBom:
    bom = await session.get(ProductionBom, bom_id)
    if bom is None:
        raise HTTPException(status_code=404, detail="Спецификация не найдена")
    return bom


@router.get("/boms", response_model=list[BomOut])
async def list_boms(session: AsyncSession = Depends(get_session)):
    """Справочник спецификаций с агрегатами (позиций + обеспеченность)."""
    boms = (
        await session.execute(select(ProductionBom).order_by(ProductionBom.product))
    ).scalars().all()
    result = []
    for bom in boms:
        result.append(_bom_out(bom, await _bom_items(session, bom.id)))
    return result


@router.get("/boms/{bom_id}", response_model=BomDetailOut)
async def get_bom(bom_id: int, session: AsyncSession = Depends(get_session)) -> BomDetailOut:
    """Спецификация с раскрытым составом и статусами позиций."""
    bom = await _get_bom_or_404(session, bom_id)
    items = await _bom_items(session, bom_id)
    detail = BomDetailOut.model_validate(bom)
    detail.item_count = len(items)
    detail.coverage = _coverage(items)
    detail.items = [_item_out(i) for i in items]
    return detail


@router.post("/boms", response_model=BomOut, status_code=201)
async def create_bom(payload: BomCreate, session: AsyncSession = Depends(get_session)):
    """Создать спецификацию (черновик, без позиций)."""
    bom = ProductionBom(**payload.model_dump())
    session.add(bom)
    await session.commit()
    await session.refresh(bom)
    return _bom_out(bom, [])


@router.patch("/boms/{bom_id}", response_model=BomOut)
async def update_bom(
    bom_id: int, payload: BomUpdate, session: AsyncSession = Depends(get_session)
):
    """Правка реквизитов спецификации (изделие/версия/примечание)."""
    bom = await _get_bom_or_404(session, bom_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bom, field, value)
    await session.commit()
    await session.refresh(bom)
    return _bom_out(bom, await _bom_items(session, bom_id))


@router.post("/boms/{bom_id}/approve", response_model=BomOut)
async def approve_bom(bom_id: int, session: AsyncSession = Depends(get_session)):
    """Утвердить спецификацию. Пустой состав утвердить нельзя (409)."""
    bom = await _get_bom_or_404(session, bom_id)
    items = await _bom_items(session, bom_id)
    if not items:
        raise HTTPException(status_code=409, detail="Нельзя утвердить пустую спецификацию")
    bom.status = "approved"
    await session.commit()
    await session.refresh(bom)
    return _bom_out(bom, items)


@router.delete("/boms/{bom_id}", status_code=204)
async def delete_bom(bom_id: int, session: AsyncSession = Depends(get_session)):
    """Удалить спецификацию вместе с её составом."""
    bom = await _get_bom_or_404(session, bom_id)
    for item in await _bom_items(session, bom_id):
        await session.delete(item)
    await session.delete(bom)
    await session.commit()


@router.post("/boms/{bom_id}/items", response_model=BomItemOut, status_code=201)
async def add_bom_item(
    bom_id: int, payload: BomItemCreate, session: AsyncSession = Depends(get_session)
):
    """Добавить позицию в состав. Правка состава возвращает спецификацию в черновик."""
    bom = await _get_bom_or_404(session, bom_id)
    item = ProductionBomItem(bom_id=bom_id, **payload.model_dump())
    session.add(item)
    bom.status = "draft"
    await session.commit()
    await session.refresh(item)
    return _item_out(item)


@router.patch("/bom-items/{item_id}", response_model=BomItemOut)
async def update_bom_item(
    item_id: int, payload: BomItemUpdate, session: AsyncSession = Depends(get_session)
):
    """Правка позиции состава (возвращает спецификацию в черновик)."""
    item = await session.get(ProductionBomItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Позиция состава не найдена")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    bom = await session.get(ProductionBom, item.bom_id)
    if bom is not None:
        bom.status = "draft"
    await session.commit()
    await session.refresh(item)
    return _item_out(item)


@router.delete("/bom-items/{item_id}", status_code=204)
async def delete_bom_item(item_id: int, session: AsyncSession = Depends(get_session)):
    """Удалить позицию состава (возвращает спецификацию в черновик)."""
    item = await session.get(ProductionBomItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Позиция состава не найдена")
    bom = await session.get(ProductionBom, item.bom_id)
    if bom is not None:
        bom.status = "draft"
    await session.delete(item)
    await session.commit()


# ===== Планирование · план/факт =====


async def _approved_norm_map(session: AsyncSession) -> dict[str, float]:
    """{название изделия → н.ч/шт} по утверждённым нормам (точное совпадение title)."""
    norms = (
        await session.execute(
            select(ProductionNorm).where(
                ProductionNorm.kind == "product", ProductionNorm.status == "approved"
            )
        )
    ).scalars().all()
    return {n.title: n.nh for n in norms}


def _ytd_month(year: int) -> int:
    """Сколько месяцев года считать «до текущего» (включительно) для YTD-сумм."""
    now = _utcnow()
    if year < now.year:
        return 12
    if year > now.year:
        return 0
    return now.month


async def require_legacy_unowned_book(session: AsyncSession):
    from modules.production.accounting_ownership import ProductionOrderOwnership

    if await session.scalar(select(ProductionOrderOwnership.order_id).limit(1)) is not None:
        raise HTTPException(409, "Выберите юрлицо: общий просмотр производства недоступен для сопоставленных нарядов")


async def _build_plan_board(session: AsyncSession, year: int) -> PlanBoardOut:
    """Собрать матрицу плана/факта за год: план — из ``production_plan``, факт — из
    завершённых нарядов (``completed_at``→fallback ``created_at``), норма — из справочника."""
    await require_legacy_unowned_book(session)
    plan_rows = (
        await session.execute(select(ProductionPlan).where(ProductionPlan.year == year))
    ).scalars().all()
    orders = (await session.execute(select(ProductionOrder))).scalars().all()
    worker_count = await session.scalar(select(func.count()).select_from(ProductionWorker)) or 0
    norm_map = await _approved_norm_map(session)

    plan_pm: dict[str, list[int]] = {}   # изделие → план qty по месяцам (12)
    for p in plan_rows:
        if 1 <= p.month <= 12:
            plan_pm.setdefault(p.product, [0] * 12)[p.month - 1] = p.plan_qty

    fact_pm: dict[str, list[int]] = {}   # изделие → факт qty по месяцам (12)
    for o in orders:
        if o.stage != COMPLETED_STAGE:
            continue
        date = o.completed_at or o.created_at
        if date is None or date.year != year:
            continue
        fact_pm.setdefault(o.product, [0] * 12)[date.month - 1] += o.made_qty

    rows: list[PlanRowOut] = []
    for product in sorted(set(plan_pm) | set(fact_pm)):
        plan_arr = plan_pm.get(product, [0] * 12)
        fact_arr = fact_pm.get(product, [0] * 12)
        norm_nh = norm_map.get(product, 0.0)
        months = [
            PlanMonthCell(
                month=m + 1,
                plan_qty=plan_arr[m],
                plan_nh=round(plan_arr[m] * norm_nh, 2),
                fact_qty=fact_arr[m],
                fact_nh=round(fact_arr[m] * norm_nh, 2),
            )
            for m in range(12)
        ]
        rows.append(
            PlanRowOut(
                product=product,
                norm_nh=norm_nh,
                months=months,
                year_qty=sum(plan_arr),
                year_nh=round(sum(c.plan_nh for c in months), 2),
            )
        )

    month_nh = [round(sum(r.months[m].plan_nh for r in rows), 2) for m in range(12)]
    fact_nh = [round(sum(r.months[m].fact_nh for r in rows), 2) for m in range(12)]
    capacity_nh = float(max(1, worker_count) * ASSEMBLER_HOURS_PER_MONTH)
    load_pct = [round(month_nh[m] / capacity_nh * 100, 1) for m in range(12)]
    cur = _ytd_month(year)
    totals = PlanTotalsOut(
        month_nh=month_nh,
        fact_nh=fact_nh,
        load_pct=load_pct,
        year_nh=round(sum(month_nh), 2),
        plan_ytd=round(sum(month_nh[:cur]), 2),
        fact_ytd=round(sum(fact_nh[:cur]), 2),
        peak_month=max(range(12), key=lambda m: load_pct[m]),
        low_month=min(range(12), key=lambda m: load_pct[m]),
    )
    return PlanBoardOut(year=year, capacity_nh=capacity_nh, rows=rows, totals=totals)


async def _upsert_plan_cell(
    session: AsyncSession, year: int, product: str, month: int, plan_qty: int
) -> None:
    obj = (
        await session.execute(
            select(ProductionPlan).where(
                ProductionPlan.year == year,
                ProductionPlan.product == product,
                ProductionPlan.month == month,
            )
        )
    ).scalar_one_or_none()
    if obj is None:
        session.add(ProductionPlan(year=year, product=product, month=month, plan_qty=plan_qty))
    else:
        obj.plan_qty = plan_qty


@router.get("/plan", response_model=PlanBoardOut)
async def plan_board(year: int | None = None, session: AsyncSession = Depends(get_session)):
    """Матрица плана/факта за год (по умолчанию — текущий): позиции, итоги, загрузка мощности."""
    return await _build_plan_board(session, year or _utcnow().year)


@router.put("/plan/cell", response_model=PlanBoardOut)
async def update_plan_cell(payload: PlanCellUpdate, session: AsyncSession = Depends(get_session)):
    """Изменить план одной ячейки (год × изделие × месяц). Возвращает пересчитанную матрицу."""
    await require_legacy_unowned_book(session)
    await _upsert_plan_cell(session, payload.year, payload.product, payload.month, payload.plan_qty)
    await session.commit()
    return await _build_plan_board(session, payload.year)


@router.post("/plan/position", response_model=PlanBoardOut, status_code=201)
async def upsert_plan_position(
    payload: PlanPositionUpsert, session: AsyncSession = Depends(get_session)
):
    """Создать/заменить позицию плана на год целиком (12 значений qty)."""
    await require_legacy_unowned_book(session)
    for month, qty in enumerate(payload.monthly, start=1):
        await _upsert_plan_cell(session, payload.year, payload.product, month, qty)
    await session.commit()
    return await _build_plan_board(session, payload.year)


@router.delete("/plan/position", status_code=204)
async def delete_plan_position(
    year: int, product: str, session: AsyncSession = Depends(get_session)
):
    """Удалить позицию из плана (все 12 ячеек года)."""
    await require_legacy_unowned_book(session)
    rows = (
        await session.execute(
            select(ProductionPlan).where(
                ProductionPlan.year == year, ProductionPlan.product == product
            )
        )
    ).scalars().all()
    for row in rows:
        await session.delete(row)
    await session.commit()


# ===== Аналитика производства (read-model, без своих таблиц) =====


@router.get("/analytics", response_model=AnalyticsOut)
async def analytics(year: int | None = None, session: AsyncSession = Depends(get_session)):
    """Сводная аналитика цеха; денежная премия — только плановая оценка.

    Чистый read-model: агрегирует наряды, ОТК, табель и план — своих данных не хранит.
    """
    year = year or _utcnow().year
    board = await _build_plan_board(session, year)
    totals = board.totals

    qc = (await session.execute(select(ProductionQc))).scalars().all()
    accept = sum(1 for r in qc if r.decision == "accept")
    rework = sum(1 for r in qc if r.decision == "rework")
    scrap = sum(1 for r in qc if r.decision == "scrap")
    total = len(qc)
    reasons: dict[str, int] = {}
    for r in qc:
        if r.decision == SCRAP_DECISION:
            reasons[r.reason or "—"] = reasons.get(r.reason or "—", 0) + 1

    workers = (await session.execute(select(ProductionWorker))).scalars().all()
    total_output = sum(w.nh_output for w in workers)
    total_hours = sum(w.days_worked * 8 for w in workers)

    return AnalyticsOut(
        vyrabotka_fact_nh=round(sum(totals.fact_nh), 2),
        vyrabotka_plan_nh=totals.plan_ytd,
        efficiency_pct=round(total_output / total_hours * 100, 1) if total_hours else 0.0,
        fpy_pct=round(accept / total * 100, 1) if total else 0.0,
        pass_rate_pct=round((accept + rework) / total * 100, 1) if total else 0.0,
        scrap_pct=round(scrap / total * 100, 1) if total else 0.0,
        premium_fot_byn=round(sum(w.nh_output * PREMIUM_RATE for w in workers), 2),
        financial_scope="production_planning_estimate",
        plan_fact_by_month=[
            {"month": m + 1, "plan_nh": totals.month_nh[m], "fact_nh": totals.fact_nh[m]}
            for m in range(12)
        ],
        scrap_reasons=sorted(
            ({"reason": k, "count": v} for k, v in reasons.items()),
            key=lambda x: x["count"],
            reverse=True,
        ),
        team_contribution=sorted(
            (
                {
                    "name": w.name,
                    "nh_output": w.nh_output,
                    "share_pct": round(w.nh_output / total_output * 100, 1)
                    if total_output
                    else 0.0,
                }
                for w in workers
            ),
            key=lambda x: x["nh_output"],
            reverse=True,
        ),
        top_products=[
            {"product": r.product, "fact_nh": round(sum(c.fact_nh for c in r.months), 2)}
            for r in sorted(
                board.rows,
                key=lambda r: sum(c.fact_nh for c in r.months),
                reverse=True,
            )
            if sum(c.fact_nh for c in r.months) > 0
        ][:10],
    )
