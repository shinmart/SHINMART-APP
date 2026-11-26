/**
 * ЗИМА 2027 — АВТОМАТИЗАЦИЯ ОСТАТКОВ + FIFO СЕБЕСТОИМОСТЬ + МАРЖА
 * ---------------------------------------------------------------
 * v18 — ДОБАВЛЕНО: приложение пишет в НОВЫЕ листы ПРИХОДЫ и ПРОДАЖИ_ЖУРНАЛ
 * (одна операция = одна строка). Старые ЗАКУПКИ и ПРОДАЖИ остаются архивом.
 * Весь скрипт (ОСТАТКИ, FIFO, АНАЛИЗАТОР, Kaspi, onEdit) после переноса
 * работает с новыми листами. Перенос: меню «Остатки и FIFO» →
 * «📦 Перенести данные в новые листы (один раз)». До переноса всё работает как раньше.
 *
 * v16 — ИСПРАВЛЕНО (настоящая причина нулей/#REF! в ОСТАТКИ): скрытые
 * пробелы в РАЗМЕР/НАЗВАНИЕ (ЗАКУПКИ) и РАЗМЕР/НАИМЕНОВАНИЕ (ПРОДАЖИ) —
 * неразрывный пробел, пробел в конце, двойной пробел, перенос строки
 * (обычно попадают при копировании из прайсов поставщиков).
 * Скрипт при сборке ОСТАТКИ обрезал их, а формулы SUMIFS сравнивали «как
 * есть», поэтому позиция появлялась в списке, но Закуп/Прдж/СС = 0.
 * Теперь перед каждой пересборкой скрипт сам чистит эти ячейки
 * (cleanKeyColumns): меняются только пробелы, текст и ссылки остаются.
 *
 * v15 — ИСПРАВЛЕНО: #REF! ("Массив не выведен...") в колонках C, H, I, J, Q
 * и далее Z, AA, AB листа ОСТАТКИ. Причина: формула "последняя партия"
 * при отсутствии совпадения в ЗАКУПКИ отдавала всю колонку. Теперь в этом
 * случае возвращается пусто/0. Остальной код не менялся.
 *
 * v14 — ДОБАВЛЕНО: лист "АНАЛИЗАТОР" (см. ЧАСТЬ 3 перед блоком Kaspi).
 * Это копия ОСТАТКИ, но со ВСЕМИ позициями за всю историю: любая пара
 * РАЗМЕР + НАЗВАНИЕ, которая хоть раз была в ЗАКУПКИ или в ПРОДАЖИ
 * (в том числе полностью проданная). Продажи без закупки в список не попадают.
 * Пересобирается вместе с ОСТАТКИ (rebuildAll: правка → до 5 минут,
 * или кнопка "Обновить всё сейчас"). Закуп/Прдж/Остат — живые формулы.
 * Остальной код (ОСТАТКИ, FIFO, Kaspi) не менялся.
 *
 * v13 — ИЗМЕНЕНИЕ: добавлен автозапуск анализа цен Kaspi КАЖДЫЕ 2 ЧАСА
 * (kaspiStartHourlyRun + kaspiSetupHourlyTrigger). Защита от наложения:
 * новый обход не стартует, если предыдущий ещё не завершился (есть
 * висящий триггер kaspiRunChunk — значит идёт цепочка продолжений).
 * Новый пункт меню: "⏱️ Настроить автозапуск Kaspi (каждые 2 часа)".
 *
 * v12 — ИЗМЕНЕНИЕ: FIFO-расчёт СЕБЕС/МАРЖА в листе ПРОДАЖИ (и
 * служебные колонки "FIFO СЕБЕС (расчёт)" / "FIFO СЕБЕС за 1 шт" /
 * "Маржа (расчёт)", и рабочие колонки СЕБЕС/МАРЖА, и колонки
 * "Продано (FIFO)" / "Остаток партии" в ЗАКУПКИ) теперь считается
 * по стоимости партии "ЦЕНА ПОД КЛЮЧ" (закупка + РАСХОДЫ), а не по
 * "Цена закупки (тг)". Это касается и полного пересчёта (rebuildFifo),
 * и мгновенного точечного (recalcFifoForKeys / onEdit).
 *
 * v11 — ИЗМЕНЕНИЕ: столбец H (СС) на листе ОСТАТКИ теперь берёт
 * значение из столбца "ЦЕНА ПОД КЛЮЧ" листа ЗАКУПКИ (закупочная
 * цена + РАСХОДЫ), а не из "Цена закупки (тг)" — для правильного
 * расчёта маржинальности с учётом сопутствующих расходов.
 *
 * v10 — ПЕРЕНЕСЕНО ИЗ ЛЕТО 2026: мгновенный точечный пересчёт
 * СЕБЕС/МАРЖА при правке (без ожидания 5 минут) — пересчитывается
 * только та шина (размер+бренд), которую отредактировали в
 * ЗАКУПКИ или ПРОДАЖИ, а не весь лист. ОСТАТКИ и АРТИКУЛЫ
 * по-прежнему обновляются по кнопке/расписанию (нужен полный
 * пересчёт из-за связей с листом БАЗА).
 *
 * Также перенесена логика: рабочие колонки СЕБЕС/МАРЖА в ПРОДАЖИ
 * пишутся ТОЛЬКО в строки, где скрипт реально нашёл партию
 * закупки в ЗАКУПКИ и посчитал FIFO. Если партии нет (например,
 * Б/У шина без прихода, себестоимость вписывается вручную) —
 * скрипт ячейку вообще не трогает, ваше ручное значение остаётся
 * на месте.
 *
 * v9: добавлена автоподтяжка ССЫЛКА KOLESA.KZ (колонка L) и
 * ССЫЛКА OLX (колонка M) на листе ОСТАТКИ из листа БАЗА
 * (колонки J и K соответственно), по тому же совпадению
 * РАЗМЕР + НАЗВАНИЕ.
 *
 * v8: добавлена автоподтяжка ФОТО (колонка K, лист ОСТАТКИ) из
 * листа БАЗА (колонка H) по совпадению РАЗМЕР + НАЗВАНИЕ —
 * по тому же принципу, что артикул (N/T).
 *
 * v7: добавлена автоподстановка АРТИКУЛ ТОВАРА (колонка C, лист
 * ЗАКУПКИ) из листа БАЗА по совпадению РАЗМЕР + НАЗВАНИЕ.
 * Заполняются только пустые ячейки — вручную вписанные артикулы
 * не перезаписываются.
 *
 * === ДОБАВЛЕНО: блок KASPI MONITORING в самом конце файла ===
 * Пишет мин./среднюю цену конкурентов в столбцы W/X, ссылку на
 * каталог с фильтрами (сортировка: сначала дешёвые) — в столбец Y
 * листа ОСТАТКИ. Содержит словарь транслитерации кириллических
 * брендов. Перед каждым обходом W:Y полностью очищаются.
 *
 * === ДОБАВЛЕНО: столбцы Z (РАЗНИЦА), AA (СТАТУС), AB (МАРЖА ЕСЛИ
 * ПО КАСПИ) — все генерируются как формулы прямо внутри
 * rebuildOstatki(), протягиваются САМИ на каждую строку при каждой
 * автоматической пересборке листа (каждые 5 минут).
 * Z = разница между мин. ценой Kaspi (W) и вашей ценой продажи (I).
 * AA = статус ("НЕТ ДАННЫХ"/"ПОНИЗИТЬ"/"МОЖНО ПОДНЯТЬ"/"В РЫНКЕ"),
 *      порог ±1050 ₸.
 * AB = потенциальная маржа, если продавать по цене Kaspi (W - H,
 *      где H — себестоимость).
 * ---------------------------------------------------------------
 */

const Q = String.fromCharCode(39);
const QQ = String.fromCharCode(34);

// v18: приложение пишет в новые листы-журналы. Пока перенос не выполнен, скрипт работает со старыми листами.
const APP_NEW_ZAKUP = 'ПРИХОДЫ';
const APP_NEW_PRODAJI = 'ПРОДАЖИ_ЖУРНАЛ';

function pickSheetName_(newName, oldName) {
  try {
    return getSS_().getSheetByName(newName) ? newName : oldName;
  } catch (e) {
    return oldName;
  }
}

const SHEETS = {
  OSTATKI: 'ОСТАТКИ',
  ZAKUP: pickSheetName_(APP_NEW_ZAKUP, 'ЗАКУПКИ'),
  PRODAJI: pickSheetName_(APP_NEW_PRODAJI, 'ПРОДАЖИ'),
  BAZA: 'БАЗА',
  ANALIZ: 'АНАЛИЗАТОР'
};

const DATA_START_ROW = 4;

const ZAKUP_HEADERS = {
  size: 'РАЗМЕР',
  brand: 'НАЗВАНИЕ',
  qty: 'КОЛ',
  cost: 'Цена закупки (тг)',
  costFull: 'ЦЕНА ПОД КЛЮЧ',
  cashPrice: 'ЗА НАЛ',
  kaspi: 'KASPI',
  tip: 'ТИП',
  art: 'АРТИКУЛ ТОВАРА',
  dateReceived: 'Дата прихода',
  soldFifo: 'Продано (FIFO)',
  remainFifo: 'Остаток партии'
};

const PRODAJI_HEADERS = {
  size: 'РАЗМЕР',
  brand: 'НАИМЕНОВАНИЕ',
  qty: 'КОЛ'
};

const BAZA_HEADERS = {
  art: 'АРТИКУЛ ТОВАРА',
  size: 'РАЗМЕР',
  name: 'НАИМЕНОВАНИЕ ДЛЯ ПРАЙСА'
};

const PRODAJI_PRICE_HEADER_CANDIDATES = ['ЦЕНА', 'ЦЕНА ПРОДАЖИ', 'СУММА', 'ПРОДАЖА'];

const PRODAJI_FIFO_COST_HEADER = 'FIFO СЕБЕС (расчёт)';
const PRODAJI_FIFO_UNIT_COST_HEADER = 'FIFO СЕБЕС за 1 шт';
const PRODAJI_MARGIN_HEADER = 'Маржа (расчёт)';

