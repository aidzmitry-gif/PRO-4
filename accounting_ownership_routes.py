"""Reviewed organization assignment of existing production orders."""
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from config.access import is_package_allowed
from core.domain.models import Sku
from core.runtime.deps import get_core, get_session
from core.services.auth import (
    EffectiveIdentityLookupError,
    get_current_user,
    resolve_effective_oidc_user,
)
from modules.production.accounting_ownership import (
    OwnershipCommand,
    ProductionOrderOwnership,
    assign_order,
    order_snapshot,
)
from modules.production.models import ProductionOrder
from modules.production.order_completion import (
    CompletionCommand,
    OrderCompletion,
    complete_order,
    preview_completion,
)
from modules.production.order_creation import CreateOrderCommand, OrderCreationReceipt, create_order
from modules.production.output_documents import (
    OutputCommand,
    OutputConfirmation,
    OutputDocument,
    confirm_output,
    prepare_output,
    preview_output,
)
from modules.production.schemas import ProductionOrderOut, StageUpdate
from modules.wms.models import StockMovement
from modules.wms.production_material_issues import (
    ProductionMaterialIssue,
    ProductionMaterialIssueCommand,
    preview_material_issue,
    read_issue,
    record_material_issue,
)

router = APIRouter(tags=["Юрлица производства"])


async def transaction(session=Depends(get_session)):
    try:
        yield session
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Production ownership could not be committed") from exc
    except Exception:
        await session.rollback()
        raise


async def effective_user(session, user):
    try:
        user = await resolve_effective_oidc_user(user, session)
    except EffectiveIdentityLookupError as exc:
        raise HTTPException(503, "Current identity cannot be verified") from exc
    if user.local_status not in (None, "active") or not is_package_allowed("production", user.roles):
        raise HTTPException(403, "Active production access required")
    return user


async def context(org_id: int, session=Depends(transaction, scope="function"), core=Depends(get_core), user=Depends(get_current_user)):
    gateway = getattr(core.services, "accounting", None)
    if gateway is None:
        raise HTTPException(503, "Organization service is unavailable")
    user = await effective_user(session, user)
    await gateway.source_owner_authority(session, org_id, user)
    user = await effective_user(session, user)
    actor = await gateway.source_owner_authority(session, org_id, user)
    return session, gateway, user, actor


def response(data):
    return JSONResponse(jsonable_encoder(data, custom_encoder={Decimal: lambda value: format(value, "f")}),
        headers={"Cache-Control": "private, no-store"})


async def member_context(org_id: int, session=Depends(transaction, scope="function"), core=Depends(get_core), user=Depends(get_current_user)):
    gateway = getattr(core.services, "accounting", None)
    if gateway is None:
        raise HTTPException(503, "Organization service is unavailable")
    user = await effective_user(session, user)
    await gateway.source_member(session, org_id, user)
    user = await effective_user(session, user)
    await gateway.source_member(session, org_id, user)
    return session


async def output_context(org_id: int, x_expected_principal: str = Header(min_length=1),
    session=Depends(member_context), core=Depends(get_core), user=Depends(get_current_user)):
    user = await effective_user(session, user)
    gateway = core.services.accounting
    actor = await gateway.source_write_authority(session, org_id, user)
    if actor != x_expected_principal:
        raise HTTPException(409, "Current principal differs from the saved command")
    warehouse = getattr(core.services, "wms_reservations", None)
    return session, gateway, user, warehouse


async def material_member_context(org_id: int, session=Depends(transaction, scope="function"),
                                  core=Depends(get_core), user=Depends(get_current_user)):
    gateway = getattr(core.services, "accounting", None)
    if gateway is None:
        raise HTTPException(503, "Organization service is unavailable")
    user = await effective_user(session, user)
    await gateway.source_member(session, org_id, user)
    return session, gateway, user


@router.post("/organizations/{org_id}/output-preview")
async def output_preview(org_id: int, command: OutputCommand, ctx=Depends(output_context)):
    session, gateway, user, warehouse = ctx
    return response(await preview_output(session, gateway, org_id, user, command, warehouse_gateway=warehouse))


@router.post("/organizations/{org_id}/output-documents")
async def output_prepare(org_id: int, command: OutputCommand, ctx=Depends(output_context)):
    session, gateway, user, warehouse = ctx
    row = await prepare_output(session, gateway, org_id, user, command, warehouse_gateway=warehouse)
    return response({column.key: getattr(row, column.key) for column in row.__table__.columns})


