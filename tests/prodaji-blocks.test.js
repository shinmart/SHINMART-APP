// Блоки дней старого листа ПРОДАЖИ: где приложение пишет продажу. Модель таблицы, не настоящая (L-015).
const fs = require('fs');
const D = (s) => new Date(s + 'T00:00:00');
let g; // g[r-1][c-1] = {v, f}
const W = 8;
function cell(r, c) { return (g[r - 1] = g[r - 1] || [])[c - 1] = (g[r - 1][c - 1] || { v: '', f: '' }); }
const sh = {
  getName: () => 'ПРОДАЖИ', getMaxRows: () => 500, getLastColumn: () => W, insertRowsAfter() {},
  getLastRow() { let n = g.length; while (n > 0 && !(g[n - 1] || []).some(x => x && (x.v !== '' || x.f))) n--; return n; },
  insertRowBefore(r) { g.splice(r - 1, 0, []); },
  insertRowsBefore(r, n) { for (let i = 0; i < n; i++) g.splice(r - 1, 0, []); },
  getRange(r, c, nr = 1, nc = 1) {
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const a = []; for (let j = 0; j < nc; j++) a.push(cell(r + i, c + j).v); o.push(a); } return o; },
      getFormulas() { const o = []; for (let i = 0; i < nr; i++) { const a = []; for (let j = 0; j < nc; j++) a.push(cell(r + i, c + j).f); o.push(a); } return o; },
      setValue(x) { cell(r, c).v = x; return this; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const x = cell(r + i, c + j); if (!x.f) x.v = ''; else x.v = x.v; if (!x.f) x.v = ''; } return this; },
      getCell(i, j) { return sh.getRange(r + i - 1, c + j - 1); },
      copyTo(dst) { const t = dst.__pos; for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const s = cell(r + i, c + j); g[t.r - 1 + i] = g[t.r - 1 + i] || []; g[t.r - 1 + i][t.c - 1 + j] = { v: s.v, f: s.f }; } },
      __pos: { r, c }
    };
  }
};
global.getSS_ = () => ({ getSpreadsheetTimeZone: () => 'Asia/Almaty', getSheetByName: () => sh });
global.SHEETS = { PRODAJI: 'ПРОДАЖИ' }; global.DATA_START_ROW = 4;
global.SpreadsheetApp = { flush() {}, CopyPasteType: { PASTE_NORMAL: 0 } };
global.Utilities = { formatDate: (d) => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, parseDate: (s) => D(s) };
let src = fs.readFileSync(__dirname + '/../apps-script/WebApp.gs', 'utf8');
const a = src.indexOf('// ===== ПРОДАЖИ: блоки дней'), b = src.indexOf('// Записать значения продажи');
src = src.slice(a, b);
src = 'globalThis.appDay_=(d)=>Utilities.formatDate(d);globalThis.appDow_=()=>"пт";\n' + src;
(0, eval)(src.replace(/\nfunction (\w+)/g, '\nglobalThis.$1=function $1'));
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
function row(r, vals, formula) { vals.forEach((x, j) => { if (x !== null) cell(r, j + 1).v = x; }); if (formula) { cell(r, 6).f = '=D' + r + '*C' + r; cell(r, 6).v = 0; } }
// строки 1-3 шапка; 4 дата 25.11; 5-6 продажи; 7 пусто (формула); 8 итог; 9 дата 26.11; 10-11 пустые; 12 итог
g = [[], [], []];
row(4, [D('2026-11-25'), 'ср']);
row(5, ['215/65/16', 'ШАОЯНГ', 35900, 2], true);
row(6, ['195/65/15', 'ТРАЙАНГЛ', 29000, 4], true);
row(7, ['', '', '', ''], true);
row(8, ['процентное соотношение дня к обороту', '', 23.5, 90]);
row(9, [D('2026-11-26'), 'чт']);
row(10, ['', '', '', ''], true);
row(11, ['', '', '', ''], true);
row(12, ['процентное соотношение дня к обороту', '', 0, 0]);
const tz = 'Asia/Almaty';
ok(appPlaceSaleRow_(sh, tz, '2026-11-25') === 7, 'день 25.11: первая пустая строка блока = 7');
ok(appPlaceSaleRow_(sh, tz, '2026-11-26') === 10, 'день 26.11: пустая строка 10, не хвост листа');
// блок 25.11 заполнен — вставка внутри блока
cell(7, 1).v = 'x'; cell(7, 2).v = 'y';
const r = appPlaceSaleRow_(sh, tz, '2026-11-25');
ok(r === 7 && /^процент/.test(g[8][0].v) === true && g[7][0].v === 'x', 'блок заполнен: вставлена строка перед последней, итоги сдвинулись, row=' + r);
ok(appIsSummaryLabel_(cell(9, 1).v), 'итоговая строка осталась ниже вставки');
// нет блока на дату — создаётся копия последнего
const n = appPlaceSaleRow_(sh, tz, '2026-11-27');
const head = cell(n - 1, 1).v;
ok(head instanceof Date && head.getDate() === 27, 'создан блок 27.11, заголовок над строкой ' + n);
ok(cell(n, 1).v === '' && cell(n, 6).f !== '', 'строка продажи пустая, формулы на месте');
ok(appFindDayBlock_(sh.getRange(4, 1, sh.getLastRow() - 3, 2).getValues(), '2026-11-27', tz) !== null, 'новый блок находится');

