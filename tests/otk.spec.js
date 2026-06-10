// Функциональные тесты прототипа «Производство · ОТК · контроль качества»
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.goto(proto('proizvodstvo_otk.html'));
});

/* Хелпер: дозаполнить протокол №250 до состояния «можно принять»
   (визуалка предзаполнена, остаются 3 функциональных пункта и ёмкость) */
async function complete250(page) {
  for (let i = 0; i < 3; i++) {
    await page.locator(`#ckwrap .ck[data-g="1"][data-i="${i}"] .ckb[data-v="ok"]`).click();
  }
  await page.locator('#ckwrap .ms[data-k="cap"] input').fill('101');
}

test.describe('ОТК · стартовый рендер', () => {

  test('KPI очереди и список позиций', async ({ page }) => {
    await expect(page.locator('#k-q')).toHaveText('25'); // 1+3+8+13 единиц
    await expect(page.locator('#k-q-f')).toHaveText('4 позиции в очереди');
    await expect(page.locator('.qitem')).toHaveCount(4);
    await expect(page.locator('.qitem').first()).toHaveClass(/sel/); // №250 выбран по умолчанию
    await expect(page.locator('.qitem .qmode')).toHaveText([
      'повторный прогон', '100% контроль', 'AQL · 8 из 26', 'AQL · 13 из 300',
    ]);
    await expect(page.locator('.qitem[data-id="250"] .qb')).toContainText('к контролю: 1 из 2');
    await expect(page.locator('.qitem[data-id="260"] .qb')).toContainText('сборщик: Руслан');
  });

  test('Паспорт изделия №250 по умолчанию', async ({ page }) => {
    await expect(page.locator('#p-no')).toHaveText('№250');
    await expect(page.locator('#p-title')).toHaveText('Аккумулятор LiFePO4 RADIAN 12V 100Ah');
    await expect(page.locator('#p-id')).toHaveText('РАД-12100-0626-02');
    await expect(page.locator('#p-qty')).toHaveText('1 из 2');
    await expect(page.locator('#p-date')).toHaveText('05.06.2026');
    await expect(page.locator('#p-asm')).toHaveText('Артём');
    await expect(page.locator('#p-u')).toHaveText('12,8 В');
    await expect(page.locator('#p-c')).toHaveText('100 Ач');
    await expect(page.locator('#p-r')).toHaveText('≤ 25 мОм');
    await expect(page.locator('#p-w')).toHaveText('13,5 кг');
  });

  test('Предзаполненный протокол №250: чек-лист, измерения, решения заблокированы', async ({ page }) => {
    // визуальный контроль принят ранее, функциональная проверка пустая
    await expect(page.locator('#ckwrap .ck')).toHaveCount(7);
    await expect(page.locator('#ckwrap .ck.ok')).toHaveCount(4);
    await expect(page.locator('#ckwrap .ck.bad')).toHaveCount(0);
    // измерения: 3 заполнены в допуске, ёмкость не измерена
    await expect(page.locator('#ckwrap .ms')).toHaveCount(4);
    await expect(page.locator('#ckwrap .mtag')).toHaveText([
      'в допуске', 'в допуске', 'в допуске', 'не измерено',
    ]);
    await expect(page.locator('#ckwrap .ms[data-k="u"] input')).toHaveValue('13.28');
    await expect(page.locator('#ckwrap .ms[data-k="cap"] input')).toHaveValue('');
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 4/7 · Измерения в допуске: 3/4');
    await expect(page.locator('#btnOk')).toBeDisabled();
    await expect(page.locator('#btnEsc')).toBeDisabled();
    await expect(page.locator('#re-custom')).toBeHidden();
  });

  test('Журнал, счётчики смены и итоги на старте', async ({ page }) => {
    await expect(page.locator('#jbody tr')).toHaveCount(3);
    await expect(page.locator('#j-cnt')).toHaveText('3 записей');
    await expect(page.locator('#jbody tr').first()).toContainText('09:42');
    await expect(page.locator('#jbody tr').first()).toContainText('№268');
    await expect(page.locator('#jbody .jres')).toHaveText([
      'Принято', 'Принято', 'Доработка · ёмкость',
    ]);
    await expect(page.locator('#r-ok')).toHaveText('12');
    await expect(page.locator('#r-okfoot')).toHaveText('67% плана смены');
    await expect(page.locator('#k-re')).toHaveText('2');
    await expect(page.locator('#s-acts')).toHaveText('2');
    await expect(page.locator('#r-esc-cnt')).toHaveText('1');
  });
});

