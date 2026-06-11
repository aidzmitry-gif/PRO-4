// Функциональные тесты прототипа «Производство · Аналитика» (дашборд).
//
// Особенности прототипа:
// - Переключатель периода Месяц/Квартал/Год (#seg-period) пересчитывает KPI,
//   подсветку план/факт, тренд pass-rate, причины брака, вклад сборщиков и
//   таблицу топ-изделий из инлайн-данных (месяц = канон июня 2026).
// - Графики — чистый SVG: столбики дней (rect.dbar), пары план/факт (g.mpair),
//   линия pass-rate (circle.pp), горизонтальные бары брака и сборщиков.
// - Клик/hover по столбику дня — детализация дня в правой рейке (#daycard).
// - Русский формат чисел: запятая — десятичный разделитель, неразрывный
//   пробел — разделитель тысяч (toHaveText нормализует его в обычный пробел).
const { test, expect } = require('@playwright/test');
const { proto } = require('./helpers');

const seg = (page, label) => page.locator('#seg-period button', { hasText: label });

test.beforeEach(async ({ page }) => {
  // Прототип тянет внешние ресурсы (Google Fonts, i.pravatar.cc) — на медленной
  // сети событие load подвисает. Блокируем сеть: file://-страница самодостаточна,
  // а скрипт выполняется синхронно в конце body, т.е. к domcontentloaded всё готово.
  await page.route(/^https?:\/\//, r => r.abort());
  await page.goto(proto('proizvodstvo_analitika.html'), { waitUntil: 'domcontentloaded' });
});

test.describe('Стартовый рендер · KPI месяца (канон июня)', () => {
  test('шесть KPI бьются с каноном: 412/660, 64%, 89%, 96%, 1,8%, 2 575 BYN', async ({ page }) => {
    await expect(page).toHaveTitle('ERP · Производство · Аналитика');
    await expect(page.locator('#k-vyr')).toHaveText('412');
    await expect(page.locator('#k-vyr-of')).toHaveText('/ 660 н.ч');
    await expect(page.locator('#k-vyr-f')).toHaveText('62% плана периода');
    await expect(page.locator('#k-vyr-bar')).toHaveAttribute('style', /width:\s*62%/);
    await expect(page.locator('#k-eff')).toHaveText('64');
    await expect(page.locator('#k-fpy')).toHaveText('89');
    await expect(page.locator('#k-pass')).toHaveText('96');
    await expect(page.locator('#k-pass-f')).toHaveText('принято 184 изделия');
    await expect(page.locator('#k-brak')).toHaveText('1,8');
    await expect(page.locator('#k-brak-f')).toHaveText('в норме · порог ≤ 2%');
    await expect(page.locator('#k-brak-f')).toHaveClass(/ok/);
    // премия = 412 н.ч × 6,25 BYN = 2 575
    await expect(page.locator('#k-prem')).toHaveText('2 575');
    await expect(page.locator('#k-prem-f')).toHaveText('412 н.ч × 6,25 BYN');
  });

  test('шелл: крошки, активный модуль и подменю производства из 8 пунктов', async ({ page }) => {
    await expect(page.locator('.crumb')).toHaveText('Производство/Аналитика');
    await expect(page.locator('.nav > a.active')).toHaveText('Производство');
    await expect(page.locator('.nav .sub a')).toHaveText([
      'Воронка сборки', 'Заявки на сборку', 'Спецификации · BOM',
      'Планирование · план/факт', 'Нормы и нормативы', 'Выработка и оценка',
      'ОТК · контроль качества', 'Аналитика',
    ]);
    await expect(page.locator('.nav .sub a.active')).toHaveText('Аналитика');
  });

  test('сегмент периода: три кнопки, активен «Месяц», подпись «Июнь 2026»', async ({ page }) => {
    await expect(page.locator('#seg-period button')).toHaveText(['Месяц', 'Квартал', 'Год']);
    await expect(page.locator('#seg-period button.active')).toHaveCount(1);
    await expect(page.locator('#seg-period button.active')).toHaveText('Месяц');
    await expect(page.locator('#pp-lab')).toHaveText('Июнь 2026');
    await expect(page.locator('#p-sub')).toHaveText('Июнь 2026 · факт на 09.06.2026 · мощность цеха 704 н.ч/мес');
  });
});

test.describe('Переключение периода · пересчёт KPI', () => {
  test('квартал: 1 655 / 1 970 н.ч (84%), премия 10 344 BYN', async ({ page }) => {
    await seg(page, 'Квартал').click();
    await expect(page.locator('#seg-period button.active')).toHaveText('Квартал');
    await expect(page.locator('#pp-lab')).toHaveText('II квартал 2026');
    // апрель+май+июнь: 612+631+412 = 1 655; план 650+660+660 = 1 970
    await expect(page.locator('#k-vyr')).toHaveText('1 655');
    await expect(page.locator('#k-vyr-of')).toHaveText('/ 1 970 н.ч');
    await expect(page.locator('#k-vyr-f')).toHaveText('84% плана периода');
    await expect(page.locator('#k-eff')).toHaveText('76');
    await expect(page.locator('#k-fpy')).toHaveText('89');
    await expect(page.locator('#k-pass')).toHaveText('95');
    await expect(page.locator('#k-pass-f')).toHaveText('принято 544 изделия');
    await expect(page.locator('#k-brak')).toHaveText('1,9');
    await expect(page.locator('#k-brak-f')).toHaveClass(/ok/);
    // 1 655 × 6,25 = 10 343,75 → 10 344
    await expect(page.locator('#k-prem')).toHaveText('10 344');
    await expect(page.locator('#k-prem-f')).toHaveText('1 655 н.ч × 6,25 BYN');
  });

  test('год: 3 485 / 7 780 н.ч (45%), брак 2,1% — выше порога', async ({ page }) => {
    await seg(page, 'Год').click();
    await expect(page.locator('#pp-lab')).toHaveText('2026 год');
    await expect(page.locator('#k-vyr')).toHaveText('3 485');
    await expect(page.locator('#k-vyr-of')).toHaveText('/ 7 780 н.ч');
    await expect(page.locator('#k-vyr-f')).toHaveText('45% плана периода');
    await expect(page.locator('#k-eff')).toHaveText('79');
    await expect(page.locator('#k-fpy')).toHaveText('89');
    await expect(page.locator('#k-pass')).toHaveText('95');
    // склонение: 1 077 изделий (а не «изделия»)
    await expect(page.locator('#k-pass-f')).toHaveText('принято 1 077 изделий');
    await expect(page.locator('#k-brak')).toHaveText('2,1');
    await expect(page.locator('#k-brak-f')).toHaveText('выше порога ≤ 2%');
    await expect(page.locator('#k-brak-f')).toHaveClass(/bad/);
    await expect(page.locator('#k-prem')).toHaveText('21 781');
  });

  test('возврат на месяц восстанавливает канон; повторный клик по активной кнопке безвреден', async ({ page }) => {
    await seg(page, 'Год').click();
    await seg(page, 'Месяц').click();
    await expect(page.locator('#k-vyr')).toHaveText('412');
    await expect(page.locator('#k-prem')).toHaveText('2 575');
    await expect(page.locator('#k-brak')).toHaveText('1,8');
    await expect(page.locator('#pp-lab')).toHaveText('Июнь 2026');
    // повторный клик по уже активному «Месяц»
    await seg(page, 'Месяц').click();
    await expect(page.locator('#seg-period button.active')).toHaveCount(1);
    await expect(page.locator('#seg-period button.active')).toHaveText('Месяц');
    await expect(page.locator('#k-vyr')).toHaveText('412');
  });
});

test.describe('График 1 · выработка по дням июня (SVG)', () => {
  test('9 столбиков: значения, даты, выходные и день ниже нормы', async ({ page }) => {
    await expect(page.locator('#ch-days .dbar')).toHaveCount(9);
    await expect(page.locator('#ch-days .dvv')).toHaveText([
      '56', '61', '22', '58', '64', '—', '—', '73', '78',
    ]);
    await expect(page.locator('#ch-days .dlb')).toHaveText([
      '01', '02', '03', '04', '05', '06', '07', '08', '09',
    ]);
    await expect(page.locator('#ch-days .dwd')).toHaveText([
      'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс', 'пн', 'вт',
    ]);
    // сб и вс — нулевые бары; 03.06 (22 н.ч) — единственный ниже нормы 30
    await expect(page.locator('#ch-days .dbar.zero')).toHaveCount(2);
    await expect(page.locator('#ch-days .dbar.lo')).toHaveCount(1);
    await expect(page.locator('#ch-days .dbar.lo')).toHaveAttribute('data-d', '2');
    // линия нормы и итог: 56+61+22+58+64+73+78 = 412
    await expect(page.locator('#ch-days .norml')).toHaveCount(1);
    await expect(page.locator('#ch-days .norml-lab')).toHaveText('норма 30 н.ч/день');
    await expect(page.locator('#days-sum')).toHaveText('итого 412 н.ч · норма 30 н.ч/день');
  });
});

test.describe('График 2 · план/факт по месяцам года (SVG)', () => {
  test('12 пар столбиков, факты января–июня и линия мощности 704', async ({ page }) => {
    await expect(page.locator('#ch-months .mpair')).toHaveCount(12);
    await expect(page.locator('#ch-months .bp')).toHaveCount(12);
    await expect(page.locator('#ch-months .bf')).toHaveCount(12);
    // факт подписан только у 6 закрытых месяцев
    await expect(page.locator('#ch-months .mfv')).toHaveText([
      '580', '596', '654', '612', '631', '412',
    ]);
    // июль–декабрь — без факта (нулевые бары)
    await expect(page.locator('#ch-months .bf.zero')).toHaveCount(6);
    await expect(page.locator('#ch-months .axl')).toHaveText([
      'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
    ]);
    await expect(page.locator('#ch-months .capline')).toHaveCount(1);
    await expect(page.locator('#ch-months .cap-lab')).toHaveText('мощность 704 н.ч');
  });

  test('подсветка периода: месяц — июнь, квартал — три месяца, год — все 12', async ({ page }) => {
    await expect(page.locator('#ch-months .mpair.cur')).toHaveCount(1);
    await expect(page.locator('#ch-months .mpair.cur')).toHaveAttribute('data-m', '5');
    await seg(page, 'Квартал').click();
    await expect(page.locator('#ch-months .mpair.cur')).toHaveCount(3);
    await expect(page.locator('#ch-months .mpair.cur').first()).toHaveAttribute('data-m', '3');
    await seg(page, 'Год').click();
    await expect(page.locator('#ch-months .mpair.cur')).toHaveCount(12);
    await seg(page, 'Месяц').click();
    await expect(page.locator('#ch-months .mpair.cur')).toHaveCount(1);
  });
});

test.describe('График 3 · тренд pass-rate (SVG)', () => {
  test('месяц: 6 точек января–июня с подписями процентов', async ({ page }) => {
    await expect(page.locator('#ch-pass .pp')).toHaveCount(6);
    await expect(page.locator('#ch-pass .pline')).toHaveCount(1);
    await expect(page.locator('#ch-pass .pv')).toHaveText([
      '93%', '94%', '95%', '94%', '95%', '96%',
    ]);
    await expect(page.locator('#ch-pass .axl')).toHaveText([
      'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
    ]);
    await expect(page.locator('#pass-cap')).toHaveText('январь–июнь 2026');
  });

  test('квартал сжимает тренд до 3 точек, год возвращает 6', async ({ page }) => {
    await seg(page, 'Квартал').click();
    await expect(page.locator('#ch-pass .pp')).toHaveCount(3);
    await expect(page.locator('#ch-pass .pv')).toHaveText(['94%', '95%', '96%']);
    await expect(page.locator('#pass-cap')).toHaveText('апрель–июнь 2026');
    await seg(page, 'Год').click();
    await expect(page.locator('#ch-pass .pp')).toHaveCount(6);
    await expect(page.locator('#pass-cap')).toHaveText('январь–июнь 2026');
  });
});

test.describe('График 4 · причины брака (SVG)', () => {
  test('месяц — канон: пайка БМС 4, шов 2, ёмкость 2, корпус 1 (9 случаев)', async ({ page }) => {
    await expect(page.locator('#ch-brak .brbar')).toHaveCount(4);
    await expect(page.locator('#ch-brak .brl')).toHaveText([
      'Пайка БМС', 'Сварной шов', 'Ёмкость ниже номинала', 'Корпус/крышка',
    ]);
    await expect(page.locator('#ch-brak .brv')).toHaveText(['4', '2', '2', '1']);
    await expect(page.locator('#brak-cap')).toHaveText('9 случаев');
    // самый широкий бар — у лидирующей причины «Пайка БМС»
    const widths = await page.locator('#ch-brak .brbar').evaluateAll(
      els => els.map(e => +e.getAttribute('width')));
    expect(widths[0]).toBe(Math.max(...widths));
    expect(widths[1]).toBeGreaterThan(widths[3]);
  });

  test('квартал и год масштабируют причины, склонение «случая/случаев» верное', async ({ page }) => {
    await seg(page, 'Квартал').click();
    await expect(page.locator('#ch-brak .brv')).toHaveText(['11', '6', '5', '3']);
    await expect(page.locator('#brak-cap')).toHaveText('25 случаев');
    await seg(page, 'Год').click();
    await expect(page.locator('#ch-brak .brv')).toHaveText(['21', '13', '11', '7']);
    await expect(page.locator('#brak-cap')).toHaveText('52 случая');
  });
});

test.describe('График 5 · вклад сборщиков (SVG)', () => {
  test('месяц — канон выработки: Михаил 63,1 · Руслан 28,4 · Артём 18,9 · Николай 17', async ({ page }) => {
    await expect(page.locator('#ch-team .tbar')).toHaveCount(4);
    await expect(page.locator('#ch-team .tnm')).toHaveText([
      'Михаил', 'Руслан', 'Артём', 'Николай',
    ]);
    await expect(page.locator('#ch-team .tv')).toHaveText([
      '63,1 н.ч · 50%', '28,4 н.ч · 22%', '18,9 н.ч · 15%', '17 н.ч · 13%',
    ]);
    // фирменные цвета сборщиков из канона
    const fills = await page.locator('#ch-team .tbar').evaluateAll(
      els => els.map(e => e.getAttribute('fill')));
    expect(fills).toEqual(['#6366F1', '#E8920C', '#0891B2', '#16A34A']);
    // 63,1 + 28,35 + 18,9 + 17 = 127,35 → «127,4»
    await expect(page.locator('#team-cap')).toHaveText('127,4 н.ч суммарно');
  });
});

test.describe('Таблица · топ изделий по выработке', () => {
  test('месяц: 5 позиций из канона заявок с долями от 125 н.ч', async ({ page }) => {
    const rows = page.locator('#topbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).locator('td')).toHaveText([
      '№243 · RADIAN LiFePO4 48V 460Ah', '1', '40', '32%',
    ]);
    await expect(rows.nth(1).locator('td')).toHaveText([
      '№248 · 4×ICP103450DA Moli', '70', '35', '28%',
    ]);
    await expect(rows.nth(2).locator('td')).toHaveText([
      '№260 · BSL 10×INR18650 18V Bull', '33', '33', '26%',
    ]);
    await expect(rows.nth(4).locator('td')).toHaveText([
      '№259 · EVE 10×INR18650 5000mAh 18V', '7', '7', '6%',
    ]);
    await expect(page.locator('#top-foot')).toHaveText('5 позиций');
    await expect(page.locator('#top-sum')).toHaveText('125 н.ч');
    await expect(page.locator('#top-period')).toHaveText('Июнь 2026');
  });

  test('год: 6 позиций, агрегаты больше месячных, итог 877 н.ч', async ({ page }) => {
    await seg(page, 'Год').click();
    const rows = page.locator('#topbody tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0).locator('td')).toHaveText([
      'RADIAN LiFePO4 48V 460Ah', '7', '280', '32%',
    ]);
    await expect(rows.nth(5).locator('td')).toHaveText([
      'ER17505 4PF FANSO', '1 200', '24', '3%',
    ]);
    await expect(page.locator('#top-foot')).toHaveText('6 позиций');
    await expect(page.locator('#top-sum')).toHaveText('877 н.ч');
    await expect(page.locator('#top-period')).toHaveText('2026 год');
  });
});

