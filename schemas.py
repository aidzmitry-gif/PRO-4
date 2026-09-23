"""Pydantic-схемы модуля Production."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


# ===== Выработка и оценка =====


class WorkerCreate(BaseModel):
    name: str
    salary: float = 0.0
    days_worked: int = 0
    nh_output: float = 0.0


class WorkerUpdate(BaseModel):
    name: str | None = None
    salary: float | None = None
    days_worked: int | None = None
    nh_output: float | None = None


class WorkerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    salary: float
    days_worked: int
    nh_output: float


class PayrollRow(BaseModel):
    id: int
    name: str
    nh_output: float
    base: float       # оклад × дни / 22
    premium: float    # выработка × премиальная ставка
    total: float      # base + premium
    contribution: float  # стоимость выработки (для рейтинга вклада)


class PayrollOut(BaseModel):
    rows: list[PayrollRow]          # отсортированы по вкладу (лидеры первыми)
    total_nh: float
    total_base: float
    total_premium: float
    total_payroll: float
    calculation_scope: Literal["management_estimate"]
    accounting_posting_available: bool
    statutory_payroll_certified: bool


# ===== ОТК =====


class QcDecisionIn(BaseModel):
    decision: str  # accept | rework | scrap
    order_code: str = ""
    product: str = ""
    reason: str = ""
    inspector: str = ""


class QcOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_code: str
    product: str
    decision: str
    reason: str
    inspector: str


class QcStats(BaseModel):
    accepted: int
    rework: int
    scrap: int
    total: int
    pass_rate: float  # принято / всего, %


# ===== Спецификации · BOM =====


class BomCreate(BaseModel):
    product: str
    version: str = "v1"
    note: str = ""


class BomUpdate(BaseModel):
    product: str | None = None
    version: str | None = None
    note: str | None = None


class BomItemCreate(BaseModel):
    component: str
    norm_qty: float = 0.0
    unit: str = "шт"
    stock: float = 0.0
    reserved: float = 0.0


class BomItemUpdate(BaseModel):
    component: str | None = None
    norm_qty: float | None = None
    unit: str | None = None
    stock: float | None = None
    reserved: float | None = None


class BomItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bom_id: int
    component: str
    norm_qty: float
    unit: str
    stock: float
    reserved: float
    status: str = "ok"  # ok | short — вычисляется (доступно ≥ норма)


class BomOut(BaseModel):
    """Строка списка спецификаций (без позиций) + агрегаты обеспеченности."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product: str
    version: str
    status: str
    note: str = ""
    item_count: int = 0       # позиций в составе
    coverage: int = 100       # % обеспеченных позиций


class BomDetailOut(BomOut):
    """Спецификация с раскрытым составом."""

    items: list[BomItemOut] = []


# ===== Планирование · план/факт =====


class PlanCellUpdate(BaseModel):
    """Изменение одной ячейки плана (год × изделие × месяц)."""

    year: int
    product: str
    month: int = Field(ge=1, le=12)
    plan_qty: int = Field(ge=0)


class PlanPositionUpsert(BaseModel):
    """Создать/заменить позицию плана на год целиком (12 значений qty, янв..дек)."""

    year: int
    product: str
    monthly: list[int] = Field(min_length=12, max_length=12)


class PlanMonthCell(BaseModel):
    month: int           # 1..12
    plan_qty: int
    plan_nh: float       # plan_qty × norm_nh
    fact_qty: int        # из завершённых нарядов этого месяца
    fact_nh: float       # fact_qty × norm_nh


class PlanRowOut(BaseModel):
    product: str
    norm_nh: float       # н.ч/шт из утверждённой нормы (0 если нет)
    months: list[PlanMonthCell]  # 12
    year_qty: int
    year_nh: float


class PlanTotalsOut(BaseModel):
    month_nh: list[float]   # план н.ч по месяцам (12)
    fact_nh: list[float]    # факт н.ч по месяцам (12)
    load_pct: list[float]   # month_nh / capacity_nh × 100 (12)
    year_nh: float
    plan_ytd: float         # план н.ч с начала года по текущий месяц включ.
    fact_ytd: float         # факт н.ч YTD
    peak_month: int         # индекс 0..11 макс. загрузки
    low_month: int          # индекс 0..11 мин. загрузки


class PlanBoardOut(BaseModel):
    year: int
    capacity_nh: float      # мощность цеха, н.ч/мес
    rows: list[PlanRowOut]
    totals: PlanTotalsOut


# ===== Аналитика производства (read-model) =====


class AnalyticsOut(BaseModel):
    # KPI
    vyrabotka_fact_nh: float    # Σ fact_nh за год — выработка факт
    vyrabotka_plan_nh: float    # Σ plan_nh YTD — план периода
    efficiency_pct: float       # выработка н.ч ÷ (Σ days_worked × 8 ч) × 100
    fpy_pct: float              # accept ÷ всего × 100 (с первого предъявления)
    pass_rate_pct: float        # (accept + rework) ÷ всего × 100
    scrap_pct: float            # scrap ÷ всего × 100
    premium_fot_byn: float      # Σ (nh_output × премиальная ставка) по табелю
    # Серии для графиков
    plan_fact_by_month: list[dict]   # [{month, plan_nh, fact_nh}] ×12
    scrap_reasons: list[dict]        # [{reason, count}] desc
    team_contribution: list[dict]    # [{name, nh_output, share_pct}] desc
    top_products: list[dict]         # [{product, fact_nh}] desc
