// Проверка построения строк зеркала (чистая логика). Запуск: node tests/mirror.test.js
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/../apps-script/Mirror.gs', 'utf8').replace(/\nconst (\w+) =/g, '\nglobalThis.$1 =');
(0, eval)(src);
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const cols = { w: 12, size: 1, brand: 2, qty: 4, price: 3, tip: 5, sebes: 7, marja: 8, fCost: 10, fUnit: 11, fMar: 12, sum: 6 };
const d = new Date(2026, 10, 26);
const nv = [
  [d, 'чт', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['235/45R18', 'HANKOOK W', 60000, 4, 'ШИПЫ', 240000, 200000, 40000, d, 'a@x', '', 200000, 50000, 40000],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['205/55R16', 'NOKIAN', 50000, 2, 'ШИПЫ', 100000, 80000, 20000, d, 'a@x', '', 80000, 40000, 20000]
];
const b = mirrorBuildSales_(nv, cols);
ok(b.length === 3, 'пустая строка пропущена, 1 шапка + 2 продажи');
ok(b[0].header && b[0].row[0] === d && b[0].row[1] === '', 'шапка дня: дата в колонке размера');
ok(b[1].row[0] === '235/45R18' && b[1].row[2] === 60000 && b[1].row[3] === 4 && b[1].row[9] === 200000 && b[1].row[11] === 40000, 'продажа: колонки по заголовкам');
ok(b[1].row[5] === '', 'СУММА заполняется формулой отдельно');
ok(b.every(x => x.row.length === 12), 'ширина как у старого листа');
