// Функциональные тесты прототипа «Производство · Заявки на сборку».
//
// Особенности прототипа (по коду):
// - Реестр из 12 заявок канона лежит в массиве REQS, рендер — buildTable/
//   fillKpis/select; сортировка всегда по сроку (месяц, день, №).
// - «Сегодня» в прототипе — 09.06.2026: просрочена только №248 (срок 06.06).
// - Запуск в работу доступен при обеспеченности 100% и утверждённой норме
//   (статусы «новая»/«комплектация»); переводит заявку в «очередь».
// - Русский формат чисел: запятая — десятичный разделитель.
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const row = (page, id) => page.locator(`#rtbody tr[data-id="${id}"]`);
const rows = page => page.locator('#rtbody tr.itm');

test.beforeEach(async ({ page }) => {
  // Страница самодостаточна (file://), внешние только шрифты — блокируем сеть,
  // чтобы не флачить на загрузке Google Fonts; скрипт синхронный в конце body.
  await page.route(/^https?:\/\//, r => r.abort());
  await page.goto(proto('proizvodstvo_zayavki.html'), { waitUntil: 'domcontentloaded' });
});

test.describe('Стартовый рендер · KPI', () => {
  test('шесть KPI посчитаны от канона: 12 заявок, 2 комплектации, 2 без нормы, 1 просрочка, 197,0 н.ч, 2 готовы', async ({ page }) => {
    await expect(page).toHaveTitle('ERP · Производство · Заявки на сборку');
    await expect(page.locator('#k-active')).toHaveText('12');
    await expect(page.locator('#k-active-f')).toHaveText('12 заявок до запуска и в цеху');
    await expect(page.locator('#k-compl')).toHaveText('2');
    await expect(page.locator('#k-compl-f')).toHaveText('2 позиции в дефиците');
    await expect(page.locator('#k-nonorm')).toHaveText('2');
    await expect(page.locator('#k-over')).toHaveText('1');
    await expect(page.locator('#k-over-f')).toHaveText('№248 · срок 06.06');
    await expect(page.locator('#k-nh')).toHaveText('197,0');
    // 197 / 704 н.ч месячной мощности = 28%
    await expect(page.locator('#k-nh-f')).toHaveText('28% мощности цеха · 704 н.ч/мес');
    await expect(page.locator('#k-ready')).toHaveText('2');
  });

  test('реестр: 12 заявок, отсортированы по сроку, просрочка №248 первая и красная', async ({ page }) => {
    await expect(rows(page)).toHaveCount(12);
    const ids = await rows(page).evaluateAll(trs => trs.map(t => t.dataset.id));
    expect(ids).toEqual(['248', '250', '259', '243', '277', '260', '265', '245', '274', '252', '240', '151']);
    await expect(row(page, 248).locator('.due')).toHaveText('06.06');
    await expect(row(page, 248).locator('.due')).toHaveClass(/over/);
    await expect(page.locator('#rtbody .due.over')).toHaveCount(1);
  });

  test('строка №274 из канона: 2 шт, 10,0 н.ч, обеспеченность 72%, высокий приоритет, комплектация', async ({ page }) => {
    const r = row(page, 274);
    await expect(r.locator('.nm')).toHaveText('LiFePO4 RADIAN LF12200-02 12V 200Ah');
    await expect(r.locator('td').nth(2)).toHaveText('2');
    await expect(r.locator('.covx .v')).toHaveText('72%');
    await expect(r.locator('td').nth(6)).toHaveText('10,0');
    await expect(r.locator('.badge')).toHaveText('высокий');
    await expect(r.locator('.stz')).toHaveText('комплектация');
  });

  test('итоги портфеля: 3 новых, 2 комплектация, 2 очередь, 3 в цеху, 2 ОТК', async ({ page }) => {
    await expect(page.locator('#s-total')).toHaveText('12');
    await expect(page.locator('#s-new')).toHaveText('3');
    await expect(page.locator('#s-compl')).toHaveText('2');
    await expect(page.locator('#s-queue')).toHaveText('2');
    await expect(page.locator('#s-work')).toHaveText('3');
    await expect(page.locator('#s-otk')).toHaveText('2');
  });
});

test.describe('Деталь заявки', () => {
  test('по умолчанию выбрана №248: шапка, норма 0,5 н.ч/шт, запуск недоступен — уже в работе', async ({ page }) => {
    await expect(row(page, 248)).toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№248');
    await expect(page.locator('#d-item')).toHaveText('4×ICP103450DA Moli');
    await expect(page.locator('#p-qty')).toHaveText('70 шт');
    await expect(page.locator('#p-nh')).toHaveText('35,0 н.ч');
    await expect(page.locator('#p-due')).toHaveText('06.06 · просрочена');
    // 35 н.ч / 70 шт
    await expect(page.locator('#d-normtx')).toContainText('Норма утверждена');
    await expect(page.locator('#d-normtx')).toContainText('0,5 н.ч/шт');
    await expect(page.locator('#btnLaunch')).toBeDisabled();
    await expect(page.locator('#d-hint')).toHaveText('Заявка уже запущена — статус «в работе».');
  });

  test('№274: мини-BOM с дефицитом корпуса ABS, запуск заблокирован по обеспеченности', async ({ page }) => {
    await row(page, 274).click();
    await expect(page.locator('#d-bomtag')).toHaveText('4 позиции · обеспеченность 72%');
    await expect(page.locator('#d-bom tbody tr')).toHaveCount(4);
    const abs = page.locator('#d-bom tbody tr', { hasText: 'Корпус ABS LF12200-02' });
    await expect(abs.locator('.stx')).toHaveText('дефицит');
    await expect(abs.locator('.stx')).toHaveClass(/none/);
    // остальные три позиции в наличии
    await expect(page.locator('#d-bom .stx.ok')).toHaveCount(3);
    await expect(page.locator('#btnLaunch')).toBeDisabled();
    await expect(page.locator('#d-hint')).toHaveText('Недоступно: обеспеченность 72% — дождитесь комплектации.');
  });

  test('№252: норма на утверждении со ссылкой на справочник, дефицит разъёма REMA 320А', async ({ page }) => {
    await row(page, 252).click();
    await expect(page.locator('#d-normtx')).toContainText('Норма на утверждении · 8 н.ч/шт предварительно');
    await expect(page.locator('#d-normtx .normlink')).toHaveText('Нормы и нормативы');
    const rema = page.locator('#d-bom tbody tr', { hasText: 'Разъём REMA 320А' });
    await expect(rema.locator('.stx')).toHaveText('дефицит');
    await expect(page.locator('#d-bomtag')).toHaveText('4 позиции · обеспеченность 80%');
  });

  test('№245: нет нормы — предупреждение со ссылкой, ожидание элементов 40%', async ({ page }) => {
    await row(page, 245).click();
    await expect(page.locator('#d-normtx')).toContainText('Нет утверждённой нормы — н.ч оценочные');
    await expect(page.locator('#d-normtx .normlink')).toHaveText('Нормы и нормативы');
    await expect(page.locator('#d-bom .normbox')).toContainText('ждём элементы');
    await expect(page.locator('#d-bomtag')).toHaveText('обеспеченность 40%');
    await expect(page.locator('#d-hint')).toHaveText('Недоступно: обеспеченность 40% — дождитесь комплектации.');
  });
});

test.describe('Запуск в работу', () => {
  test('№277 готова: запуск переводит в очередь, пересчитывает KPI и пишет в журнал', async ({ page }) => {
    await row(page, 277).click();
    await expect(page.locator('#d-hint')).toHaveText('Готова к запуску: комплект 100% и норма утверждена.');
    await expect(page.locator('#btnLaunch')).toBeEnabled();
    await page.locator('#btnLaunch').click();
    await expect(row(page, 277).locator('.stz')).toHaveText('очередь');
    await expect(row(page, 277).locator('.stz')).toHaveClass(/queue/);
    await expect(page.locator('#k-ready')).toHaveText('1');
    await expect(page.locator('#s-queue')).toHaveText('3');
    await expect(page.locator('#s-new')).toHaveText('2');
    // журнал пополнился
    await expect(page.locator('#r-jrncnt')).toHaveText('4');
    await expect(page.locator('#r-jrn .jr').first()).toContainText('№277 запущена в работу — поставлена в очередь цеха (0,5 н.ч)');
    // повторный запуск недоступен
    await expect(page.locator('#btnLaunch')).toBeDisabled();
    await expect(page.locator('#d-hint')).toHaveText('Заявка уже запущена — статус «очередь».');
  });

  test('после запуска обеих готовых заявок KPI «готовы к запуску» обнуляется', async ({ page }) => {
    await row(page, 277).click();
    await page.locator('#btnLaunch').click();
    await row(page, 265).click();
    await page.locator('#btnLaunch').click();
    await expect(page.locator('#k-ready')).toHaveText('0');
    await expect(page.locator('#s-queue')).toHaveText('4');
    await expect(page.locator('#r-jrncnt')).toHaveText('5');
    // активных заявок не убавилось — они остались в портфеле
    await expect(page.locator('#k-active')).toHaveText('12');
  });
});

test.describe('Фильтр по статусу и поиск', () => {
  test('сегменты: «В работе» — 3, «ОТК» — 2, «Комплектация» — 2, возврат на «Все» — 12', async ({ page }) => {
    await page.locator('#segst button[data-s="work"]').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).locator('.stz')).toHaveText(['в работе', 'в работе', 'в работе']);
    await page.locator('#segst button[data-s="otk"]').click();
    await expect(rows(page)).toHaveCount(2);
    await page.locator('#segst button[data-s="compl"]').click();
    await expect(rows(page)).toHaveCount(2);
    await page.locator('#segst button[data-s="all"]').click();
    await expect(rows(page)).toHaveCount(12);
  });

  test('живой поиск по № и изделию', async ({ page }) => {
    await page.fill('#q', '274');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-id', '274');
    await page.fill('#q', 'tekcell');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('.nm')).toHaveText('SB-AA02-2P Tekcell');
    await page.fill('#q', '');
    await expect(rows(page)).toHaveCount(12);
  });

  test('пустой результат — заглушка, комбинация фильтра и поиска работает', async ({ page }) => {
    await page.fill('#q', 'zzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#empty-row')).toContainText('Ничего не найдено по запросу «zzz»');
    // фильтр «Новые» + поиск по изделию
    await page.locator('#segst button[data-s="new"]').click();
    await page.fill('#q', 'sanyo');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-id', '277');
  });
});