test.describe('Очередь · выбор позиции', () => {

  test('Клик по №259 открывает её протокол', async ({ page }) => {
    await page.locator('.qitem[data-id="259"]').click();
    await expect(page.locator('.qitem[data-id="259"]')).toHaveClass(/sel/);
    await expect(page.locator('.qitem[data-id="250"]')).not.toHaveClass(/sel/);
    await expect(page.locator('#p-no')).toHaveText('№259');
    await expect(page.locator('#p-title')).toHaveText('Аккумулятор EVE 10×INR18650 5000mAh 18V');
    await expect(page.locator('#p-qty')).toHaveText('3 из 7');
    await expect(page.locator('#p-u')).toHaveText('18,0 В');
    // протокол пустой: 6 пунктов, 3 измерения
    await expect(page.locator('#ckwrap .ck')).toHaveCount(6);
    await expect(page.locator('#ckwrap .ms')).toHaveCount(3);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 0/6 · Измерения в допуске: 0/3');
    await expect(page.locator('#btnOk')).toBeDisabled();
    await expect(page.locator('#btnEsc')).toBeDisabled();
  });

  test('Отметки сохраняются при переключении позиций', async ({ page }) => {
    await page.locator('.qitem[data-id="259"]').click();
    await page.locator('#ckwrap .ck[data-g="0"][data-i="0"] .ckb[data-v="ok"]').click();
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 1/6 · Измерения в допуске: 0/3');
    // уходим на №250 и возвращаемся
    await page.locator('.qitem[data-id="250"]').click();
    await expect(page.locator('#p-no')).toHaveText('№250');
    await page.locator('.qitem[data-id="259"]').click();
    await expect(page.locator('#ckwrap .ck[data-g="0"][data-i="0"]')).toHaveClass(/ok/);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 1/6 · Измерения в допуске: 0/3');
  });
});

test.describe('Чек-лист и измерения', () => {

  test('Отметка ✕: установка, снятие повторным кликом, активация эскалации', async ({ page }) => {
    const row = page.locator('#ckwrap .ck[data-g="1"][data-i="0"]');
    await row.locator('.ckb[data-v="bad"]').click();
    await expect(page.locator('#ckwrap .ck[data-g="1"][data-i="0"]')).toHaveClass(/bad/);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 4/7 · 1 несоотв. · Измерения в допуске: 3/4');
    await expect(page.locator('#btnEsc')).toBeEnabled();
    // повторный клик снимает отметку
    await page.locator('#ckwrap .ck[data-g="1"][data-i="0"] .ckb[data-v="bad"]').click();
    await expect(page.locator('#ckwrap .ck[data-g="1"][data-i="0"]')).not.toHaveClass(/bad|ok/);
    await expect(page.locator('#btnEsc')).toBeDisabled();
    // галочка вместо креста
    await page.locator('#ckwrap .ck[data-g="1"][data-i="0"] .ckb[data-v="ok"]').click();
    await expect(page.locator('#ckwrap .ck[data-g="1"][data-i="0"]')).toHaveClass(/ok/);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 5/7 · Измерения в допуске: 3/4');
  });

  test('Измерение вне допуска и возврат в допуск', async ({ page }) => {
    const cap = page.locator('#ckwrap .ms[data-k="cap"] input');
    const tag = page.locator('#ckwrap .ms[data-k="cap"] .mtag');
    await cap.fill('99'); // допуск ≥ 100
    await expect(tag).toHaveText('вне допуска');
    await expect(page.locator('#ckwrap .ms[data-k="cap"]')).toHaveClass(/bad/);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 4/7 · Измерения в допуске: 3/4 · 1 вне');
    await expect(page.locator('#btnEsc')).toBeEnabled();
    await cap.fill('101');
    await expect(tag).toHaveText('в допуске');
    await expect(page.locator('#ckwrap .ms[data-k="cap"]')).toHaveClass(/ok/);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 4/7 · Измерения в допуске: 4/4');
    await expect(page.locator('#btnEsc')).toBeDisabled();
  });

  test('Полный чек-лист и измерения активируют «Принять»', async ({ page }) => {
    await expect(page.locator('#btnOk')).toBeDisabled();
    await complete250(page);
    await expect(page.locator('#dec-ready')).toHaveText('Чек-лист: 7/7 · Измерения в допуске: 4/4');
    await expect(page.locator('#btnOk')).toBeEnabled();
    // снятие одной отметки снова блокирует
    await page.locator('#ckwrap .ck[data-g="1"][data-i="2"] .ckb[data-v="ok"]').click();
    await expect(page.locator('#btnOk')).toBeDisabled();
  });
});

