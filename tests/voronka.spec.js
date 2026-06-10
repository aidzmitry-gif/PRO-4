// Функциональные тесты прототипа «Производство · Воронка сборки».
// Прототип самодостаточный (file://), вся логика — в инлайн-скрипте страницы.
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const cs = (page, stage) => page.locator(`.col[data-stage="${stage}"] [data-cs]`);
const card = (page, order) => page.locator(`.card[data-order="${order}"]`);

// HTML5 drag-and-drop: locator.dragTo() в Chromium не доводит drop до обработчиков
// прототипа, поэтому диспатчим dragstart/dragover/drop/dragend с общим DataTransfer.
async function dragCard(page, order, stage, position = 'end') {
  await page.evaluate(({ order, stage, position }) => {
    const el = document.querySelector(`.card[data-order="${order}"]`);
    const body = document.querySelector(`.col[data-stage="${stage}"] .col-body`);
    if (!el || !body) throw new Error(`dragCard: нет карточки №${order} или этапа ${stage}`);
    const dt = new DataTransfer();
    const fire = (target, type, init = {}) =>
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...init }));
    fire(el, 'dragstart');
    let clientY;
    if (position === 'start') {
      const first = body.querySelector('.card:not(.dragging)');
      clientY = (first || body).getBoundingClientRect().top + 1; // выше центра первой карточки
    } else {
      clientY = body.getBoundingClientRect().bottom - 1; // ниже всех карточек -> в конец
    }
    fire(body, 'dragover', { clientY });
    fire(body, 'drop', { clientY });
    fire(el, 'dragend');
  }, { order, stage, position });
}

test.beforeEach(async ({ page }) => {
  await page.goto(proto('proizvodstvo_voronka.html'), { waitUntil: 'domcontentloaded' });
});

test.describe('Стартовый рендер доски', () => {
  test('шесть этапов воронки с правильными заголовками', async ({ page }) => {
    await expect(page.locator('.topbar .crumb')).toContainText('Воронка сборки');
    const cols = page.locator('.board .col');
    await expect(cols).toHaveCount(6);
    const titles = ['Заявки на сборку', 'Комплектация · обеспечение', 'Очередь · запланировано',
      'Сборка · в работе', 'ОТК · контроль', 'Готово → склад/отгрузка'];
    for (let i = 0; i < titles.length; i++) {
      await expect(page.locator(`.col[data-stage="${i}"] .ct`)).toContainText(titles[i]);
      await expect(page.locator(`.col[data-stage="${i}"] .ct .cap`)).toHaveText(`ЭТАП ${i + 1}`);
    }
  });

  test('recount() при загрузке заполняет счётчики всех колонок', async ({ page }) => {
    await expect(page.locator('.board .card')).toHaveCount(16);
    await expect(cs(page, 0)).toHaveText('3 заявки · 3 н.ч');
    await expect(cs(page, 1)).toHaveText('2 заявки · 18 н.ч');
    await expect(cs(page, 2)).toHaveText('2 заявки · 51 н.ч');
    await expect(cs(page, 3)).toHaveText('3 заявки · 108 н.ч');
    await expect(cs(page, 4)).toHaveText('2 заявки · 17 н.ч');
    await expect(cs(page, 5)).toHaveText('4 заявки · 8 н.ч');
  });

  test('KPI смены и итоги периода с точными числами', async ({ page }) => {
    const kpis = page.locator('.kpis .kpi');
    await expect(kpis).toHaveCount(6);
    await expect(kpis.first().locator('.kpi-val .num')).toHaveText('18,4');
    await expect(kpis.first().locator('.kpi-val .of')).toHaveText('/ 30 н.ч');
    await expect(kpis.first().locator('.kpi-foot')).toHaveText('61% плана дня · отставание 11,6 н.ч');
    const cells = page.locator('.summary .sum-cell');
    await expect(cells).toHaveCount(6);
    await expect(cells.first().locator('.n')).toHaveText('412');
    await expect(cells.filter({ hasText: 'ФОТ' }).locator('.n')).toContainText('2 575');
  });

  test('по умолчанию выбрана №274 и карта перерисована скриптом', async ({ page }) => {
    await expect(page.locator('.card.sel')).toHaveCount(1);
    await expect(card(page, '274')).toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№274');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор LiFePO4 RADIAN LF12200-02 12V 200Ah');
    // renderDetail() на старте затирает статическую разметку: «10,0» -> «10»; covCls:'warn' из данных приоритетнее порога (cov=72 дал бы bad)
    await expect(page.locator('#d-nh-total')).toHaveText('10');
    await expect(page.locator('#d-bom-tag')).toHaveText('72%');
    await expect(page.locator('#d-bom-tag')).toHaveClass('tag cov-warn');
    await expect(page.locator('#d-prog-pct')).toHaveText('0');
    await expect(page.locator('#d-prog-op')).toHaveText('ожидает корпус ABS');
  });
});

