// Функциональные тесты экрана «Производство · Нормы и нормативы»
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const row = (page, text) => page.locator('#ntbody tr.itm').filter({ hasText: text });
const selRow = page => page.locator('#ntbody tr.itm.sel');

test.beforeEach(async ({ page }) => {
  await page.goto(proto('proizvodstvo_normy.html'));
});

test.describe('Стартовый рендер', () => {
  test('KPI-плитки справочника заполнены точными числами', async ({ page }) => {
    await expect(page.locator('#k-total')).toHaveText('59');
    await expect(page.locator('#k-total-f')).toHaveText('35 изделий + 24 операций');
    await expect(page.locator('#k-ok')).toHaveText('52');
    await expect(page.locator('#k-ok-f')).toHaveText('88% справочника');
    await expect(page.locator('#k-wait')).toHaveText('3');
    await expect(page.locator('#k-none')).toHaveText('4');
    await expect(page.locator('#k-range')).toHaveText('0,002–26 ч');
    await expect(page.locator('#k-max')).toHaveText('650');
    await expect(page.locator('#k-max-f')).toHaveText('Тяговая 48V · 15S 3P');
    await expect(page.locator('#op-none')).toHaveText('4 позиции');
  });

  test('итоги справочника и правая панель посчитаны', async ({ page }) => {
    await expect(page.locator('#s-prod')).toHaveText('35');
    await expect(page.locator('#s-ops')).toHaveText('24');
    await expect(page.locator('#s-ok')).toHaveText('88');
    await expect(page.locator('#s-none')).toHaveText('4');
    await expect(page.locator('#s-avg')).toHaveText('3,779 ч');
    await expect(page.locator('#r-cov')).toHaveText('93');
    await expect(page.locator('#r-foot')).toHaveText('4 без нормы');
    await expect(page.locator('#r-waitcnt')).toHaveText('3');
    await expect(page.locator('#r-nonecnt')).toHaveText('4');
    await expect(page.locator('#r-wait .rrow')).toHaveCount(3);
    await expect(page.locator('#r-none .rrow')).toHaveCount(4);
    await expect(page.locator('#r-none .rrow').first()).toContainText('назначить хронометраж');
  });

  test('таблица изделий: группы, 35 строк и выбранная строка с расчётами', async ({ page }) => {
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(35);
    await expect(page.locator('#ntbody tr.grp')).toHaveText([
      'Ni-MH сборки', 'Li-ion · LiFePO4', 'Тяговая техника', 'Ремонт · сервис',
    ]);
    const sel = selRow(page);
    await expect(sel).toHaveCount(1);
    await expect(sel.locator('.nm')).toHaveText('Аккумулятор 32 LiFePO4 25,6V 18,4Ah');
    await expect(sel.locator('td').nth(1)).toHaveText('3,3');
    await expect(sel.locator('td').nth(2)).toHaveText('198');
    await expect(sel.locator('td').nth(3)).toHaveText('82,5 BYN');
    await expect(sel.locator('td').nth(4)).toHaveText('20,63 BYN');
    await expect(sel.locator('.stx')).toHaveText('утверждена');
  });

  test('карта норматива выбранного изделия и его маршрут', async ({ page }) => {
    await expect(page.locator('#d-cat')).toHaveText('Li-ion · LiFePO4');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор 32 LiFePO4 25,6V 18,4Ah');
    await expect(page.locator('#d-norm')).toHaveText('3,3');
    await expect(page.locator('#d-min')).toHaveText('198 мин / шт');
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#d-date')).toHaveText('01.06.2026');
    await expect(page.locator('#d-note')).toHaveText('маршрут 15 операций');
    await expect(page.locator('#d-cost')).toHaveText('82,5 BYN');
    await expect(page.locator('#d-prem')).toHaveText('20,63 BYN');
    await expect(page.locator('#d-pershift')).toHaveText('2 шт');
    await expect(page.locator('#d-use tr')).toHaveCount(3);
    await expect(page.locator('#d-use tr').first()).toContainText('Воронка сборки · заявки');
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(15);
    await expect(page.locator('#rt-tag')).toHaveText('15 опер. · Σ 3,3 н.ч');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('сходится с нормой');
  });
});