test.describe('Создание заявки', () => {
  test('пустое изделие подсвечивается и не даёт сохранить', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await page.locator('#f-save').click();
    await expect(page.locator('#f-item')).toHaveClass(/invalid/);
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(rows(page)).toHaveCount(12);
    // начало ввода снимает подсветку
    await page.fill('#f-item', 'Т');
    await expect(page.locator('#f-item')).not.toHaveClass(/invalid/);
  });

  test('новая заявка №278 появляется со статусом «новая», по сроку, KPI пересчитаны', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await page.fill('#f-item', 'Тяговая 24V · 8S 2P');
    await page.fill('#f-qty', '3');
    await page.selectOption('#f-prio', 'high');
    await page.locator('#f-save').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(rows(page)).toHaveCount(13);
    const r = row(page, 278);
    await expect(r.locator('.stz')).toHaveText('новая');
    await expect(r.locator('.badge')).toHaveText('высокий');
    await expect(r).toHaveClass(/sel/);
    // срок по умолчанию 23.06 — между №240 (20.06) и №151 (30.06)
    const ids = await rows(page).evaluateAll(trs => trs.map(t => t.dataset.id));
    expect(ids.indexOf('278')).toBe(ids.indexOf('240') + 1);
    expect(ids.indexOf('151')).toBe(ids.indexOf('278') + 1);
    // KPI: активных больше, нормы нет (н.ч оценочные = 0), портфель не вырос
    await expect(page.locator('#k-active')).toHaveText('13');
    await expect(page.locator('#k-nonorm')).toHaveText('3');
    await expect(page.locator('#k-nh')).toHaveText('197,0');
    await expect(page.locator('#d-no')).toHaveText('№278');
    await expect(page.locator('#r-jrn .jr').first()).toContainText('№278 создана · Тяговая 24V · 8S 2P · источник CRM');
  });

  test('отмена: кнопка, Escape и клик в фон закрывают модалку без изменений', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await page.locator('#f-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await page.locator('#btnAdd').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#addModal')).toBeHidden();
    await page.locator('#btnAdd').click();
    await page.fill('#f-item', 'Черновик, который не сохраним');
    await page.locator('#addModal').click({ position: { x: 8, y: 8 } });
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(rows(page)).toHaveCount(12);
    await expect(page.locator('#k-active')).toHaveText('12');
  });
});