test.describe('Детализация дня (правая рейка)', () => {
  test('по умолчанию выбран сегодняшний день 09.06: 78 н.ч и 3 позиции', async ({ page }) => {
    await expect(page.locator('#dc-date')).toHaveText('вт · 09.06.2026');
    await expect(page.locator('#dc-val')).toHaveText('78 н.ч');
    await expect(page.locator('#dc-badge')).toHaveText('норма +48');
    await expect(page.locator('#dc-badge')).toHaveClass(/ok/);
    await expect(page.locator('#dc-items .dci')).toHaveCount(3);
    await expect(page.locator('#dc-items .dci').first()).toHaveText('4×ICP103450DA Moli · №24834 н.ч');
    await expect(page.locator('#dc-cnt')).toHaveText('3 позиции');
    await expect(page.locator('#ch-days .dbar.sel')).toHaveCount(1);
    await expect(page.locator('#ch-days .dbar.sel')).toHaveAttribute('data-d', '8');
  });

  test('клик по 03.06 — день ниже нормы: 22 н.ч, бейдж «ниже нормы», 2 позиции', async ({ page }) => {
    await page.locator('#ch-days .dhit[data-d="2"]').click();
    await expect(page.locator('#dc-date')).toHaveText('ср · 03.06.2026');
    await expect(page.locator('#dc-val')).toHaveText('22 н.ч');
    await expect(page.locator('#dc-badge')).toHaveText('ниже нормы -8');
    await expect(page.locator('#dc-badge')).toHaveClass(/bad/);
    await expect(page.locator('#dc-items .dci')).toHaveCount(2);
    await expect(page.locator('#dc-items .dci b')).toHaveText(['12 н.ч', '10 н.ч']);
    await expect(page.locator('#dc-cnt')).toHaveText('2 позиции');
    // склонение «2 позиции», выделение перенесено на день 03
    await expect(page.locator('#ch-days .dbar.sel')).toHaveCount(1);
    await expect(page.locator('#ch-days .dbar.sel')).toHaveAttribute('data-d', '2');
  });

  test('клик по выходному 07.06: 0 н.ч, «выходной», 0 позиций и пустой список', async ({ page }) => {
    await page.locator('#ch-days .dhit[data-d="6"]').click();
    await expect(page.locator('#dc-date')).toHaveText('вс · 07.06.2026');
    await expect(page.locator('#dc-val')).toHaveText('0 н.ч');
    await expect(page.locator('#dc-badge')).toHaveText('выходной');
    await expect(page.locator('#dc-badge')).toHaveClass(/na/);
    await expect(page.locator('#dc-items .dci')).toHaveCount(0);
    await expect(page.locator('#dc-items .dc-empty')).toHaveText('Выходной день — нарядов нет');
    await expect(page.locator('#dc-cnt')).toHaveText('0 позиций');
  });

  test('hover показывает превью дня, не сбивая выбранный; клик возвращает день 09', async ({ page }) => {
    await page.locator('#ch-days .dhit[data-d="2"]').click();
    // hover по 05.06 — карточка показывает превью
    await page.locator('#ch-days .dhit[data-d="4"]').hover();
    await expect(page.locator('#dc-val')).toHaveText('64 н.ч');
    await expect(page.locator('#dc-date')).toHaveText('пт · 05.06.2026');
    // но выделение осталось на 03.06
    await expect(page.locator('#ch-days .dbar.sel')).toHaveAttribute('data-d', '2');
    // уход курсора с графика возвращает карточку к выбранному дню
    await page.locator('.aside-h').hover();
    await expect(page.locator('#dc-val')).toHaveText('22 н.ч');
    // повторный клик по 09.06 восстанавливает исходное состояние
    await page.locator('#ch-days .dhit[data-d="8"]').click();
    await page.locator('#ch-days .dhit[data-d="8"]').click();
    await expect(page.locator('#ch-days .dbar.sel')).toHaveCount(1);
    await expect(page.locator('#dc-date')).toHaveText('вт · 09.06.2026');
    await expect(page.locator('#dc-val')).toHaveText('78 н.ч');
  });

  test('смена периода не сбрасывает выбранный день и сам график дней', async ({ page }) => {
    await page.locator('#ch-days .dhit[data-d="2"]').click();
    await seg(page, 'Квартал').click();
    // график дней июня и карточка дня живут независимо от периода
    await expect(page.locator('#ch-days .dbar')).toHaveCount(9);
    await expect(page.locator('#dc-date')).toHaveText('ср · 03.06.2026');
    await expect(page.locator('#ch-days .dbar.sel')).toHaveAttribute('data-d', '2');
    await expect(page.locator('#days-sum')).toHaveText('итого 412 н.ч · норма 30 н.ч/день');
  });
});

test.describe('Правая рейка · отклонения и плейсхолдер ИИ', () => {
  test('три ключевых отклонения и блок «Помощники ИИ · ИТЕРАЦИЯ 1»', async ({ page }) => {
    await expect(page.locator('.rail-cap .cnt.red')).toHaveText('3');
    await expect(page.locator('#dev-day .rt')).toHaveText('03.06 — выработка 22 н.ч при норме 30');
    await expect(page.locator('#dev-deficit .rt')).toHaveText('Дефициты комплектующих: 2 позиции');
    await expect(page.locator('#dev-deficit .rs')).toHaveText('корпус ABS (№274) · разъём REMA 320А (№252)');
    await expect(page.locator('#dev-rework .rt')).toHaveText('Доработка дольше 24 ч — №248');
    await expect(page.locator('#dev-rework .rs')).toHaveText('4×ICP103450DA Moli · просрочка к 06.06');
    await expect(page.locator('.ai-soon .as-t')).toHaveText('Помощники ИИ');
    await expect(page.locator('.ai-soon .as-badge')).toHaveText('ИТЕРАЦИЯ 1');
    await expect(page.locator('.ai-soon .as-li')).toHaveCount(3);
  });
});