test.describe('Переключение вида', () => {
  test('Изделия ↔ Операции: счётчики, группы, выбор первой строки', async ({ page }) => {
    await page.locator('#kindseg button[data-k="ops"]').click();
    await expect(page.locator('#kindseg button.active')).toHaveAttribute('data-k', 'ops');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(24);
    await expect(page.locator('#ntbody tr.grp')).toHaveText([
      'Сварка · приварка', 'Пайка', 'Корпусные работы', 'Тест · контроль',
    ]);
    // выбрана первая операция, карта обновилась, маршрут для операции скрыт
    await expect(selRow(page).locator('.nm')).toHaveText('Сварка 32 батарей в холдерах');
    await expect(page.locator('#d-title')).toHaveText('Сварка 32 батарей в холдерах');
    await expect(page.locator('#d-norm')).toHaveText('0,436');
    await expect(page.locator('#d-min')).toHaveText('26,2 мин / шт');
    await expect(page.locator('#d-pershift')).toHaveText('17 шт');
    await expect(page.locator('#d-use tr').first()).toContainText('Маршруты изделий');
    await expect(page.locator('#routeCard')).toBeHidden();

    await page.locator('#kindseg button[data-k="prod"]').click();
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(35);
    await expect(selRow(page).locator('.nm')).toHaveText('Аккумулятор 10 SUNER Ni-MH AAA 12V 300mAh /Китай, ввоз Литва/');
    await expect(page.locator('#routeCard')).toBeVisible();
    await expect(page.locator('#rt-tag')).toHaveText('3 опер. · Σ 0,2 н.ч');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('сходится с нормой');
  });
});

test.describe('Выбор строки и поиск', () => {
  test('клик по строке обновляет карту норматива и маршрут', async ({ page }) => {
    await row(page, 'Тяговая 24V · 8S 1P').click();
    await expect(row(page, 'Тяговая 24V · 8S 1P')).toHaveClass(/sel/);
    await expect(page.locator('#d-cat')).toHaveText('Тяговая техника');
    await expect(page.locator('#d-title')).toHaveText('Тяговая 24V · 8S 1P');
    await expect(page.locator('#d-norm')).toHaveText('7');
    await expect(page.locator('#d-min')).toHaveText('420 мин / шт');
    await expect(page.locator('#d-cost')).toHaveText('175 BYN');
    await expect(page.locator('#d-pershift')).toHaveText('1 шт');
    await expect(page.locator('#d-date')).toHaveText('01.06.2026');
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(4);
    await expect(page.locator('#rt-tag')).toHaveText('4 опер. · Σ 7 н.ч');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('сходится с нормой');
    await expect(page.locator('#rt-foot td.r').nth(2)).toHaveText('175 BYN');
  });

  test('позиция без нормы показывает прочерки и пустой маршрут', async ({ page }) => {
    const r = row(page, 'Аккумулятор для метеостанции RST 12V 105Ah 4S');
    await expect(r.locator('td').nth(1)).toHaveText('—');
    await expect(r.locator('td').nth(3)).toHaveText('—');
    await expect(r.locator('.stx')).toHaveText('нет нормы');
    await r.click();
    await expect(page.locator('#d-norm')).toHaveText('—');
    await expect(page.locator('#d-min')).toHaveText('норма не установлена');
    await expect(page.locator('#d-status')).toHaveText('нет нормы');
    await expect(page.locator('#d-date')).toHaveText('—');
    await expect(page.locator('#d-cost')).toHaveText('—');
    await expect(page.locator('#d-prem')).toHaveText('—');
    await expect(page.locator('#d-pershift')).toHaveText('—');
    await expect(page.locator('#rt-body .empty')).toBeVisible();
    await expect(page.locator('#rt-tag')).toHaveText('нет состава');
    await expect(page.locator('#rt-foot')).toBeEmpty();
  });

  test('клик в правой панели открывает операцию и переключает вид', async ({ page }) => {
    await page.locator('#r-wait .rrow').filter({ hasText: 'Помывка батареи' }).click();
    await expect(page.locator('#kindseg button.active')).toHaveAttribute('data-k', 'ops');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(24);
    await expect(selRow(page).locator('.nm')).toHaveText('Помывка батареи');
    await expect(page.locator('#d-title')).toHaveText('Помывка батареи');
    await expect(page.locator('#d-status')).toHaveText('на утверждении');
    await expect(page.locator('#d-date')).toHaveText('—');
    await expect(page.locator('#routeCard')).toBeHidden();
  });

  test('поиск фильтрует таблицу и восстанавливает её после очистки', async ({ page }) => {
    await page.locator('#q').fill('Тяговая');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(7);
    await expect(page.locator('#ntbody tr.grp')).toHaveText(['Тяговая техника']);
    // выбранное изделие (Li-ion) скрыто фильтром
    await expect(selRow(page)).toHaveCount(0);
    await page.locator('#q').fill('такого изделия нет');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(0);
    await expect(page.locator('#ntbody tr.grp')).toHaveCount(0);
    await page.locator('#q').fill('');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(35);
    await expect(selRow(page).locator('.nm')).toHaveText('Аккумулятор 32 LiFePO4 25,6V 18,4Ah');
  });
});