test.describe('Снятие с производства', () => {
  test('снятие №245 с причиной: реестр и KPI пересчитаны, запись в журнале', async ({ page }) => {
    await row(page, 245).click();
    await page.locator('#btnRemove').click();
    await expect(page.locator('#remModal')).toBeVisible();
    await expect(page.locator('#rm-name')).toHaveText('№245 · SAMSUNG 8INR18650-25R');
    await page.fill('#rm-reason', 'клиент отменил заказ');
    await page.locator('#rm-confirm').click();
    await expect(page.locator('#remModal')).toBeHidden();
    await expect(rows(page)).toHaveCount(11);
    await expect(row(page, 245)).toHaveCount(0);
    await expect(page.locator('#k-active')).toHaveText('11');
    await expect(page.locator('#k-nonorm')).toHaveText('1');
    // 197,0 − 0,5
    await expect(page.locator('#k-nh')).toHaveText('196,5');
    await expect(page.locator('#r-nh')).toHaveText('196,5');
    await expect(page.locator('#r-jrn .jr').first())
      .toContainText('№245 снята с производства · причина: клиент отменил заказ');
    // выбор переехал на первую видимую заявку
    await expect(page.locator('#d-no')).toHaveText('№248');
  });

  test('снятие без причины пишет «причина не указана», отмена ничего не меняет', async ({ page }) => {
    await row(page, 240).click();
    await page.locator('#btnRemove').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#remModal')).toBeHidden();
    await expect(rows(page)).toHaveCount(12);
    await page.locator('#btnRemove').click();
    await page.locator('#rm-confirm').click();
    await expect(rows(page)).toHaveCount(11);
    await expect(page.locator('#r-jrn .jr').first())
      .toContainText('№240 снята с производства · причина не указана');
  });
});

