"""Обработчики событий модуля Production (подписки на шину).

- ``sales.deal.handoff``        → завести ``ProductionPlan`` под сделку (идемпотентно по ``deal_id``).
- ``procurement.order.received`` → материалы приехали; graceful no-op (не падаем при отсутствии
  связанного плана — полноценная проводка резерва материалов появится с MRP).

Обработчики с сигнатурой ``(payload, ctx)`` получают ``ctx`` (сессия + сервисы) — как и
подписчики sales/finance. Транзакцией владеет relay-цикл шины: здесь только ``add``/``flush``,
без ``commit`` (эталон — ``modules.sales.events.on_shipment_delivered``).
"""
from __future__ import annotations

import logging

from sqlalchemy import select

logger = logging.getLogger(__name__)


async def on_deal_handoff(payload: dict, ctx) -> None:
    """sales.deal.handoff → плановая строка под сделку (идемпотентно по ``deal_id``).

    Повторный emit того же handoff не плодит дубль: перед вставкой ищем строку с этим
    ``deal_id`` (``flush`` делает уже добавленную в этом же relay-проходе видимой для SELECT).

    Строка живёт ВНЕ календарной S&OP-матрицы: ``year=0`` (реальные чтения плана фильтруют по
    фактическому году и её не видят), ``month=deal_id`` — держит кортеж ``(year, product, month)``
    уникальным per-deal под ограничением ``uq_production_plan_cell``. Привязку к реальному
    периоду добавит MRP.
    """
    if ctx is None:
        return
    deal_id = payload.get("deal_id")
    if not deal_id:
        # handoff без deal_id — нечем гарантировать идемпотентность, пропускаем.
        return

    from modules.production.models import ProductionPlan

    existing = (
        await ctx.session.execute(
            select(ProductionPlan.id).where(ProductionPlan.deal_id == deal_id)
        )
    ).first()
    if existing is not None:
        return  # идемпотентность: план по этой сделке уже заведён.

    ctx.session.add(
        ProductionPlan(
            deal_id=deal_id,
            source_event="sales.deal.handoff",
            product=payload.get("product", ""),
            year=0,              # sentinel: строка вне календарной S&OP-матрицы
            month=int(deal_id),  # уникальность (year, product, month) per-deal под year=0
            plan_qty=int(payload.get("qty") or 0),
        )
    )
    await ctx.session.flush()  # видимость для идемпотентной проверки следующего handoff в этом relay
    logger.info("Production: план по сделке %s заведён (sales.deal.handoff)", deal_id)


async def on_order_received(payload: dict, ctx) -> None:
    """procurement.order.received → материалы получены (информационно, graceful).

    Пока no-op: точка расширения под будущий MRP (списание резерва материалов под план).
    Никогда не бросает — при неизвестном PO/отсутствии связанного плана relay не должен падать.
    """
    if ctx is None:
        return
    logger.info(
        "Production: материалы получены (PO=%s) — план-хук пока no-op",
        payload.get("po_number"),
    )