const PRODAJI_MANUAL_SEBES_HEADER = 'СЕБЕС';
const PRODAJI_MANUAL_MARJA_HEADER = 'МАРЖА';

// ================== ВСПОМОГАТЕЛЬНОЕ ==================

function getHeaderMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h).trim().toUpperCase();
    if (key) map[key] = i + 1;
  });
  return map;
}

function resolveCols(headerMap, wanted, sheetLabel, requiredKeys) {
  const resolved = {};
  const missing = [];
  Object.keys(wanted).forEach(logicalName => {
    const headerText = wanted[logicalName].trim().toUpperCase();
    const colNum = headerMap[headerText] || null;
    resolved[logicalName] = colNum;
    if (!colNum && requiredKeys.indexOf(logicalName) !== -1) {
      missing.push(wanted[logicalName]);
    }
  });
  if (missing.length > 0) {
    throw new Error(
      'На листе "' + sheetLabel + '" не найдены обязательные заголовки: ' +
      missing.join(', ') + '. Проверьте строку 1 — названия должны совпадать в точности.'
    );
  }
  return resolved;
}

function findProdajiPriceCol(prodSheet) {
  const map = getHeaderMap(prodSheet);
  for (let i = 0; i < PRODAJI_PRICE_HEADER_CANDIDATES.length; i++) {
    const key = PRODAJI_PRICE_HEADER_CANDIDATES[i].toUpperCase();
    if (map[key]) return map[key];
  }
  return null;
}

function findProdajiManualCols(prodSheet) {
  const map = getHeaderMap(prodSheet);
  return {
    sebesCol: map[PRODAJI_MANUAL_SEBES_HEADER.toUpperCase()] || null,
    marjaCol: map[PRODAJI_MANUAL_MARJA_HEADER.toUpperCase()] || null
  };
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ================== ТРИГГЕРЫ ==================

function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    if (sheetName !== SHEETS.ZAKUP && sheetName !== SHEETS.PRODAJI) return;
    if (e.range.getRow() < DATA_START_ROW) return;

    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    // Правка руками в таблице должна быть видна в приложении сразу, а не через 2 минуты кэша
    try { CacheService.getScriptCache().remove('APPIDX_meta'); } catch (eCache) { /* не критично */ }

    const ss = e.source;
    const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
    const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);

    const zhLite = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand']);
    const phLite = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand']);

    let keys;
    if (sheetName === SHEETS.ZAKUP) {
      keys = getRowsKeys(zakupSheet, e.range, zhLite.size, zhLite.brand);
    } else {
      keys = getRowsKeys(prodSheet, e.range, phLite.size, phLite.brand);
    }
    if (keys.size === 0) return;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return;
    try {
      recalcFifoForKeys(Array.from(keys));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
  }
}

function getRowsKeys(sheet, range, sizeCol, brandCol) {
  const startRow = range.getRow();
  const numRows = range.getNumRows();
  const lastCol = Math.max(sizeCol, brandCol);
  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const keys = new Set();
  values.forEach(row => {
    const size = String(row[sizeCol - 1] || '').trim();
    const brand = String(row[brandCol - 1] || '').trim();
    if (size && brand) keys.add(size + '|||' + brand);
  });
  return keys;
}

function checkAndRebuildIfNeeded() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('needsRebuild') === 'true') {
    props.deleteProperty('needsRebuild');
    rebuildAll();
  }
}

function hourlyRebuild() {
  PropertiesService.getScriptProperties().deleteProperty('needsRebuild');
  rebuildAll();
}

function setupTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'checkAndRebuildIfNeeded' || fn === 'hourlyRebuild') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('checkAndRebuildIfNeeded')
    .timeBased()
    .everyMinutes(5)
    .create();

  ScriptApp.newTrigger('hourlyRebuild')
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert(
    'Готово! Теперь:\n' +
    '• СЕБЕС/МАРЖА в ПРОДАЖИ пересчитываются мгновенно при правке (точечно, без ожидания)\n' +
    '• ОСТАТКИ и АРТИКУЛЫ пересобираются каждые 5 минут (если были правки) + подстраховка раз в час\n\n' +
    'Мгновенный пересчёт покрывает 95% случаев. Если вставили сразу много строк\n' +
    'или переименовали бренд шины — нажмите "🔄 Обновить всё сейчас".'
  );
}

// v17: таблица для скрипта — и из меню/триггеров, и из веб-приложения (там "активной" таблицы нет)
function getSS_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (!id) throw new Error('Не подготовлено приложение: в таблице меню «Остатки и FIFO» → «📱 Подготовить приложение»');
  return SpreadsheetApp.openById(id);
}

function onOpen() {
  try { PropertiesService.getScriptProperties().setProperty('SS_ID', SpreadsheetApp.getActiveSpreadsheet().getId()); } catch (e) {}
  SpreadsheetApp.getUi()
    .createMenu('Остатки и FIFO')
    .addItem('🔄 Обновить всё сейчас', 'rebuildAll')
    .addItem('📦 Только остатки', 'rebuildOstatkiSafe')
    .addItem('🧹 Почистить скрытые пробелы (ЗАКУПКИ/ПРОДАЖИ)', 'cleanKeyColumnsReport')
    .addItem('💰 Только себестоимость (FIFO, полный)', 'rebuildFifoSafe')
    .addItem('🏷️ Только артикулы (ЗАКУПКИ ← БАЗА)', 'fillArtikulZakupkiSafe')
    .addItem('📊 Только АНАЛИЗАТОР (все позиции)', 'rebuildAnalizatorSafe')
    .addItem('🎨 Оформить АНАЛИЗАТОР заново (цвета)', 'analizatorApplyFormatSafe')
    .addSeparator()
    .addItem('🌐 Синхронизировать цены с Kaspi (сейчас)', 'kaspiStartNightlyRun')
    .addItem('⏱️ Настроить автозапуск Kaspi (каждые 2 часа)', 'kaspiSetupHourlyTrigger')
    .addItem('🔎 Показать кириллические бренды (диагностика)', 'kaspiListCyrillicBrands')
    .addSeparator()
    .addItem('⚙️ Настроить автообновление (запустить один раз)', 'setupTriggers')
    .addSeparator()
    .addItem('📦 Перенести данные в новые листы (один раз)', 'appMigrateUi')
    .addItem('🗓️ Журнал продаж: разбить по дням', 'appRelayoutSalesUi')
    .addItem('🔧 Починить дни недели в журнале продаж', 'appFixDayNamesUi')
    .addItem('📱 Подготовить приложение', 'appPrepare')
    .addItem('🪞 Обновить старые листы ЗАКУПКИ и ПРОДАЖИ из новых', 'mirrorUi')
    .addItem('🪞 Авто-зеркало: включить / выключить (раз в час)', 'mirrorAutoToggleUi')
    .addItem('💰 Подготовить деньги: настройки, счета, вложения', 'opsPrepare')
    .addToUi();
}

function rebuildAll() {
  cleanKeyColumnsSafe();
  fillArtikulZakupkiSafe();
  rebuildOstatkiSafe();
  rebuildFifoSafe();
  rebuildAnalizatorSafe();
}

function rebuildOstatkiSafe() {
  try {
    cleanKeyColumnsSafe();
    rebuildOstatki();
  } catch (err) {
    SpreadsheetApp.getUi().alert('Ошибка в "Остатки": ' + err.message);
  }
}

function rebuildFifoSafe() {
  try {
    rebuildFifo();
  } catch (err) {
    SpreadsheetApp.getUi().alert('Ошибка в "FIFO": ' + err.message);
  }
}

function fillArtikulZakupkiSafe() {
  try {
    fillArtikulZakupki();
  } catch (err) {
    SpreadsheetApp.getUi().alert('Ошибка в "Артикулы": ' + err.message);
  }
}

// ================================================================
// ЧИСТКА СКРЫТЫХ ПРОБЕЛОВ в ключевых колонках (РАЗМЕР / НАЗВАНИЕ)
// ================================================================

let KEYS_CLEANED_THIS_RUN = false;