test.describe('Добавление нормы', () => {
  test('новая норма уходит «на утверждение» и пересчитывает счётчики', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Новая норма');
    await expect(page.locator('#np-name')).toBeFocused();
    await page.locator('#np-name').fill('Тестовая сборка 4S2P');
    // запятая как десятичный разделитель: браузер нормализует её в точку
    await page.locator('#np-norm').pressSequentially('0,4');
    await expect(page.locator('#np-norm')).toHaveValue('0.4');
    await page.locator('#np-note').fill('проверка прототипа');
    await page.locator('#np-save').click();
    await expect(page.locator('#addModal')).toBeHidden();

    await expect(page.locator('#ntbody tr.grp')).toHaveCount(5);
    await expect(page.locator('#ntbody tr.grp').last()).toHaveText('Новые нормы');
    const r = row(page, 'Тестовая сборка 4S2P');
    await expect(r).toHaveClass(/sel/);
    await expect(r.locator('.nt')).toHaveText('проверка прототипа');
    await expect(r.locator('td').nth(1)).toHaveText('0,4');
    await expect(r.locator('td').nth(2)).toHaveText('24');
    await expect(r.locator('td').nth(3)).toHaveText('10 BYN');
    await expect(r.locator('td').nth(4)).toHaveText('2,5 BYN');
    await expect(r.locator('.stx')).toHaveText('на утверждении');
    await expect(page.locator('#d-title')).toHaveText('Тестовая сборка 4S2P');
    await expect(page.locator('#d-pershift')).toHaveText('18 шт');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(36);
    await expect(page.locator('#k-total')).toHaveText('60');
    await expect(page.locator('#k-wait')).toHaveText('4');
    await expect(page.locator('#s-prod')).toHaveText('36');
    await expect(page.locator('#r-waitcnt')).toHaveText('4');
    await expect(page.locator('#r-wait .rrow')).toHaveCount(4);
  });

  test('пустая или отрицательная норма даёт статус «нет нормы»', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await page.locator('#np-name').fill('Изделие без нормы X1');
    await page.locator('#np-save').click();
    const r = row(page, 'Изделие без нормы X1');
    await expect(r.locator('td').nth(1)).toHaveText('—');
    await expect(r.locator('.stx')).toHaveText('нет нормы');
    await expect(page.locator('#d-min')).toHaveText('норма не установлена');
    await expect(page.locator('#d-status')).toHaveText('нет нормы');
    await expect(page.locator('#k-none')).toHaveText('5');
    await expect(page.locator('#op-none')).toHaveText('5 позиции');
    await expect(page.locator('#r-nonecnt')).toHaveText('5');

    await page.locator('#btnAdd').click();
    await page.locator('#np-name').fill('Минусовая норма X2');
    await page.locator('#np-norm').fill('-1');
    await page.locator('#np-save').click();
    await expect(row(page, 'Минусовая норма X2').locator('.stx')).toHaveText('нет нормы');
    await expect(page.locator('#k-none')).toHaveText('6');
  });

  test('отмена, Escape и клик по фону не добавляют запись', async ({ page }) => {
    await page.locator('#btnAdd').click();
    await page.locator('#np-name').fill('Черновик не сохранится');
    await page.locator('#np-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#k-total')).toHaveText('59');
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(35);
    await expect(page.locator('#ntbody tr.grp').filter({ hasText: 'Новые нормы' })).toHaveCount(0);

    // повторное открытие — поля сброшены, Escape закрывает
    await page.locator('#btnAdd').click();
    await expect(page.locator('#np-name')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('#addModal')).toBeHidden();

    // клик по затемнённому фону закрывает модалку
    await page.locator('#btnAdd').click();
    await page.locator('#addModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#k-total')).toHaveText('59');
  });
});

