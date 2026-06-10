// Функциональные тесты экрана «Производство · Планирование».
// Прототип самодостаточный (file://): годовая матрица SKU × 12 месяцев,
// мощность 704 н.ч/мес, правка плана по ячейкам, модалки добавления/редактирования/удаления.
// Ожидаемые числа рассчитаны по данным из инлайн-скрипта прототипа:
// план года 4620 н.ч / 9 470 шт; июнь (текущий месяц) 484,5 н.ч → 69%; январь 229 н.ч → 33%; средняя загрузка 55%.
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const LF32 = 'Аккумулятор 32 LiFePO4 (погрузчик)';
const AAA = 'Аккумулятор 10 SUNER Ni-MH AAA 12V 300mAh';

const row = (page, id) => page.locator(`#mtx-body tr[data-s="${id}"]`);
const cell = (page, id, m) => row(page, id).locator(`td[data-m="${m}"]`);
const rowYear = (page, id) => row(page, id).locator('td.yr');
// в tfoot: nth(0) — подпись, далее 12 месяцев, последний — год
const footCell = (page, m) => page.locator('#mtx-foot td').nth(m + 1);
const footYear = page => page.locator('#mtx-foot td.yr');

async function editCell(page, id, m, value) {
  await cell(page, id, m).click();
  const inp = page.locator('.cellinp');
  await inp.fill(value);
  await inp.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto(proto('proizvodstvo_planirovanie.html'));
});