// --- несколько строк подряд (комплект + комментарий) ---
g = [[], [], []];
row(4, [D('2026-11-25'), 'ср']);
row(5, ['215/65/16', 'ШАОЯНГ', 35900, 2], true);
row(6, ['', '', '', ''], true);
row(7, ['', '', '', ''], true);
row(8, ['процентное соотношение дня к обороту', '', 23.5, 90]);
ok(appPlaceSaleRow_(sh, tz, '2026-11-25', 2) === 6, 'нужно 2 строки: пустая серия 6-7');
cell(7, 2).v = 'занято';
const r3 = appPlaceSaleRow_(sh, tz, '2026-11-25', 3);
ok(r3 === 7 && g[r3 - 1] !== undefined && /^процент/.test(cell(7 + 3 + 1, 1).v), 'серии 3 нет: вставлено 3 строки внутри блока, итоги сдвинулись, row=' + r3 + ' итог=' + cell(11, 1).v);
// --- сумма за комплект ---
const it = appSplitTotal_([{ price: 40900, qty: 4 }, { price: 25000, qty: 2 }], 200000);
ok(Math.abs(it[0].price * 4 + it[1].price * 2 - 200000) < 0.01, 'сумма комплекта сходится ровно: ' + it[0].price + ' / ' + it[1].price);
const it2 = appSplitTotal_([{ price: 80000, qty: 4 }], 320000);
ok(it2[0].price === 80000, 'одна позиция: 320000 / 4 = 80000');
const it3 = appSplitTotal_([{ price: 40000, qty: 4 }, { price: 40000, qty: 4 }], 320000);
ok(it3[0].price * 4 + it3[1].price * 4 === 320000 && it3[0].price === 40000, 'две одинаковые позиции по 4 шт на 320 000');

// Чтение только блоков нужного дня (ускорение журнала дня)
{
  const colA = [[D('2026-11-25')], ['a'], ['b'], ['процентное'], [D('2026-11-26')], ['c'], [''], [D('2026-11-25')], ['d']];
  const r = appDayRanges_(colA, '2026-11-25', 'Asia/Almaty');
  ok(r.length === 2 && r[0].from === 4 && r[0].n === 4 && r[1].from === 11 && r[1].n === 2, 'блоки 25.11: два куска, хвост листа учтён ' + JSON.stringify(r));
  ok(JSON.stringify(appDayRanges_(colA, '2026-11-26', 'x')) === JSON.stringify([{ from: 8, n: 3 }]), 'блок 26.11: от заголовка до следующего');
  ok(appDayRanges_(colA, '2026-11-27', 'x').length === 0, 'нет дня — пусто');
}
