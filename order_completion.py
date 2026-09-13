"""Physical order completion, separate from warehouse arrival and accounting close."""
import hashlib
import json
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, DateTime, ForeignKey, String, event, func, select
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base
from modules.production.accounting_ownership import immutable, order_snapshot
from modules.production.models import ProductionOrder
from modules.production.output_documents import OutputConfirmation, OutputDocument
from modules.production.output_reconciliation import reconcile_output


class CompletionCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    operation_date: date
    evidence: str = Field(min_length=10, max_length=1000)


class OrderCompletion(Base):
    __tablename__ = "order_completion"
    __table_args__ = {"schema": "production"}
    order_id: Mapped[int] = mapped_column(ForeignKey("production.order_ownership.order_id"), primary_key=True)
    organization_id: Mapped[int] = mapped_column()
    command: Mapped[dict] = mapped_column(JSON)
    snapshot: Mapped[dict] = mapped_column(JSON)
    actor: Mapped[str] = mapped_column(String(200))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


event.listen(OrderCompletion, "before_update", immutable)
event.listen(OrderCompletion, "before_delete", immutable)


async def preview_completion(session, org_id, order_id, warehouse):
    reconciliation = await reconcile_output(session, org_id, order_id, warehouse)
    order = await session.get(ProductionOrder, order_id)
    if order.completed_at is not None or order.stage == "done":
        raise HTTPException(409, "Order is already completed; read its stored completion")
    planned = Decimal(order.qty)
    if (planned <= 0 or Decimal(reconciliation["confirmed_quantity"]) != planned
        or Decimal(reconciliation["accepted_quantity"]) != planned
        or Decimal(reconciliation["pending_quantity"]) != 0 or Decimal(reconciliation["rejected_quantity"]) != 0):
        raise HTTPException(409, "Completion requires the full ordered quantity accepted without pending output or rejection")
    documents = (await session.scalars(select(OutputDocument).join(OutputConfirmation,
        OutputConfirmation.document_id == OutputDocument.id).where(OutputDocument.order_id == order_id,
        OutputDocument.organization_id == org_id))).all()
    minimum_date = max(d.command["operation_date"] for d in documents)
    snapshot = {"order": order_snapshot(order)[0], "reconciliation": reconciliation, "minimum_date": minimum_date}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return {"snapshot": snapshot, "digest": digest}


async def complete_order(session, gateway, org_id, user, order_id, command, warehouse):
    actor = await gateway.source_write_authority(session, org_id, user)
    existing = await session.get(OrderCompletion, order_id)
    normalized = command.model_dump(mode="json")
    if existing is not None:
        if existing.organization_id != org_id:
            raise HTTPException(404, "Order completion not found in this organization")
        if existing.actor != actor or existing.command != normalized:
            raise HTTPException(409, "Completion differs from the saved decision")
        return existing
    reviewed = await preview_completion(session, org_id, order_id, warehouse)
    if reviewed["digest"] != command.expected_digest:
        raise HTTPException(409, "Output reconciliation changed; review completion again")
    if normalized["operation_date"] < reviewed["snapshot"]["minimum_date"]:
        raise HTTPException(409, "Completion date cannot precede the confirmed output dates")
    row = OrderCompletion(order_id=order_id, organization_id=org_id, command=normalized,
        snapshot=reviewed["snapshot"], actor=actor)
    session.add(row)
    await session.flush()
    order = await session.get(ProductionOrder, order_id)
    order.stage, order.progress, order.made_qty = "done", 100, order.qty
    order.completed_at = datetime.combine(command.operation_date, time.min)
    await session.flush()
    return row
