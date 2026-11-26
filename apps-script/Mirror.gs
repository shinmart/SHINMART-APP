/**
 * ШИНМАРТ · Зеркало: новые листы (ПРИХОДЫ, ПРОДАЖИ_ЖУРНАЛ) → старые (ЗАКУПКИ, ПРОДАЖИ).
 *
 * Правило: источник правды — НОВЫЕ листы (их ведёт приложение, по ним считаются остатки и FIFO).
 * Старые листы становятся «зеркалом» для ваших привычных формул и других файлов.
 * Правки руками в новых листах сразу видны в приложении (onEdit в Code.gs).
 * Правки руками в старых листах при следующем зеркалировании ПЕРЕЗАПИШУТСЯ — поэтому перед
 * каждым зеркалированием делается копия старого листа (последние 3 копии хранятся).
 *
 * Защита: если в старом листе есть формулы в колонках, которые зеркало не умеет воспроизвести,
 * оно ничего не меняет и пишет, какие это колонки.
 */

const MIRROR_KEEP_COPIES = 3;

function mirrorUi() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.alert('Обновить старые листы',
    'Листы ЗАКУПКИ и ПРОДАЖИ будут заполнены заново из ПРИХОДЫ и ПРОДАЖИ_ЖУРНАЛ.\n' +
    'Правки, сделанные руками в старых листах, пропадут (останется копия листа).\n\nПродолжить?', ui.ButtonSet.YES_NO);
  if (a !== ui.Button.YES) return;
  try {
    const r = mirrorRun();
    ui.alert('Готово', 'Приходов: ' + r.purchases + '\nПродаж: ' + r.sales + '\nКопии старых листов сохранены.', ui.ButtonSet.OK);
  } catch (e) { ui.alert('Не обновлено', String(e && e.message ? e.message : e), ui.ButtonSet.OK); }
}

function mirrorAutoToggleUi() {
  const ui = SpreadsheetApp.getUi();
  const ex = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'mirrorAuto');
  if (ex.length) { ex.forEach(t => ScriptApp.deleteTrigger(t)); ui.alert('Авто-зеркало выключено.'); return; }
  ScriptApp.newTrigger('mirrorAuto').timeBased().everyHours(1).create();
  ui.alert('Авто-зеркало включено: старые листы обновляются раз в час.');
}

// Триггер: без окон, ошибки в журнал
function mirrorAuto() {
  try { mirrorRun(); } catch (e) { console.error('mirrorAuto: ' + (e && e.message ? e.message : e)); }
}

// ---------- построение строк (чистые функции, проверяются тестом) ----------

// Строки старого листа ПРОДАЖИ из нового журнала. newRows: массив строк (14 колонок) без шапки.
// cols: { w, size, brand, price, qty, tip, sebes, marja, fCost, fUnit, fMar } — номера колонок старого листа (с 1).
function mirrorBuildSales_(newRows, cols) {
  const out = [];
  newRows.forEach(r => {
    const a = r[0];
    const row = new Array(cols.w).fill('');
    if (a instanceof Date) {
      row[cols.size - 1] = a;
      out.push({ row: row, header: true });
      return;
    }
    if (String(a).trim() === '' || String(r[1]).trim() === '') return;
    row[cols.size - 1] = r[0];
    row[cols.brand - 1] = r[1];
    if (cols.price) row[cols.price - 1] = r[2];
    row[cols.qty - 1] = r[3];
    if (cols.tip) row[cols.tip - 1] = r[4];
    if (cols.sebes) row[cols.sebes - 1] = r[6];
    if (cols.marja) row[cols.marja - 1] = r[7];
    if (cols.fCost) row[cols.fCost - 1] = r[11];
    if (cols.fUnit) row[cols.fUnit - 1] = r[12];
    if (cols.fMar) row[cols.fMar - 1] = r[13];
    out.push({ row: row, header: false });
  });
  return out;
}

// Номера колонок старого листа, которые зеркало заполняет сам.
function mirrorSalesCols_(sh) {
  const map = getHeaderMap(sh);
  const ph = resolveCols(map, PRODAJI_HEADERS, 'ПРОДАЖИ', ['size', 'brand', 'qty']);
  const price = findProdajiPriceCol(sh);
  if (!price) throw new Error('В листе ПРОДАЖИ не найдена колонка ЦЕНА.');
  const px = appCols_(map, APP_PH_EXTRA);
  return {
    w: sh.getLastColumn(), size: ph.size, brand: ph.brand, qty: ph.qty, price: price,
    tip: map['ТИП'] || null, sebes: px.sebes, marja: px.marja,
    fCost: map[PRODAJI_FIFO_COST_HEADER.toUpperCase()] || null,
    fUnit: map[PRODAJI_FIFO_UNIT_COST_HEADER.toUpperCase()] || null,
    fMar: map[PRODAJI_MARGIN_HEADER.toUpperCase()] || null,
    sum: map['СУММА'] || null
  };
}