test.describe('Стартовый рендер', () => {
  test('KPI-карточки: план года, факт периода, загрузка, пик и число позиций', async ({ page }) => {
    await expect(page.locator('#k-year')).toHaveText('4620');
    await expect(page.locator('#k-year-f')).toHaveText('9 470 шт за год');
    await expect(page.locator('#k-fact')).toHaveText('1724,7');
    await expect(page.locator('#k-planytd')).toHaveText('1994,7');
    await expect(page.locator('#k-fact-f')).toHaveText('86% плана периода');
    await expect(page.locator('#k-load')).toHaveText('55');
    await expect(page.locator('#k-peak')).toHaveText('69');
    await expect(page.locator('#k-peak-f')).toHaveText('спад 33% · выровнять');
    await expect(page.locator('#k-jun')).toHaveText('484,5');
    await expect(page.locator('#k-jun-f')).toHaveText('загрузка 69%');
    await expect(page.locator('#k-sku')).toHaveText('7');
    await expect(page.locator('#op-peak')).toHaveText('июнь (69%)');
    await expect(page.locator('#op-low')).toHaveText('январь (33%)');
  });

  test('матрица: 7 позиций, 12 месяцев, итоги месяцев и года', async ({ page }) => {
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    await expect(page.locator('#mtx-head th')).toHaveCount(14);
    await expect(page.locator('#mtx-head th.now')).toHaveText('Июн');
    await expect(page.locator('#mtx-head th.yr')).toHaveText('Год');
    const lf = row(page, 'lf32');
    await expect(lf.locator('.skn')).toHaveText(LF32);
    await expect(lf.locator('.skm')).toHaveText('№1 · норма 3,3 н.ч/шт');
    await expect(cell(page, 'lf32', 0)).toHaveText('40');
    await expect(cell(page, 'lf32', 2)).toHaveText('95');
    await expect(rowYear(page, 'lf32')).toHaveText('710');
    await expect(rowYear(page, 'fanso')).toHaveText('4 900');
    // в ячейке tfoot число н.ч и процент загрузки идут слитно (textContent)
    await expect(footCell(page, 0)).toHaveText('22933%');
    await expect(footCell(page, 5)).toHaveText('484,569%');
    await expect(footCell(page, 5).locator('.ld-pct')).toHaveClass(/ok/);
    await expect(footYear(page)).toHaveText('4620');
    // в режиме «штуки» редактируемы все 7 × 12 ячеек
    await expect(page.locator('#mtx-body td.ed')).toHaveCount(84);
  });

  test('сводка, правая панель и график загрузки против мощности', async ({ page }) => {
    await expect(page.locator('#s-year')).toHaveText('4620');
    await expect(page.locator('#s-fact')).toHaveText('1724,7');
    await expect(page.locator('#s-load')).toHaveText('55');
    await expect(page.locator('#s-peak')).toHaveText('69% / 33%');
    await expect(page.locator('#s-ready')).toHaveText('86');
    await expect(page.locator('#s-sku')).toHaveText('7');
    await expect(page.locator('#r-year')).toHaveText('4620 н.ч');
    await expect(page.locator('#r-foot')).toHaveText('загрузка 55%');
    const bars = page.locator('#caps .cb');
    await expect(bars).toHaveCount(12);
    await expect(page.locator('#caps .cb.now .cl')).toHaveText('Июн');
    await expect(page.locator('#caps .cb.now .cv')).toHaveText('485');
    await expect(bars.nth(0).locator('.cv')).toHaveText('229');
    await expect(bars.nth(0).locator('.cvf')).toHaveText('197');
    await expect(bars.nth(6).locator('.cvf')).toHaveText('—'); // будущие месяцы — без факта
    const lead = page.locator('#lead .lead');
    await expect(lead).toHaveCount(7);
    await expect(lead.nth(0).locator('.ln')).toHaveText(LF32);
    await expect(lead.nth(0).locator('.lv')).toHaveText('2343 н.ч');
    await expect(lead.nth(1).locator('.lv')).toHaveText('924 н.ч');
  });

  test('деталь по умолчанию: первая позиция с маршрутом и стоимостью', async ({ page }) => {
    await expect(row(page, 'lf32')).toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№1');
    await expect(page.locator('#d-title')).toHaveText(LF32);
    await expect(page.locator('#d-yearnh')).toHaveText('2343');
    await expect(page.locator('#d-yearsht')).toHaveText('710');
    await expect(page.locator('#d-factsht')).toHaveText('333');
    await expect(page.locator('#d-peakm')).toHaveText('Мар · 95 шт');
    await expect(page.locator('#d-norm')).toHaveText('3,3 ч');
    await expect(page.locator('#d-mbar .mb')).toHaveCount(12);
    await expect(page.locator('#d-ops tr')).toHaveCount(15);
    await expect(page.locator('#d-optag')).toHaveText('3,3 н.ч');
    const firstOp = page.locator('#d-ops tr').nth(0);
    await expect(firstOp.locator('td').nth(0)).toHaveText('Сварка 32 батарей в холдерах');
    await expect(firstOp.locator('td').nth(1)).toHaveText('0,4'); // fmt() округляет до 1 знака
    await expect(firstOp.locator('td').nth(2)).toHaveText('13%');
    await expect(page.locator('#d-cost')).toHaveText('82,5');
    await expect(page.locator('#d-yearcost')).toHaveText('58 575 BYN');
    await expect(page.locator('#d-yearprem')).toHaveText('14 644 BYN');
    await expect(page.locator('#d-norm2')).toHaveText('3,3 ч');
    await expect(page.locator('#d-yearnh2')).toHaveText('2343 ч');
  });
});