test.describe('Карта изделия: выбор карточки', () => {
  test('клик по №243 переносит выделение и шапку карты', async ({ page }) => {
    await card(page, '243').click();
    await expect(page.locator('.card.sel')).toHaveCount(1);
    await expect(card(page, '243')).toHaveClass(/sel/);
    await expect(card(page, '274')).not.toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№243');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор RADIAN LiFePO4 48V 460Ah');
  });

  test('маршрут №243: семь узлов, два пройдены, текущий «Пайка БМС»', async ({ page }) => {
    await card(page, '243').click();
    const nodes = page.locator('#d-timeline .node');
    await expect(nodes).toHaveCount(7);
    await expect(page.locator('#d-timeline .node.done')).toHaveCount(2);
    await expect(page.locator('#d-timeline .node.cur')).toHaveCount(1);
    await expect(page.locator('#d-timeline .node.cur .lab')).toHaveText('Пайка БМС');
    await expect(nodes.last().locator('.lab')).toHaveText('Готово');
  });

  test('операции №243: план/факт и статусы в таблице', async ({ page }) => {
    await card(page, '243').click();
    const rows = page.locator('#d-ops tr');
    await expect(rows).toHaveCount(7);
    const first = rows.nth(0);
    await expect(first.locator('td').nth(0)).toHaveText('Подготовка пластин');
    await expect(first.locator('td').nth(1)).toHaveText('22');
    await expect(first.locator('td').nth(2)).toHaveText('2,2');
    await expect(first.locator('td').nth(3)).toHaveText('2,2');
    await expect(first.locator('.st')).toHaveClass('st ok');
    await expect(first.locator('.st')).toHaveText('готово');
    await expect(rows.nth(1).locator('.st')).toHaveClass('st run');
    await expect(rows.nth(1).locator('.st')).toHaveText('идёт');
  });

  test('операции №248: у ненормированных строк факт «—», статусы без «undefined»', async ({ page }) => {
    await card(page, '248').click();
    const rows = page.locator('#d-ops tr');
    await expect(rows).toHaveCount(5);
    await expect(page.locator('#d-ops')).not.toContainText('undefined');
    for (const row of await rows.all()) {
      await expect(row.locator('.st')).toHaveClass(/^st (ok|run|plan|done|warn|bad)$/);
    }
    const mod = rows.filter({ hasText: 'Установка модуля тока' });
    await expect(mod.locator('td').nth(2)).toHaveText('—'); // н.ч план
    await expect(mod.locator('td').nth(3)).toHaveText('—'); // н.ч факт
    await expect(mod.locator('.st')).toHaveClass('st run');
    await expect(mod.locator('.st')).toHaveText('идёт');
    await expect(rows.nth(3).locator('.st')).toHaveText('идёт'); // Опрессовка выводов 0,5мм
    await expect(rows.nth(4).locator('.st')).toHaveText('план');
    await expect(page.locator('#d-nh-done')).toHaveText('4,3 ч'); // факт только по сварке: 4,25 -> до десятых
  });

  test('операции №250: статусы «готово/идёт» в таблице, выработка 10 ч', async ({ page }) => {
    await card(page, '250').click();
    const rows = page.locator('#d-ops tr');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('#d-ops')).not.toContainText('undefined');
    const fill = rows.nth(1);
    await expect(fill.locator('td').nth(0)).toHaveText('Заливка компаундом');
    await expect(fill.locator('td').nth(3)).toHaveText('—');
    await expect(fill.locator('.st')).toHaveClass('st done');
    await expect(fill.locator('.st')).toHaveText('готово');
    await expect(rows.nth(2).locator('.st')).toHaveClass('st run');
    await expect(rows.nth(2).locator('.st')).toHaveText('идёт');
    await expect(rows.nth(3).locator('.st')).toHaveText('идёт');
    await expect(page.locator('#d-nh-done')).toHaveText('10 ч'); // факт только по «Сборке»
  });

  test('нормо-часы №243: 40 н.ч, факт 7,3 ч, стоимость и премия', async ({ page }) => {
    await card(page, '243').click();
    await expect(page.locator('#d-nh-total')).toHaveText('40');
    await expect(page.locator('#d-nh-per')).toHaveText('40 ч');
    await expect(page.locator('#d-nh-qty')).toHaveText('1 шт');
    await expect(page.locator('#d-nh-done')).toHaveText('7,3 ч'); // 2,2 + 5,1 по операциям
    await expect(page.locator('#d-nh-cost')).toHaveText('1000 BYN'); // 40 х 25
    await expect(page.locator('#d-nh-prem')).toHaveText('250 BYN'); // 40 х 6,25
    await expect(page.locator('#d-bom-tag')).toHaveText('100%');
    await expect(page.locator('#d-bom-tag')).toHaveClass('tag cov-ok');
  });

  test('BOM №274: семь позиций, корпус ABS заблокирован', async ({ page }) => {
    await expect(page.locator('#d-bom tr')).toHaveCount(7);
    const row = page.locator('#d-bom tr', { hasText: 'Корпус ABS' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toHaveText('2'); // норма
    await expect(row.locator('td').nth(2)).toHaveText('0'); // резерв
    await expect(row.locator('.st')).toHaveClass('st bad');
    await expect(row.locator('.st')).toHaveText('блок');
  });

  test('карточка без данных (№265): generic-карта с пустыми состояниями', async ({ page }) => {
    await card(page, '265').click();
    await expect(page.locator('#d-no')).toHaveText('№265');
    await expect(page.locator('#d-title')).toHaveText('SB-AA02-2P 1/2АА (Tekcell) литиевый /Корея/');
    await expect(page.locator('#d-ops td.empty')).toContainText('Маршрут операций ещё не задан');
    await expect(page.locator('#d-bom td.empty')).toHaveText('Спецификация не привязана.');
    // расчёт от data-nh="2.0": итог 2 н.ч, 50 BYN, премия 12,5 BYN
    await expect(page.locator('#d-nh-total')).toHaveText('2');
    await expect(page.locator('#d-nh-per')).toHaveText('2 ч');
    await expect(page.locator('#d-nh-qty')).toHaveText('1 шт');
    await expect(page.locator('#d-nh-cost')).toHaveText('50 BYN');
    await expect(page.locator('#d-nh-prem')).toHaveText('12,5 BYN');
    await expect(page.locator('#d-bom-tag')).toHaveClass('tag cov-ok');
    // этап 1 -> текущий узел «Заявка», прогресс 0
    await expect(page.locator('#d-timeline .node')).toHaveCount(6);
    await expect(page.locator('#d-timeline .node.done')).toHaveCount(0);
    await expect(page.locator('#d-timeline .node.cur .lab')).toHaveText('Заявка');
    await expect(page.locator('#d-prog-pct')).toHaveText('0');
    await expect(page.locator('#d-prog-op')).toHaveText('Заявка');
  });

  test('generic-карточка в «Готово» (№258): прогресс 100% и пройденный маршрут', async ({ page }) => {
    await card(page, '258').click();
    await expect(page.locator('#d-no')).toHaveText('№258');
    await expect(page.locator('#d-prog-pct')).toHaveText('100');
    await expect(page.locator('#d-prog-op')).toHaveText('Готово');
    await expect(page.locator('#d-timeline .node')).toHaveCount(6);
    await expect(page.locator('#d-timeline .node.done')).toHaveCount(5);
    await expect(page.locator('#d-timeline .node.cur .lab')).toHaveText('Готово');
    await expect(page.locator('#d-nh-total')).toHaveText('2,4');
    await expect(page.locator('#d-nh-cost')).toHaveText('60 BYN');
  });

  test('партия №151: норма на 150 шт и округление премии', async ({ page }) => {
    await card(page, '151').click();
    await expect(page.locator('#d-nh-total')).toHaveText('45'); // 0,3 х 150
    await expect(page.locator('#d-nh-per')).toHaveText('0,3 ч');
    await expect(page.locator('#d-nh-qty')).toHaveText('150 шт');
    await expect(page.locator('#d-nh-done')).toHaveText('0 ч');
    await expect(page.locator('#d-nh-cost')).toHaveText('1125 BYN');
    await expect(page.locator('#d-nh-prem')).toHaveText('281,3 BYN'); // 281,25 округляется до десятых
    await expect(page.locator('#d-bom tr')).toHaveCount(6);
    await expect(page.locator('#d-prog-op')).toHaveText('старт по графику смены');
  });

  test('повторный клик и клики по кнопкам не сбрасывают выбор', async ({ page }) => {
    await card(page, '245').click();
    await expect(page.locator('#d-no')).toHaveText('№245');
    await card(page, '245').click(); // повторный клик по уже выбранной
    await expect(page.locator('.card.sel')).toHaveCount(1);
    await expect(card(page, '245')).toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№245');
    // служебные кнопки гасят всплытие и не трогают выделение
    await page.locator('.col[data-stage="0"] .add-card').click();
    await page.locator('.op-bar .pill-w').first().click();
    await expect(page.locator('.card.sel')).toHaveCount(1);
    await expect(page.locator('#d-no')).toHaveText('№245');
  });
});

