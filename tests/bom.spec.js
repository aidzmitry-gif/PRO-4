// Функциональные тесты экрана «Производство · Спецификации · BOM»
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const row = (page, text) => page.locator('#btbody tr.itm').filter({ hasText: text });
const selRow = page => page.locator('#btbody tr.itm.sel');
const bomRow = (page, i) => page.locator(`#bom-body tr[data-i="${i}"]`);

test.beforeEach(async ({ page }) => {
  // Прототип тянет Google Fonts через @import — на медленной сети событие load
  // подвисает. Блокируем сеть: file://-страница самодостаточна, а скрипт
  // выполняется синхронно в конце body, т.е. к domcontentloaded всё готово.
  await page.route(/^https?:\/\//, r => r.abort());
  await page.goto(proto('proizvodstvo_bom.html'), { waitUntil: 'domcontentloaded' });
});

test.describe('Стартовый рендер', () => {
  test('KPI-плитки справочника BOM заполнены точными числами', async ({ page }) => {
    await expect(page.locator('#k-total')).toHaveText('15');
    await expect(page.locator('#k-total-f')).toHaveText('12 с BOM + 3 без');
    await expect(page.locator('#k-ok')).toHaveText('9');
    await expect(page.locator('#k-ok-f')).toHaveText('60% справочника');
    await expect(page.locator('#k-draft')).toHaveText('3');
    await expect(page.locator('#k-none')).toHaveText('3');
    await expect(page.locator('#k-short')).toHaveText('4');
    await expect(page.locator('#k-short-f')).toHaveText('в 3 изделиях');
    await expect(page.locator('#k-depth')).toHaveText('4,5');
    await expect(page.locator('#k-depth-f')).toHaveText('54 позиции в 12 BOM');
  });

  test('итоги справочника и шапка правой рейки посчитаны', async ({ page }) => {
    await expect(page.locator('#s-total')).toHaveText('15');
    await expect(page.locator('#s-pos')).toHaveText('54');
    await expect(page.locator('#s-depth')).toHaveText('4,5');
    await expect(page.locator('#s-cov')).toHaveText('80');
    await expect(page.locator('#s-short')).toHaveText('4');
    await expect(page.locator('#r-cov')).toHaveText('80');
    await expect(page.locator('#r-foot')).toHaveText('3 без BOM');
  });

  test('таблица изделий: 15 строк, 3 серии, строка №274 с расчётами', async ({ page }) => {
    await expect(page.locator('#btbody tr.itm')).toHaveCount(15);
    await expect(page.locator('#btbody tr.grp')).toHaveText([
      'LiFePO4 · стационарные и тяговые', 'Li-ion сборки 18650', 'Ni-MH и элементы с выводами',
    ]);
    const sel = selRow(page);
    await expect(sel).toHaveCount(1);
    await expect(sel.locator('.nm')).toHaveText('Аккумулятор LiFePO4 RADIAN LF12200-02 12V 200Ah');
    await expect(sel.locator('.nt')).toHaveText('заявка №274 · 2 шт');
    await expect(sel.locator('td').nth(1)).toHaveText('v2');
    await expect(sel.locator('td').nth(2)).toHaveText('6');
    await expect(sel.locator('td').nth(3)).toHaveText('да');
    await expect(sel.locator('td').nth(4)).toHaveText('72%');
    await expect(sel.locator('.stx')).toHaveText('утверждена');
  });

  test('деталь №274: паспорт спецификации и состав с дефицитом корпуса ABS', async ({ page }) => {
    await expect(page.locator('#d-ver')).toHaveText('BOM v2');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор LiFePO4 RADIAN LF12200-02 12V 200Ah');
    await expect(page.locator('#p-ver')).toHaveText('v2');
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#d-date')).toHaveText('03.06.2026');
    await expect(page.locator('#d-cov')).toHaveText('72%');
    await expect(page.locator('#d-dem')).toHaveText('2 шт');
    await expect(page.locator('#d-rsum')).toHaveText('Σ 5 н.ч/шт');
    await expect(page.locator('#btnApprove')).toBeDisabled();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(6);
    await expect(page.locator('#bom-tag')).toHaveText('6 позиций · дефицит 2');
    // корпус ABS — полный дефицит: требуется 2, доступно 0
    const korp = bomRow(page, 2);
    await expect(korp.locator('td').first()).toHaveText('Корпус ABS LF12200 с крышкой');
    await expect(korp.locator('td').nth(3)).toHaveText('2');
    await expect(korp.locator('td').nth(6)).toHaveText('0');
    await expect(korp.locator('.stx')).toHaveText('дефицит');
    // лента никелевая — частичный дефицит: 12,5 на шт, нужно 25, доступно 8
    const lenta = bomRow(page, 3);
    await expect(lenta.locator('.nh-ed')).toHaveText('12,5');
    await expect(lenta.locator('td').nth(3)).toHaveText('25');
    await expect(lenta.locator('td').nth(6)).toHaveText('8');
    await expect(lenta.locator('.stx')).toHaveText('дефицит');
    await expect(bomRow(page, 0).locator('.stx')).toHaveText('в наличии');
    await expect(page.locator('#bom-foot')).toContainText('72%');
    await expect(page.locator('#bom-foot')).toContainText('дефицит: 2 позиции');
  });

  test('маршрут №274 синхронен с нормами: 5 операций от подготовки до теста', async ({ page }) => {
    await expect(page.locator('#rt-tag')).toHaveText('5 опер. · Σ 5 н.ч/шт');
    const ops = page.locator('#rt-body tr');
    await expect(ops).toHaveCount(5);
    await expect(ops.nth(0)).toContainText('Подготовка и выборка элементов');
    await expect(ops.nth(0).locator('td').nth(1)).toHaveText('0,5');
    await expect(ops.nth(0).locator('td').nth(2)).toHaveText('10%');
    await expect(ops.nth(1)).toContainText('Сварка модулей 4S');
    await expect(ops.nth(2)).toContainText('Пайка БМС и силовых проводов');
    await expect(ops.nth(3)).toContainText('Сборка в корпус и заливка');
    await expect(ops.nth(4)).toContainText('Тест на анализаторе АКБ');
    await expect(ops.nth(1).locator('td').nth(2)).toHaveText('30%');
  });

  test('рейка: 4 дефицитные позиции и журнал из 3 записей', async ({ page }) => {
    await expect(page.locator('#r-shortcnt')).toHaveText('4');
    const shorts = page.locator('#r-short .rrow');
    await expect(shorts).toHaveCount(4);
    await expect(shorts.nth(0).locator('.rt')).toHaveText('Корпус ABS LF12200 с крышкой');
    await expect(shorts.nth(0).locator('.rs')).toHaveText('№274 · не хватает 2 шт');
    await expect(shorts.nth(1).locator('.rs')).toHaveText('№274 · не хватает 17 м');
    await expect(shorts.nth(2).locator('.rt')).toHaveText('BMS 16S 100A с балансиром');
    await expect(shorts.nth(2).locator('.rs')).toHaveText('№243 · не хватает 1 шт');
    await expect(shorts.nth(3).locator('.rt')).toHaveText('Разъём REMA 320А');
    await expect(shorts.nth(3).locator('.rs')).toHaveText('№252 · не хватает 1 шт');
    await expect(page.locator('#r-logcnt')).toHaveText('3');
    await expect(page.locator('#r-log .rrow')).toHaveCount(3);
    await expect(page.locator('#r-log .rrow').first().locator('.rt')).toHaveText('№252 · создан черновик BOM v1');
  });

  test('склонение «позиция/позиции/позиций» для разных N', async ({ page }) => {
    const words = await page.evaluate(ns => ns.map(n => posWord(n)), [1, 2, 4, 5, 11, 14, 21, 22, 25, 100, 111]);
    expect(words).toEqual([
      'позиция', 'позиции', 'позиции', 'позиций', 'позиций', 'позиций',
      'позиция', 'позиции', 'позиций', 'позиций', 'позиций',
    ]);
  });
});

test.describe('Выбор строки и поиск', () => {
  test('черновик №252: обеспеченность 80%, дефицит REMA, можно утвердить', async ({ page }) => {
    await row(page, 'для погрузчика').click();
    await expect(row(page, 'для погрузчика')).toHaveClass(/sel/);
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор LiFePO4 80V LF100A для погрузчика');
    await expect(page.locator('#p-ver')).toHaveText('v1');
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#d-date')).toHaveText('—');
    await expect(page.locator('#d-cov')).toHaveText('80%');
    await expect(page.locator('#d-dem')).toHaveText('1 шт');
    await expect(page.locator('#d-rsum')).toHaveText('Σ 8 н.ч/шт');
    await expect(page.locator('#btnApprove')).toBeEnabled();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(5);
    await expect(page.locator('#bom-tag')).toHaveText('5 позиций · дефицит 1');
    const rema = bomRow(page, 2);
    await expect(rema.locator('td').first()).toHaveText('Разъём REMA 320А');
    await expect(rema.locator('.stx')).toHaveText('дефицит');
    await expect(page.locator('#rt-tag')).toHaveText('5 опер. · Σ 8 н.ч/шт');
  });

  test('изделие без BOM показывает прочерки, пустой состав и маршрут', async ({ page }) => {
    const r = row(page, 'метеостанции RST');
    await expect(r.locator('td').nth(1)).toHaveText('—');
    await expect(r.locator('td').nth(2)).toHaveText('—');
    await expect(r.locator('td').nth(3)).toHaveText('—');
    await expect(r.locator('td').nth(4)).toHaveText('—');
    await expect(r.locator('.stx')).toHaveText('нет BOM');
    await r.click();
    await expect(page.locator('#d-status')).toHaveText('нет BOM');
    await expect(page.locator('#p-ver')).toHaveText('—');
    await expect(page.locator('#d-cov')).toHaveText('—');
    await expect(page.locator('#d-rsum')).toHaveText('не привязан');
    await expect(page.locator('#btnApprove')).toBeDisabled();
    await expect(page.locator('#bom-tag')).toHaveText('нет состава');
    await expect(page.locator('#bom-body .empty')).toBeVisible();
    await expect(page.locator('#rt-body .empty')).toBeVisible();
    await expect(page.locator('#rt-tag')).toHaveText('маршрут не привязан');
  });

  test('поиск фильтрует по названию и номеру заявки, очистка восстанавливает', async ({ page }) => {
    await page.locator('#q').fill('RADIAN');
    await expect(page.locator('#btbody tr.itm')).toHaveCount(3);
    await expect(page.locator('#btbody tr.grp')).toHaveText(['LiFePO4 · стационарные и тяговые']);
    await page.locator('#q').fill('№260');
    await expect(page.locator('#btbody tr.itm')).toHaveCount(1);
    await expect(page.locator('#btbody tr.itm .nm')).toHaveText('Аккумулятор BSL 10×INR18650 18V для Bull');
    await page.locator('#q').fill('такого изделия нет');
    await expect(page.locator('#btbody tr.itm')).toHaveCount(0);
    await expect(page.locator('#btbody tr.grp')).toHaveCount(0);
    await page.locator('#q').fill('');
    await expect(page.locator('#btbody tr.itm')).toHaveCount(15);
    await expect(selRow(page).locator('.nm')).toHaveText('Аккумулятор LiFePO4 RADIAN LF12200-02 12V 200Ah');
  });
});

test.describe('Inline-правка нормы расхода', () => {
  test('Enter сохраняет норму: лента закрывает дефицит, статус откатывается в черновик', async ({ page }) => {
    await bomRow(page, 3).locator('.nh-ed').click();
    const inp = page.locator('#bom-body .nh-inp');
    await expect(inp).toHaveValue('12.5');
    await inp.fill('4');
    await inp.press('Enter');
    // норма 4 × 2 шт = 8 — доступных 8 хватает, позиция вышла из дефицита
    await expect(bomRow(page, 3).locator('.nh-ed')).toHaveText('4');
    await expect(bomRow(page, 3).locator('td').nth(3)).toHaveText('8');
    await expect(bomRow(page, 3).locator('.stx')).toHaveText('в наличии');
    await expect(page.locator('#d-cov')).toHaveText('83%');
    await expect(page.locator('#bom-tag')).toHaveText('6 позиций · дефицит 1');
    // правка утверждённой спецификации откатывает её в черновик
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#d-date')).toHaveText('—');
    await expect(page.locator('#btnApprove')).toBeEnabled();
    await expect(selRow(page).locator('.stx')).toHaveText('черновик');
    await expect(selRow(page).locator('td').nth(4)).toHaveText('83%');
    await expect(page.locator('#k-ok')).toHaveText('8');
    await expect(page.locator('#k-ok-f')).toHaveText('53% справочника');
    await expect(page.locator('#k-draft')).toHaveText('4');
    await expect(page.locator('#k-short')).toHaveText('3');
    await expect(page.locator('#r-shortcnt')).toHaveText('3');
    await expect(page.locator('#r-short .rrow')).toHaveCount(3);
    await expect(page.locator('#r-logcnt')).toHaveText('4');
    await expect(page.locator('#r-log .rrow').first().locator('.rt'))
      .toHaveText('№274 · норма расхода изменена: Лента никелевая 0,15×8 мм');
  });

  test('Escape отменяет правку — ни норма, ни статус, ни KPI не меняются', async ({ page }) => {
    await bomRow(page, 3).locator('.nh-ed').click();
    const inp = page.locator('#bom-body .nh-inp');
    await inp.fill('99');
    await inp.press('Escape');
    await expect(bomRow(page, 3).locator('.nh-ed')).toHaveText('12,5');
    await expect(page.locator('#d-cov')).toHaveText('72%');
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#k-ok')).toHaveText('9');
    await expect(page.locator('#k-short')).toHaveText('4');
    await expect(page.locator('#r-logcnt')).toHaveText('3');
  });

  test('ноль и отрицательное значение отбрасываются — норма прежняя', async ({ page }) => {
    await bomRow(page, 3).locator('.nh-ed').click();
    await page.locator('#bom-body .nh-inp').fill('0');
    await page.locator('#bom-body .nh-inp').press('Enter');
    await expect(bomRow(page, 3).locator('.nh-ed')).toHaveText('12,5');
    await expect(page.locator('#d-status')).toHaveText('утверждена');

    await bomRow(page, 3).locator('.nh-ed').click();
    await page.locator('#bom-body .nh-inp').fill('-2');
    await page.locator('#bom-body .nh-inp').press('Enter');
    await expect(bomRow(page, 3).locator('.nh-ed')).toHaveText('12,5');
    await expect(page.locator('#d-cov')).toHaveText('72%');
    await expect(page.locator('#r-logcnt')).toHaveText('3');
  });
});

test.describe('Добавление позиции', () => {
  test('пустые обязательные поля не проходят валидацию — модалка не закрывается', async ({ page }) => {
    await page.locator('#btnAddPos').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#ap-name')).toBeFocused();
    // пустое имя
    await page.locator('#ap-save').click();
    await expect(page.locator('#addModal')).toBeVisible();
    // имя есть, нормы нет
    await page.locator('#ap-name').fill('Предохранитель 150А');
    await page.locator('#ap-save').click();
    await expect(page.locator('#addModal')).toBeVisible();
    // норма нулевая — тоже отказ
    await page.locator('#ap-norm').fill('0');
    await page.locator('#ap-save').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(6);
    await expect(page.locator('#r-logcnt')).toHaveText('3');
  });

  test('новая позиция без остатка становится дефицитной и пересчитывает всё', async ({ page }) => {
    await page.locator('#btnAddPos').click();
    await page.locator('#ap-name').fill('Предохранитель 150А');
    await page.locator('#ap-norm').fill('1');
    await page.locator('#ap-save').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(7);
    const nrow = bomRow(page, 6);
    await expect(nrow.locator('td').first()).toHaveText('Предохранитель 150А');
    await expect(nrow.locator('.nh-ed')).toHaveText('1');
    await expect(nrow.locator('td').nth(2)).toHaveText('шт');
    await expect(nrow.locator('td').nth(3)).toHaveText('2');
    await expect(nrow.locator('td').nth(6)).toHaveText('0');
    await expect(nrow.locator('.stx')).toHaveText('дефицит');
    await expect(page.locator('#d-cov')).toHaveText('62%');
    await expect(page.locator('#bom-tag')).toHaveText('7 позиций · дефицит 3');
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#k-short')).toHaveText('5');
    await expect(page.locator('#k-depth')).toHaveText('4,6');
    await expect(page.locator('#k-depth-f')).toHaveText('55 позиций в 12 BOM');
    await expect(page.locator('#s-pos')).toHaveText('55');
    await expect(page.locator('#k-ok')).toHaveText('8');
    await expect(page.locator('#k-draft')).toHaveText('4');
    await expect(selRow(page).locator('td').nth(2)).toHaveText('7');
    await expect(page.locator('#r-logcnt')).toHaveText('4');
    await expect(page.locator('#r-log .rrow').first().locator('.rt'))
      .toHaveText('№274 · позиция добавлена: Предохранитель 150А');
  });

  test('отмена, Escape и клик по фону не добавляют позицию, поля сбрасываются', async ({ page }) => {
    await page.locator('#btnAddPos').click();
    await page.locator('#ap-name').fill('Черновик не сохранится');
    await page.locator('#ap-norm').fill('5');
    await page.locator('#ap-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(6);
    await expect(page.locator('#k-depth')).toHaveText('4,5');

    // повторное открытие — поля сброшены, Escape закрывает
    await page.locator('#btnAddPos').click();
    await expect(page.locator('#ap-name')).toHaveValue('');
    await expect(page.locator('#ap-norm')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('#addModal')).toBeHidden();

    // клик по затемнённому фону закрывает модалку
    await page.locator('#btnAddPos').click();
    await page.locator('#addModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#r-logcnt')).toHaveText('3');
  });

  test('добавление первой позиции изделию без BOM создаёт черновик v1', async ({ page }) => {
    await row(page, 'метеостанции RST').click();
    await page.locator('#btnAddPos').click();
    await page.locator('#ap-name').fill('Корпус RST герметичный');
    await page.locator('#ap-norm').fill('1');
    await page.locator('#ap-stock').fill('2');
    await page.locator('#ap-save').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#p-ver')).toHaveText('v1');
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#d-cov')).toHaveText('100%');
    await expect(page.locator('#btnApprove')).toBeEnabled();
    await expect(page.locator('#bom-tag')).toHaveText('1 позиция · без дефицита');
    const r = row(page, 'метеостанции RST');
    await expect(r.locator('td').nth(1)).toHaveText('v1');
    await expect(r.locator('td').nth(2)).toHaveText('1');
    await expect(r.locator('td').nth(4)).toHaveText('100%');
    await expect(r.locator('.stx')).toHaveText('черновик');
    // KPI: изделий без BOM стало 2, глубина пересчитана на 13 BOM
    await expect(page.locator('#k-none')).toHaveText('2');
    await expect(page.locator('#k-total-f')).toHaveText('13 с BOM + 2 без');
    await expect(page.locator('#k-draft')).toHaveText('4');
    await expect(page.locator('#k-depth')).toHaveText('4,2');
    await expect(page.locator('#k-depth-f')).toHaveText('55 позиций в 13 BOM');
    await expect(page.locator('#r-cov')).toHaveText('87');
    await expect(page.locator('#r-foot')).toHaveText('2 без BOM');
  });
});

test.describe('Удаление позиции', () => {
  test('модалка показывает имя, отмена и Escape не удаляют', async ({ page }) => {
    const lenta = bomRow(page, 3);
    await lenta.hover();
    await lenta.locator('.rt-del').click();
    await expect(page.locator('#delModal')).toBeVisible();
    await expect(page.locator('#del-name')).toHaveText('Лента никелевая 0,15×8 мм');
    await page.locator('#del-cancel').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(6);

    await lenta.hover();
    await lenta.locator('.rt-del').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(6);
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#r-logcnt')).toHaveText('3');
  });

  test('подтверждение удаляет позицию и пересчитывает обеспеченность и глубину', async ({ page }) => {
    const lenta = bomRow(page, 3);
    await lenta.hover();
    await lenta.locator('.rt-del').click();
    await page.locator('#del-confirm').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#bom-body tr[data-i]')).toHaveCount(5);
    await expect(page.locator('#d-cov')).toHaveText('80%');
    await expect(page.locator('#bom-tag')).toHaveText('5 позиций · дефицит 1');
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#k-short')).toHaveText('3');
    await expect(page.locator('#k-depth')).toHaveText('4,4');
    await expect(page.locator('#k-draft')).toHaveText('4');
    await expect(page.locator('#s-pos')).toHaveText('53');
    await expect(page.locator('#r-logcnt')).toHaveText('4');
    await expect(page.locator('#r-log .rrow').first().locator('.rt'))
      .toHaveText('№274 · позиция удалена: Лента никелевая 0,15×8 мм');
  });
});

test.describe('Утверждение BOM', () => {
  test('черновик №252 утверждается с датой 09.06.2026 и пересчётом KPI', async ({ page }) => {
    await row(page, 'для погрузчика').click();
    await page.locator('#btnApprove').click();
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#d-date')).toHaveText('09.06.2026');
    await expect(page.locator('#btnApprove')).toBeDisabled();
    await expect(row(page, 'для погрузчика').locator('.stx')).toHaveText('утверждена');
    await expect(page.locator('#k-ok')).toHaveText('10');
    await expect(page.locator('#k-ok-f')).toHaveText('67% справочника');
    await expect(page.locator('#k-draft')).toHaveText('2');
    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toast')).toHaveText('№252 · BOM v1 утверждена · премии и план пересчитаны');
    await expect(page.locator('#r-logcnt')).toHaveText('4');
    await expect(page.locator('#r-log .rrow').first().locator('.rt')).toHaveText('№252 · BOM v1 утверждена');
  });

  test('правка утверждённой → черновик → повторное утверждение возвращает статус', async ({ page }) => {
    await bomRow(page, 3).locator('.nh-ed').click();
    await page.locator('#bom-body .nh-inp').fill('4');
    await page.locator('#bom-body .nh-inp').press('Enter');
    await expect(page.locator('#d-status')).toHaveText('черновик');
    await expect(page.locator('#k-ok')).toHaveText('8');

    await page.locator('#btnApprove').click();
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#d-date')).toHaveText('09.06.2026');
    await expect(page.locator('#btnApprove')).toBeDisabled();
    await expect(page.locator('#k-ok')).toHaveText('9');
    await expect(page.locator('#k-draft')).toHaveText('3');
    await expect(page.locator('#r-logcnt')).toHaveText('5');
    await expect(page.locator('#r-log .rrow').first().locator('.rt')).toHaveText('№274 · BOM v2 утверждена');
  });
});

test.describe('Проверка обеспеченности и op-bar', () => {
  test('кнопка пересчитывает дефициты, пишет тост и строку в журнал; повторный клик добавляет ещё', async ({ page }) => {
    await page.locator('#btnCheck').click();
    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toast')).toHaveText('Обеспеченность пересчитана · дефицит: 4 позиции');
    await expect(page.locator('#k-short')).toHaveText('4');
    await expect(page.locator('#r-logcnt')).toHaveText('4');
    const first = page.locator('#r-log .rrow').first();
    await expect(first.locator('.rt')).toHaveText('Проверка обеспеченности против остатков');
    await expect(first.locator('.rs')).toHaveText('вт 09.06 · дефицит 4 позиции');
    // повторное действие — ещё одна запись журнала
    await page.locator('#btnCheck').click();
    await expect(page.locator('#r-logcnt')).toHaveText('5');
  });

  test('«Открыть №274», передача в закупки и клик по дефициту в рейке', async ({ page }) => {
    await row(page, 'RADIAN 12V 100Ah').click();
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор LiFePO4 RADIAN 12V 100Ah');
    await page.locator('#opOpen274').click();
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор LiFePO4 RADIAN LF12200-02 12V 200Ah');
    await expect(selRow(page).locator('.nt')).toHaveText('заявка №274 · 2 шт');

    await page.locator('#opToBuy').click();
    await expect(page.locator('#toast')).toHaveText('Потребность передана в закупки: 4 позиции');

    // клик по дефициту BMS 16S в рейке открывает №243
    await page.locator('#r-short .rrow').nth(2).click();
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор RADIAN LiFePO4 48V 460Ah');
    await expect(page.locator('#d-cov')).toHaveText('86%');
    await expect(page.locator('#bom-tag')).toHaveText('7 позиций · дефицит 1');
  });
});