@router.get("/organizations/{org_id}/output-documents/{request_id}")
async def output_result(org_id: int, request_id: UUID, session=Depends(member_context)):
    row = await session.scalar(select(OutputDocument).where(
        OutputDocument.organization_id == org_id, OutputDocument.request_id == str(request_id)))
    if row is None:
        raise HTTPException(404, "Production output document not found in this organization")
    return response({column.key: getattr(row, column.key) for column in row.__table__.columns})


@router.get("/organizations/{org_id}/output-documents")
async def output_register(org_id: int, session=Depends(member_context)):
    rows = (await session.execute(select(OutputDocument, OutputConfirmation).outerjoin(
        OutputConfirmation, OutputConfirmation.document_id == OutputDocument.id
    ).where(OutputDocument.organization_id == org_id).order_by(OutputDocument.id.desc()).limit(200))).all()
    return response([{"document": {c.key: getattr(document, c.key) for c in document.__table__.columns},
        "confirmation": None if confirmation is None else {c.key: getattr(confirmation, c.key)
            for c in confirmation.__table__.columns}} for document, confirmation in rows])


class ConfirmOutputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


@router.post("/organizations/{org_id}/output-documents/{request_id}/confirm")
async def output_confirm(org_id: int, request_id: UUID, command: ConfirmOutputCommand, ctx=Depends(output_context)):
    session, gateway, user, warehouse = ctx
    document = await session.scalar(select(OutputDocument).where(
        OutputDocument.organization_id == org_id, OutputDocument.request_id == str(request_id)))
    if document is None:
        raise HTTPException(404, "Production output document not found in this organization")
    row = await confirm_output(session, gateway, org_id, user, document.id, command.expected_digest,
        warehouse_gateway=warehouse)
    return response({column.key: getattr(row, column.key) for column in row.__table__.columns})


@router.get("/organizations/{org_id}/output-confirmations/{request_id}")
async def output_confirmation(org_id: int, request_id: UUID, session=Depends(member_context)):
    row = await session.scalar(select(OutputConfirmation).join(OutputDocument,
        OutputDocument.id == OutputConfirmation.document_id).where(
        OutputConfirmation.organization_id == org_id, OutputDocument.organization_id == org_id,
        OutputDocument.request_id == str(request_id)))
    if row is None:
        raise HTTPException(404, "Production output confirmation not found in this organization")
    return response({column.key: getattr(row, column.key) for column in row.__table__.columns})


@router.post("/organizations/{org_id}/material-issue-preview")
async def material_issue_preview(org_id: int, command: ProductionMaterialIssueCommand,
                                 ctx=Depends(material_member_context)):
    session, gateway, user = ctx
    return response(await preview_material_issue(session, gateway, org_id, user, command))


@router.post("/organizations/{org_id}/material-issues", status_code=201)
async def material_issue_create(org_id: int, command: ProductionMaterialIssueCommand,
                                ctx=Depends(output_context)):
    session, gateway, user, _ = ctx
    row, movement = await record_material_issue(session, gateway, org_id, user, command)
    return response({"issue": {column.key: getattr(row, column.key) for column in row.__table__.columns},
                     "movement": {column.key: getattr(movement, column.key) for column in movement.__table__.columns},
                     "posted": True, "final_cost_certified": False})


@router.get("/organizations/{org_id}/material-issues")
async def material_issue_register(org_id: int, session=Depends(member_context)):
    rows = (await session.scalars(select(ProductionMaterialIssue).where(
        ProductionMaterialIssue.organization_id == org_id).order_by(ProductionMaterialIssue.id.desc()).limit(200))).all()
    result = []
    for row in rows:
        movement = await session.get(StockMovement, row.movement_id)
        result.append({"issue": {column.key: getattr(row, column.key) for column in row.__table__.columns},
                       "movement": None if movement is None else {column.key: getattr(movement, column.key) for column in movement.__table__.columns},
                       "posted": True, "final_cost_certified": False})
    return response(result)


@router.get("/organizations/{org_id}/material-issues/{request_id}")
async def material_issue_read(org_id: int, request_id: UUID, session=Depends(member_context)):
    row, movement = await read_issue(session, org_id, request_id)
    return response({"issue": {column.key: getattr(row, column.key) for column in row.__table__.columns},
                     "movement": {column.key: getattr(movement, column.key) for column in movement.__table__.columns},
                     "posted": True, "final_cost_certified": False})


async def organization_orders(session, org_id):
    return (await session.scalars(select(ProductionOrder).join(
        ProductionOrderOwnership, ProductionOrderOwnership.order_id == ProductionOrder.id
    ).where(ProductionOrderOwnership.organization_id == org_id).order_by(ProductionOrder.id.desc()))).all()