test.describe('Правая рейка', () => {
  test('портфель 197,0 из 704 н.ч (28%), «Требуют реакции» — 4 строки канона', async ({ page }) => {
    await expect(page.locator('#r-nh')).toHaveText('197,0');
    await expect(page.locator('#r-pct')).toHaveText('28%');
    await expect(page.locator('#r-reactcnt')).toHaveText('4');
    const items = page.locator('#r-react .rrow');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0).locator('.rt')).toHaveText('№248 просрочена');
    await expect(items.nth(1).locator('.rt')).toHaveText('Дефицит: Корпус ABS LF12200-02');
    await expect(items.nth(2).locator('.rt')).toHaveText('Дефицит: Разъём REMA 320А');
    await expect(items.nth(3).locator('.rt')).toHaveText('Без нормы часов · 2 заявки');
    await expect(items.nth(3).locator('.rs')).toHaveText('№245, №252');
  });

  test('клик по сигналу рейки открывает карточку заявки', async ({ page }) => {
    await page.locator('#r-react .rrow').nth(1).click();
    await expect(page.locator('#d-no')).toHaveText('№274');
    await expect(row(page, 274)).toHaveClass(/sel/);
    await page.locator('#r-react .rrow').nth(2).click();
    await expect(page.locator('#d-no')).toHaveText('№252');
  });

  test('журнал сегодня: три стартовые записи смены', async ({ page }) => {
    await expect(page.locator('#r-jrncnt')).toHaveText('3');
    const j = page.locator('#r-jrn .jr');
    await expect(j).toHaveCount(3);
    await expect(j.nth(0)).toContainText('№265 принята из CRM · менеджер Инна');
    await expect(j.nth(1)).toContainText('№274: дефицит «корпус ABS» — заявка поставщику GOTION');
    await expect(j.nth(2)).toContainText('№250 передана на ОТК · контролёр Никита');
  });
});
