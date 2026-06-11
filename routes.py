"""HTTP-API модуля Production. Монтируется под префиксом ``/production``."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.runtime.core import Core
from core.runtime.deps import get_core, get_session
from core.runtime.funnel import FunnelBoardOut, FunnelCard, build_board
from modules.production.models import ProductionNorm, ProductionOrder
from modules.production.schemas import (
    NormCreate,
    NormOut,
    NormUpdate,
    ProductionOrderCreate,
    ProductionOrderOut,
    StageUpdate,
)
from modules.production.stages import STAGES

router = APIRouter(tags=["production"])

# Переход в эту стадию = наряд готов → приход на склад (production → wms).
COMPLETED_STAGE = "done"


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