test.describe('Правка нормы', () => {
  test('правка через «Изменить норму» переводит статус на утверждение', async ({ page }) => {
    await page.locator('#btnEdit').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Изменение нормы');
    await expect(page.locator('#np-name')).toHaveValue('Аккумулятор 32 LiFePO4 25,6V 18,4Ah');
    await expect(page.locator('#np-norm')).toHaveValue('3.3');
    await expect(page.locator('#np-note')).toHaveValue('маршрут 15 операций');
    await page.locator('#np-norm').fill('4');
    await page.locator('#np-save').click();
    await expect(page.locator('#addModal')).toBeHidden();

    const sel = selRow(page);
    await expect(sel.locator('td').nth(1)).toHaveText('4');
    await expect(sel.locator('td').nth(2)).toHaveText('240');
    await expect(sel.locator('td').nth(3)).toHaveText('100 BYN');
    await expect(sel.locator('td').nth(4)).toHaveText('25 BYN');
    await expect(sel.locator('.stx')).toHaveText('на утверждении');
    await expect(page.locator('#d-norm')).toHaveText('4');
    await expect(page.locator('#d-status')).toHaveText('на утверждении');
    await expect(page.locator('#d-date')).toHaveText('—');
    await expect(page.locator('#k-wait')).toHaveText('4');
    await expect(page.locator('#k-ok')).toHaveText('51');
    await expect(page.locator('#k-ok-f')).toHaveText('86% справочника');
    // маршрут (Σ 3,3) перестал сходиться с новой нормой 4
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('-0,7 ч к норме');
  });

  test('шестерёнка строки открывает правку, отмена ничего не меняет', async ({ page }) => {
    const r = row(page, 'Сборка 6s6p');
    await r.hover();
    await r.locator('.rowed2').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Изменение нормы');
    await expect(page.locator('#np-name')).toHaveValue('Сборка 6s6p');
    await expect(page.locator('#np-norm')).toHaveValue('4');
    // шестерёнка также выбирает строку
    await expect(page.locator('#d-title')).toHaveText('Сборка 6s6p');
    await page.locator('#np-norm').fill('9');
    await page.locator('#np-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(r.locator('td').nth(1)).toHaveText('4');
    await expect(r.locator('.stx')).toHaveText('утверждена');
    await expect(page.locator('#k-wait')).toHaveText('3');
  });
});

test.describe('Состав работ изделия', () => {
  test('правка н.ч операции по Enter пересчитывает Σ, долю и статус', async ({ page }) => {
    const first = page.locator('#rt-body tr[data-i="0"]');
    await expect(first.locator('.nh-ed')).toHaveText('0,436');
    await first.locator('.nh-ed').click();
    const inp = page.locator('#rt-body .nh-inp');
    await expect(inp).toHaveValue('0.436');
    await inp.fill('0.5');
    await inp.press('Enter');
    await expect(page.locator('#rt-body tr[data-i="0"] .nh-ed')).toHaveText('0,5');
    await expect(page.locator('#rt-body tr[data-i="0"] td').nth(2)).toHaveText('15%');
    await expect(page.locator('#rt-tag')).toHaveText('15 опер. · Σ 3,364 н.ч');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('+0,064 ч к норме');
    await expect(page.locator('#d-status')).toHaveText('на утверждении');
    await expect(selRow(page).locator('.stx')).toHaveText('на утверждении');
    await expect(page.locator('#k-wait')).toHaveText('4');
  });

  test('Escape отменяет правку н.ч — норма и статус не меняются', async ({ page }) => {
    await page.locator('#rt-body tr[data-i="0"] .nh-ed').click();
    const inp = page.locator('#rt-body .nh-inp');
    await inp.fill('9');
    await inp.press('Escape');
    await expect(page.locator('#rt-body tr[data-i="0"] .nh-ed')).toHaveText('0,436');
    await expect(page.locator('#rt-tag')).toHaveText('15 опер. · Σ 3,3 н.ч');
    await expect(page.locator('#d-status')).toHaveText('утверждена');
    await expect(page.locator('#k-wait')).toHaveText('3');
  });

  test('удаление операции из маршрута и «Σ как норма»', async ({ page }) => {
    const last = page.locator('#rt-body tr[data-i="14"]');
    await expect(last).toContainText('Помывка батареи');
    await last.hover();
    await last.locator('.rt-del').click();
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(14);
    await expect(page.locator('#rt-tag')).toHaveText('14 опер. · Σ 3,009 н.ч');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('-0,291 ч к норме');
    await expect(page.locator('#d-status')).toHaveText('на утверждении');
    await expect(page.locator('#k-wait')).toHaveText('4');

    await page.locator('#rt-apply').click();
    await expect(page.locator('#d-norm')).toHaveText('3,009');
    await expect(page.locator('#d-min')).toHaveText('180,5 мин / шт');
    await expect(page.locator('#rt-foot .dev-tag')).toHaveText('сходится с нормой');
    await expect(selRow(page).locator('td').nth(1)).toHaveText('3,009');
  });

  test('добавление операции: пустой ввод, библиотека и своя операция', async ({ page }) => {
    // пустой ввод — ничего не происходит
    await page.locator('#rt-addbtn').click();
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(15);
    await expect(page.locator('#rt-tag')).toHaveText('15 опер. · Σ 3,3 н.ч');
    await expect(page.locator('#k-wait')).toHaveText('3');

    // из библиотеки без н.ч — берётся норма операции
    await page.locator('#rt-sel').selectOption({ label: 'Прошивка платы · 0,073 н.ч' });
    await page.locator('#rt-addbtn').click();
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(16);
    await expect(page.locator('#rt-body tr[data-i="15"] td').first()).toHaveText('Прошивка платы');
    await expect(page.locator('#rt-body tr[data-i="15"] .nh-ed')).toHaveText('0,073');
    await expect(page.locator('#rt-tag')).toHaveText('16 опер. · Σ 3,373 н.ч');
    await expect(page.locator('#rt-sel')).toHaveValue('');

    // своя операция с указанием н.ч
    await page.locator('#rt-custom').fill('Контроль ОТК');
    await page.locator('#rt-nh').fill('0.12');
    await page.locator('#rt-addbtn').click();
    await expect(page.locator('#rt-body tr[data-i]')).toHaveCount(17);
    await expect(page.locator('#rt-body tr[data-i="16"] td').first()).toHaveText('Контроль ОТК');
    await expect(page.locator('#rt-body tr[data-i="16"] .nh-ed')).toHaveText('0,12');
    await expect(page.locator('#rt-tag')).toHaveText('17 опер. · Σ 3,493 н.ч');
    await expect(page.locator('#rt-custom')).toHaveValue('');
    await expect(page.locator('#rt-nh')).toHaveValue('');
    await expect(selRow(page).locator('.stx')).toHaveText('на утверждении');
    await expect(page.locator('#k-wait')).toHaveText('4');
  });
});

test.describe('Удаление нормы', () => {
  test('модалка показывает имя, отмена и Escape не удаляют', async ({ page }) => {
    await row(page, 'Тяговая 80V · LF100A').click();
    await page.locator('#btnDel').click();
    await expect(page.locator('#delModal')).toBeVisible();
    await expect(page.locator('#del-name')).toHaveText('Тяговая 80V · LF100A');
    await page.locator('#del-cancel').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(row(page, 'Тяговая 80V · LF100A')).toHaveCount(1);
    await expect(page.locator('#k-total')).toHaveText('59');

    await page.locator('#btnDel').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(row(page, 'Тяговая 80V · LF100A')).toHaveCount(1);
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(35);
  });

  test('подтверждение удаляет норму и пересчитывает счётчики', async ({ page }) => {
    await row(page, 'Тяговая 80V · LF100A').click();
    await page.locator('#btnDel').click();
    await page.locator('#del-confirm').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(row(page, 'Тяговая 80V · LF100A')).toHaveCount(0);
    await expect(page.locator('#ntbody tr.itm')).toHaveCount(34);
    await expect(page.locator('#k-total')).toHaveText('58');
    await expect(page.locator('#k-wait')).toHaveText('2');
    await expect(page.locator('#r-waitcnt')).toHaveText('2');
    // выбор переходит на первую строку справочника
    await expect(selRow(page).locator('.nm')).toHaveText('Аккумулятор 10 SUNER Ni-MH AAA 12V 300mAh /Китай, ввоз Литва/');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор 10 SUNER Ni-MH AAA 12V 300mAh /Китай, ввоз Литва/');
  });
});