test.describe('Вкладки карты и переключатель вида', () => {
  test('вкладки карты: активна одна, переключение по клику', async ({ page }) => {
    const tabs = page.locator('.dtab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.first()).toHaveClass(/active/);
    await tabs.filter({ hasText: 'ОТК' }).click();
    await expect(page.locator('.dtab.active')).toHaveCount(1);
    await expect(tabs.filter({ hasText: 'ОТК' })).toHaveClass(/active/);
    await expect(tabs.first()).not.toHaveClass(/active/);
  });

  test('переключатель вида доски: повторный клик не ломает состояние', async ({ page }) => {
    const seg = page.locator('.board-tools .seg button');
    await expect(seg).toHaveCount(2);
    await expect(seg.nth(0)).toHaveClass(/active/);
    await seg.nth(1).click();
    await expect(seg.nth(1)).toHaveClass(/active/);
    await expect(seg.nth(0)).not.toHaveClass(/active/);
    await seg.nth(1).click(); // повторный клик по активной
    await expect(page.locator('.board-tools .seg button.active')).toHaveCount(1);
    await expect(seg.nth(1)).toHaveClass(/active/);
  });
});

test.describe('Drag-and-drop и пересчёт счётчиков', () => {
  test('перенос №277 в «Готово» двигает DOM и пересчитывает обе колонки', async ({ page }) => {
    await dragCard(page, '277', 5);
    await expect(page.locator('.col[data-stage="5"] .col-body .card[data-order="277"]')).toHaveCount(1);
    await expect(page.locator('.col[data-stage="0"] .card[data-order="277"]')).toHaveCount(0);
    await expect(page.locator('.col[data-stage="5"] .card').last()).toHaveAttribute('data-order', '277');
    await expect(cs(page, 0)).toHaveText('2 заявки · 2,5 н.ч');
    await expect(cs(page, 5)).toHaveText('5 заявок · 8,5 н.ч');
    await expect(page.locator('.board .card')).toHaveCount(16); // карточка одна, не клон
  });

  test('перенос №250 из ОТК: единственное число «1 заявка»', async ({ page }) => {
    await dragCard(page, '250', 5);
    await expect(cs(page, 4)).toHaveText('1 заявка · 7 н.ч');
    await expect(cs(page, 5)).toHaveText('5 заявок · 18 н.ч');
  });

  test('опустошение колонки ОТК: «0 заявок · 0 н.ч»', async ({ page }) => {
    await dragCard(page, '250', 5);
    await dragCard(page, '259', 5);
    await expect(page.locator('.col[data-stage="4"] .card')).toHaveCount(0);
    await expect(cs(page, 4)).toHaveText('0 заявок · 0 н.ч');
    await expect(cs(page, 5)).toHaveText('6 заявок · 25 н.ч');
  });

  test('сортировка внутри колонки меняет порядок, но не счётчик', async ({ page }) => {
    await dragCard(page, '245', 0, 'start');
    const cards = page.locator('.col[data-stage="0"] .card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute('data-order', '245');
    await expect(cards.nth(1)).toHaveAttribute('data-order', '277');
    await expect(cards.nth(2)).toHaveAttribute('data-order', '265');
    await expect(cs(page, 0)).toHaveText('3 заявки · 3 н.ч');
  });

  test('после переноса generic-карта строится по новому этапу', async ({ page }) => {
    await dragCard(page, '277', 3); // «Заявки» -> «Сборка · в работе»
    await expect(cs(page, 3)).toHaveText('4 заявки · 108,5 н.ч');
    // dragend на 60 мс глушит клики (justDragged) — повторяем клик до успеха
    await expect(async () => {
      await card(page, '277').click();
      await expect(card(page, '277')).toHaveClass(/sel/, { timeout: 200 });
    }).toPass();
    await expect(page.locator('#d-no')).toHaveText('№277');
    await expect(page.locator('#d-prog-pct')).toHaveText('40'); // этап «Сборка» -> 40%
    await expect(page.locator('#d-prog-op')).toHaveText('Сборка');
    await expect(page.locator('#d-timeline .node')).toHaveCount(6);
    await expect(page.locator('#d-timeline .node.done')).toHaveCount(3);
    await expect(page.locator('#d-timeline .node.cur .lab')).toHaveText('Сборка');
  });
});
