// Функциональные тесты прототипа «Производство · Выработка и оценка».
//
// Особенности прототипа (выяснено по коду):
// - Данные сборщиков лежат в глобальном объекте W, расчёты — в глобальных
//   функциях derive/buildTable/fillTotals/buildLeaderboard/renderWorker.
//   Редактируемых полей в UI нет, поэтому арифметику ЗП проверяем, меняя
//   вводные через page.evaluate и прогоняя штатный конвейер пересчёта
//   (тот же, что выполняется при загрузке страницы).
// - Формула: оклад × дни/22 + выработка(н.ч) × 6,25 BYN; вклад = н.ч × 25 BYN.
// - Русский формат чисел: запятая — десятичный разделитель, неразрывный
//   пробел — разделитель тысяч (toHaveText нормализует его в обычный пробел).
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

// Пересчёт страницы с изменёнными вводными — повторяет init-конвейер прототипа.
const recalc = (page, mutate, selectKey) =>
  page.evaluate(([mutSrc, key]) => {
    eval(mutSrc)(W);
    const T = buildTable();
    fillTotals(T);
    buildLeaderboard();
    bindRows();
    selectWorker(key);
  }, [mutate.toString(), selectKey]);

const row = (page, k) => page.locator(`#wtbody tr[data-w="${k}"]`);
const cell = (page, k, i) => row(page, k).locator('td').nth(i);

