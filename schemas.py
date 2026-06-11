"""Pydantic-схемы модуля Production."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ProductionOrderCreate(BaseModel):
    product: str
    qty: int = 1
    progress: int = 0
    priority: str = "Средний"
    owner: str = ""
    stage: str = "queue"
    number: str = ""
    due_date: str | None = None
    insight: str = ""
    nh_per_unit: float = 0.0  # 0 → подставится из утверждённой нормы справочника
    made_qty: int = 0


class ProductionOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    product: str
    qty: int
    progress: int
    priority: str
    owner: str
    stage: str
    due_date: str | None = None
    insight: str = ""
    nh_per_unit: float = 0.0
    made_qty: int = 0


class StageUpdate(BaseModel):
    stage: str


class NormCreate(BaseModel):
    title: str
    kind: str = "product"  # product | operation
    nh: float = 0.0
    note: str = ""


class NormUpdate(BaseModel):
    title: str | None = None
    nh: float | None = None
    note: str | None = None


class NormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    nh: float
    status: str
    note: str = ""
