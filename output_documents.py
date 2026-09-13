"""Reviewed facts for a production output document; no stock or ledger mutation."""
import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    event,
    func,
    select,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base
from core.domain.models import OutboxEvent, Sku
from modules.production.accounting_ownership import (
    ProductionOrderOwnership,
    immutable,
    order_snapshot,
)
from modules.production.models import ProductionOrder


class OutputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    order_id: int = Field(gt=0, strict=True)
    expected_order_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    operation_date: date
    sku_code: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    warehouse: str = Field(min_length=1, max_length=128)
    location_id: int = Field(gt=0, strict=True)
    lot: str = Field(min_length=1, max_length=64)
    evidence: str = Field(min_length=10, max_length=1000)

    @field_serializer("quantity")
    def serialize_quantity(self, value: Decimal):
        return format(value, ".2f")

    @field_validator("quantity", mode="before")
    @classmethod
    def exact_quantity(cls, value):
        if not isinstance(value, (str, Decimal)):
            raise ValueError("Output quantity requires an exact decimal string")
        return value


class OutputDocument(Base):
    """Immutable prepared source; does not imply stock acceptance or accounting posting."""
    __tablename__ = "output_document"
    __table_args__ = (UniqueConstraint("organization_id", "request_id"), {"schema": "production"})
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column()
    order_id: Mapped[int] = mapped_column(ForeignKey("production.order_ownership.order_id"))
    request_id: Mapped[str] = mapped_column(String(36))
    command: Mapped[dict] = mapped_column(JSON)
    snapshot: Mapped[dict] = mapped_column(JSON)
    digest: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(200))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


event.listen(OutputDocument, "before_update", immutable)
event.listen(OutputDocument, "before_delete", immutable)


class OutputConfirmation(Base):
    """Confirmed output quantity with an atomically registered warehouse event."""
    __tablename__ = "output_confirmation"
    __table_args__ = {"schema": "production"}
    document_id: Mapped[int] = mapped_column(ForeignKey("production.output_document.id"), primary_key=True)
    organization_id: Mapped[int] = mapped_column()
    order_id: Mapped[int] = mapped_column(ForeignKey("production.order_ownership.order_id"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("outbox_event.id"), unique=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    digest: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(200))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


event.listen(OutputConfirmation, "before_update", immutable)
event.listen(OutputConfirmation, "before_delete", immutable)


async def confirm_output(session, gateway, organization_id, user, document_id, expected_digest, *, warehouse_gateway):
    """Caller owns transaction; confirmation and warehouse event commit together."""
    actor = await gateway.source_write_authority(session, organization_id, user)
    document = await session.get(OutputDocument, document_id)
    if document is None or document.organization_id != organization_id:
        raise HTTPException(404, "Output document not found in this organization")
    if document.digest != expected_digest:
        raise HTTPException(409, "Output document differs from the reviewed version")
    # Order lock also serializes distinct documents for the same production order.
    order = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == document.order_id)
        .with_for_update().execution_options(populate_existing=True))
    existing = await session.get(OutputConfirmation, document_id)
    if existing is not None:
        if existing.actor != actor:
            raise HTTPException(409, "Output confirmation belongs to another principal")
        return existing
    command = OutputCommand.model_validate(document.command)
    current = await preview_output(session, gateway, organization_id, user, command, warehouse_gateway=warehouse_gateway)
    if {**current, "principal": document.actor} != document.snapshot:
        raise HTTPException(409, "Output source changed; prepare a new document")
    previous = (await session.execute(select(OutputConfirmation.quantity, OutputDocument.snapshot)
        .join(OutputDocument, OutputDocument.id == OutputConfirmation.document_id)
        .where(OutputConfirmation.order_id == document.order_id))).all()
    for _, snapshot in previous:
        if snapshot["sku_snapshot"]["code"] != current["sku_snapshot"]["code"] or snapshot["sku_snapshot"]["unit"] != current["sku_snapshot"]["unit"]:
            raise HTTPException(409, "Partial outputs must use the same catalog SKU and unit")
    if sum((row.quantity for row in previous), Decimal("0")) + command.quantity > order.qty:
        raise HTTPException(409, "Confirmed output exceeds the production order quantity")
    await gateway.source_changed(session, organization_id, user, f"production:output:{document.id}",
        1, command.operation_date.isoformat())
    source_event = OutboxEvent(event_type="production.output.confirmed", version=1, payload=output_payload(document))
    session.add(source_event)
    await session.flush()
    result = OutputConfirmation(document_id=document.id, organization_id=organization_id, event_id=source_event.id,
        order_id=document.order_id, quantity=command.quantity, digest=document.digest, actor=actor)
    session.add(result)
    await session.flush()
    return result