// Колонки с формулами в старом листе, которые зеркало не заполняет (их потерять нельзя).
function mirrorUnknownFormulaCols_(sh, cols, firstRows) {
  const w = sh.getLastColumn(), last = sh.getLastRow();
  if (last < DATA_START_ROW) return [];
  const n = Math.min(firstRows, last - DATA_START_ROW + 1);
  const f = sh.getRange(DATA_START_ROW, 1, n, w).getFormulas();
  const known = {};
  [cols.size, cols.brand, cols.qty, cols.price, cols.tip, cols.sebes, cols.marja, cols.fCost, cols.fUnit, cols.fMar, cols.sum].forEach(c => { if (c) known[c] = 1; });
  const bad = [];
  for (let c = 1; c <= w; c++) {
    if (known[c]) continue;
    for (let i = 0; i < n; i++) { if (f[i][c - 1]) { bad.push(colLetter(c)); break; } }
  }
  return bad;
}

// ---------- копии и запуск ----------

function mirrorBackup_(ss, name, tz) {
  const sh = ss.getSheetByName(name);
  if (!sh) return;
  const day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HH-mm');
  const cp = sh.copyTo(ss);
  cp.setName(name + '_копия_' + day);
  cp.hideSheet();
  const copies = ss.getSheets().filter(x => x.getName().indexOf(name + '_копия_') === 0).map(x => x.getName()).sort();
  while (copies.length > MIRROR_KEEP_COPIES) ss.deleteSheet(ss.getSheetByName(copies.shift()));
}

function mirrorRun() {
  const ss = getSS_();
  const tz = ss.getSpreadsheetTimeZone();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица занята, повторите через минуту.');
  try {
    const nz = ss.getSheetByName(APP_NEW_ZAKUP), np = ss.getSheetByName(APP_NEW_PRODAJI);
    const oz = ss.getSheetByName('ЗАКУПКИ'), op = ss.getSheetByName('ПРОДАЖИ');
    if (!nz || !np) throw new Error('Новые листы ' + APP_NEW_ZAKUP + ' и ' + APP_NEW_PRODAJI + ' не найдены. Сначала выполните перенос данных.');
    if (!oz || !op) throw new Error('Не найдены старые листы ЗАКУПКИ и ПРОДАЖИ.');

    // --- проверки до любых изменений ---
    const wz = oz.getLastColumn();
    const hn = nz.getRange(1, 1, 1, wz).getValues()[0].map(x => String(x).trim());
    const ho = oz.getRange(1, 1, 1, wz).getValues()[0].map(x => String(x).trim());
    if (hn.join('|') !== ho.join('|')) throw new Error('Заголовки ЗАКУПКИ и ПРИХОДЫ различаются, зеркало остановлено, ничего не изменено.');
    const cols = mirrorSalesCols_(op);
    const bad = mirrorUnknownFormulaCols_(op, cols, 200);
    if (bad.length) throw new Error('В листе ПРОДАЖИ есть формулы в колонках ' + bad.join(', ') + ', которые зеркало не умеет воспроизводить. Ничего не изменено.');

    mirrorBackup_(ss, 'ЗАКУПКИ', tz);
    mirrorBackup_(ss, 'ПРОДАЖИ', tz);

    // --- приходы: копия строк целиком (значения, формулы, оформление) ---
    const zLast = nz.getLastRow();
    const oLast = Math.max(oz.getLastRow(), DATA_START_ROW);
    oz.getRange(DATA_START_ROW, 1, oLast - DATA_START_ROW + 1, wz).clear();
    let purchases = 0;
    if (zLast >= DATA_START_ROW) {
      purchases = zLast - DATA_START_ROW + 1;
      appEnsureSize_(oz, DATA_START_ROW + purchases + 50, wz);
      nz.getRange(DATA_START_ROW, 1, purchases, wz).copyTo(oz.getRange(DATA_START_ROW, 1, purchases, wz));
    }

    // --- продажи: те же колонки, что заполняет миграция; дни — блоками ---
    const pLast = np.getLastRow();
    const nv = pLast >= DATA_START_ROW ? np.getRange(DATA_START_ROW, 1, pLast - DATA_START_ROW + 1, 14).getValues() : [];
    const built = mirrorBuildSales_(nv, cols);
    const oPLast = Math.max(op.getLastRow(), DATA_START_ROW);
    op.getRange(DATA_START_ROW, 1, oPLast - DATA_START_ROW + 1, cols.w).clear();
    if (built.length) {
      appEnsureSize_(op, DATA_START_ROW + built.length + 50, cols.w);
      op.getRange(DATA_START_ROW, 1, built.length, cols.w).setValues(built.map(b => b.row));
      const hdr = [];
      built.forEach((b, i) => { if (b.header) hdr.push('A' + (DATA_START_ROW + i)); });
      if (hdr.length) { try { op.getRangeList(hdr).setNumberFormat('dd.mm.yy').setBackground('#ff9900').setFontWeight('bold'); } catch (e) { /* оформление не критично */ } }
      if (cols.sum && cols.price !== cols.sum) {
        const f = built.map((b, i) => [b.header ? '' : '=' + colLetter(cols.qty) + (DATA_START_ROW + i) + '*' + colLetter(cols.price) + (DATA_START_ROW + i)]);
        op.getRange(DATA_START_ROW, cols.sum, built.length, 1).setFormulas(f);
      }
    }
    const sales = built.filter(b => !b.header).length;
    PropertiesService.getScriptProperties().setProperty('MIRROR_LAST', new Date().toISOString());
    return { purchases: purchases, sales: sales };
  } finally {
    lock.releaseLock();
  }
}