test.describe('Правка ячеек плана', () => {
  test('Enter сохраняет значение и пересчитывает строку, месяц и KPI', async ({ page }) => {
    await editCell(page, 'lf32', 0, '100'); // январь 40 → 100 (+60 шт × 3,3 н.ч)
    await expect(cell(page, 'lf32', 0)).toHaveText('100');
    await expect(rowYear(page, 'lf32')).toHaveText('770');
    await expect(footCell(page, 0)).toHaveText('42761%'); // 229+198=427 н.ч → 61%
    await expect(footYear(page)).toHaveText('4818');
    await expect(page.locator('#k-year')).toHaveText('4818');
    await expect(page.locator('#k-year-f')).toHaveText('9 530 шт за год');
    await expect(page.locator('#d-yearsht')).toHaveText('770');
    await expect(page.locator('#d-yearnh')).toHaveText('2541');
    await expect(page.locator('#caps .cb').nth(0).locator('.cv')).toHaveText('427');
  });

  test('Escape отменяет правку без пересчёта', async ({ page }) => {
    await cell(page, 'lf32', 0).click();
    const inp = page.locator('.cellinp');
    await expect(inp).toHaveValue('40');
    await inp.fill('999');
    await inp.press('Escape');
    await expect(page.locator('.cellinp')).toHaveCount(0);
    await expect(cell(page, 'lf32', 0)).toHaveText('40');
    await expect(rowYear(page, 'lf32')).toHaveText('710');
    await expect(page.locator('#k-year')).toHaveText('4620');
  });

  test('пустой ввод сохраняется как 0 (коммит по потере фокуса)', async ({ page }) => {
    await cell(page, 'lf32', 0).click();
    await page.locator('.cellinp').fill('');
    await page.locator('.section-h h2').click(); // blur → commit
    await expect(cell(page, 'lf32', 0)).toHaveText('0');
    await expect(rowYear(page, 'lf32')).toHaveText('670');
    await expect(footCell(page, 0)).toHaveText('9714%'); // 229-132=97 н.ч → 14%
    await expect(page.locator('#k-year')).toHaveText('4488');
  });

  test('значение выше мощности подсвечивает месяц и смещает пик', async ({ page }) => {
    await editCell(page, 'lf32', 0, '200'); // январь: 229+528=757 н.ч → 108% > 100%
    await expect(footCell(page, 0)).toHaveText('757108%');
    await expect(footCell(page, 0).locator('.ld-pct')).toHaveClass(/hi/);
    await expect(page.locator('#k-peak')).toHaveText('108');
    await expect(page.locator('#op-peak')).toHaveText('январь (108%)');
    await expect(page.locator('#op-low')).toHaveText('февраль (33%)');
    await expect(page.locator('#s-peak')).toHaveText('108% / 33%');
  });
});

test.describe('Единицы измерения', () => {
  test('переключение штуки ↔ нормо-часы меняет ячейки и блокирует правку', async ({ page }) => {
    const nhBtn = page.locator('#unitseg button[data-u="nh"]');
    await nhBtn.click();
    await expect(nhBtn).toHaveClass(/active/);
    await expect(cell(page, 'lf32', 0)).toHaveText('132'); // 40 × 3,3
    await expect(cell(page, 'lf32', 2)).toHaveText('313,5'); // 95 × 3,3
    await expect(cell(page, 'p48', 0)).toHaveText('—'); // нулевой план
    await expect(rowYear(page, 'lf32')).toHaveText('2343');
    await expect(rowYear(page, 'aaa')).toHaveText('240');
    await expect(page.locator('#mtx-body td.ed')).toHaveCount(0);
    await cell(page, 'lf32', 0).click(); // в нормо-часах правка недоступна
    await expect(page.locator('.cellinp')).toHaveCount(0);
    // итоговая строка всегда в нормо-часах
    await expect(footCell(page, 0)).toHaveText('22933%');
    // обратно в штуки — снова редактируемо
    await page.locator('#unitseg button[data-u="sht"]').click();
    await expect(cell(page, 'lf32', 0)).toHaveText('40');
    await expect(page.locator('#mtx-body td.ed')).toHaveCount(84);
  });
});

test.describe('Выбор позиции', () => {
  test('клик по названию открывает деталь позиции с её цифрами', async ({ page }) => {
    await row(page, 'p24').locator('.skn').click();
    await expect(row(page, 'p24')).toHaveClass(/sel/);
    await expect(row(page, 'lf32')).not.toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№5');
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор для погрузчика 24В');
    await expect(page.locator('#d-yearnh')).toHaveText('924');
    await expect(page.locator('#d-yearsht')).toHaveText('132');
    await expect(page.locator('#d-factsht')).toHaveText('28');
    await expect(page.locator('#d-peakm')).toHaveText('Июн · 15 шт');
    await expect(page.locator('#d-norm')).toHaveText('7 ч');
    await expect(page.locator('#d-ops tr')).toHaveCount(4);
    await expect(page.locator('#d-optag')).toHaveText('7 н.ч');
    await expect(page.locator('#d-cost')).toHaveText('175');
    await expect(page.locator('#d-yearcost')).toHaveText('23 100 BYN');
    await expect(page.locator('#d-yearprem')).toHaveText('5 775 BYN');
  });

  test('клик по строке топ-SKU выбирает позицию в матрице и детали', async ({ page }) => {
    await page.locator('#lead .lead[data-s="oth"]').click();
    await expect(row(page, 'oth')).toHaveClass(/sel/);
    await expect(page.locator('#d-no')).toHaveText('№7');
    await expect(page.locator('#d-title')).toHaveText('Прочие АКБ и сборки');
  });
});