test.describe('Решение · принять', () => {

  test('Принятие: журнал, счётчик смены, очередь, KPI', async ({ page }) => {
    await complete250(page);
    await page.locator('#btnOk').click();
    // счётчик смены
    await expect(page.locator('#r-ok')).toHaveText('13');
    await expect(page.locator('#r-okfoot')).toHaveText('72% плана смены'); // 13/18
    // журнал
    await expect(page.locator('#jbody tr')).toHaveCount(4);
    await expect(page.locator('#j-cnt')).toHaveText('4 записей');
    const top = page.locator('#jbody tr').first();
    await expect(top).toContainText('№250');
    await expect(top).toContainText('Аккумулятор LiFePO4 RADIAN 12V 100Ah · 1 шт');
    await expect(top.locator('.jres')).toHaveText('Принято');
    await expect(top.locator('.jres')).toHaveClass(/ok/);
    // №250 (1 шт) израсходован — очередь и KPI пересчитаны, открыт №259
    await expect(page.locator('.qitem')).toHaveCount(3);
    await expect(page.locator('.qitem[data-id="250"]')).toHaveCount(0);
    await expect(page.locator('.qitem[data-id="259"]')).toHaveClass(/sel/);
    await expect(page.locator('#p-no')).toHaveText('№259');
    await expect(page.locator('#k-q')).toHaveText('24');
    await expect(page.locator('#k-q-f')).toHaveText('3 позиции в очереди');
  });
});

test.describe('Решение · доработка', () => {

  test('Готовая причина: KPI, журнал, расход очереди', async ({ page }) => {
    await page.locator('#re-reason').selectOption({ label: 'Пайка БМС · непропай / перемычка' });
    await page.locator('#btnRe').click();
    await expect(page.locator('#k-re')).toHaveText('3');
    const top = page.locator('#jbody tr').first();
    await expect(top).toContainText('№250');
    await expect(top.locator('.jres')).toHaveText('Доработка · Пайка БМС'); // лейбл до « ·»
    await expect(top.locator('.jres')).toHaveClass(/re/);
    await expect(page.locator('#j-cnt')).toHaveText('4 записей');
    // единица №250 ушла, селект причин сброшен
    await expect(page.locator('.qitem')).toHaveCount(3);
    await expect(page.locator('#p-no')).toHaveText('№259');
    await expect(page.locator('#re-reason')).toHaveValue('');
  });

  test('Без причины доработка не отправляется', async ({ page }) => {
    await expect(page.locator('#re-reason')).toHaveValue('');
    await page.locator('#btnRe').click();
    await expect(page.locator('#jbody tr')).toHaveCount(3);
    await expect(page.locator('#k-re')).toHaveText('2');
    await expect(page.locator('.qitem')).toHaveCount(4);
    await expect(page.locator('#p-no')).toHaveText('№250');
  });

  test('Своя причина добавляется в список причин', async ({ page }) => {
    await expect(page.locator('#re-reason option')).toHaveCount(8);
    await page.locator('#re-reason').selectOption('__custom');
    await expect(page.locator('#re-custom')).toBeVisible();
    await expect(page.locator('#re-custom')).toBeFocused();
    await page.locator('#re-custom').fill('Царапина корпуса');
    await page.locator('#btnRe').click();
    // причина встала в список перед «+ Своя причина…», ввод скрыт и очищен
    await expect(page.locator('#re-reason option')).toHaveCount(9);
    await expect(page.locator('#re-reason option').nth(7)).toHaveText('Царапина корпуса');
    await expect(page.locator('#re-reason option').nth(8)).toHaveText('+ Своя причина…');
    await expect(page.locator('#re-custom')).toBeHidden();
    await expect(page.locator('#re-custom')).toHaveValue('');
    // решение проведено
    await expect(page.locator('#k-re')).toHaveText('3');
    await expect(page.locator('#jbody tr').first().locator('.jres')).toHaveText('Доработка · Царапина корпуса');
  });

  test('Повторная своя причина не дублируется в списке', async ({ page }) => {
    await page.locator('#re-reason').selectOption('__custom');
    await page.locator('#re-custom').fill('Царапина корпуса');
    await page.locator('#btnRe').click();
    await expect(page.locator('#re-reason option')).toHaveCount(9);
    // вторая доработка с той же своей причиной — уже по №259
    await expect(page.locator('#p-no')).toHaveText('№259');
    await page.locator('#re-reason').selectOption('__custom');
    await page.locator('#re-custom').fill('Царапина корпуса');
    await page.locator('#btnRe').click();
    await expect(page.locator('#re-reason option')).toHaveCount(9); // дубля нет
    await expect(page.locator('#k-re')).toHaveText('4');
    await expect(page.locator('#j-cnt')).toHaveText('5 записей');
    await expect(page.locator('#jbody .jres').filter({ hasText: 'Доработка · Царапина корпуса' })).toHaveCount(2);
    await expect(page.locator('#p-qty')).toHaveText('2 из 7'); // №259: 3 → 2
  });

  test('Пустая своя причина блокируется', async ({ page }) => {
    await page.locator('#re-reason').selectOption('__custom');
    await page.locator('#btnRe').click(); // пусто
    await expect(page.locator('#jbody tr')).toHaveCount(3);
    await expect(page.locator('#re-custom')).toBeVisible();
    await page.locator('#re-custom').fill('   '); // только пробелы
    await page.locator('#btnRe').click();
    await expect(page.locator('#jbody tr')).toHaveCount(3);
    await expect(page.locator('#k-re')).toHaveText('2');
    await expect(page.locator('.qitem')).toHaveCount(4);
    await expect(page.locator('#re-reason option')).toHaveCount(8); // ничего не добавилось
  });
});

