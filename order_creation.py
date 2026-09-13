"""Atomic, replayable creation of an explicitly owned production order."""
import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint, event, select
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base
from modules.production.accounting_ownership import (
    OwnershipCommand,
    assign_order,
    immutable,
    order_snapshot,
)
from modules.production.schemas import ProductionOrderCreate, ProductionOrderOut


class CreateOrderCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    product: str = Field(min_length=1, max_length=255)
    quantity: int = Field(gt=0, strict=True, le=2147483647)
    evidence: str = Field(min_length=10, max_length=1000)


class OrderCreationReceipt(Base):
    __tablename__ = "order_creation_receipt"
    __table_args__ = (UniqueConstraint("organization_id", "request_id"), {"schema": "production"})
    order_id: Mapped[int] = mapped_column(ForeignKey("production.order_ownership.order_id"), primary_key=True)
    organization_id: Mapped[int] = mapped_column()
    request_id: Mapped[str] = mapped_column(String(36))
    digest: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(200))
    command: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)


event.listen(OrderCreationReceipt, "before_update", immutable)
event.listen(OrderCreationReceipt, "before_delete", immutable)


async def create_order(session, gateway, organization_id, user, command: CreateOrderCommand):
    from modules.production.routes import prepare_order

    actor = await gateway.source_owner_authority(session, organization_id, user)
    normalized = command.model_dump(mode="json")
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, ensure_ascii=False,
        separators=(",", ":")).encode()).hexdigest()
    receipt = await session.scalar(select(OrderCreationReceipt).where(
        OrderCreationReceipt.organization_id == organization_id,
        OrderCreationReceipt.request_id == str(command.request_id)))
    if receipt is not None:
        if receipt.actor != actor or receipt.digest != digest or receipt.command != normalized:
            raise HTTPException(409, "Production creation key conflicts with the original command")
        return receipt.result
    order = await prepare_order(ProductionOrderCreate(product=command.product, qty=command.quantity), session)
    await assign_order(session, gateway, organization_id, user, OwnershipCommand(
        order_id=order.id, expected_digest=order_snapshot(order)[1], evidence=command.evidence))
    result = ProductionOrderOut.model_validate(order).model_dump(mode="json")
    session.add(OrderCreationReceipt(order_id=order.id, organization_id=organization_id,
        request_id=str(command.request_id), digest=digest, actor=actor, command=normalized, result=result))
    await session.flush()
    return result
