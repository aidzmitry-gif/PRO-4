# Модуль production — контекст для Claude

**Тип:** git submodule → PRO-4 (правка = коммит в этот репозиторий)
**API-префикс:** `/production`
**Схема БД:** `production`
**Статус:** наполняется (наряды с нормо-часами + справочник норм, канбан-доска, публикация события; без подписок/workflow/permissions). Прототипы UI — `prototypes/production/` (8 экранов со сквозной навигацией, 170 Playwright-тестов в `tests/` корня репо).

## Назначение
Производство (цех): ведёт производственные наряды в канбане по этапам — от очереди (план)
до готовности. При переходе наряда в финальный этап «Готово → склад» публикует событие
прихода продукции на склад (production → wms). Нормо-час — базовая единица учёта:
норма на изделие живёт в справочнике (`ProductionNorm`) и подставляется в наряд.

## Файлы
- `module.py` — `ProductionModule(ModuleContract)`, `get_module()`; регистрация роутера и виджета
- `models.py` — ORM `ProductionOrder` + `ProductionNorm` (схема `production`)
- `schemas.py` — Pydantic: `ProductionOrderCreate/Out`, `StageUpdate`, `NormCreate/Update/Out`
- `routes.py` — HTTP-API `/production/*`; `_to_card()` → `FunnelCard`; `_nh_fmt()` — русский формат н.ч
- `stages.py` — `STAGES`: этапы канбана цеха (порядок = колонки доски)
- `__init__.py` — пакет
- `prototypes/production/` — 8 самодостаточных HTML-прототипов экранов (см. README там)

## Что регистрирует в ядре (register())
- **Роуты:** `core.include_router(routes.router, prefix="/production")`
- **Widgets:** `core.register_widget(Widget("production", "Производство", source="production.orders"))`
- Подписок / workflow / permissions / roles / telegram — нет.

## События
- **Публикует:** `production.completed` — при `PATCH /orders/{id}` с переходом в этап `done`.
  Payload: `{item, qty, warehouse: "Главный", entity_ref: "production:<id>"}` (приход на склад).
- **Подписан на:** ничего.

## Модель данных (таблицы схемы)
- `production.production_order` (`ProductionOrder`):
  - `id` (PK), `number` (str, авто `ПЗ-2026-NNNN` если пусто), `product` (str), `qty` (int=1)
  - `progress` (int, % хода работ; ставится 100 при `done`), `priority` (str="Средний")
  - `owner` (str, мастер), `stage` (str="queue"), `due_date` (str|None), `insight` (str)
  - `nh_per_unit` (float, н.ч/шт; 0 → подставляется из утверждённой нормы при создании)
  - `made_qty` (int, сделано шт; при `done` ставится = qty)
  - `created_at` (datetime, server_default now)
  - Этапы (`stage`, из `stages.py`): `queue` → `picking` → `assembly` → `qc` → `packing` → `done`
  - Связей FK с другими таблицами нет.
- `production.production_norm` (`ProductionNorm`) — справочник норм (экран «Нормы и нормативы»):
  - `id` (PK), `kind` (str: `product`|`operation`), `title` (str), `nh` (float, нормо-часы)
  - `status` (str: `none` нет нормы → `pending` на утверждении → `approved` утверждена)
  - `note` (str), `updated_at` (datetime, onupdate now)
  - Правка `nh` возвращает статус в `pending`; утвердить норму с nh=0 нельзя (409).

## API-эндпоинты (ключевые)
- `GET /production/orders` — плоский список нарядов (для аналитики/совместимости), сортировка по `id desc`
- `GET /production/board` — канбан цеха: наряды сгруппированы по `STAGES` (`build_board`); тег «N н.ч» на карточке при nh>0
- `POST /production/orders` — создать наряд (201); номер генерируется, если не задан; `nh_per_unit=0` → подстановка из утверждённой нормы по точному `title` изделия
- `PATCH /production/orders/{order_id}` — сменить этап; при `done` → `progress=100`, `made_qty=qty`, emit `production.completed`
- `GET /production/norms?kind=` / `POST /production/norms` — справочник норм (создание: nh>0 → `pending`, nh=0 → `none`)
- `PATCH /production/norms/{id}` — правка (смена nh → `pending`); `POST /production/norms/{id}/approve` — утвердить (409 при nh=0); `DELETE /production/norms/{id}` — 204

## Межмодульные связи и зависимости
- Из ядра: `core.runtime.{contract,core,deps,funnel}`, `core.db.base.Base`.
- Использует общий конструктор воронки `core.runtime.funnel` (`FunnelCard`, `build_board`, `FunnelBoardOut`).
- Исходящая интеграция: событие `production.completed` → WMS (приход на склад). Прямых вызовов
  других модулей нет — только через `core.event_bus`.

## Подводные камни / детали
- Роуты модуля **коммитят сами** (`session.commit()`), в отличие от паттерна «роут владеет
  транзакцией, репозиторий не коммитит». CRUD не через `core/db/repository`.
- `COMPLETED_STAGE = "done"` захардкожен в `routes.py` — должен совпадать с финальным `id` в `STAGES`.
- `PATCH` принимает любую строку `stage` (нет валидации против `STAGES`).
- `due_date` — строка, не дата.
- `number` генерируется после `flush()` (нужен `id`), затем коммит.
- Подстановка нормы — по **точному** совпадению `title` (kind=product, status=approved); миграция — `0027_production_norms.py` в суперпроекте.