test.describe('Решение · брак', () => {

  test('Модалка акта: предзаполнение полей', async ({ page }) => {
    await page.locator('#btnScrap').click();
    await expect(page.locator('#scrapModal')).toBeVisible();
    await expect(page.locator('#sc-name')).toHaveText('№250 · Аккумулятор LiFePO4 RADIAN 12V 100Ah');
    // причина по умолчанию — из режима повторного прогона
    await expect(page.locator('#sc-reason')).toHaveValue('не держит ёмкость · повторный прогон');
    await expect(page.locator('#sc-src')).toHaveValue('comp');
    await expect(page.locator('#sc-comp option')).toHaveCount(4);
    await expect(page.locator('#sc-comp option').first())
      .toHaveText('Аккумулятор IFR27175200A 105Ah — Ganfeng Lithium');
    await expect(page.locator('#sc-buyer')).toBeChecked();
    await expect(page.locator('#sc-buyer')).toBeEnabled();
    await expect(page.locator('#sc-boss')).toBeChecked();
    await expect(page.locator('#sc-boss')).toBeDisabled(); // руководитель — обязательно
  });

  test('Оформление брака: акт, претензия, журнал, эскалации', async ({ page }) => {
    await page.locator('#btnScrap').click();
    await page.locator('#sc-confirm').click();
    await expect(page.locator('#scrapModal')).toBeHidden();
    await expect(page.locator('#s-acts')).toHaveText('3'); // АКТ-0610-03
    // журнал: брак с пометкой о претензии
    const top = page.locator('#jbody tr').first();
    await expect(top.locator('.jres')).toHaveText('Брак · не держит ёмкость · повторный прогон · претензия');
    await expect(top.locator('.jres')).toHaveClass(/scrap/);
    // эскалации: претензия закупщику + акт руководителю
    await expect(page.locator('#r-esc-cnt')).toHaveText('3');
    await expect(page.locator('#r-esc .rrow')).toHaveCount(3);
    await expect(page.locator('#r-esc .rrow .rt').nth(0)).toHaveText('Брак · АКТ-0610-03 → руководителю');
    await expect(page.locator('#r-esc .rrow .rt').nth(1)).toHaveText('Претензия → закупщику · ПР-0610-02');
    await expect(page.locator('#r-esc .rrow .rs').nth(1))
      .toHaveText('Ganfeng Lithium · Аккумулятор IFR27175200A 105Ah · не держит ёмкость · повторный прогон');
    // единица списана из очереди
    await expect(page.locator('.qitem')).toHaveCount(3);
    await expect(page.locator('#p-no')).toHaveText('№259');
    await expect(page.locator('#k-q')).toHaveText('24');
  });

  test('Отмена, Escape и клик по фону закрывают модалку без последствий', async ({ page }) => {
    await page.locator('#btnScrap').click();
    await expect(page.locator('#scrapModal')).toBeVisible();
    await page.locator('#sc-cancel').click();
    await expect(page.locator('#scrapModal')).toBeHidden();
    // повторное открытие → Escape
    await page.locator('#btnScrap').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#scrapModal')).toBeHidden();
    // повторное открытие → клик по подложке
    await page.locator('#btnScrap').click();
    await page.locator('#scrapModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#scrapModal')).toBeHidden();
    // ничего не изменилось
    await expect(page.locator('#s-acts')).toHaveText('2');
    await expect(page.locator('#jbody tr')).toHaveCount(3);
    await expect(page.locator('.qitem')).toHaveCount(4);
    await expect(page.locator('#p-no')).toHaveText('№250');
    await expect(page.locator('#r-esc-cnt')).toHaveText('1');
  });

  test('Источник «Сборка»: претензии закупщику нет', async ({ page }) => {
    await page.locator('#btnScrap').click();
    await page.locator('#sc-src').selectOption('asm');
    await expect(page.locator('#sc-comp-fld')).toBeHidden();
    await expect(page.locator('#sc-buyer')).not.toBeChecked();
    await expect(page.locator('#sc-buyer')).toBeDisabled();
    await page.locator('#sc-confirm').click();
    await expect(page.locator('#s-acts')).toHaveText('3');
    // только уведомление руководителю, без претензии
    await expect(page.locator('#r-esc-cnt')).toHaveText('2');
    await expect(page.locator('#r-esc .rrow')).toHaveCount(2);
    await expect(page.locator('#r-esc .rrow .rt').first()).toHaveText('Брак · АКТ-0610-03 → руководителю');
    await expect(page.locator('#jbody tr').first().locator('.jres'))
      .toHaveText('Брак · не держит ёмкость · повторный прогон'); // без « · претензия»
  });
});