function normKeyText(v) {
  return String(v)
    .replace(/[   -​  　﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Возвращает число исправленных ячеек. Формулы и не-текст не трогает.
function cleanKeyColumns() {
  if (KEYS_CLEANED_THIS_RUN) return 0;
  KEYS_CLEANED_THIS_RUN = true;

  const ss = getSS_();
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);
  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand']);
  const ph = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand']);

  const jobs = [
    { sheet: zakupSheet, cols: [zh.size, zh.brand] },
    { sheet: prodSheet, cols: [ph.size, ph.brand] }
  ];

  let fixed = 0;
  jobs.forEach(job => {
    const lastRow = job.sheet.getLastRow();
    if (lastRow < DATA_START_ROW) return;
    const n = lastRow - DATA_START_ROW + 1;
    job.cols.forEach(col => {
      const rng = job.sheet.getRange(DATA_START_ROW, col, n, 1);
      const vals = rng.getValues();
      const forms = rng.getFormulas();
      for (let i = 0; i < n; i++) {
        const v = vals[i][0];
        if (typeof v !== 'string' || forms[i][0] !== '') continue;
        const cleaned = normKeyText(v);
        if (cleaned === v) continue;
        const cell = job.sheet.getRange(DATA_START_ROW + i, col);
        const rtv = cell.getRichTextValue();
        const url = rtv ? rtv.getLinkUrl() : null;
        if (url) {
          cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(cleaned).setLinkUrl(url).build());
        } else {
          cell.setValue(cleaned);
        }
        fixed++;
      }
    });
  });
  if (fixed > 0) console.log('cleanKeyColumns: исправлено ячеек: ' + fixed);
  return fixed;
}

function cleanKeyColumnsSafe() {
  try {
    cleanKeyColumns();
  } catch (err) {
    console.error(err);
  }
}

function cleanKeyColumnsReport() {
  KEYS_CLEANED_THIS_RUN = false;
  try {
    const fixed = cleanKeyColumns();
    SpreadsheetApp.getUi().alert(fixed > 0
      ? 'Исправлено ячеек со скрытыми пробелами: ' + fixed + '. Теперь нажмите "Обновить всё сейчас".'
      : 'Скрытых пробелов не найдено.');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Ошибка: ' + err.message);
  }
}

// ================================================================
// ЧАСТЬ 0 — АРТИКУЛ ТОВАРА (ЗАКУПКИ!C ← БАЗА, по РАЗМЕР + НАЗВАНИЕ)
// ================================================================

function fillArtikulZakupki() {
  const ss = getSS_();
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const bazaSheet = ss.getSheetByName(SHEETS.BAZA);

  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP,
    ['size', 'brand', 'art']);
  const bh = resolveCols(getHeaderMap(bazaSheet), BAZA_HEADERS, SHEETS.BAZA,
    ['art', 'size', 'name']);

  const bazaLastRow = bazaSheet.getLastRow();
  if (bazaLastRow < 2) return;

  const bazaValues = bazaSheet.getRange(2, 1, bazaLastRow - 1, bazaSheet.getLastColumn()).getValues();
  const bazaMap = {};

  bazaValues.forEach(row => {
    const art = String(row[bh.art - 1] || '').trim();
    const size = String(row[bh.size - 1] || '').trim();
    const name = String(row[bh.name - 1] || '').trim();
    if (!art || !size || !name) return;
    const key = size.toUpperCase() + '|||' + name.toUpperCase();
    if (!bazaMap[key]) bazaMap[key] = art;
  });

  const zakupLastRow = zakupSheet.getLastRow();
  if (zakupLastRow < DATA_START_ROW) return;

  const numRows = zakupLastRow - DATA_START_ROW + 1;
  const sizeVals = zakupSheet.getRange(DATA_START_ROW, zh.size, numRows, 1).getValues();
  const brandVals = zakupSheet.getRange(DATA_START_ROW, zh.brand, numRows, 1).getValues();
  const artVals = zakupSheet.getRange(DATA_START_ROW, zh.art, numRows, 1).getValues();

  let changed = false;

  for (let i = 0; i < numRows; i++) {
    const existing = String(artVals[i][0] || '').trim();
    if (existing) continue;

    const size = String(sizeVals[i][0] || '').trim();
    const brand = String(brandVals[i][0] || '').trim();
    if (!size || !brand) continue;

    const key = size.toUpperCase() + '|||' + brand.toUpperCase();
    if (bazaMap[key]) {
      artVals[i][0] = bazaMap[key];
      changed = true;
    }
  }

  if (changed) {
    zakupSheet.getRange(DATA_START_ROW, zh.art, numRows, 1).setValues(artVals);
  }
}

// ================================================================
// ЧАСТЬ 1 — ОСТАТКИ (22 колонки A:V + Z:AB для анализа Kaspi)
// ================================================================

function rebuildOstatki() {
  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);

  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP,
    ['size', 'brand', 'qty', 'cost', 'costFull', 'cashPrice', 'kaspi', 'tip', 'art']);
  const ph = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI,
    ['size', 'brand', 'qty']);

  const L = {
    zSize: colLetter(zh.size), zBrand: colLetter(zh.brand), zQty: colLetter(zh.qty),
    zCost: colLetter(zh.cost), zCostFull: colLetter(zh.costFull),
    zCash: colLetter(zh.cashPrice), zKaspi: colLetter(zh.kaspi),
    zTip: colLetter(zh.tip), zArt: colLetter(zh.art),
    pSize: colLetter(ph.size), pBrand: colLetter(ph.brand), pQty: colLetter(ph.qty)
  };

  const oldLastRow = ostSheet.getLastRow();

  const zakupLastRow = zakupSheet.getLastRow();
  const zakupValues = zakupLastRow >= DATA_START_ROW
    ? zakupSheet.getRange(DATA_START_ROW, 1,
        zakupLastRow - DATA_START_ROW + 1, zakupSheet.getLastColumn()).getValues()
    : [];

  const map = {};
  const order = [];

  zakupValues.forEach(row => {
    const size = String(row[zh.size - 1] || '').trim();
    const brand = String(row[zh.brand - 1] || '').trim();
    const qty = Number(row[zh.qty - 1]) || 0;
    const cashPrice = Number(row[zh.cashPrice - 1]) || 0;
    const tip = String(row[zh.tip - 1] || '').trim();
    if (!size || !brand) return;
    const key = size + '|||' + brand;
    if (!map[key]) {
      map[key] = { size, brand, zakup: 0, prodano: 0, lastCashPrice: 0, lastTip: '' };
      order.push(key);
    }
    map[key].zakup += qty;
    map[key].lastCashPrice = cashPrice || map[key].lastCashPrice;
    map[key].lastTip = tip || map[key].lastTip;
  });

  const prodLastRow = prodSheet.getLastRow();
  const prodValues = prodLastRow >= DATA_START_ROW
    ? prodSheet.getRange(DATA_START_ROW, 1,
        prodLastRow - DATA_START_ROW + 1, prodSheet.getLastColumn()).getValues()
    : [];

  prodValues.forEach(row => {
    const size = String(row[ph.size - 1] || '').trim();
    const brand = String(row[ph.brand - 1] || '').trim();
    const qty = Number(row[ph.qty - 1]) || 0;
    if (!size || !brand) return;
    const key = size + '|||' + brand;
    if (map[key]) map[key].prodano += qty;
  });

  let items = order
    .map(key => {
      const it = map[key];
      return {
        size: it.size,
        brand: it.brand,
        tip: it.lastTip,
        price: it.lastCashPrice,
        ostatok: it.zakup - it.prodano
      };
    })
    .filter(it => it.ostatok !== 0);

  function parseSize(size) {
    const parts = size.split('/').map(p => p.trim());
    let width = parseInt(parts[0], 10) || 0;
    let height = 0, diamStr = '';
    if (parts.length >= 3) {
      height = parseInt(parts[1], 10) || 0;
      diamStr = parts[2];
    } else if (parts.length === 2) {
      diamStr = parts[1];
    } else {
      diamStr = parts[0];
    }
    const diam = parseInt(diamStr, 10) || 0;
    return { width, height, diam };
  }

  items.forEach(it => { it._p = parseSize(it.size); });

  items.sort((a, b) => {
    if (a._p.diam !== b._p.diam) return a._p.diam - b._p.diam;
    const byA = a.size.localeCompare(b.size, 'ru', { numeric: true, sensitivity: 'base' });
    if (byA !== 0) return byA;
    const byC = a.tip.localeCompare(b.tip, 'ru', { sensitivity: 'base' });
    if (byC !== 0) return byC;
    return a.price - b.price;
  });

  const rows = [];
  let lastDiam = null;
  let lastSize = null;

  items.forEach(it => {
    if (it._p.diam !== lastDiam) {
      rows.push({ type: 'header', size: 'R' + it._p.diam });
      lastDiam = it._p.diam;
      lastSize = null;
    } else if (it.size !== lastSize) {
      rows.push({ type: 'blank' });
    }
    rows.push({ type: 'data', size: it.size, brand: it.brand });
    lastSize = it.size;
  });

  if (oldLastRow >= DATA_START_ROW) {
    // A:V (основные данные)
    ostSheet.getRange(DATA_START_ROW, 1,
      oldLastRow - DATA_START_ROW + 1, 22).clearContent();
    // Z:AB (анализ Kaspi — разница, статус, маржа). W:X:Y НЕ трогаем —
    // туда пишет отдельный Kaspi-скрипт, здесь их очищать нельзя.
    ostSheet.getRange(DATA_START_ROW, 26,
      oldLastRow - DATA_START_ROW + 1, 3).clearContent();
  }

  if (rows.length === 0) {
    ostSheet.getRange('D2').setFormula('=SUM(D3:D3)');
    ostSheet.getRange('E2').setFormula('=SUM(E3:E3)');
    ostSheet.getRange('F2').setFormula('=SUM(F3:F3)');
    return;
  }

  const startRow = DATA_START_ROW;
  const numRows = rows.length;

  const aCol = [], bCol = [];
  const cols = ['C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','S','T','U','V','Z','AA','AB'];
  const colVals = {};
  cols.forEach(c => colVals[c] = []);

  rows.forEach((row, idx) => {
    const r = startRow + idx;
    if (row.type === 'data') {
      aCol.push([row.size]);
      bCol.push([row.brand]);
      cols.forEach(c => colVals[c].push([ostatkiFormulaFor(c, r, L)]));
    } else if (row.type === 'header') {
      aCol.push([row.size]);
      bCol.push(['']);
      cols.forEach(c => colVals[c].push(['']));
    } else {
      aCol.push(['']);
      bCol.push(['']);
      cols.forEach(c => colVals[c].push(['']));
    }
  });

  ostSheet.getRange(startRow, 1, numRows, 1).setValues(aCol);
  ostSheet.getRange(startRow, 2, numRows, 1).setValues(bCol);

  const colIndex = { C:3, D:4,E:5,F:6,G:7,H:8,I:9,J:10,K:11,L:12,M:13, N:14,O:15,P:16,Q:17,S:19,T:20,U:21,V:22, Z:26, AA:27, AB:28 };
  cols.forEach(c => {
    ostSheet.getRange(startRow, colIndex[c], numRows, 1).setValues(colVals[c]);
  });

  const lastDataRow = startRow + numRows - 1;
  ostSheet.getRange('D2').setFormula(`=SUM(D3:D${lastDataRow})`);
  ostSheet.getRange('E2').setFormula(`=SUM(E3:E${lastDataRow})`);
  ostSheet.getRange('F2').setFormula(`=SUM(F3:F${lastDataRow})`);
}