@router.get("/organizations/{org_id}/output-skus")
async def output_skus(org_id: int, q: str = Query(min_length=1, max_length=100), session=Depends(member_context)):
    rows = (await session.scalars(select(Sku).where(Sku.is_active.is_(True), func.length(func.trim(Sku.unit)) > 0,
        or_(Sku.code.icontains(q, autoescape=True), Sku.title.icontains(q, autoescape=True)))
        .order_by(Sku.code, Sku.id).limit(50))).all()
    return response([{"code": row.code, "title": row.title, "unit": row.unit} for row in rows])


@router.get("/organizations/{org_id}/output-places")
async def output_places(org_id: int, q: str = Query(min_length=1, max_length=100),
    session=Depends(member_context), core=Depends(get_core)):
    warehouse = getattr(core.services, "wms_reservations", None)
    if warehouse is None:
        raise HTTPException(503, "Warehouse receiving place service is unavailable")
    return response(await warehouse.receiving_places(session, org_id, q))


@router.get("/organizations/{org_id}/orders/{order_id}/output-source")
async def output_order_source(org_id: int, order_id: int, session=Depends(member_context)):
    order = await session.scalar(select(ProductionOrder).join(ProductionOrderOwnership,
        ProductionOrderOwnership.order_id == ProductionOrder.id).where(
        ProductionOrder.id == order_id, ProductionOrderOwnership.organization_id == org_id).with_for_update())
    if order is None:
        raise HTTPException(404, "Production order not found in this organization")
    snapshot, digest = order_snapshot(order)
    return response({"organization_id": org_id, "snapshot": snapshot, "digest": digest})


@router.get("/organizations/{org_id}/orders/{order_id}/output-reconciliation")
async def output_reconciliation(org_id: int, order_id: int, session=Depends(member_context), core=Depends(get_core)):
    from modules.production.output_reconciliation import reconcile_output

    return response(await reconcile_output(session, org_id, order_id, getattr(core.services, "wms_reservations", None)))


@router.get("/organizations/{org_id}/orders/{order_id}/completion-preview")
async def completion_preview(org_id: int, order_id: int, session=Depends(member_context), core=Depends(get_core)):
    return response(await preview_completion(session, org_id, order_id, getattr(core.services, "wms_reservations", None)))


@router.post("/organizations/{org_id}/orders/{order_id}/completion")
async def completion_create(org_id: int, order_id: int, command: CompletionCommand, ctx=Depends(output_context)):
    session, gateway, user, warehouse = ctx
    row = await complete_order(session, gateway, org_id, user, order_id, command, warehouse)
    return response({c.key: getattr(row, c.key) for c in row.__table__.columns})


@router.get("/organizations/{org_id}/orders/{order_id}/completion")
async def completion_result(org_id: int, order_id: int, session=Depends(member_context)):
    row = await session.get(OrderCompletion, order_id)
    if row is None or row.organization_id != org_id:
        raise HTTPException(404, "Order completion not found in this organization")
    return response({c.key: getattr(row, c.key) for c in row.__table__.columns})


@router.get("/organizations/{org_id}/access")
async def access(org_id: int, session=Depends(member_context), core=Depends(get_core), user=Depends(get_current_user)):
    user = await effective_user(session, user)
    gateway = core.services.accounting
    actor = await gateway.source_member(session, org_id, user)
    permissions = {}
    for name, authorize in (("can_create", gateway.source_owner_authority),
                            ("can_change_stage", gateway.source_write_authority)):
        try:
            await authorize(session, org_id, user)
            permissions[name] = True
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
            permissions[name] = False
    return response({"organization_id": org_id, "principal": actor, **permissions})


@router.get("/order-organizations")
async def organizations(session=Depends(transaction, scope="function"), core=Depends(get_core), user=Depends(get_current_user)):
    gateway = getattr(core.services, "accounting", None)
    if gateway is None:
        raise HTTPException(503, "Organization service is unavailable")
    user = await effective_user(session, user)
    return response(await gateway.source_organizations(session, user))


