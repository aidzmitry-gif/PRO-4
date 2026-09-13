"""Explicit company mapping of an existing production order; no default owner."""
import hashlib
import json
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, event, func, select
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base
from modules.production.models import ProductionOrder


class OwnershipCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    order_id: int = Field(gt=0, strict=True)
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence: str = Field(min_length=10, max_length=1000)


class ProductionOrderOwnership(Base):
    __tablename__ = "order_ownership"
    __table_args__ = {"schema": "production"}
    order_id: Mapped[int] = mapped_column(ForeignKey("production.production_order.id"), primary_key=True)
    organization_id: Mapped[int] = mapped_column(Integer, index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    digest: Mapped[str] = mapped_column(String(64))
    evidence: Mapped[str] = mapped_column(String(1000))
    actor: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def immutable(mapper, connection, target):
    raise ValueError("Production order ownership is immutable")


event.listen(ProductionOrderOwnership, "before_update", immutable)
event.listen(ProductionOrderOwnership, "before_delete", immutable)


def order_snapshot(order):
    # Planning floats and foreman names cannot imply inventory cost or company.
    snapshot = {"order_id": order.id, "number": order.number, "product": order.product,
        "quantity": order.qty, "stage": order.stage,
        "created_at": order.created_at.isoformat() if order.created_at else None}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return snapshot, digest


async def assign_order(session, gateway, organization_id, user, command: OwnershipCommand):
    """Caller owns transaction and effective identity; chief confirms mapping."""
    actor = await gateway.source_owner_authority(session, organization_id, user)
    # Same order lock serializes assignments even when callers select different companies.
    order = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == command.order_id)
        .with_for_update().execution_options(populate_existing=True))
    if order is None:
        raise HTTPException(404, "Production order not found")
    existing = await session.get(ProductionOrderOwnership, command.order_id)
    if existing is not None:
        if (existing.organization_id != organization_id or existing.digest != command.expected_digest
            or existing.evidence != command.evidence or existing.actor != actor):
            raise HTTPException(409, "Production order ownership conflicts with the saved decision")
        return existing
    snapshot, digest = order_snapshot(order)
    if digest != command.expected_digest:
        raise HTTPException(409, "Production order changed; review ownership again")
    ownership = ProductionOrderOwnership(order_id=order.id, organization_id=organization_id,
        snapshot=snapshot, digest=digest, evidence=command.evidence, actor=actor)
    session.add(ownership)
    await session.flush()
    return ownership