function ostatkiFormulaFor(col, r, L) {
  const ZK = Q + SHEETS.ZAKUP + Q;
  const PR = Q + SHEETS.PRODAJI + Q;
  const BZ = Q + 'БАЗА' + Q;
  const E2 = QQ + QQ;

  function lastMatchFormula(valueColLetter, fallback) {
    const fb = fallback === undefined ? '0' : fallback;
    // v15: если партии нет — возвращаем fb. Раньше MAX давал 0, а INDEX(колонка; 0)
    // отдавал всю колонку целиком -> "#REF! Массив не выведен".
    return `IFERROR(LET(pos; MAX(ARRAYFORMULA(IF((${ZK}!${L.zSize}:${L.zSize}=A${r}) * (${ZK}!${L.zBrand}:${L.zBrand}=B${r}); ROW(${ZK}!${L.zSize}:${L.zSize}); 0))); IF(pos=0; ${fb}; INDEX(${ZK}!${valueColLetter}:${valueColLetter}; pos))); ${fb})`;
  }

  function bazaArtFormula() {
    return `IFERROR(INDEX(${BZ}!A:A; MATCH(1; (${BZ}!B:B=A${r})*(${BZ}!C:C=B${r}); 0)); ${E2})`;
  }

  function bazaPhotoFormula() {
    return `IFERROR(INDEX(${BZ}!H:H; MATCH(1; (${BZ}!B:B=A${r})*(${BZ}!C:C=B${r}); 0)); ${E2})`;
  }

  function bazaKolesaFormula() {
    return `IFERROR(INDEX(${BZ}!J:J; MATCH(1; (${BZ}!B:B=A${r})*(${BZ}!C:C=B${r}); 0)); ${E2})`;
  }

  function bazaOlxFormula() {
    return `IFERROR(INDEX(${BZ}!K:K; MATCH(1; (${BZ}!B:B=A${r})*(${BZ}!C:C=B${r}); 0)); ${E2})`;
  }

  switch (col) {
    case 'C': return `=${lastMatchFormula(L.zTip, E2)}`;
    case 'D': return `=IFERROR(SUMIFS(${ZK}!${L.zQty}:${L.zQty}; ${ZK}!${L.zSize}:${L.zSize}; A${r}; ${ZK}!${L.zBrand}:${L.zBrand}; B${r}); 0)`;
    case 'E': return `=IFERROR(SUMIFS(${PR}!${L.pQty}:${L.pQty}; ${PR}!${L.pSize}:${L.pSize}; A${r}; ${PR}!${L.pBrand}:${L.pBrand}; B${r}); 0)`;
    case 'F': return `=D${r} - E${r}`;
    case 'G': return `=IF(AND(F${r}<>${E2}; F${r}<4); REPT(${QQ}|${QQ}; F${r}); ${E2})`;
    case 'H': return `=${lastMatchFormula(L.zCostFull)}`;
    case 'I': return `=${lastMatchFormula(L.zCash)}`;
    case 'J': return `=IF(OR(A${r}=${E2}; B${r}=${E2}); ${E2}; IF(SUMIFS(${ZK}!${L.zKaspi}:${L.zKaspi}; ${ZK}!${L.zSize}:${L.zSize}; A${r}; ${ZK}!${L.zBrand}:${L.zBrand}; B${r})=0; ${E2}; ${lastMatchFormula(L.zKaspi)}))`;
    case 'K': return `=${bazaPhotoFormula()}`;
    case 'L': return `=${bazaKolesaFormula()}`;
    case 'M': return `=${bazaOlxFormula()}`;
    case 'N': return `=${bazaArtFormula()}`;
    case 'O': return `=CONCATENATE(A${r};${QQ} ${QQ};B${r};${QQ} ${QQ};C${r})`;
    case 'P': return `=B${r}`;
    case 'Q': return `=${lastMatchFormula(L.zKaspi)}`;
    case 'S': return `=IF(F${r}=${E2};${E2};IF(F${r}<8;0;F${r}))`;
    case 'T': return `=${bazaArtFormula()}`;
    case 'U': return `=I${r}`;
    case 'V': return `=F${r}`;
    // Z = разница между мин. ценой Kaspi (W) и вашей ценой продажи (I).
    // Пусто, если Kaspi не нашёл конкурентов (W пусто/0).
    case 'Z': return `=IF(OR(W${r}=${E2};W${r}=0);${E2};W${r}-I${r})`;
    // AA = статус на основе Z, порог ±1050 ₸.
    case 'AA': return `=IF(Z${r}=${E2};${QQ}НЕТ ДАННЫХ${QQ};IF(Z${r}<=-1050;${QQ}ПОНИЗИТЬ${QQ};IF(Z${r}>=1050;${QQ}МОЖНО ПОДНЯТЬ${QQ};${QQ}В РЫНКЕ${QQ})))`;
    // AB = потенциальная маржа, если продавать по цене Kaspi (W - себестоимость H).
    // Пусто, если Kaspi не нашёл конкурентов.
    case 'AB': return `=IF(OR(W${r}=${E2};W${r}=0);${E2};W${r}-H${r})`;
  }
  return '';
}

// ================================================================
// ЧАСТЬ 2 — FIFO СЕБЕСТОИМОСТЬ + МАРЖА
// ================================================================

function ensureFifoColumnsSetup(zakupSheet) {
  const map = getHeaderMap(zakupSheet);
  let dateCol = map[ZAKUP_HEADERS.dateReceived.toUpperCase()] || null;
  let soldCol = map[ZAKUP_HEADERS.soldFifo.toUpperCase()] || null;
  let remainCol = map[ZAKUP_HEADERS.remainFifo.toUpperCase()] || null;

  if (!dateCol) {
    dateCol = zakupSheet.getLastColumn() + 1;
    zakupSheet.getRange(1, dateCol).setValue(ZAKUP_HEADERS.dateReceived)
      .setFontWeight('bold').setFontColor('#1155cc');
  }
  if (!soldCol) {
    soldCol = zakupSheet.getLastColumn() + 1;
    zakupSheet.getRange(1, soldCol).setValue(ZAKUP_HEADERS.soldFifo).setFontWeight('bold');
  }
  if (!remainCol) {
    remainCol = zakupSheet.getLastColumn() + 1;
    zakupSheet.getRange(1, remainCol).setValue(ZAKUP_HEADERS.remainFifo).setFontWeight('bold');
  }
  return { dateCol, soldCol, remainCol };
}

function ensureProdajiExtraColumns(prodSheet) {
  const map = getHeaderMap(prodSheet);

  let costCol = map[PRODAJI_FIFO_COST_HEADER.toUpperCase()] || null;
  if (!costCol) {
    costCol = prodSheet.getLastColumn() + 1;
    prodSheet.getRange(1, costCol).setValue(PRODAJI_FIFO_COST_HEADER)
      .setFontWeight('bold').setFontColor('#1155cc');
  }

  let unitCostCol = map[PRODAJI_FIFO_UNIT_COST_HEADER.toUpperCase()] || null;
  if (!unitCostCol) {
    unitCostCol = prodSheet.getLastColumn() + 1;
    prodSheet.getRange(1, unitCostCol).setValue(PRODAJI_FIFO_UNIT_COST_HEADER)
      .setFontWeight('bold').setFontColor('#1155cc');
  }

  let marginCol = map[PRODAJI_MARGIN_HEADER.toUpperCase()] || null;
  if (!marginCol) {
    marginCol = prodSheet.getLastColumn() + 1;
    prodSheet.getRange(1, marginCol).setValue(PRODAJI_MARGIN_HEADER)
      .setFontWeight('bold').setFontColor('#0b8043');
  }

  return { costCol, unitCostCol, marginCol };
}