test.beforeEach(async ({ page }) => {
  // Прототип тянет внешние ресурсы (Google Fonts, i.pravatar.cc) — на медленной
  // сети событие load подвисает. Блокируем сеть: file://-страница самодостаточна,
  // а скрипт выполняется синхронно в конце body, т.е. к domcontentloaded всё готово.
  await page.route(/^https?:\/\//, r => r.abort());
  await page.goto(proto('proizvodstvo_vyrabotka.html'), { waitUntil: 'domcontentloaded' });
});

test.describe('Стартовый рендер · KPI цеха', () => {
  test('выработка цеха, эффективность и выработка в день посчитаны от табеля', async ({ page }) => {
    await expect(page).toHaveTitle('ERP · Производство · Выработка и оценка');
    // 63,1 + 28,35 + 18,9 + 17 = 127,35 → «127,4»; норма периода 25 дн × 7,5
    await expect(page.locator('#k-fact')).toHaveText('127,4');
    await expect(page.locator('#k-normtd')).toHaveText('187,5');
    await expect(page.locator('#k-fact-f')).toHaveText('68% нормы периода');
    await expect(page.locator('#k-fact-bar')).toHaveAttribute('style', /width:\s*68%/);
    // эффективность = 127,35 / (25 дн × 8 ч) = 64%
    await expect(page.locator('#k-eff')).toHaveText('64');
    await expect(page.locator('#k-perday')).toHaveText('5,1');
  });

  test('денежные KPI: ФОТ, премия и стоимость выработки', async ({ page }) => {
    // оклад 1200 + премия 127,35 × 6,25 = 795,94 → итог 1 996
    await expect(page.locator('#k-fot')).toHaveText('1 996');
    await expect(page.locator('#k-fot-f')).toHaveText('оклад 1 200 + премия 796');
    await expect(page.locator('#k-prem')).toHaveText('796');
    await expect(page.locator('#k-prem-f')).toHaveText('× 6,25 BYN/н.ч · 40% ФОТ');
    // вклад = 127,35 × 25 BYN
    await expect(page.locator('#k-vklad')).toHaveText('3 184');
  });
});

test.describe('Табель по сборщикам', () => {
  test('четыре сборщика в исходном порядке, Михаил выделен по умолчанию', async ({ page }) => {
    await expect(page.locator('#wtbody tr')).toHaveCount(4);
    await expect(page.locator('#wtbody .nm')).toHaveText(['Михаил', 'Руслан', 'Артём', 'Николай']);
    await expect(page.locator('#wtbody tr.sel')).toHaveCount(1);
    await expect(row(page, 'mih')).toHaveClass(/sel/);
  });

  test('строка Михаила: перевыполнение нормы и расчёт ЗП', async ({ page }) => {
    await expect(cell(page, 'mih', 1)).toHaveText('7 / 7');
    await expect(cell(page, 'mih', 2)).toHaveText('63,1 / 176');
    // отклонение к норме периода: 63,1 − 52,5 = +10,6
    const dev = row(page, 'mih').locator('.dev');
    await expect(dev).toHaveText('+10,6');
    await expect(dev).toHaveClass(/pos/);
    await expect(cell(page, 'mih', 4)).toHaveText('9');
    const eff = row(page, 'mih').locator('.eff');
    await expect(eff).toHaveText('113%');
    await expect(eff).toHaveClass(/hi/);
    // оклад 1200 × 7/22 = 382; премия 63,1 × 6,25 = 394; итого 776
    await expect(cell(page, 'mih', 6)).toHaveText('382');
    await expect(cell(page, 'mih', 7)).toHaveText('394');
    await expect(cell(page, 'mih', 8)).toHaveText('776');
  });

  test('строка Николая: недовыработка с красными маркерами', async ({ page }) => {
    await expect(cell(page, 'nik', 1)).toHaveText('5 / 7');
    await expect(cell(page, 'nik', 2)).toHaveText('17 / 176');
    const dev = row(page, 'nik').locator('.dev');
    await expect(dev).toHaveText('-20,5');
    await expect(dev).toHaveClass(/neg/);
    await expect(cell(page, 'nik', 4)).toHaveText('3,4');
    const eff = row(page, 'nik').locator('.eff');
    await expect(eff).toHaveText('43%');
    await expect(eff).toHaveClass(/lo/);
    // оклад 1000 × 5/22 = 227; премия 17 × 6,25 = 106; итого 334
    await expect(cell(page, 'nik', 6)).toHaveText('227');
    await expect(cell(page, 'nik', 7)).toHaveText('106');
    await expect(cell(page, 'nik', 8)).toHaveText('334');
  });

  test('итоговая строка цеха суммирует табель и ФОТ', async ({ page }) => {
    await expect(page.locator('#wtfoot td')).toHaveText([
      'ИТОГО · ЦЕХ', '25', '127,4', '', '5,1', '64%', '1 200', '796', '1 996',
    ]);
  });

  test('сводка «Итоги по фонду оплаты» сходится с таблицей', async ({ page }) => {
    await expect(page.locator('#s-okl')).toHaveText('1 200');
    await expect(page.locator('#s-prem')).toHaveText('796');
    await expect(page.locator('#s-fot')).toHaveText('1 996');
    // средняя ЗП = 1 995,94 / 4 = 499
    await expect(page.locator('#s-avg')).toHaveText('499');
    await expect(page.locator('#s-vklad')).toHaveText('3 184');
    await expect(page.locator('#s-share')).toHaveText('40');
  });

  test('правая панель дублирует выработку цеха и процент к норме', async ({ page }) => {
    await expect(page.locator('#r-fact')).toHaveText('127,4');
    await expect(page.locator('#r-normtd')).toHaveText('187,5');
    await expect(page.locator('#r-foot')).toHaveText('68% к норме периода');
    await expect(page.locator('#r-bar')).toHaveAttribute('style', /width:\s*68%/);
  });
});

test.describe('Лидеры по вкладу', () => {
  test('рейтинг отсортирован по стоимости выработки, первый отмечен золотом', async ({ page }) => {
    const leads = page.locator('#lead .lead');
    await expect(leads).toHaveCount(4);
    await expect(page.locator('#lead .ln')).toHaveText(['Михаил', 'Руслан', 'Артём', 'Николай']);
    await expect(page.locator('#lead .rk')).toHaveText(['1', '2', '3', '4']);
    // вклад = факт н.ч × 25 BYN
    await expect(page.locator('#lead .lv')).toHaveText([
      '1 578 BYN', '709 BYN', '472 BYN', '425 BYN',
    ]);
    await expect(leads.nth(0).locator('.rk')).toHaveClass(/g1/);
    await expect(leads.nth(1).locator('.rk')).not.toHaveClass(/g1/);
    await expect(leads.nth(0).locator('.ls')).toHaveText('63,1 н.ч выработано');
  });
});

test.describe('Деталка сотрудника (по умолчанию Михаил)', () => {
  test('формула ЗП: оклад × дни/22 + выработка × 6,25', async ({ page }) => {
    await expect(page.locator('#d-name')).toHaveText('Михаил');
    await expect(page.locator('#d-full')).toHaveText('Дым Михаил Сергеевич');
    await expect(page.locator('#f-okl')).toHaveText('1 200');
    await expect(page.locator('#f-days')).toHaveText('7');
    await expect(page.locator('#f-fact')).toHaveText('63,1');
    await expect(page.locator('#f-itog')).toHaveText('776');
    await expect(page.locator('#d-okl')).toHaveText('382 BYN');
    await expect(page.locator('#d-wdays')).toHaveText('7 / 22');
    await expect(page.locator('#d-prem')).toHaveText('394 BYN');
    await expect(page.locator('#d-itog')).toHaveText('776 BYN');
  });

  test('график по дням: 7 столбиков с фактами и датами, без провалов', async ({ page }) => {
    await expect(page.locator('#d-days .dy')).toHaveCount(7);
    await expect(page.locator('#d-days .dy .dv')).toHaveText(['8', '9', '8,5', '9', '7,6', '9', '12']);
    await expect(page.locator('#d-days .dy .dl')).toHaveText(['01', '02', '03', '04', '05', '08', '09']);
    // у Михаила все дни не ниже нормы 7,5 — ни «низких», ни нулевых баров
    await expect(page.locator('#d-days .bk.lo')).toHaveCount(0);
    await expect(page.locator('#d-days .bk.zero')).toHaveCount(0);
    await expect(page.locator('#d-bars-sum')).toHaveText('итого 63,1 н.ч · норма к периоду 52,5 н.ч');
    await expect(page.locator('#d-dev')).toHaveText('+10,6 ч');
    await expect(page.locator('#d-dev')).toHaveClass(/pos/);
    await expect(page.locator('#d-perday')).toHaveText('9 ч');
  });

  test('операции сборщика и структура времени', async ({ page }) => {
    const ops = page.locator('#d-ops tr');
    await expect(ops).toHaveCount(5);
    await expect(ops.nth(0).locator('td')).toHaveText(['Сварка 32 батарей в холдерах', '24,3']);
    await expect(ops.nth(4).locator('td')).toHaveText(['Прочие сборки', '4,5']);
    await expect(page.locator('#d-eff')).toHaveText('113');
    await expect(page.locator('#d-idle .ld')).toHaveCount(3);
    await expect(page.locator('#d-idle .ld b')).toHaveText(['82%', '12%', '6%']);
  });
});

test.describe('Выбор сотрудника', () => {
  test('клик по строке Руслана переключает выделение и деталку', async ({ page }) => {
    await row(page, 'rus').click();
    await expect(page.locator('#wtbody tr.sel')).toHaveCount(1);
    await expect(row(page, 'rus')).toHaveClass(/sel/);
    await expect(row(page, 'mih')).not.toHaveClass(/sel/);
    await expect(page.locator('#d-name')).toHaveText('Руслан');
    // 28,35 × 10 = 283,5… → отображается «28,4»
    await expect(page.locator('#f-okl')).toHaveText('1 000');
    await expect(page.locator('#f-fact')).toHaveText('28,4');
    await expect(page.locator('#f-itog')).toHaveText('495');
    await expect(page.locator('#d-prem')).toHaveText('177 BYN');
    await expect(page.locator('#d-dev')).toHaveText('-24,1 ч');
    await expect(page.locator('#d-dev')).not.toHaveClass(/pos/);
    // все 7 дней Руслана ниже нормы 7,5 — все бары «низкие»
    await expect(page.locator('#d-days .bk.lo')).toHaveCount(7);
  });

  test('клик по лидеру открывает деталку и подсвечивает строку таблицы', async ({ page }) => {
    await page.locator('#lead .lead[data-w="art"]').click();
    await expect(row(page, 'art')).toHaveClass(/sel/);
    await expect(page.locator('#wtbody tr.sel')).toHaveCount(1);
    await expect(page.locator('#d-name')).toHaveText('Артём');
    await expect(page.locator('#d-full')).toHaveText('Коровкин Артём Геннадьевич');
    await expect(page.locator('#d-bars-sum')).toHaveText('итого 18,9 н.ч · норма к периоду 45 н.ч');
    // у Артёма два нулевых дня — прочерки и «нулевые» бары
    await expect(page.locator('#d-days .bk.zero')).toHaveCount(2);
    await expect(page.locator('#d-days .dy .dv')).toHaveText(['4', '2,4', '6', '—', '—', '3,5', '3']);
  });

  test('повторный клик не ломает выделение, возврат к Михаилу работает', async ({ page }) => {
    await row(page, 'nik').click();
    await row(page, 'nik').click();
    await expect(page.locator('#wtbody tr.sel')).toHaveCount(1);
    await expect(row(page, 'nik')).toHaveClass(/sel/);
    await expect(page.locator('#d-name')).toHaveText('Николай');
    await expect(page.locator('#f-itog')).toHaveText('334');
    await row(page, 'mih').click();
    await expect(row(page, 'mih')).toHaveClass(/sel/);
    await expect(row(page, 'nik')).not.toHaveClass(/sel/);
    await expect(page.locator('#d-name')).toHaveText('Михаил');
    await expect(page.locator('#f-itog')).toHaveText('776');
  });
});

test.describe('Вкладки деталки', () => {
  test('активная вкладка всегда одна и следует за кликами', async ({ page }) => {
    await expect(page.locator('.dtab')).toHaveCount(4);
    await expect(page.locator('.dtab.active')).toHaveText('Выработка по дням');
    await page.locator('.dtab', { hasText: 'Расчёт ЗП' }).click();
    await expect(page.locator('.dtab.active')).toHaveCount(1);
    await expect(page.locator('.dtab.active')).toHaveText('Расчёт ЗП');
    await page.locator('.dtab', { hasText: 'Структура времени' }).click();
    await expect(page.locator('.dtab.active')).toHaveCount(1);
    await expect(page.locator('.dtab.active')).toHaveText('Структура времени');
  });
});

test.describe('Пересчёт при изменении вводных', () => {
  test('рост выработки Руслана до 40 н.ч пересчитывает премию, итог и KPI', async ({ page }) => {
    await recalc(page, W => { W.rus.fact = 40; }, 'rus');
    // строка: откл 40 − 52,5 = −12,5; премия 40 × 6,25 = 250; итог 318 + 250 = 568
    await expect(row(page, 'rus').locator('.dev')).toHaveText('-12,5');
    await expect(cell(page, 'rus', 4)).toHaveText('5,7');
    await expect(row(page, 'rus').locator('.eff')).toHaveText('71%');
    await expect(cell(page, 'rus', 6)).toHaveText('318');
    await expect(cell(page, 'rus', 7)).toHaveText('250');
    await expect(cell(page, 'rus', 8)).toHaveText('568');
    // деталка и формула
    await expect(page.locator('#f-fact')).toHaveText('40');
    await expect(page.locator('#f-itog')).toHaveText('568');
    await expect(page.locator('#d-prem')).toHaveText('250 BYN');
    // KPI и сводка цеха: ФОТ 1200 + 868,75 = 2 069
    await expect(page.locator('#k-fot')).toHaveText('2 069');
    await expect(page.locator('#k-prem')).toHaveText('869');
    await expect(page.locator('#k-fot-f')).toHaveText('оклад 1 200 + премия 869');
    await expect(page.locator('#k-prem-f')).toHaveText('× 6,25 BYN/н.ч · 42% ФОТ');
    await expect(page.locator('#s-avg')).toHaveText('517');
    // лидерборд: вклад Руслана 40 × 25 = 1 000, по-прежнему 2-е место
    const rusLead = page.locator('#lead .lead[data-w="rus"]');
    await expect(rusLead.locator('.lv')).toHaveText('1 000 BYN');
    await expect(rusLead.locator('.rk')).toHaveText('2');
    // после перестроения строки остаются кликабельными
    await row(page, 'mih').click();
    await expect(page.locator('#d-name')).toHaveText('Михаил');
  });

  test('у Николая 8 дней и 60 н.ч: оклад, отклонение и итог цеха пересчитаны', async ({ page }) => {
    await recalc(page, W => { W.nik.days = 8; W.nik.fact = 60; }, 'nik');
    // оклад 1000 × 8/22 = 364; премия 60 × 6,25 = 375; итог 739
    await expect(cell(page, 'nik', 6)).toHaveText('364');
    await expect(cell(page, 'nik', 7)).toHaveText('375');
    await expect(cell(page, 'nik', 8)).toHaveText('739');
    // выработка ровно в норму: 60 − 8 × 7,5 = +0
    const dev = row(page, 'nik').locator('.dev');
    await expect(dev).toHaveText('+0');
    await expect(dev).toHaveClass(/pos/);
    await expect(cell(page, 'nik', 4)).toHaveText('7,5');
    const eff = row(page, 'nik').locator('.eff');
    await expect(eff).toHaveText('94%');
    await expect(eff).toHaveClass(/hi/);
    // итог цеха: 28 дней, 170,35 н.ч → ФОТ 2 401
    await expect(page.locator('#wtfoot td')).toHaveText([
      'ИТОГО · ЦЕХ', '28', '170,4', '', '6,1', '76%', '1 336', '1 065', '2 401',
    ]);
    // деталка: дни в формуле и норма к периоду
    await expect(page.locator('#f-days')).toHaveText('8');
    await expect(page.locator('#d-wdays')).toHaveText('8 / 22');
    await expect(page.locator('#d-itog')).toHaveText('739 BYN');
    await expect(page.locator('#d-dev')).toHaveText('+0 ч');
  });

  test('нулевая выработка Артёма: премия 0, остаётся только оклад', async ({ page }) => {
    await recalc(page, W => { W.art.fact = 0; }, 'art');
    // премия 0 × 6,25 = 0; итог = оклад 1000 × 6/22 = 273
    await expect(cell(page, 'art', 7)).toHaveText('0');
    await expect(cell(page, 'art', 8)).toHaveText('273');
    const dev = row(page, 'art').locator('.dev');
    await expect(dev).toHaveText('-45');
    await expect(dev).toHaveClass(/neg/);
    await expect(cell(page, 'art', 4)).toHaveText('0');
    const eff = row(page, 'art').locator('.eff');
    await expect(eff).toHaveText('0%');
    await expect(eff).toHaveClass(/lo/);
    // деталка и формула
    await expect(page.locator('#f-itog')).toHaveText('273');
    await expect(page.locator('#d-prem')).toHaveText('0 BYN');
    await expect(page.locator('#d-itog')).toHaveText('273 BYN');
    // лидерборд: Артём падает на последнее место с нулевым вкладом
    const artLead = page.locator('#lead .lead[data-w="art"]');
    await expect(artLead.locator('.rk')).toHaveText('4');
    await expect(artLead.locator('.lv')).toHaveText('0 BYN');
    // KPI цеха без выработки Артёма
    await expect(page.locator('#k-fot')).toHaveText('1 878');
    await expect(page.locator('#k-prem')).toHaveText('678');
    await expect(page.locator('#k-vklad')).toHaveText('2 711');
  });
});
