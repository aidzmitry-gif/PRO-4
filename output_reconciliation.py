"""Read confirmed output and warehouse facts under the caller's company authority."""
from fastapi import HTTPException
from sqlalchemy import select

from modules.production.accounting_ownership import ProductionOrderOwnership
from modules.production.models import ProductionOrder
from modules.production.output_documents import OutputConfirmation, OutputDocument, output_payload


async def reconcile_output(session, org_id, order_id, warehouse):
    from decimal import Decimal

    order = await session.scalar(select(ProductionOrder).join(ProductionOrderOwnership,
        ProductionOrderOwnership.order_id == ProductionOrder.id).where(
        ProductionOrder.id == order_id, ProductionOrderOwnership.organization_id == org_id).with_for_update())
    if order is None:
        raise HTTPException(404, "Production order not found in this organization")
    if warehouse is None:
        raise HTTPException(503, "Warehouse reconciliation service unavailable")
    rows = (await session.execute(select(OutputDocument, OutputConfirmation).join(OutputConfirmation,
        OutputConfirmation.document_id == OutputDocument.id).where(OutputDocument.order_id == order_id,
        OutputDocument.organization_id == org_id, OutputConfirmation.organization_id == org_id)
        .order_by(OutputDocument.id))).all()
    confirmed = accepted = rejected = pending = Decimal("0")
    units = {(d.snapshot["sku_snapshot"]["code"], d.snapshot["sku_snapshot"]["unit"]) for d, _ in rows}
    lots = {d.command.get("lot") for d, _ in rows if isinstance(d.command.get("lot"), str) and d.command.get("lot")}
    if len(units) > 1:
        raise HTTPException(409, "Confirmed output SKU or unit requires reconciliation")
    items = []
    try:
        for document, confirmation in rows:
            state = await warehouse.production_receipt_status(session, org_id, confirmation.event_id, output_payload(document))
            confirmed += confirmation.quantity
            if state["state"] == "accepted":
                accepted += Decimal(state["accepted_quantity"])
                rejected += Decimal(state["rejected_quantity"])
            else:
                pending += confirmation.quantity
            items.append({"document_id": document.id, "request_id": document.request_id,
                "sku_code": document.snapshot["sku_snapshot"]["code"],
                "lot": document.command.get("lot"),
                "operation_date": document.command["operation_date"],
                "quantity": format(confirmation.quantity, ".2f"), **state})
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"organization_id": org_id, "order_id": order_id, "planned_quantity": str(order.qty),
        "confirmed_quantity": format(confirmed, ".2f"), "accepted_quantity": format(accepted, ".2f"),
        "rejected_quantity": format(rejected, ".2f"), "pending_quantity": format(pending, ".2f"),
        "documents": items, "sku_code": next(iter(units))[0] if units else None,
        "lot": next(iter(lots)) if len(lots) == 1 else None,
        "unit": next(iter(units))[1] if units else None,
        "scope": "confirmed_output_documents", "accounting_final": False}