function rebuildFifo() {
  const ss = getSS_();
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);

  const fifoCols = ensureFifoColumnsSetup(zakupSheet);
  const prodExtra = ensureProdajiExtraColumns(prodSheet);
  const priceCol = findProdajiPriceCol(prodSheet);
  const manualCols = findProdajiManualCols(prodSheet);

  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP,
    ['size', 'brand', 'qty', 'costFull']);
  const ph = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI,
    ['size', 'brand', 'qty']);

  const zakupLastRow = zakupSheet.getLastRow();
  if (zakupLastRow < DATA_START_ROW) return;

  const zakupLastCol = Math.max(zakupSheet.getLastColumn(), fifoCols.remainCol);
  const zakupValues = zakupSheet.getRange(
    DATA_START_ROW, 1, zakupLastRow - DATA_START_ROW + 1, zakupLastCol
  ).getValues();

  const batchesByKey = {};

  zakupValues.forEach((row, idx) => {
    const size = String(row[zh.size - 1] || '').trim();
    const brand = String(row[zh.brand - 1] || '').trim();
    const qty = Number(row[zh.qty - 1]) || 0;
    const cost = Number(row[zh.costFull - 1]) || 0;
    const dateVal = row[fifoCols.dateCol - 1];
    if (!size || !brand || qty <= 0) return;

    const sortKey = (dateVal instanceof Date && !isNaN(dateVal.getTime()))
      ? dateVal.getTime()
      : idx;

    const key = size + '|||' + brand;
    if (!batchesByKey[key]) batchesByKey[key] = [];
    batchesByKey[key].push({ idx, qty, cost, sortKey });
  });

  Object.keys(batchesByKey).forEach(key => {
    batchesByKey[key].sort((a, b) => a.sortKey - b.sortKey || a.idx - b.idx);
  });

  const prodLastRow = prodSheet.getLastRow();
  if (prodLastRow < DATA_START_ROW) return;

  const prodLastCol = prodSheet.getLastColumn();
  const prodValues = prodSheet.getRange(
    DATA_START_ROW, 1, prodLastRow - DATA_START_ROW + 1, prodLastCol
  ).getValues();

  const salesByKey = {};
  let currentDate = null;

  prodValues.forEach((row, idx) => {
    const aVal = row[ph.size - 1];

    if (aVal instanceof Date && !isNaN(aVal.getTime())) {
      currentDate = aVal;
      return;
    }

    const size = String(aVal || '').trim();
    const brand = String(row[ph.brand - 1] || '').trim();
    const qty = Number(row[ph.qty - 1]) || 0;

    if (!size || size.indexOf('/') === -1 || !brand || qty <= 0) return;

    const sortKey = (currentDate instanceof Date) ? currentDate.getTime() : idx;
    const key = size + '|||' + brand;
    if (!salesByKey[key]) salesByKey[key] = [];
    salesByKey[key].push({ idx, qty, sortKey });
  });

  Object.keys(salesByKey).forEach(key => {
    salesByKey[key].sort((a, b) => a.sortKey - b.sortKey || a.idx - b.idx);
  });

  const gWrite = {};
  const soldPerBatchIdx = {};
  const remainPerBatchIdx = {};

  Object.keys(batchesByKey).forEach(key => {
    batchesByKey[key].forEach(b => {
      soldPerBatchIdx[b.idx] = 0;
      remainPerBatchIdx[b.idx] = b.qty;
    });
  });

  Object.keys(salesByKey).forEach(key => {
    const batches = batchesByKey[key] || [];
    if (batches.length === 0) return;
    const sales = salesByKey[key];
    const remain = batches.map(b => b.qty);
    let bi = 0;

    sales.forEach(s => {
      let need = s.qty;
      let totalCost = 0;

      while (need > 0 && bi < batches.length) {
        if (remain[bi] <= 0) { bi++; continue; }
        const take = Math.min(remain[bi], need);
        totalCost += take * batches[bi].cost;
        remain[bi] -= take;
        need -= take;
        if (remain[bi] === 0 && need > 0) bi++;
      }

      if (need > 0) {
        const fallbackCost = batches.length ? batches[batches.length - 1].cost : 0;
        totalCost += need * fallbackCost;
      }

      gWrite[s.idx] = totalCost;
    });

    batches.forEach((b, i) => {
      soldPerBatchIdx[b.idx] = b.qty - remain[i];
      remainPerBatchIdx[b.idx] = remain[i];
    });
  });

  const costOut = [];
  const unitCostOut = [];
  const marginOut = [];
  const hasCostRow = new Array(prodValues.length).fill(false);

  for (let i = 0; i < prodValues.length; i++) {
    const hasCost = Object.prototype.hasOwnProperty.call(gWrite, i);
    hasCostRow[i] = hasCost;
    const totalCost = hasCost ? gWrite[i] : '';
    costOut.push([totalCost]);

    if (!hasCost) {
      unitCostOut.push(['']);
      marginOut.push(['']);
      continue;
    }

    const qty = Number(prodValues[i][ph.qty - 1]) || 0;
    const unitCost = qty > 0 ? totalCost / qty : '';
    unitCostOut.push([unitCost]);

    if (priceCol && qty > 0) {
      const rawPrice = prodValues[i][priceCol - 1];
      const hasPrice = rawPrice !== '' && rawPrice !== null &&
        !isNaN(Number(rawPrice)) && Number(rawPrice) > 0;
      if (hasPrice) {
        const salePrice = Number(rawPrice);
        const margin = (salePrice - unitCost) * qty;
        marginOut.push([margin]);
      } else {
        marginOut.push(['']);
      }
    } else {
      marginOut.push(['']);
    }
  }

  prodSheet.getRange(DATA_START_ROW, prodExtra.costCol, prodValues.length, 1).setValues(costOut);
  prodSheet.getRange(DATA_START_ROW, prodExtra.unitCostCol, prodValues.length, 1).setValues(unitCostOut);
  prodSheet.getRange(DATA_START_ROW, prodExtra.marginCol, prodValues.length, 1).setValues(marginOut);

  if (manualCols.sebesCol) {
    writeOnlyProductRows(prodSheet, manualCols.sebesCol, costOut, hasCostRow, DATA_START_ROW);
  }
  if (manualCols.marjaCol) {
    writeOnlyProductRows(prodSheet, manualCols.marjaCol, marginOut, hasCostRow, DATA_START_ROW);
  }

  const yOut = [];
  const zOut = [];
  for (let i = 0; i < zakupValues.length; i++) {
    yOut.push([Object.prototype.hasOwnProperty.call(soldPerBatchIdx, i) ? soldPerBatchIdx[i] : '']);
    zOut.push([Object.prototype.hasOwnProperty.call(remainPerBatchIdx, i) ? remainPerBatchIdx[i] : '']);
  }
  zakupSheet.getRange(DATA_START_ROW, fifoCols.soldCol, zakupValues.length, 1).setValues(yOut);
  zakupSheet.getRange(DATA_START_ROW, fifoCols.remainCol, zakupValues.length, 1).setValues(zOut);
}

function writeOnlyProductRows(sheet, col, valuesArr, mask, startRow) {
  let i = 0;
  while (i < valuesArr.length) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j < valuesArr.length && mask[j]) j++;
    const slice = valuesArr.slice(i, j);
    sheet.getRange(startRow + i, col, slice.length, 1).setValues(slice);
    i = j;
  }
}

function recalcFifoForKeys(keys) {
  const ss = getSS_();
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);

  const fifoCols = ensureFifoColumnsSetup(zakupSheet);
  const prodExtra = ensureProdajiExtraColumns(prodSheet);
  const priceCol = findProdajiPriceCol(prodSheet);
  const manualCols = findProdajiManualCols(prodSheet);

  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP,
    ['size', 'brand', 'qty', 'costFull']);
  const ph = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI,
    ['size', 'brand', 'qty']);

  const keySet = new Set(keys);

  const zakupLastRow = zakupSheet.getLastRow();
  if (zakupLastRow < DATA_START_ROW) return;
  const zakupLastCol = Math.max(zakupSheet.getLastColumn(), fifoCols.remainCol);
  const zakupValues = zakupSheet.getRange(
    DATA_START_ROW, 1, zakupLastRow - DATA_START_ROW + 1, zakupLastCol
  ).getValues();

  const batchesByKey = {};
  zakupValues.forEach((row, idx) => {
    const size = String(row[zh.size - 1] || '').trim();
    const brand = String(row[zh.brand - 1] || '').trim();
    const key = size + '|||' + brand;
    if (!keySet.has(key)) return;
    const qty = Number(row[zh.qty - 1]) || 0;
    const cost = Number(row[zh.costFull - 1]) || 0;
    const dateVal = row[fifoCols.dateCol - 1];
    if (!size || !brand || qty <= 0) return;
    const sortKey = (dateVal instanceof Date && !isNaN(dateVal.getTime())) ? dateVal.getTime() : idx;
    if (!batchesByKey[key]) batchesByKey[key] = [];
    batchesByKey[key].push({ idx, qty, cost, sortKey });
  });
  Object.keys(batchesByKey).forEach(key => {
    batchesByKey[key].sort((a, b) => a.sortKey - b.sortKey || a.idx - b.idx);
  });

  const prodLastRow = prodSheet.getLastRow();
  if (prodLastRow < DATA_START_ROW) return;
  const prodLastCol = prodSheet.getLastColumn();
  const prodValues = prodSheet.getRange(
    DATA_START_ROW, 1, prodLastRow - DATA_START_ROW + 1, prodLastCol
  ).getValues();

  const salesByKey = {};
  let currentDate = null;

  prodValues.forEach((row, idx) => {
    const aVal = row[ph.size - 1];
    if (aVal instanceof Date && !isNaN(aVal.getTime())) { currentDate = aVal; return; }
    const size = String(aVal || '').trim();
    const brand = String(row[ph.brand - 1] || '').trim();
    const qty = Number(row[ph.qty - 1]) || 0;
    if (!size || size.indexOf('/') === -1 || !brand || qty <= 0) return;
    const key = size + '|||' + brand;
    if (!keySet.has(key)) return;
    const sortKey = (currentDate instanceof Date) ? currentDate.getTime() : idx;
    if (!salesByKey[key]) salesByKey[key] = [];
    salesByKey[key].push({ idx, qty, sortKey });
  });
  Object.keys(salesByKey).forEach(key => {
    salesByKey[key].sort((a, b) => a.sortKey - b.sortKey || a.idx - b.idx);
  });

  const gWrite = {};
  const soldPerBatchIdx = {};
  const remainPerBatchIdx = {};

  Object.keys(batchesByKey).forEach(key => {
    batchesByKey[key].forEach(b => {
      soldPerBatchIdx[b.idx] = 0;
      remainPerBatchIdx[b.idx] = b.qty;
    });
  });

  Object.keys(salesByKey).forEach(key => {
    const batches = batchesByKey[key] || [];
    if (batches.length === 0) return;
    const sales = salesByKey[key];
    const remain = batches.map(b => b.qty);
    let bi = 0;

    sales.forEach(s => {
      let need = s.qty;
      let totalCost = 0;
      while (need > 0 && bi < batches.length) {
        if (remain[bi] <= 0) { bi++; continue; }
        const take = Math.min(remain[bi], need);
        totalCost += take * batches[bi].cost;
        remain[bi] -= take;
        need -= take;
        if (remain[bi] === 0 && need > 0) bi++;
      }
      if (need > 0) {
        const fallbackCost = batches.length ? batches[batches.length - 1].cost : 0;
        totalCost += need * fallbackCost;
      }
      gWrite[s.idx] = totalCost;
    });

    batches.forEach((b, i) => {
      soldPerBatchIdx[b.idx] = b.qty - remain[i];
      remainPerBatchIdx[b.idx] = remain[i];
    });
  });

  const touchedProdIdx = [];
  Object.keys(salesByKey).forEach(key => {
    salesByKey[key].forEach(s => touchedProdIdx.push(s.idx));
  });
  touchedProdIdx.sort((a, b) => a - b);

  touchedProdIdx.forEach(idx => {
    const hasCost = Object.prototype.hasOwnProperty.call(gWrite, idx);
    const totalCost = hasCost ? gWrite[idx] : '';
    const qty = Number(prodValues[idx][ph.qty - 1]) || 0;
    const unitCost = (hasCost && qty > 0) ? totalCost / qty : '';
    let margin = '';
    if (hasCost && priceCol && qty > 0) {
      const rawPrice = prodValues[idx][priceCol - 1];
      const hasPrice = rawPrice !== '' && rawPrice !== null &&
        !isNaN(Number(rawPrice)) && Number(rawPrice) > 0;
      if (hasPrice) margin = (Number(rawPrice) - unitCost) * qty;
    }
    const r = DATA_START_ROW + idx;
    prodSheet.getRange(r, prodExtra.costCol).setValue(totalCost);
    prodSheet.getRange(r, prodExtra.unitCostCol).setValue(unitCost);
    prodSheet.getRange(r, prodExtra.marginCol).setValue(margin);
    if (hasCost) {
      if (manualCols.sebesCol) prodSheet.getRange(r, manualCols.sebesCol).setValue(totalCost);
      if (manualCols.marjaCol) prodSheet.getRange(r, manualCols.marjaCol).setValue(margin);
    }
  });

  const touchedBatchIdx = [];
  Object.keys(batchesByKey).forEach(key => {
    batchesByKey[key].forEach(b => touchedBatchIdx.push(b.idx));
  });
  touchedBatchIdx.sort((a, b) => a - b);

  touchedBatchIdx.forEach(idx => {
    const r = DATA_START_ROW + idx;
    zakupSheet.getRange(r, fifoCols.soldCol).setValue(soldPerBatchIdx[idx]);
    zakupSheet.getRange(r, fifoCols.remainCol).setValue(remainPerBatchIdx[idx]);
  });
}