test.describe('Добавление позиции', () => {
  test('новая позиция добавляется в матрицу и пересчитывает итоги', async ({ page }) => {
    await page.locator('#btnAdd').click();
    const modal = page.locator('#addModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Новая позиция плана');
    await expect(page.locator('#np-save-t')).toHaveText('Добавить в план');
    await expect(page.locator('#fld-qty')).toBeVisible();
    await page.locator('#np-name').fill('Тестовая АКБ 12V');
    await page.locator('#np-norm').fill('0.5');
    await page.locator('#np-qty').fill('10');
    await page.locator('#np-save').click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(8);
    const sel = page.locator('#mtx-body tr.sel');
    await expect(sel.locator('.skn')).toHaveText('Тестовая АКБ 12V');
    await expect(sel.locator('.skm')).toHaveText('№8 · норма 0,5 н.ч/шт');
    await expect(sel.locator('td[data-m="0"]')).toHaveText('10');
    await expect(sel.locator('td.yr')).toHaveText('120');
    await expect(page.locator('#d-no')).toHaveText('№8');
    await expect(page.locator('#d-title')).toHaveText('Тестовая АКБ 12V');
    await expect(page.locator('#d-yearnh')).toHaveText('60');
    await expect(page.locator('#d-norm')).toHaveText('0,5 ч');
    await expect(page.locator('#k-sku')).toHaveText('8');
    await expect(page.locator('#k-year')).toHaveText('4680');
    await expect(footCell(page, 0)).toHaveText('23433%'); // 229+5=234 н.ч → 33%
    await expect(page.locator('#lead .lead')).toHaveCount(8);
  });

  test('отмена, Escape и клик в фон закрывают модалку без добавления', async ({ page }) => {
    // отмена кнопкой
    await page.locator('#btnAdd').click();
    await page.locator('#np-name').fill('Черновик');
    await page.locator('#np-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    await expect(page.locator('#k-sku')).toHaveText('7');
    // повторное открытие — форма чистая
    await page.locator('#btnAdd').click();
    await expect(page.locator('#np-name')).toHaveValue('');
    await expect(page.locator('#np-qty')).toHaveValue('');
    // Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    // клик в фон (вне карточки)
    await page.locator('#btnAdd').click();
    await page.locator('#addModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
  });

  test('сохранение пустой формы создаёт позицию с дефолтами прототипа', async ({ page }) => {
    // в прототипе нет валидации: пустая форма даёт «Новая позиция», норму 0,2 и план 0
    await page.locator('#btnAdd').click();
    await page.locator('#np-save').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(8);
    const sel = page.locator('#mtx-body tr.sel');
    await expect(sel.locator('.skn')).toHaveText('Новая позиция');
    await expect(sel.locator('.skm')).toHaveText('№8 · норма 0,2 н.ч/шт');
    await expect(sel.locator('td[data-m="0"]')).toHaveText('0');
    await expect(sel.locator('td.yr')).toHaveText('0');
    await expect(page.locator('#k-sku')).toHaveText('8');
    await expect(page.locator('#k-year')).toHaveText('4620'); // нулевой план не меняет нормо-часы
  });
});

test.describe('Редактирование позиции', () => {
  test('модалка предзаполнена, количество скрыто, Escape не меняет данные', async ({ page }) => {
    await page.locator('#btnEdit').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Редактирование позиции');
    await expect(page.locator('#np-save-t')).toHaveText('Сохранить');
    await expect(page.locator('#np-name')).toHaveValue(LF32);
    await expect(page.locator('#np-norm')).toHaveValue('3.3');
    await expect(page.locator('#fld-qty')).toBeHidden();
    await expect(page.locator('#np-norm-hint')).toHaveText('правка нормы пересчитает н.ч, загрузку и стоимость по всем месяцам');
    await page.keyboard.press('Escape');
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#d-norm')).toHaveText('3,3 ч');
    await expect(page.locator('#k-year')).toHaveText('4620');
  });

  test('правка названия и нормы пересчитывает н.ч, загрузку и стоимость', async ({ page }) => {
    await page.locator('#btnEdit').click();
    await page.locator('#np-name').fill('Аккумулятор 32 LiFePO4 (v2)');
    await page.locator('#np-norm').fill('1');
    await page.locator('#np-save').click();
    await expect(page.locator('#addModal')).toBeHidden();
    const lf = row(page, 'lf32');
    await expect(lf.locator('.skn')).toHaveText('Аккумулятор 32 LiFePO4 (v2)');
    await expect(lf.locator('.skm')).toHaveText('№1 · норма 1 н.ч/шт');
    await expect(rowYear(page, 'lf32')).toHaveText('710'); // штуки не меняются
    await expect(page.locator('#d-title')).toHaveText('Аккумулятор 32 LiFePO4 (v2)');
    await expect(page.locator('#d-norm')).toHaveText('1 ч');
    await expect(page.locator('#d-yearnh')).toHaveText('710');
    await expect(page.locator('#d-cost')).toHaveText('25');
    await expect(page.locator('#d-optag')).toHaveText('1 н.ч'); // маршрут масштабируется к новой норме
    await expect(page.locator('#k-year')).toHaveText('2987'); // 4620 − 2343 + 710
    await expect(footCell(page, 0)).toHaveText('13719%'); // 229 − 132 + 40 = 137 н.ч → 19%
    await expect(footYear(page)).toHaveText('2987');
  });

  test('кнопка в строке открывает редактирование именно своей позиции', async ({ page }) => {
    const aaa = row(page, 'aaa');
    await aaa.hover();
    await aaa.locator('.rowed').click();
    await expect(page.locator('#addModal')).toBeVisible();
    await expect(page.locator('#mc-title')).toHaveText('Редактирование позиции');
    await expect(page.locator('#np-name')).toHaveValue(AAA);
    await expect(aaa).toHaveClass(/sel/); // строка одновременно выбирается
    await page.locator('#np-cancel').click();
    await expect(page.locator('#addModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
  });
});

test.describe('Удаление позиции', () => {
  test('модалка показывает данные позиции, отмена не удаляет', async ({ page }) => {
    await page.locator('#btnDel').click();
    await expect(page.locator('#delModal')).toBeVisible();
    await expect(page.locator('#del-name')).toHaveText(LF32);
    await expect(page.locator('#del-info')).toContainText('План года: 710 шт · 2343 н.ч');
    await page.locator('#del-cancel').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    await expect(row(page, 'lf32')).toHaveCount(1);
    await expect(page.locator('#k-sku')).toHaveText('7');
  });

  test('подтверждение удаляет позицию, перенумеровывает и пересчитывает итоги', async ({ page }) => {
    await page.locator('#btnDel').click();
    await page.locator('#del-confirm').click();
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(6);
    await expect(row(page, 'lf32')).toHaveCount(0);
    // бывшая №2 становится №1, выбор переходит на неё
    await expect(row(page, 'aaa').locator('.skm')).toHaveText('№1 · норма 0,2 н.ч/шт');
    await expect(page.locator('#d-no')).toHaveText('№1');
    await expect(page.locator('#d-title')).toHaveText(AAA);
    await expect(page.locator('#k-sku')).toHaveText('6');
    await expect(page.locator('#k-year')).toHaveText('2277'); // 4620 − 2343
    await expect(footYear(page)).toHaveText('2277');
    await expect(page.locator('#lead .lead').nth(0).locator('.lv')).toHaveText('924 н.ч');
  });

  test('Escape и клик в фон закрывают подтверждение без удаления', async ({ page }) => {
    await page.locator('#btnDel').click();
    await expect(page.locator('#delModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    await page.locator('#btnDel').click();
    await page.locator('#delModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#delModal')).toBeHidden();
    await expect(page.locator('#mtx-body tr')).toHaveCount(7);
    await expect(page.locator('#d-title')).toHaveText(LF32);
  });
});
