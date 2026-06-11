"""ORM-модели модуля Production (схема ``production.*``)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class ProductionOrder(Base):
    """Производственный наряд в канбане цеха: изделие, кол-во, прогресс, этап.

    Этап (`stage`) ведёт наряд от очереди до готовности (см. ``stages.py``).
    Переход в «Готово → склад» (``done``) публикует ``production.completed`` → приход на склад.
    Нормо-час — базовая единица учёта: ``nh_per_unit`` берётся из утверждённой
    нормы справочника (`ProductionNorm`), если не задан явно.
    """

    __tablename__ = "production_order"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(64), default="", server_default="")
    product: Mapped[str] = mapped_column(String(255))
    qty: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # % хода работ
    priority: Mapped[str] = mapped_column(String(32), default="Средний", server_default="Средний")
    owner: Mapped[str] = mapped_column(String(128), default="", server_default="")  # мастер
    stage: Mapped[str] = mapped_column(String(32), default="queue", server_default="queue")
    due_date: Mapped[str | None] = mapped_column(String(32))
    insight: Mapped[str] = mapped_column(String(400), default="", server_default="")
    nh_per_unit: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # н.ч/шт
    made_qty: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # сделано шт
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ProductionNorm(Base):
    """Норма нормо-часов на изделие или операцию (экран «Нормы и нормативы»).

    Жизненный цикл статуса: ``none`` (нет нормы, nh=0) → ``pending`` (на
    утверждении — при создании/правке nh>0) → ``approved`` (утверждена).
    Любая правка ``nh`` возвращает норму на утверждение.
    """

    __tablename__ = "production_norm"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="product", server_default="product")
    title: Mapped[str] = mapped_column(String(255))
    nh: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # нормо-часы
    status: Mapped[str] = mapped_column(String(16), default="none", server_default="none")
    note: Mapped[str] = mapped_column(String(400), default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class ProductionWorker(Base):
    """Сборщик в табеле выработки (экран «Выработка и оценка»).

    ЗП = оклад × отработанные дни / 22 + выработка (н.ч) × премиальная ставка.
    Нормо-час — база начисления премии.
    """

    __tablename__ = "production_worker"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    salary: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # оклад BYN/мес
    days_worked: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # дни в периоде
    nh_output: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # выработка н.ч


class ProductionQc(Base):
    """Решение ОТК по единице/партии (экран «ОТК · контроль качества»).

    ``decision``: ``accept`` (принять) | ``rework`` (доработка) | ``scrap`` (брак).
    Брак публикует ``production.scrap`` → претензия в закупки (production → procurement).
    """

    __tablename__ = "production_qc"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    order_code: Mapped[str] = mapped_column(String(64), default="", server_default="")
    product: Mapped[str] = mapped_column(String(255), default="", server_default="")
    decision: Mapped[str] = mapped_column(String(16))  # accept | rework | scrap
    reason: Mapped[str] = mapped_column(String(255), default="", server_default="")
    inspector: Mapped[str] = mapped_column(String(128), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ProductionBom(Base):
    """Спецификация изделия — состав (экран «Спецификации · BOM»).

    ``status``: ``draft`` (черновик) | ``approved`` (утверждена). Правка состава
    (добавление/изменение/удаление позиции) возвращает спецификацию в черновик.
    Позиции состава — ``ProductionBomItem`` (по ``bom_id``, без FK-связи).
    """

    __tablename__ = "production_bom"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    product: Mapped[str] = mapped_column(String(255))
    version: Mapped[str] = mapped_column(String(16), default="v1", server_default="v1")
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    note: Mapped[str] = mapped_column(String(400), default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class ProductionBomItem(Base):
    """Позиция состава спецификации: комплектующее, норма расхода, остаток/резерв.

    Обеспеченность позиции: доступно = ``stock - reserved`` ≥ ``norm_qty`` (на 1 шт).
    """

    __tablename__ = "production_bom_item"
    __table_args__ = {"schema": "production"}

    id: Mapped[int] = mapped_column(primary_key=True)
    bom_id: Mapped[int] = mapped_column(Integer, index=True)
    component: Mapped[str] = mapped_column(String(255))
    norm_qty: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # расход на 1 шт
    unit: Mapped[str] = mapped_column(String(32), default="шт", server_default="шт")
    stock: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # на складе
    reserved: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # в резерве