// ================== ДИАГНОСТИКА ==================
function showHeaders() {
  const ss = getSS_();
  const report = [SHEETS.ZAKUP, SHEETS.PRODAJI, SHEETS.BAZA].map(name => {
    const sheet = ss.getSheetByName(name);
    const map = getHeaderMap(sheet);
    const lines = Object.keys(map).map(k => colLetter(map[k]) + ': ' + k);
    return name + ':\n' + lines.join('\n');
  }).join('\n\n');
  SpreadsheetApp.getUi().alert(report);
}

// ================================================================
// ЧАСТЬ 3 — АНАЛИЗАТОР (все позиции за всю историю)
// ----------------------------------------------------------------
// Колонки: A РАЗМЕР | B БРЕНД | C ТИП | D Закуп | E Прдж | F Остат |
//          G С.Ц (ЦЕНА ПОД КЛЮЧ, последняя партия — как СС в ОСТАТКИ) |
//          H ЦЕНА (ЗА НАЛ, последняя партия — как в ОСТАТКИ) |
//          I СУММА СЕБЕС (G*F) | J СУММА ПРОДАЖ (H*F)
// D, E, F, I, J — живые формулы (пересчитываются мгновенно при правке
// ЗАКУПКИ/ПРОДАЖИ). Список позиций (A:C) и G:H пересобирает скрипт.
// ================================================================

const ANALIZ_START_ROW = 5;      // 1 — шапка, 2-3 — итоги, 4 — строка фильтра
const ANALIZ_COLS = 10;          // A:J
const ANALIZ_SPARE_ROWS = 50;    // запас пустых строк под новые позиции
const ANALIZ_FORMAT_FLAG = 'ANALIZ_FORMAT_V1';

function rebuildAnalizatorSafe() {
  try {
    cleanKeyColumnsSafe();
    rebuildAnalizator();
  } catch (err) {
    console.error(err);
    try { SpreadsheetApp.getUi().alert('Ошибка в "АНАЛИЗАТОР": ' + err.message); } catch (e2) { /* запуск по триггеру — окна нет */ }
  }
}

function analizatorApplyFormatSafe() {
  try {
    analizatorApplyFormat();
    SpreadsheetApp.getUi().alert('Оформление АНАЛИЗАТОР обновлено.');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Ошибка оформления АНАЛИЗАТОР: ' + err.message);
  }
}

function anParseSize(size) {
  const parts = String(size).split('/').map(p => p.trim());
  let diamStr;
  if (parts.length >= 3) diamStr = parts[2];
  else if (parts.length === 2) diamStr = parts[1];
  else diamStr = parts[0];
  return { diam: parseInt(diamStr, 10) || 0 };
}

function anFormulaFor(col, r, L) {
  const ZK = Q + SHEETS.ZAKUP + Q;
  const PR = Q + SHEETS.PRODAJI + Q;
  switch (col) {
    case 'D': return `=IFERROR(SUMIFS(${ZK}!${L.zQty}:${L.zQty}; ${ZK}!${L.zSize}:${L.zSize}; A${r}; ${ZK}!${L.zBrand}:${L.zBrand}; B${r}); 0)`;
    case 'E': return `=IFERROR(SUMIFS(${PR}!${L.pQty}:${L.pQty}; ${PR}!${L.pSize}:${L.pSize}; A${r}; ${PR}!${L.pBrand}:${L.pBrand}; B${r}); 0)`;
    case 'F': return `=D${r} - E${r}`;
    case 'I': return `=G${r}*F${r}`;
    case 'J': return `=H${r}*F${r}`;
  }
  return '';
}

function rebuildAnalizator() {
  const ss = getSS_();
  const anSheet = ss.getSheetByName(SHEETS.ANALIZ);
  if (!anSheet) {
    throw new Error('Не найден лист "' + SHEETS.ANALIZ + '". Создайте лист с таким названием.');
  }
  const zakupSheet = ss.getSheetByName(SHEETS.ZAKUP);
  const prodSheet = ss.getSheetByName(SHEETS.PRODAJI);

  const zh = resolveCols(getHeaderMap(zakupSheet), ZAKUP_HEADERS, SHEETS.ZAKUP,
    ['size', 'brand', 'qty', 'costFull', 'cashPrice', 'tip']);
  const ph = resolveCols(getHeaderMap(prodSheet), PRODAJI_HEADERS, SHEETS.PRODAJI,
    ['size', 'brand', 'qty']);

  const L = {
    zSize: colLetter(zh.size), zBrand: colLetter(zh.brand), zQty: colLetter(zh.qty),
    pSize: colLetter(ph.size), pBrand: colLetter(ph.brand), pQty: colLetter(ph.qty)
  };

  // ---------- 1. Собираем все позиции из ЗАКУПКИ ----------
  const map = {};
  const order = [];
  function ensure(size, brand) {
    const key = size.toUpperCase() + '|||' + brand.toUpperCase();
    if (!map[key]) {
      map[key] = { size, brand, tip: '', cost: 0, cash: 0 };
      order.push(key);
    }
    return map[key];
  }

  const zakupLastRow = zakupSheet.getLastRow();
  const zakupValues = zakupLastRow >= DATA_START_ROW
    ? zakupSheet.getRange(DATA_START_ROW, 1,
        zakupLastRow - DATA_START_ROW + 1, zakupSheet.getLastColumn()).getValues()
    : [];

  zakupValues.forEach(row => {
    const size = String(row[zh.size - 1] || '').trim();
    const brand = String(row[zh.brand - 1] || '').trim();
    if (!size || !brand) return;
    const it = ensure(size, brand);
    // как в ОСТАТКИ: берём значения из ПОСЛЕДНЕЙ по порядку строки закупки
    it.cost = Number(row[zh.costFull - 1]) || 0;
    it.cash = Number(row[zh.cashPrice - 1]) || 0;
    const tip = String(row[zh.tip - 1] || '').trim();
    if (tip) it.tip = tip;
  });

  // Продажи позиции НЕ создают: в списке только то, что есть в ЗАКУПКИ.
  // Продано без закупки (другое название, мусорная строка) — не попадает в
  // список, но ячейка A2 покажет ⚠, что итог продаж не сходится.

  // ---------- 2. Сортировка и группировка — как в ОСТАТКИ ----------
  const items = order.map(k => map[k]);
  items.forEach(it => { it._d = anParseSize(it.size).diam; });
  items.sort((a, b) => {
    if (a._d !== b._d) return a._d - b._d;
    const bySize = a.size.localeCompare(b.size, 'ru', { numeric: true, sensitivity: 'base' });
    if (bySize !== 0) return bySize;
    const byTip = a.tip.localeCompare(b.tip, 'ru', { sensitivity: 'base' });
    if (byTip !== 0) return byTip;
    return a.cash - b.cash;
  });

  const rows = [];
  let lastDiam = null;
  let lastSize = null;
  items.forEach(it => {
    if (it._d !== lastDiam) {
      rows.push({ type: 'header', size: 'R' + it._d });
      lastDiam = it._d;
      lastSize = null;
    } else if (it.size !== lastSize) {
      rows.push({ type: 'blank' });
    }
    rows.push({ type: 'data', it: it });
    lastSize = it.size;
  });

  // ---------- 3. Место на листе и очистка старого содержимого ----------
  const n = rows.length;
  const lastDataRow = ANALIZ_START_ROW + Math.max(n, 1) - 1;
  const needRows = lastDataRow + ANALIZ_SPARE_ROWS;
  const maxRows = anSheet.getMaxRows();
  if (needRows > maxRows) {
    // вставляем ВНУТРИ диапазона (перед последней строкой) — тогда фильтр и
    // условное форматирование растягиваются сами
    anSheet.insertRowsBefore(maxRows, needRows - maxRows);
  }
  const clearRows = anSheet.getMaxRows() - ANALIZ_START_ROW + 1;
  anSheet.getRange(ANALIZ_START_ROW, 1, clearRows, ANALIZ_COLS).clearContent();

  // ---------- 4. Запись ----------
  if (n > 0) {
    const out = rows.map((row, idx) => {
      const r = ANALIZ_START_ROW + idx;
      if (row.type === 'header') return [row.size, '', '', '', '', '', '', '', '', ''];
      if (row.type === 'blank') return ['', '', '', '', '', '', '', '', '', ''];
      const it = row.it;
      return [
        it.size, it.brand, it.tip,
        anFormulaFor('D', r, L), anFormulaFor('E', r, L), anFormulaFor('F', r, L),
        it.cost, it.cash,
        anFormulaFor('I', r, L), anFormulaFor('J', r, L)
      ];
    });
    anSheet.getRange(ANALIZ_START_ROW, 1, n, ANALIZ_COLS).setValues(out);
  }

  // ---------- 5. Шапка и итоги (ПРОДАЖИ!I3 и L3 ссылаются на F2 и I3) ----------
  if (!anSheet.getRange('A1').getValue()) anSheet.getRange('A1').setValue('РАЗМЕР');
  if (!anSheet.getRange('B1').getValue()) anSheet.getRange('B1').setValue('БРЕНД (СТРАНА)');
  if (!anSheet.getRange('C1').getValue()) anSheet.getRange('C1').setValue('ТИП');

  const S = ANALIZ_START_ROW;
  anSheet.getRange('D2').setFormula(`=SUM(D${S}:D)`);
  anSheet.getRange('E2').setFormula(`=SUM(E${S}:E)`);
  anSheet.getRange('F2').setFormula(`=SUM(F${S}:F)`);
  anSheet.getRange('I3').setFormula(`=SUM(I${S}:I)`);
  anSheet.getRange('J3').setFormula(`=SUM(J${S}:J)`);

  // Контроль A2: итоги АНАЛИЗАТОРА должны сходиться с исходными листами.
  // ⚠ = в ЗАКУПКИ/ПРОДАЖИ есть строка, которая не попала в список
  // (нет размера или названия, лишний пробел и т.п.).
  const ZK = Q + SHEETS.ZAKUP + Q;
  const PR = Q + SHEETS.PRODAJI + Q;
  const zSum = `SUM(${ZK}!${L.zQty}${DATA_START_ROW}:${L.zQty})`;
  const pSum = `SUMIFS(${PR}!${L.pQty}${DATA_START_ROW}:${L.pQty}; ${PR}!${L.pBrand}${DATA_START_ROW}:${L.pBrand}; ${QQ}<>${QQ})`;
  anSheet.getRange('A2').setFormula(
    `=IF(ABS(D2-${zSum})>=0.5; ${QQ}⚠ закуп не сходится с ЗАКУПКИ${QQ}; ` +
    `IF(ABS(E2-${pSum})>=0.5; ${QQ}⚠ прдж: есть продажа без закупки или без размера${QQ}; ${QQ}✔ итоги сходятся${QQ}))`
  );

  // ---------- 6. Оформление (один раз; повторно — через меню) ----------
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(ANALIZ_FORMAT_FLAG)) {
    analizatorApplyFormat();
    props.setProperty(ANALIZ_FORMAT_FLAG, '1');
  }
}