test.describe('Эскалация несоответствия', () => {

  test('Пакет по измерению вне допуска: претензия + уведомление, очередь не расходуется', async ({ page }) => {
    await expect(page.locator('#btnEsc')).toBeDisabled();
    await page.locator('#ckwrap .ms[data-k="cap"] input').fill('95.5'); // допуск ≥ 100
    await expect(page.locator('#btnEsc')).toBeEnabled();
    await page.locator('#btnEsc').click();
    await expect(page.locator('#escModal')).toBeVisible();
    await expect(page.locator('#esc-name')).toHaveText('№250 · Аккумулятор LiFePO4 RADIAN 12V 100Ah');
    // причина подтянута из измерения, в русском формате
    await expect(page.locator('#esc-reason'))
      .toHaveValue('Ёмкость · контрольный разряд (анализатор): 95,5 Ач (допуск ≥ 100)');
    // отмена ничего не отправляет
    await page.locator('#esc-cancel').click();
    await expect(page.locator('#escModal')).toBeHidden();
    await expect(page.locator('#r-esc-cnt')).toHaveText('1');
    // отправляем пакет
    await page.locator('#btnEsc').click();
    await page.locator('#esc-confirm').click();
    await expect(page.locator('#escModal')).toBeHidden();
    await expect(page.locator('#r-esc-cnt')).toHaveText('3');
    await expect(page.locator('#r-esc .rrow .rt').nth(0)).toHaveText('Несоответствие → руководителю');
    await expect(page.locator('#r-esc .rrow .rt').nth(1)).toHaveText('Претензия → закупщику · ПР-0610-02');
    await expect(page.locator('#jbody tr').first().locator('.jres'))
      .toHaveText('НС передано · закупщику + руководителю');
    // решение по единице принимается отдельно — очередь не тронута
    await expect(page.locator('.qitem')).toHaveCount(4);
    await expect(page.locator('#p-no')).toHaveText('№250');
    await expect(page.locator('#k-q')).toHaveText('25');
  });
});