@router.patch("/organizations/{org_id}/orders/{order_id}")
async def change_stage(org_id: int, order_id: int, payload: StageUpdate,
    x_expected_principal: str = Header(min_length=1), session=Depends(member_context),
    core=Depends(get_core), user=Depends(get_current_user)):
    from modules.production.routes import transition_order

    user = await effective_user(session, user)
    actor = await core.services.accounting.source_write_authority(session, org_id, user)
    if actor != x_expected_principal:
        raise HTTPException(409, "Current principal differs from the saved command")
    order = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == order_id)
        .with_for_update().execution_options(populate_existing=True))
    ownership = await session.get(ProductionOrderOwnership, order_id)
    if order is None or ownership is None or ownership.organization_id != org_id:
        raise HTTPException(404, "Production order not found in this organization")
    if payload.stage == "done" and await session.scalar(select(OutputConfirmation.document_id)
        .where(OutputConfirmation.order_id == order_id).limit(1)) is not None:
        raise HTTPException(409, "Confirmed output requires document-based completion")
    transition_order(order, payload, session, core, org_id)
    await session.flush()
    return response(ProductionOrderOut.model_validate(order))


@router.get("/organizations/{org_id}/orders")
async def orders(org_id: int, session=Depends(member_context)):
    rows = await organization_orders(session, org_id)
    return response([ProductionOrderOut.model_validate(row) for row in rows])


@router.post("/organizations/{org_id}/orders")
async def create(org_id: int, command: CreateOrderCommand,
    x_expected_principal: str = Header(min_length=1), ctx=Depends(context)):
    session, gateway, user, actor = ctx
    if actor != x_expected_principal:
        raise HTTPException(409, "Current principal differs from the saved command")
    return response(await create_order(session, gateway, org_id, user, command))


@router.get("/organizations/{org_id}/order-creations/{request_id}")
async def creation_result(org_id: int, request_id: UUID, session=Depends(member_context)):
    receipt = await session.scalar(select(OrderCreationReceipt).where(
        OrderCreationReceipt.organization_id == org_id,
        OrderCreationReceipt.request_id == str(request_id)))
    if receipt is None:
        raise HTTPException(404, "Production creation result not found in this organization")
    return response({column.key: getattr(receipt, column.key) for column in receipt.__table__.columns})


@router.get("/organizations/{org_id}/board")
async def board(org_id: int, session=Depends(member_context)):
    from core.runtime.funnel import build_board
    from modules.production.routes import _to_card
    from modules.production.stages import STAGES

    unit = OutputDocument.snapshot["sku_snapshot"]["unit"].as_string()
    output_rows = (await session.execute(select(OutputConfirmation.order_id,
        func.sum(OutputConfirmation.quantity).label("quantity"), unit.label("unit"))
        .join(OutputDocument, OutputDocument.id == OutputConfirmation.document_id)
        .where(OutputConfirmation.organization_id == org_id, OutputDocument.organization_id == org_id)
        .group_by(OutputConfirmation.order_id, unit))).all()
    outputs = {}
    for row in output_rows:
        if row.order_id in outputs or not row.unit:
            raise HTTPException(409, "Confirmed output units require reconciliation")
        outputs[row.order_id] = row

    def card(order):
        result = _to_card(order)
        output = outputs.get(order.id)
        if output is not None:
            # Legacy progress is a planning estimate, not confirmed physical output.
            result.progress = None
            result.tags = [tag for tag in result.tags if tag != f"{order.qty} шт"]
            result.tags.extend([f"По наряду: {order.qty}", f"Подтверждён выпуск: {output.quantity:.2f} {output.unit}"])
        return result

    return response(build_board(STAGES, await organization_orders(session, org_id), card))


@router.get("/organizations/{org_id}/orders/{order_id}/ownership-preview")
async def preview(org_id: int, order_id: int, ctx=Depends(context)):
    session, _, _, actor = ctx
    # Serialize review with cross-company assignment before checking ownership.
    order = await session.scalar(select(ProductionOrder).where(ProductionOrder.id == order_id)
        .with_for_update().execution_options(populate_existing=True))
    if order is None:
        raise HTTPException(404, "Production order not found")
    ownership = await session.get(ProductionOrderOwnership, order_id)
    if ownership is not None and ownership.organization_id != org_id:
        raise HTTPException(404, "Production order not found in this organization")
    snapshot, digest = order_snapshot(order)
    return response({"organization_id": org_id, "principal": actor, "snapshot": snapshot, "digest": digest,
        "assigned": ownership is not None,
        "ownership": None if ownership is None else {column.key: getattr(ownership, column.key) for column in ownership.__table__.columns}})


@router.post("/organizations/{org_id}/order-ownership")
async def confirm(org_id: int, command: OwnershipCommand, x_expected_principal: str = Header(min_length=1), ctx=Depends(context)):
    session, gateway, user, actor = ctx
    if x_expected_principal != actor:
        raise HTTPException(409, "Current principal differs from the saved command")
    row = await assign_order(session, gateway, org_id, user, command)
    return response({column.key: getattr(row, column.key) for column in row.__table__.columns})