function analizatorApplyFormat() {
  const ss = getSS_();
  const sh = ss.getSheetByName(SHEETS.ANALIZ);
  if (!sh) throw new Error('Не найден лист "' + SHEETS.ANALIZ + '".');

  const S = ANALIZ_START_ROW;
  const rowsCnt = sh.getMaxRows() - S + 1;

  // ТИП: убираем сплошную заливку (цвет задают правила ниже)
  sh.getRange(S, 3, rowsCnt, 1).setBackground(null);
  // деньги
  sh.getRange(S, 7, rowsCnt, 4).setNumberFormat('#,##0"₸"');

  const cRange = sh.getRange(S, 3, rowsCnt, 1);
  const aRange = sh.getRange(S, 1, rowsCnt, 1);
  const fRange = sh.getRange(S, 6, rowsCnt, 1);
  const fjRange = sh.getRange(S, 6, rowsCnt, 5);

  const rules = [];
  function textRule(range, text, bg) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text).setBackground(bg).setRanges([range]).build());
  }
  textRule(cRange, 'ШИПЫ', '#a4c2f4');
  textRule(cRange, 'ПОДШИП', '#ffff00');
  textRule(cRange, 'ЛИПУЧКА', '#e06666');
  textRule(cRange, 'ЛИПУЧКИ', '#e06666');
  textRule(cRange, 'КАМЕРЫ', '#f1c232');

  textRule(aRange, 'КАМЕРЫ', '#ff9900');
  textRule(aRange, 'R0', '#ff9900');
  for (let d = 10; d <= 26; d++) textRule(aRange, 'R' + d, '#ff9900');

  // Остаток < 0 — продали больше, чем закупили (нет закупки / разные названия)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setBackground('#990000').setFontColor('#ffffff')
    .setRanges([fRange]).build());
  // 0 — полностью продано (или нет цены)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberEqualTo(0).setBackground('#ff0000').setRanges([fjRange]).build());
  // 1..19 — заканчивается
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberBetween(1, 19).setBackground('#ffff00').setRanges([fRange]).build());

  sh.setConditionalFormatRules(rules);
}

// ============================================================================
// === НАЧАЛО БЛОКА KASPI MONITORING (добавка, ничего выше не менялось) ===
// Пишет мин./среднюю цену конкурентов в столбцы W(23)/X(24), ссылку на
// каталог с фильтрами (сортировка: сначала дешёвые) — в столбец Y(25)
// листа ОСТАТКИ. Содержит словарь транслитерации кириллических брендов.
// ============================================================================

const KASPI_PROGRESS_KEY = 'KASPI_OSTATKI_PROGRESS_INDEX';
const KASPI_WRITE_COL_MIN = 23; // W
const KASPI_WRITE_COL_AVG = 24; // X
const KASPI_WRITE_COL_URL = 25; // Y

const CYRILLIC_BRAND_MAP = {
  'АПЛЮС': 'Aplus',
  'АТТАР': 'Attar',
  'ЙОКОГАМА': 'Yokohama',
  'ЙОКОХАМА': 'Yokohama',
  'ЛАНДСПАЙДЕР': 'Landspider',
  'ЛИНГЛОНГ': 'Linglong',
  'ПАУЭРТРАК': 'Powertrac',
  'РАЙДАНЗ': 'Rydanz',
  'САННИ': 'Sunny',
  'СОНИКС': 'Sonix',
  'ТРАЙАНГЛ': 'Triangle',
  'ТРАЙЭНГЛ': 'Triangle',
  'ТРИАНГЛ': 'Triangle',
  'ТРАКМАКС': 'Tracmax',
  'ФРИДОМ': 'Freedom',
  'ХАЙДА': 'Haida'
};

function kaspiParseTireSize(sizeStr) {
  const clean = String(sizeStr).replace(/\s+/g, '').toUpperCase();
  const parts = clean.split('/');
  if (parts.length === 3) {
    return { width: parts[0], aspect: parts[1], rim: parts[2].replace(/[^\d.]/g, '') };
  }
  if (parts.length === 2) {
    return { width: parts[0], aspect: null, rim: parts[1].replace(/[^\d.]/g, '') };
  }
  return null;
}

function kaspiGetInStockRows() {
  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);
  const bazaSheet = ss.getSheetByName(SHEETS.BAZA);

  const bh = resolveCols(getHeaderMap(bazaSheet), BAZA_HEADERS, SHEETS.BAZA, ['art']);
  const bazaHeaderMap = getHeaderMap(bazaSheet);
  const brandCol = bazaHeaderMap['БРЕНД'];
  if (!brandCol) {
    throw new Error('На листе БАЗА не найден столбец с заголовком "БРЕНД". Проверьте написание в строке 1.');
  }

  const bazaLastRow = bazaSheet.getLastRow();
  const skuToBrand = {};
  if (bazaLastRow >= 2) {
    const bazaVals = bazaSheet.getRange(2, 1, bazaLastRow - 1, Math.max(bh.art, brandCol)).getValues();
    bazaVals.forEach(row => {
      const art = String(row[bh.art - 1] || '').trim();
      const brand = String(row[brandCol - 1] || '').trim();
      if (art && brand) skuToBrand[art] = brand;
    });
  }

  const lastRow = ostSheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const values = ostSheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 14).getValues();

  const items = [];
  values.forEach((row, idx) => {
    const size = String(row[0] || '').trim();
    const title = String(row[1] || '').trim();
    const type = String(row[2] || '').trim();
    const stock = Number(row[5]) || 0;
    const artikul = String(row[13] || '').trim();

    if (!size || size.indexOf('/') === -1) return;
    if (!title || stock <= 0) return;

    const brand = skuToBrand[artikul];
    if (!brand) return;

    const parsed = kaspiParseTireSize(size);
    if (!parsed) return;

    const typeUpper = type.toUpperCase();
    let thornsText;
    if (typeUpper === 'ШИПЫ' || typeUpper === 'ПОДШИП') thornsText = 'с шипами';
    else if (typeUpper === 'ЛИПУЧКА') thornsText = 'без шипов';
    else return;

    items.push({
      rowNumber: DATA_START_ROW + idx,
      brand: brand,
      width: parsed.width,
      aspect: parsed.aspect,
      rim: parsed.rim,
      thornsText: thornsText
    });
  });

  return items;
}

function kaspiToBrandFormat(brand) {
  return String(brand).toLowerCase().split(' ')
    .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function kaspiNormalizeBrandForQuery(rawBrand) {
  const upper = String(rawBrand).trim().toUpperCase();
  if (CYRILLIC_BRAND_MAP[upper]) return CYRILLIC_BRAND_MAP[upper];
  return kaspiToBrandFormat(rawBrand);
}

function kaspiGetBrandCaseMap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('KASPI_BRAND_MAP_ZIMA2027');
  if (cached) return JSON.parse(cached);

  const city = "710000000";
  const qFilter = ":availableInZones:Magnum_ZONE5:category:Passenger car tires";
  const url = "https://kaspi.kz/yml/product-view/pl/filters?q="
    + encodeURIComponent(qFilter) + "&text=&all=false&sort=relevance&ui=d&i=-1&c=" + city + "&page=0";

  const options = {
    method: "get",
    headers: {
      "Accept": "application/json, text/*",
      "Accept-Language": "ru",
      "X-KS-City": city,
      "Referer": "https://kaspi.kz/shop/nur-sultan/c/passenger%20car%20tires/?q=" + encodeURIComponent(qFilter),
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    muteHttpExceptions: true
  };

  let map = {};
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      const filters = json.data && json.data.filters;
      const brandFilter = filters && filters.find(function(f) { return f.id === 'manufacturerName'; });
      if (brandFilter && brandFilter.rows) {
        brandFilter.rows.forEach(function(row) { map[String(row.name).toUpperCase()] = row.name; });
      }
    }
  } catch (e) {
    Logger.log('Kaspi: не удалось получить карту брендов: ' + e.message);
  }

  cache.put('KASPI_BRAND_MAP_ZIMA2027', JSON.stringify(map), 21600);
  return map;
}

