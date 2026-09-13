"""Модуль Production (Производство) — реализация ModuleContract."""
from __future__ import annotations

from core.runtime.contract import ModuleContract, Widget
from core.runtime.core import Core
from modules.production import accounting_ownership_routes, events, routes
from modules.production.output_documents import ProductionOutputService


class ProductionModule(ModuleContract):
    name = "production"
    version = "0.1.0"
    api_prefix = "/production"

    def register(self, core: Core) -> None:
        core.services.production_output = ProductionOutputService()
        core.include_router(routes.router, prefix=self.api_prefix)
        core.include_router(accounting_ownership_routes.router, prefix=self.api_prefix)
        core.register_widget(Widget("production", "Производство", source="production.orders"))
        # Подписки на шину (миграция 0080): передача сделки в производство и приход материалов.
        core.subscribe("sales.deal.handoff", events.on_deal_handoff)
        core.subscribe("procurement.order.received", events.on_order_received)


def get_module() -> ModuleContract:
    return ProductionModule()