def output_payload(document):
    command = document.command
    return {"output_document_id": document.id, "output_digest": document.digest,
        "organization_id": document.organization_id, "sku_code": command["sku_code"],
        "qty": command["quantity"], "warehouse": command["warehouse"],
        "location_id": command["location_id"], "lot": command["lot"],
        "operation_date": command["operation_date"], "entity_ref": f"production_output:{document.id}"}


class ProductionOutputService:
    async def cost_orders(self, session, organization_id, order_ids):
        if not order_ids or len(order_ids) != len(set(order_ids)) or any(type(v) is not int or v <= 0 for v in order_ids):
            raise ValueError('Explicit unique production cost order identities required')
        orders = (await session.scalars(select(ProductionOrder).join(ProductionOrderOwnership,
            ProductionOrderOwnership.order_id == ProductionOrder.id).where(
            ProductionOrderOwnership.organization_id == organization_id, ProductionOrder.id.in_(order_ids))
            .order_by(ProductionOrder.id).with_for_update(of=ProductionOrder)
            .execution_options(populate_existing=True))).all()
        if len(orders) != len(order_ids):
            raise ValueError('Every production cost order must belong to the selected organization')
        return [order_snapshot(order)[0] for order in orders]

    async def validate_delivery(self, session, event_id, payload):
        if type(payload.get("output_document_id")) is not int:
            raise ValueError("Output delivery requires a document identity")
        confirmation = await session.get(OutputConfirmation, payload["output_document_id"])
        if confirmation is None or confirmation.event_id != event_id:
            raise ValueError("Output event is not bound to a confirmation")
        document = await session.get(OutputDocument, confirmation.document_id)
        if document is None or json.dumps(output_payload(document), sort_keys=True) != json.dumps(payload, sort_keys=True):
            raise ValueError("Output delivery differs from its confirmed document")
        return document.snapshot

    async def output_reconciliation(self, session, organization_id, order_id, warehouse_gateway):
        if warehouse_gateway is None:
            raise ValueError("Warehouse reconciliation service unavailable")
        from modules.production.output_reconciliation import reconcile_output

        return await reconcile_output(session, organization_id, order_id, warehouse_gateway)


async def prepare_output(session, gateway, organization_id, user, command: OutputCommand, *, warehouse_gateway):
    actor = await gateway.source_write_authority(session, organization_id, user)
    normalized = command.model_dump(mode="json")
    existing = await session.scalar(select(OutputDocument).where(
        OutputDocument.organization_id == organization_id, OutputDocument.request_id == str(command.request_id)))
    if existing is not None:
        if existing.actor != actor or existing.command != normalized:
            raise HTTPException(409, "Output request key conflicts with the original document")
        return existing
    snapshot = await preview_output(session, gateway, organization_id, user, command, warehouse_gateway=warehouse_gateway)
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    document = OutputDocument(organization_id=organization_id, order_id=command.order_id,
        request_id=str(command.request_id), actor=actor, command=normalized, snapshot=snapshot, digest=digest)
    session.add(document)
    await session.flush()
    return document


async def preview_output(session, gateway, organization_id, user, command: OutputCommand, *, warehouse_gateway=None):
    actor = await gateway.source_write_authority(session, organization_id, user)
    order = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == command.order_id)
        .with_for_update().execution_options(populate_existing=True))
    owner = await session.get(ProductionOrderOwnership, command.order_id)
    if order is None or owner is None or owner.organization_id != organization_id:
        raise HTTPException(404, "Production order not found in this organization")
    snapshot, digest = order_snapshot(order)
    if digest != command.expected_order_digest:
        raise HTTPException(409, "Production order changed; review output again")
    if order.completed_at is not None or order.stage == "done":
        raise HTTPException(409, "Existing completed output requires reconciliation before a new output document")
    sku = await session.scalar(select(Sku).where(Sku.code == command.sku_code)
        .with_for_update().execution_options(populate_existing=True))
    if sku is None or not sku.is_active or not sku.unit or not sku.unit.strip():
        raise HTTPException(409, "Output requires an active catalog SKU with a unit")
    if warehouse_gateway is None:
        raise HTTPException(503, "Warehouse receiving place service is unavailable")
    place = await warehouse_gateway.receiving_place(session, command.warehouse, command.location_id)
    return {"organization_id": organization_id, "principal": actor,
        "command": command.model_dump(mode="json"), "order_snapshot": snapshot,
        "sku_snapshot": {"id": sku.id, "code": sku.code, "title": sku.title, "unit": sku.unit},
        "receiving_place": place, "posted": False, "confirmation_available": False}