function kaspiBuildQFilter(brand, width, aspect, rim, thornsText) {
  let parts = [
    ":availableInZones:Magnum_ZONE5",
    ":category:Passenger car tires",
    ":manufacturerName:" + brand,
    ":Tires*Section width:" + width
  ];
  if (aspect) parts.push(":Tires*Aspect ratio:" + aspect);
  parts.push(":Tires*Rim size:" + rim);
  parts.push(":Tires*Thorns:" + thornsText);
  parts.push(":Tires*Type:зимние");
  return parts.join("");
}

function kaspiFetchPrices(item) {
  const city = "710000000";
  const brandMap = kaspiGetBrandCaseMap();
  const normalizedBrand = kaspiNormalizeBrandForQuery(item.brand);
  const correctBrand = brandMap[normalizedBrand.toUpperCase()] || normalizedBrand;
  const qFilter = kaspiBuildQFilter(correctBrand, item.width, item.aspect, item.rim, item.thornsText);
  const catalogUrl = "https://kaspi.kz/shop/nur-sultan/c/passenger%20car%20tires/?q=" + encodeURIComponent(qFilter) + "&sort=price-asc&sc=";

  const allCards = [];
  let page = 0;
  while (page < 10) {
    const url = "https://kaspi.kz/yml/product-view/pl/filters?q="
      + encodeURIComponent(qFilter) + "&text=&all=false&sort=relevance&ui=d&i=-1&c=" + city + "&page=" + page;
    const options = {
      method: "get",
      headers: {
        "Accept": "application/json, text/*",
        "Accept-Language": "ru",
        "X-KS-City": city,
        "Referer": catalogUrl,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 400) break;
    if (code !== 200) break;
    const json = JSON.parse(response.getContentText());
    const cards = json.data && json.data.cards;
    if (!cards || cards.length === 0) break;
    allCards.push.apply(allCards, cards);
    page++;
    Utilities.sleep(400);
  }

  if (allCards.length === 0) return { minPrice: '', avgPrice: '', url: '' };

  const prices = allCards.map(function(c) { return c.unitSalePrice || c.unitPrice; });
  const minPrice = Math.min.apply(null, prices);
  const avgPrice = Math.round(prices.reduce(function(a, b) { return a + b; }, 0) / prices.length);
  return { minPrice: minPrice, avgPrice: avgPrice, url: catalogUrl };
}

function kaspiRunChunk() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'kaspiRunChunk') ScriptApp.deleteTrigger(t);
  });

  const props = PropertiesService.getScriptProperties();
  const items = kaspiGetInStockRows();
  let index = parseInt(props.getProperty(KASPI_PROGRESS_KEY) || '0');

  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);

  const startTime = new Date().getTime();
  const maxRunMs = 4.5 * 60 * 1000;

  while (index < items.length) {
    if (new Date().getTime() - startTime > maxRunMs) break;

    const item = items[index];
    const prices = kaspiFetchPrices(item);
    ostSheet.getRange(item.rowNumber, KASPI_WRITE_COL_MIN).setValue(prices.minPrice);
    ostSheet.getRange(item.rowNumber, KASPI_WRITE_COL_AVG).setValue(prices.avgPrice);
    ostSheet.getRange(item.rowNumber, KASPI_WRITE_COL_URL).setValue(prices.url);

    index++;
    Utilities.sleep(300);
  }

  props.setProperty(KASPI_PROGRESS_KEY, String(index));

  if (index >= items.length) {
    props.setProperty(KASPI_PROGRESS_KEY, '0');
    Logger.log('Kaspi: обход завершён, всего позиций: ' + items.length);
  } else {
    ScriptApp.newTrigger('kaspiRunChunk')
      .timeBased()
      .after(3 * 60 * 1000)
      .create();
    Logger.log('Kaspi: прогресс ' + index + '/' + items.length + ', продолжение через 3 мин');
  }
}

function kaspiStartNightlyRun() {
  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);
  const lastRow = ostSheet.getLastRow();

  if (lastRow >= DATA_START_ROW) {
    ostSheet.getRange(DATA_START_ROW, KASPI_WRITE_COL_MIN, lastRow - DATA_START_ROW + 1, 3).clearContent();
  }

  PropertiesService.getScriptProperties().setProperty(KASPI_PROGRESS_KEY, '0');
  kaspiRunChunk();
}

function kaspiSetupNightlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'kaspiStartNightlyRun') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('kaspiStartNightlyRun')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  Logger.log('Kaspi: ночной автозапуск настроен на ~02:00');
}

// === ДОБАВЛЕНО: автозапуск обхода цен Kaspi каждые 2 часа ===

function kaspiStartHourlyRun() {
  // Не начинаем новый обход, если предыдущий ещё не завершился
  // (значит, есть отложенный триггер kaspiRunChunk — цепочка продолжений)
  const pending = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'kaspiRunChunk';
  });
  if (pending) {
    Logger.log('Kaspi: предыдущий обход ещё не завершён, пропускаем этот запуск');
    return;
  }

  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);
  const lastRow = ostSheet.getLastRow();

  if (lastRow >= DATA_START_ROW) {
    ostSheet.getRange(DATA_START_ROW, KASPI_WRITE_COL_MIN, lastRow - DATA_START_ROW + 1, 3).clearContent();
  }

  PropertiesService.getScriptProperties().setProperty(KASPI_PROGRESS_KEY, '0');
  kaspiRunChunk();
}

function kaspiSetupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction();
    if (fn === 'kaspiStartNightlyRun' || fn === 'kaspiStartHourlyRun') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('kaspiStartHourlyRun')
    .timeBased()
    .everyHours(2)
    .create();
  Logger.log('Kaspi: автозапуск настроен каждые 2 часа');
  SpreadsheetApp.getUi().alert('Готово! Анализ цен Kaspi теперь запускается автоматически каждые 2 часа.');
}

function kaspiTestOne() {
  const items = kaspiGetInStockRows();
  Logger.log('Всего позиций в наличии для мониторинга: ' + items.length);
  if (items.length === 0) return;
  const sample = items[0];
  Logger.log('Тест: ' + JSON.stringify(sample));
  const prices = kaspiFetchPrices(sample);
  Logger.log('Результат: мин=' + prices.minPrice + ', средняя=' + prices.avgPrice + ', ссылка=' + prices.url);
}

function kaspiListCyrillicBrands() {
  const items = kaspiGetInStockRows();
  const cyrillicOnes = items.filter(function(it) { return /[а-яА-Я]/.test(it.brand); });
  Logger.log('Позиций с кириллическим брендом: ' + cyrillicOnes.length + ' из ' + items.length);
  const seen = {};
  cyrillicOnes.forEach(function(it) {
    if (!seen[it.brand]) {
      seen[it.brand] = true;
      const inDict = CYRILLIC_BRAND_MAP[it.brand.toUpperCase()] ? ' → есть в словаре: ' + CYRILLIC_BRAND_MAP[it.brand.toUpperCase()] : ' → НЕТ В СЛОВАРЕ';
      Logger.log('  "' + it.brand + '"' + inDict + ' (например строка ' + it.rowNumber + ')');
    }
  });
}

function kaspiListSkippedRows() {
  const ss = getSS_();
  const ostSheet = ss.getSheetByName(SHEETS.OSTATKI);
  const bazaSheet = ss.getSheetByName(SHEETS.BAZA);

  const bh = resolveCols(getHeaderMap(bazaSheet), BAZA_HEADERS, SHEETS.BAZA, ['art']);
  const bazaHeaderMap = getHeaderMap(bazaSheet);
  const brandCol = bazaHeaderMap['БРЕНД'];

  const bazaLastRow = bazaSheet.getLastRow();
  const skuToBrand = {};
  if (bazaLastRow >= 2) {
    const bazaVals = bazaSheet.getRange(2, 1, bazaLastRow - 1, Math.max(bh.art, brandCol)).getValues();
    bazaVals.forEach(row => {
      const art = String(row[bh.art - 1] || '').trim();
      const brand = String(row[brandCol - 1] || '').trim();
      if (art && brand) skuToBrand[art] = brand;
    });
  }

  const lastRow = ostSheet.getLastRow();
  const values = ostSheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 14).getValues();

  let skippedNoArtikul = [];
  let skippedNoBrandInBaza = [];

  values.forEach((row, idx) => {
    const size = String(row[0] || '').trim();
    const title = String(row[1] || '').trim();
    const stock = Number(row[5]) || 0;
    const artikul = String(row[13] || '').trim();

    if (!size || size.indexOf('/') === -1) return;
    if (!title || stock <= 0) return;

    const r = DATA_START_ROW + idx;
    if (!artikul) {
      skippedNoArtikul.push(r + ': ' + title);
      return;
    }
    if (!skuToBrand[artikul]) {
      skippedNoBrandInBaza.push(r + ' (артикул ' + artikul + '): ' + title);
    }
  });

  Logger.log('Строк без артикула (N пустой): ' + skippedNoArtikul.length);
  skippedNoArtikul.slice(0, 15).forEach(s => Logger.log('  ' + s));

  Logger.log('Строк с артикулом, но без бренда в БАЗА: ' + skippedNoBrandInBaza.length);
  skippedNoBrandInBaza.slice(0, 15).forEach(s => Logger.log('  ' + s));
}

// ============================================================================
// === КОНЕЦ БЛОКА KASPI MONITORING ===
// ============================================================================