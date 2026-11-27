/**
 * ШИНМАРТ · СКЛАД — веб-приложение для таблицы ЗИМА 2027
 * Разделы: СКЛАД (остатки и поиск), ПРОДАЖА, ПРИХОД.
 *
 * Файл добавляется в ТОТ ЖЕ проект Apps Script, где лежит основной скрипт
 * (ему нужны SHEETS, getHeaderMap, resolveCols, recalcFifoForKeys и др.).
 * Все функции приложения начинаются с "app", чтобы не пересекаться с основным кодом.
 *
 * Данные живут только в таблице. Приложение пишет в НОВЫЕ листы-журналы ПРИХОДЫ и
 * ПРОДАЖИ_ЖУРНАЛ (одна операция = одна строка). Старые ЗАКУПКИ и ПРОДАЖИ остаются архивом.
 * Старые данные переносятся один раз из меню: «Перенести данные в новые листы».
 * После записи приложение сразу пересчитывает FIFO-себестоимость.
 */

// ===== НАСТРОЙКИ =====
// Аккаунты, которым можно открыть приложение. Впишите почту папы вместо заглушки.
const APP_ALLOWED = [
  'owner@example.com',   // впишите свои почты перед развёртыванием
  'father@example.com'
];
const APP_TITLE = 'ШИНМАРТ · Склад';
const APP_LOG_SHEET = 'APP_ЖУРНАЛ';
const APP_EXP_SHEET = 'РАСХОДЫ';
const APP_PAYS = ['нал', 'QR', 'Kaspi', 'рассрочка'];
const APP_CM = '💬 ';          // начало строки-комментария под продажей в листе ПРОДАЖИ
function appIsWo_(pay) { return pay === 'СПИСАНИЕ' || pay === 'НЕДОСТАЧА'; }
function appIsSpecialSup_(sup) { return sup === 'ВОЗВРАТ' || sup === 'ИНВЕНТАРИЗАЦИЯ'; }
const APP_CACHE_TTL = 120;          // секунд хранить индекс в кэше
const APP_CHUNK = 80000;            // лимит кэша — 100 КБ на ключ
const APP_DEFAULT_MARKUP = 0.335;

// Дополнительные заголовки ЗАКУПКИ (основные берутся из ZAKUP_HEADERS)
const APP_ZH_EXTRA = {
  date: 'ДАТА ПРИХОДА',
  supplier: 'SUPPLIER',
  usd: 'ЦЕНА ($)',
  rate: 'КУРС',
  exp: 'РАСХОДЫ',
  markup: 'НАЦЕН',
  qr: 'QR (GOLD)'
};
const APP_PH_EXTRA = { sum: 'СУММА', sebes: 'СЕБЕС', marja: 'МАРЖА', date: 'ДАТА', who: 'КТО', when: 'ВРЕМЯ ЗАПИСИ', pay: 'ОПЛАТА' };
const APP_ZH_WHO = { who: 'КТО', when: 'ВРЕМЯ ЗАПИСИ' };
const APP_BZ_HEADERS = {
  art: 'АРТИКУЛ ТОВАРА', photo: 'ФОТО', png: 'PNG',
  kolesa: 'ССЫЛКА КОЛЕСА.KZ', kaspi: 'KASPI KZ', brand: 'БРЕНД', full: 'ПОЛНОЕ НАИМЕНОВАНИЕ'
};

// ===== ВХОД =====

function doGet() {
  const email = appEmail_();
  if (!appAllowed_(email)) {
    const shown = email ? String(email).replace(/[<>&]/g, '') : '';
    return HtmlService.createHtmlOutput(
      '<div style="font:16px Montserrat,Arial,sans-serif;padding:28px;line-height:1.5">' +
      '<b>Нет доступа.</b><br>' + (shown ? 'Аккаунт ' + shown + ' не в списке.' : 'Не удалось определить аккаунт Google.') +
      '<br>Откройте ссылку в нужном аккаунте.</div>'
    ).setTitle(APP_TITLE);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function appEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

function appAllowed_(email) {
  if (!email) return false;
  return APP_ALLOWED.some(a => String(a).toLowerCase() === email);
}

// Разовая подготовка: запомнить ID таблицы и создать лист журнала. Запускать из меню.
function appPrepare() {
  const ss = getSS_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  appLogSheet_();
  try {
    SpreadsheetApp.getUi().alert(
      'Приложение подготовлено.\n\n' +
      '1) В Apps Script: Развернуть → Новое развертывание → Веб-приложение.\n' +
      '2) Выполнять от имени: пользователь, открывающий приложение.\n' +
      '3) Доступ: все пользователи Google.\n' +
      '4) Скопируйте ссылку и откройте на телефоне (в Safari: «На экран Домой»).'
    );
  } catch (e) { /* без окна */ }
}

// ===== ОБЩИЕ ОБЁРТКИ =====

// Каждый запрос: проверка доступа, защита от двойного нажатия (reqId), блокировка записи.
function appGuard_(p, write, fn) {
  try {
    const email = appEmail_();
    if (!appAllowed_(email)) return { ok: false, error: 'Нет доступа для ' + (email || 'неизвестного аккаунта') };
    p = p || {};
    const cache = CacheService.getScriptCache();
    const idemKey = write && p.reqId ? 'idem_' + p.reqId : null;
    if (idemKey) {
      const prev = cache.get(idemKey);
      if (prev === 'PENDING') return { ok: false, error: 'Запрос уже выполняется. Подождите пару секунд.' };
      if (prev) return JSON.parse(prev);
      cache.put(idemKey, 'PENDING', 120);
    }
    let res;
    if (write) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) {
        if (idemKey) cache.remove(idemKey);
        return { ok: false, error: 'Таблица занята другой записью. Повторите через несколько секунд.' };
      }
      try { res = fn(email); } finally { lock.releaseLock(); }
    } else {
      res = fn(email);
    }
    res = opsScrub_(email, res);
    if (idemKey) {
      // Кэш принимает до 100 КБ: полный ответ (с индексом) может не влезть, тогда храним короткую отметку
      let saved = '';
      try { saved = JSON.stringify(res); } catch (e3) { saved = ''; }
      try {
        if (saved.length > 90000) saved = JSON.stringify({ ok: true, dup: true, row: res && res.row });
        cache.put(idemKey, saved, 600);
      } catch (e4) { try { cache.put(idemKey, JSON.stringify({ ok: true, dup: true }), 600); } catch (e5) { /* ignore */ } }
    }
    return res;
  } catch (err) {
    console.error(err);
    try { if (p && p.reqId) CacheService.getScriptCache().remove('idem_' + p.reqId); } catch (e2) { /* ignore */ }
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function appCols_(map, wanted) {
  const out = {};
  Object.keys(wanted).forEach(k => { out[k] = map[String(wanted[k]).trim().toUpperCase()] || null; });
  return out;
}

function appDay_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
// «Сегодня» — по часовому поясу скрипта (Алматы), а не таблицы: у таблицы пояс Катманду (+45 мин)
function appToday_() {
  let tz = 'Asia/Almaty';
  try { tz = Session.getScriptTimeZone() || tz; } catch (e) { /* в тестах нет Session.getScriptTimeZone */ }
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}
function appNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function appKey_(size, name) { return String(size).toUpperCase() + '|||' + String(name).toUpperCase(); }

// ===== ПУБЛИЧНЫЕ МЕТОДЫ (их зовёт Index.html) =====

function appInit(p) {
  return appGuard_(p, false, email => {
    return appForRole_(email, Object.assign({ ok: true, user: email }, appGetIndex_(false), appTodayPack_(p && p.date)));
  });
}

// Продавцу не отдаём партии с себестоимостью (кэш индекса общий, поэтому копируем позиции).
function appForRole_(email, res) {
  res.role = opsRole_(email);
  try {
    opsDumpCheck_(res.items || []);
    res.dump = opsDumpView_(res.items || []);
  } catch (e) { console.error(e); res.dump = []; }
  return res;
}

function appRefresh(p) {
  return appGuard_(p, false, email => {
    return appForRole_(email, Object.assign({ ok: true, user: email }, appGetIndex_(true), appTodayPack_(p && p.date)));
  });
}

function appGetSales(p) {
  return appGuard_(p, false, () => Object.assign({ ok: true }, appTodayPack_(p && p.date)));
}

function appStats(p) {
  return appGuard_(p, false, email => {
    opsNeedOwner_(email);
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const today = appToday_();
    const to = re.test(p && p.to) ? p.to : today;
    const from = re.test(p && p.from) ? p.from : to;
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const brandOf = {};
    try { appGetIndex_(false).items.forEach(it => { brandOf[it.k] = it.br; }); } catch (e) { /* без брендов */ }
    const out = { from: from, to: to, qty: 0, sum: 0, cost: 0, margin: 0, days: [], sizes: [], brands: [], pays: [], who: [],
      wo: { q: 0, cost: 0 }, ret: { q: 0, sum: 0 }, exp: null, profit: 0 };
    const byDay = {}, bySize = {}, byBrand = {}, byPay = {}, byWho = {};
    const brandName = (size, name) => {
      let br = brandOf[size + '|||' + name] || '';
      if (!br) br = name.replace(/^\([^)]*\)\s*/, '').split(/\s+/)[0] || 'Прочее';
      return String(br).toUpperCase();
    };
    const add = (o, k, q, rev, m) => { const x = o[k] || (o[k] = { n: k, q: 0, s: 0, m: 0 }); x.q += q; x.s += rev; x.m += m; };
    const addDay = (day, q, rev, m) => { const d = byDay[day] || (byDay[day] = { d: day, q: 0, s: 0, m: 0 }); d.q += q; d.s += rev; d.m += m; };
    appReadSales_(ps, tz).forEach(s => {
      if (!s.day || s.day < from || s.day > to) return;
      if (appIsWo_(s.pay)) { out.wo.q += s.qty; out.wo.cost += s.cost; return; }
      const rev = s.price * s.qty;
      out.qty += s.qty; out.sum += rev; out.cost += s.cost; out.margin += s.margin;
      addDay(s.day, s.qty, rev, s.margin);
      add(bySize, s.size, s.qty, rev, s.margin);
      add(byBrand, brandName(s.size, s.name), s.qty, rev, s.margin);
      add(byPay, s.pay || 'нал', s.qty, rev, s.margin);
      add(byWho, s.who ? String(s.who).split('@')[0] : '—', s.qty, rev, s.margin);
    });
    // возвраты клиентов: строки прихода с поставщиком «ВОЗВРАТ»
    try {
      appReturns_(from, to, tz).forEach(x => {
        const m = x.refund - x.cost;
        out.qty -= x.q; out.sum -= x.refund; out.cost -= x.cost; out.margin -= m; out.ret.q += x.q; out.ret.sum += x.refund;
        addDay(x.day, -x.q, -x.refund, -m);
        add(bySize, x.size, -x.q, -x.refund, -m);
        add(byBrand, brandName(x.size, x.name), -x.q, -x.refund, -m);
      });
    } catch (e) { console.error(e); }
    out.exp = appExpenses_(from, to, tz);
    out.profit = out.margin - out.wo.cost - out.exp.sum;
    const top = o => Object.keys(o).map(k => o[k]).filter(x => x.q > 0).sort((x, y) => y.q - x.q || y.m - x.m).slice(0, 8);
    out.days = Object.keys(byDay).sort().reverse().map(k => byDay[k]).slice(0, 31);
    out.sizes = top(bySize);
    out.brands = top(byBrand);
    out.pays = Object.keys(byPay).map(k => byPay[k]).sort((x, y) => y.s - x.s);
    out.who = Object.keys(byWho).map(k => byWho[k]).sort((x, y) => y.s - x.s);
    return { ok: true, stats: out };
  });
}

// ABC-анализ: кто даёт выручку за последние N дней; D = на складе, но продаж за период нет
function appAbc(p) {
  return appGuard_(p, false, email => {
    opsNeedOwner_(email);
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const days = [30, 60, 90, 180].indexOf(Math.round(appNum_(p && p.days))) >= 0 ? Math.round(appNum_(p.days)) : 90;
    const to = appToday_();
    const from = appDay_(new Date(Date.now() - (days - 1) * 86400000), tz);
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const stock = {};
    appGetIndex_(false).items.forEach(it => { stock[appKey_(it.s, it.n)] = it; });
    const agg = {};
    appReadSales_(ps, tz).forEach(s => {
      if (!s.day || s.day < from || s.day > to) return;
      const k = appKey_(s.size, s.name);
      const g = agg[k] || (agg[k] = { s: s.size, n: s.name, q: 0, sum: 0, m: 0 });
      g.q += s.qty; g.sum += s.price * s.qty; g.m += s.margin;
    });
    const sold = Object.keys(agg).map(k => Object.assign({ k: k }, agg[k])).sort((x, y) => y.sum - x.sum);
    const total = sold.reduce((t, x) => t + x.sum, 0);
    const cls = { A: [], B: [], C: [], D: [] };
    let cum = 0;
    sold.forEach(x => {
      cum += x.sum;
      const c = (cum - x.sum) < total * 0.8 ? 'A' : ((cum - x.sum) < total * 0.95 ? 'B' : 'C');
      const st = stock[x.k];
      cls[c].push({ k: st ? st.k : x.k, s: x.s, n: x.n, q: x.q, sum: x.sum, m: x.m, o: st ? st.o : 0, c: st ? st.c : 0 });
    });
    Object.keys(stock).forEach(k => {
      const st = stock[k];
      if (st.o > 0 && !agg[k]) cls.D.push({ k: st.k, s: st.s, n: st.n, q: 0, sum: 0, m: 0, o: st.o, c: st.c });
    });
    cls.D.sort((x, y) => y.o * y.c - x.o * x.c);
    const sum = {};
    Object.keys(cls).forEach(c => {
      const arr = cls[c];
      sum[c] = {
        n: arr.length,
        sum: arr.reduce((t, x) => t + x.sum, 0),
        margin: arr.reduce((t, x) => t + x.m, 0),
        stockQty: arr.reduce((t, x) => t + (x.o > 0 ? x.o : 0), 0),
        stockCost: arr.reduce((t, x) => t + (x.o > 0 ? x.o * x.c : 0), 0)
      };
    });
    const items = {};
    Object.keys(cls).forEach(c => { items[c] = cls[c].slice(0, c === 'D' ? 80 : 60); });
    return { ok: true, abc: { days: days, total: total, sum: sum, items: items } };
  });
}

// ===== ПРОДАЖИ: блоки дней старого листа =====
// День = оранжевая строка с датой в колонке А, ниже строки продаж, затем итоговые строки
// («процентное соотношение…»). Приложение заполняет пустую строку внутри блока дня, как вручную.

function appIsSummaryLabel_(v) {
  return /^\s*процент/i.test(String(v || ''));
}

// Найти блок дня: { head, first, sumRow } (sumRow — первая итоговая строка или строка после блока)
function appFindDayBlock_(vals, dateStr, tz) {
  const heads = [];
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] instanceof Date) heads.push(i);
  }
  for (let h = heads.length - 1; h >= 0; h--) {
    const i = heads[h];
    if (appDay_(vals[i][0], tz) !== dateStr) continue;
    const end = h + 1 < heads.length ? heads[h + 1] : vals.length;
    let sum = end;
    for (let j = i + 1; j < end; j++) { if (appIsSummaryLabel_(vals[j][0])) { sum = j; break; } }
    return { head: DATA_START_ROW + i, first: DATA_START_ROW + i + 1, sumRow: DATA_START_ROW + sum, vals: vals, base: DATA_START_ROW };
  }
  return null;
}

// Создать блок нового дня по образцу последнего: заголовок, пустые строки продаж, итоговые строки с формулами
function appCreateDayBlock_(ps, vals, dateStr, tz) {
  let lastHead = -1;
  for (let i = 0; i < vals.length; i++) if (vals[i][0] instanceof Date) lastHead = i;
  if (lastHead < 0) throw new Error('В листе ' + SHEETS.PRODAJI + ' нет ни одного блока дня, создайте первый вручную.');
  const srcFrom = DATA_START_ROW + lastHead;
  let srcTo = DATA_START_ROW + vals.length - 1;
  while (srcTo > srcFrom && vals[srcTo - DATA_START_ROW].every(x => String(x).trim() === '')) srcTo--;
  const n = srcTo - srcFrom + 1;
  const dst = srcTo + 1;
  if (dst + n > ps.getMaxRows()) ps.insertRowsAfter(ps.getMaxRows(), n + 50);
  const w = ps.getLastColumn();
  ps.getRange(srcFrom, 1, n, w).copyTo(ps.getRange(dst, 1, n, w), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  const dateObj = Utilities.parseDate(dateStr, tz, 'yyyy-MM-dd');
  ps.getRange(dst, 1).setValue(dateObj);
  ps.getRange(dst, 2).setValue(appDow_(dateObj, tz));
  // найти итоговую строку в копии
  let sumOff = n;
  for (let j = 1; j < n; j++) { if (appIsSummaryLabel_(vals[srcFrom - DATA_START_ROW + j][0])) { sumOff = j; break; } }
  // очистить строки продаж (А:D) и числа, введённые вручную, в итоговой части (формулы остаются)
  if (sumOff > 1) ps.getRange(dst + 1, 1, sumOff - 1, 4).clearContent();
  if (sumOff < n) {
    const rg = ps.getRange(dst + sumOff, 3, n - sumOff, w - 2);
    const f = rg.getFormulas(), v = rg.getValues();
    for (let r = 0; r < f.length; r++) for (let c = 0; c < f[r].length; c++) {
      if (!f[r][c] && typeof v[r][c] === 'number') rg.getCell(r + 1, c + 1).clearContent();
    }
  }
  SpreadsheetApp.flush();
  return dst;
}

// Строки для новой продажи: count подряд идущих пустых строк в блоке дня; нет места — вставляем внутри блока;
// нет блока — создаём. Возвращает номер первой строки.
function appPlaceSaleRow_(ps, tz, dateStr, count) {
  count = count || 1;
  const last = ps.getLastRow();
  let vals = last >= DATA_START_ROW ? ps.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 2).getValues() : [];
  let blk = appFindDayBlock_(vals, dateStr, tz);
  if (!blk) {
    appCreateDayBlock_(ps, vals, dateStr, tz);
    vals = ps.getRange(DATA_START_ROW, 1, ps.getLastRow() - DATA_START_ROW + 1, 2).getValues();
    blk = appFindDayBlock_(vals, dateStr, tz);
    if (!blk) throw new Error('Не удалось создать блок дня ' + dateStr + ' в листе ' + SHEETS.PRODAJI + '.');
  }
  const isFree = r => String(vals[r - blk.base][0]).trim() === '' && String(vals[r - blk.base][1]).trim() === '';
  // первая строка, с которой идёт нужная пустая серия
  for (let r = blk.first; r + count - 1 < blk.sumRow; r++) {
    let ok = true;
    for (let k = 0; k < count; k++) { if (!isFree(r + k)) { ok = false; break; } }
    if (ok) return r;
  }
  if (blk.sumRow <= blk.first) throw new Error('В блоке дня ' + dateStr + ' нет строк продаж. Добавьте строку в таблице вручную.');
  // места нет: вставляем count строк перед последней строкой блока, суммы дня захватят их
  const w = ps.getLastColumn();
  const at = Math.max(blk.first, blk.sumRow - 1);
  // образец оформления: обычная (белая) строка продажи ближе к концу блока
  let tpl = at;
  for (let r = blk.sumRow - 1, tried = 0; r >= blk.first && tried < 8; r--) {
    if (String(vals[r - blk.base][0]).trim() === '') continue;
    tried++;
    let bg = '#ffffff';
    try { bg = String(ps.getRange(r, 1).getBackground()).toLowerCase(); } catch (e) { /* оформление не критично */ }
    if (bg === '#ffffff' || bg === '') { tpl = r; break; }
  }
  ps.insertRowsBefore(at, count);
  const src = tpl >= at ? tpl + count : tpl;               // образец мог сместиться вниз
  for (let k = 0; k < count; k++) {
    ps.getRange(src, 1, 1, w).copyTo(ps.getRange(at + k, 1, 1, w), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    ps.getRange(at + k, 1, 1, 4).clearContent();
  }
  return at;
}

// Разложить сумму за комплект по позициям пропорционально их ценам; последняя позиция добирает остаток точно
function appSplitTotal_(items, total) {
  const base = items.reduce((t, x) => t + x.price * x.qty, 0);
  if (!(base > 0) || !(total > 0)) throw new Error('Не получилось разложить сумму комплекта.');
  let left = total;
  items.forEach((x, i) => {
    if (i === items.length - 1) { x.price = Math.round(left / x.qty * 100) / 100; return; }
    const share = total * (x.price * x.qty) / base;
    const unit = Math.max(100, Math.round(share / x.qty / 100) * 100);
    x.price = unit; left -= unit * x.qty;
  });
  return items;
}

// Записать значения продажи в строку, не трогая формулы СУММА/СЕБЕС/МАРЖА
function appWriteSaleCells_(ps, row, ph, priceCol, px, v, email, dateObj) {
  ps.getRange(row, ph.size).setValue(v.size);
  ps.getRange(row, ph.brand).setValue(v.name);
  ps.getRange(row, priceCol).setValue(v.price);
  ps.getRange(row, ph.qty).setValue(v.qty);
  if (px.pay) ps.getRange(row, px.pay).setValue(v.pay);
  if (px.date) ps.getRange(row, px.date).setValue(dateObj).setNumberFormat('dd.mm.yyyy');
  if (px.who) ps.getRange(row, px.who).setValue(email);
  if (px.when) ps.getRange(row, px.when).setValue(new Date()).setNumberFormat('dd.mm.yyyy HH:mm');
}

// ----- ПРОДАЖА -----
function appAddSale(p) {
  return appGuard_(p, true, email => appSaleCore_(email, p, false));
}

// Быстрая запись продажи: минимум обращений к таблице (читаем один раз шапку и последние строки, пишем строку одним вызовом)
function appFastSale_(ss, tz, email, v) {
  const ps = ss.getSheetByName(SHEETS.PRODAJI);
  const map = getHeaderMap(ps);
  const ph = resolveCols(map, PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
  let priceCol = null;
  for (let i = 0; i < PRODAJI_PRICE_HEADER_CANDIDATES.length && !priceCol; i++) priceCol = map[PRODAJI_PRICE_HEADER_CANDIDATES[i].toUpperCase()] || null;
  if (!priceCol) throw new Error('На листе ' + SHEETS.PRODAJI + ' не найдена колонка ЦЕНА.');
  const px = appCols_(map, APP_PH_EXTRA);
  const dateObj = Utilities.parseDate(v.dateStr, tz, 'yyyy-MM-dd');
  const row = appPlaceSaleRow_(ps, tz, v.dateStr);
  appWriteSaleCells_(ps, row, ph, priceCol, px, v, email, dateObj);
  appLog_(email, 'ПРОДАЖА', SHEETS.PRODAJI, row, v.size + '|||' + v.name, v.qty, v.price, [v.size, v.name, v.qty, v.price].join('|'));
  return { ok: true, row: row, fast: true };
}

// Второй шаг быстрых продаж: оформление строк и пересчёт себестоимости по FIFO.
// Приложение вызывает его одним запросом после паузы, сразу для всех продаж подряд.
function appFinishSale(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const keys = {};
    ((p && p.keys) || []).forEach(k => {
      const size = normKeyText(k.size || ''), name = normKeyText(k.name || '');
      if (size && name) keys[size + '|||' + name] = 1;
    });
    const list = Object.keys(keys);
    if (list.length) recalcFifoForKeys(list);
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test((p && p.date) || '') ? p.date : appToday_();
    const out = Object.assign({ ok: true }, appTodayPack_(dateStr));
    // «Слив»: если продали позицию с активным правилом — свежий остаток и проверка порога
    try {
      const act = opsDumpRules_().filter(r => r.st === 'АКТИВНО' && list.some(k => appKey_(k.split('|||')[0], k.split('|||')[1]) === r.k));
      if (act.length) {
        const items = appGetIndex_(true).items;
        opsDumpCheck_(items, act.map(r => r.k));
        out.dump = opsDumpView_(items);
      }
    } catch (e) { console.error(e); }
    return out;
  });
}

function appEnsureCol_(sh, header) {
  const map = getHeaderMap(sh);
  const k = String(header).toUpperCase();
  if (map[k]) return map[k];
  const col = Math.max(sh.getLastColumn(), 1) + 1;
  sh.getRange(1, col).setValue(header).setFontWeight('bold');
  return col;
}

function appSaleCore_(email, p, lite) {
  {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const size = normKeyText(p.size || '');
    const name = normKeyText(p.name || '');
    const qty = Math.round(appNum_(p.qty));
    const price = appNum_(p.price);
    if (!size || !name) throw new Error('Не выбрана позиция.');
    if (qty <= 0) throw new Error('Количество должно быть больше нуля.');
    const wo = p.kind === 'writeoff' || p.kind === 'shortage';
    if (price <= 0 && !wo) throw new Error('Укажите цену продажи.');
    const pay = p.kind === 'shortage' ? 'НЕДОСТАЧА' : wo ? 'СПИСАНИЕ' : (APP_PAYS.indexOf(p.pay) !== -1 ? p.pay : 'нал');
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appToday_();

    if (p.fast) return appFastSale_(ss, tz, email, { size: size, name: name, qty: qty, price: price, pay: pay, dateStr: dateStr });

    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const ph = resolveCols(getHeaderMap(ps), PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const priceCol = findProdajiPriceCol(ps);
    if (!priceCol) throw new Error('На листе ' + SHEETS.PRODAJI + ' не найдена колонка ЦЕНА.');
    const px = appCols_(getHeaderMap(ps), APP_PH_EXTRA);

    const row = appPlaceSaleRow_(ps, tz, dateStr);
    appWriteSaleCells_(ps, row, ph, priceCol, px, { size: size, name: name, qty: qty, price: price, pay: pay }, email, Utilities.parseDate(dateStr, tz, 'yyyy-MM-dd'));

    recalcFifoForKeys([size + '|||' + name]);
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');

    const cost = px.sebes ? appNum_(ps.getRange(row, px.sebes).getValue()) : 0;
    const margin = px.marja ? appNum_(ps.getRange(row, px.marja).getValue()) : (price * qty - cost);
    appLog_(email, 'ПРОДАЖА', SHEETS.PRODAJI, row, size + '|||' + name, qty, price, [size, name, qty, price].join('|'));

    if (lite) return { ok: true, row: row, cost: cost };
    const idx = appGetIndex_(true);
    return Object.assign({ ok: true, row: row, cost: cost, margin: wo ? -cost : margin }, idx, appTodayPack_(dateStr));
  }
}

function appUndoSale(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const ph = resolveCols(getHeaderMap(ps), PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const priceCol = findProdajiPriceCol(ps);
    const row = Math.round(appNum_(p.row));
    const logRec = appLogFind_(SHEETS.PRODAJI, row);
    if (!logRec) throw new Error('Эту продажу записали не через приложение. Удалите строку в таблице вручную.');
    const cur = [ps.getRange(row, ph.size).getValue(), ps.getRange(row, ph.brand).getValue(),
      ps.getRange(row, ph.qty).getValue(), ps.getRange(row, priceCol).getValue()].map(String).join('|');
    if (cur !== logRec.sig) throw new Error('Строка в таблице изменилась после записи. Удалите её вручную.');

    const key = String(ps.getRange(row, ph.size).getValue()) + '|||' + String(ps.getRange(row, ph.brand).getValue());
    ps.getRange(row, ph.size).clearContent(); ps.getRange(row, ph.brand).clearContent();   // формулы СУММА/СЕБЕС/МАРЖА остаются
    ps.getRange(row, priceCol).clearContent(); ps.getRange(row, ph.qty).clearContent();   // номера других строк не сдвигаются
    try {   // комментарий под этой продажей (строка с 💬) тоже убираем
      const nb = String(ps.getRange(row + 1, ph.brand).getValue());
      if (String(ps.getRange(row + 1, ph.size).getValue()).trim() === '' && nb.indexOf(APP_CM) === 0) ps.getRange(row + 1, ph.brand).clearContent();
    } catch (e) { console.error(e); }
    recalcFifoForKeys([key]);
    SpreadsheetApp.flush();
    appLogMarkUndone_(logRec.logRow);
    appLog_(email, 'ОТМЕНА ПРОДАЖИ', SHEETS.PRODAJI, row, key, '', '', cur);
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    const idx = appGetIndex_(true);
    return Object.assign({ ok: true }, idx, appTodayPack_(p.date || appToday_()));
  });
}

// Несколько позиций одной продажей (комплект), общая сумма за комплект и комментарий строкой ниже
function appAddSaleBatch(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const raw = (p.items || []).slice(0, 12);
    if (!raw.length) throw new Error('В продаже нет позиций.');
    const items = raw.map(x => {
      const size = normKeyText(x.size || ''), name = normKeyText(x.name || '');
      const qty = Math.round(appNum_(x.qty)), price = appNum_(x.price);
      if (!size || !name) throw new Error('Не выбрана позиция.');
      if (qty <= 0) throw new Error('Количество должно быть больше нуля.');
      if (price <= 0) throw new Error('Укажите цену для ' + size + '.');
      return { size: size, name: name, qty: qty, price: price };
    });
    const total = appNum_(p.total);
    if (total > 0) appSplitTotal_(items, total);
    let comment = String(p.comment || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (total > 0 && items.length > 1) comment = ('Комплект ' + total + ' ₸' + (comment ? ': ' + comment : ''));
    const pay = APP_PAYS.indexOf(p.pay) !== -1 ? p.pay : 'нал';
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appToday_();
    const dateObj = Utilities.parseDate(dateStr, tz, 'yyyy-MM-dd');
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const map = getHeaderMap(ps);
    const ph = resolveCols(map, PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const priceCol = findProdajiPriceCol(ps);
    if (!priceCol) throw new Error('На листе ' + SHEETS.PRODAJI + ' не найдена колонка ЦЕНА.');
    const px = appCols_(map, APP_PH_EXTRA);
    const need = items.length + (comment ? 1 : 0);
    const r0 = appPlaceSaleRow_(ps, tz, dateStr, need);
    const rows = [];
    items.forEach((it, k) => {
      const r = r0 + k;
      appWriteSaleCells_(ps, r, ph, priceCol, px, { size: it.size, name: it.name, qty: it.qty, price: it.price, pay: pay }, email, dateObj);
      appLog_(email, 'ПРОДАЖА', SHEETS.PRODAJI, r, it.size + '|||' + it.name, it.qty, it.price, [it.size, it.name, it.qty, it.price].join('|'));
      rows.push(r);
    });
    if (comment) {
      const cr = ps.getRange(r0 + items.length, ph.brand);
      cr.setValue(APP_CM + comment);
      try { cr.setFontStyle('italic').setFontColor('#5b636f'); } catch (e) { console.error(e); }
    }
    try { PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true'); } catch (e) { console.error(e); }
    return { ok: true, rows: rows, row: rows[0], prices: items.map(x => x.price), fast: true };
  });
}

// Правка продажи: цена и/или количество (позицию подтверждаем размером и названием)
function appEditSale(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const ph = resolveCols(getHeaderMap(ps), PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const priceCol = findProdajiPriceCol(ps);
    const row = Math.round(appNum_(p.row));
    if (row < DATA_START_ROW || row > ps.getLastRow()) throw new Error('Строка продажи не найдена.');
    const size = String(ps.getRange(row, ph.size).getValue()), name = String(ps.getRange(row, ph.brand).getValue());
    if (normKeyText(size) !== normKeyText(p.size || '') || normKeyText(name) !== normKeyText(p.name || '')) throw new Error('Строка в таблице изменилась. Обновите приложение.');
    const qty = Math.round(appNum_(p.qty)), price = appNum_(p.price);
    if (qty <= 0) throw new Error('Количество должно быть больше нуля.');
    if (price <= 0) throw new Error('Цена должна быть больше нуля.');
    const prevQty = ps.getRange(row, ph.qty).getValue(), prevPrice = ps.getRange(row, priceCol).getValue();
    ps.getRange(row, ph.qty).setValue(qty);
    ps.getRange(row, priceCol).setValue(price);
    recalcFifoForKeys([size + '|||' + name]);
    SpreadsheetApp.flush();
    appLog_(email, 'ПРАВКА', SHEETS.PRODAJI, row, size + '|||' + name, qty, price, [size, name, qty, price].join('|') );
    appLog_(email, 'ПРАВКА (было)', SHEETS.PRODAJI, row, size + '|||' + name, prevQty, prevPrice, [size, name, prevQty, prevPrice].join('|'));
    try { PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true'); } catch (e) { console.error(e); }
    return Object.assign({ ok: true, row: row }, appGetIndex_(true), appTodayPack_(p.date || appToday_()));
  });
}

// Расход дня: строка в блоке дня, красная заливка, белый текст, суммы идут минусом (как «АСЫЛДЫН работа −10 000»)
function appAddDayExpense(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const text = String(p.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    const sum = Math.round(appNum_(p.sum));
    if (!text) throw new Error('Напишите, на что расход.');
    if (!(sum > 0)) throw new Error('Сумма расхода должна быть больше нуля.');
    if (/^[=+\-@]/.test(text)) throw new Error('Текст не должен начинаться со знака = + - @.');
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appToday_();
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const map = getHeaderMap(ps);
    const ph = resolveCols(map, PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const px = appCols_(map, APP_PH_EXTRA);
    if (!px.sum || !px.sebes || !px.marja) throw new Error('На листе ПРОДАЖИ не найдены колонки СУММА, СЕБЕС, МАРЖА.');
    const r = appPlaceSaleRow_(ps, tz, dateStr, 1);
    ps.getRange(r, ph.brand).setValue(text);
    ps.getRange(r, px.sum).setValue(-sum);
    ps.getRange(r, px.sebes).setValue(0);
    ps.getRange(r, px.marja).setValue(-sum);
    const lastCol = Math.max(px.marja, px.sum, px.sebes, ph.qty);
    try { ps.getRange(r, 1, 1, lastCol).setBackground('#ea3323').setFontColor('#ffffff').setFontWeight('bold'); } catch (e) { console.error(e); }
    appLog_(email, 'РАСХОД', SHEETS.PRODAJI, r, text, '', sum, [text, sum, dateStr].join('|'));
    try { PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true'); } catch (e) { console.error(e); }
    return Object.assign({ ok: true, row: r }, appTodayPack_(dateStr));
  });
}

function appUndoDayExpense(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const ss = getSS_();
    const ps = ss.getSheetByName(SHEETS.PRODAJI);
    const map = getHeaderMap(ps);
    const ph = resolveCols(map, PRODAJI_HEADERS, SHEETS.PRODAJI, ['size', 'brand', 'qty']);
    const px = appCols_(map, APP_PH_EXTRA);
    const row = Math.round(appNum_(p.row));
    const rec = appLogFind_(SHEETS.PRODAJI, row);
    if (!rec) throw new Error('Этот расход записали не через приложение. Удалите строку в таблице вручную.');
    const text = String(ps.getRange(row, ph.brand).getValue());
    if (rec.sig.indexOf(text + '|') !== 0) throw new Error('Строка в таблице изменилась. Удалите её вручную.');
    // оформление берём у ближайшей обычной строки продажи выше
    let fmt = 0;
    for (let r = row - 1; r >= DATA_START_ROW && r > row - 40; r--) {
      if (!(ps.getRange(r, ph.qty).getValue() > 0)) continue;
      let bg = '#ffffff';
      try { bg = String(ps.getRange(r, 1).getBackground()).toLowerCase(); } catch (e) { /* ок */ }
      if (bg === '#ffffff') { fmt = r; break; }
    }
    ps.getRange(row, ph.brand).clearContent();
    if (px.sum && px.sebes && px.marja && fmt) {
      ['sum', 'sebes', 'marja'].forEach(k => {
        const f = ps.getRange(fmt, px[k]).getFormula();
        if (f) ps.getRange(row, px[k]).setFormulaR1C1(ps.getRange(fmt, px[k]).getFormulaR1C1());
        else ps.getRange(row, px[k]).clearContent();
      });
      appCopyFormat_(ps, fmt, row);
    }
    SpreadsheetApp.flush();
    appLogMarkUndone_(rec.logRow);
    appLog_(email, 'ОТМЕНА РАСХОДА', SHEETS.PRODAJI, row, text, '', '', rec.sig);
    try { PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true'); } catch (e) { console.error(e); }
    return Object.assign({ ok: true }, appTodayPack_(p.date || appToday_()));
  });
}

// Расходы дня, записанные приложением
function appDayExpenses_(ps, day) {
  const sh = appLogSheet_();
  const last = sh.getLastRow();
  const out = [];
  if (last < 2) return out;
  const from = Math.max(2, last - 600);
  const v = sh.getRange(from, 1, last - from + 1, 10).getValues();
  const map = {};
  v.forEach(r => {
    if (r[3] !== SHEETS.PRODAJI || r[2] !== 'РАСХОД') return;
    if (r[9]) { delete map[r[4]]; return; }
    map[r[4]] = { t: r[0], text: String(r[5]), sum: appNum_(r[7]), sig: String(r[8]) };
  });
  let tz = 'Asia/Almaty';
  try { tz = Session.getScriptTimeZone() || tz; } catch (e) { /* в тестах нет */ }
  Object.keys(map).forEach(k => {
    const x = map[k];
    if (x.sig.split('|').pop() !== day) return;
    out.push({ row: Number(k), text: x.text, sum: x.sum, t: x.t instanceof Date ? Utilities.formatDate(x.t, tz, 'HH:mm') : '' });
  });
  return out;
}

// ----- ПРИХОД -----
function appAddPurchase(p) {
  return appGuard_(p, true, email => appPurchaseCore_(email, p, false));
}

function appPurchaseCore_(email, p, lite) {
  {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const size = normKeyText(p.size || '');
    const name = normKeyText(p.name || '');
    const tip = normKeyText(p.tip || '');
    const supplier = normKeyText(p.supplier || '');
    const qty = Math.round(appNum_(p.qty));
    const cur = p.cur === 'USD' ? 'USD' : 'KZT';
    const cost = appNum_(p.cost), usd = appNum_(p.usd), rate = appNum_(p.rate);
    const exp = appNum_(p.exp);
    const markup = p.markup === '' || p.markup == null ? APP_DEFAULT_MARKUP : appNum_(p.markup);
    const manual = appNum_(p.manual);
    if (!size || !name) throw new Error('Укажите размер и название.');
    if (!supplier) throw new Error('Выберите поставщика.');
    if (qty <= 0) throw new Error('Количество должно быть больше нуля.');
    if (cur === 'USD' && (usd <= 0 || rate <= 0)) throw new Error('Укажите цену в долларах и курс.');
    if (cur === 'KZT' && cost <= 0) throw new Error('Укажите цену закупки.');
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appToday_();
    const dateObj = Utilities.parseDate(dateStr, tz, 'yyyy-MM-dd');

    const zs = ss.getSheetByName(SHEETS.ZAKUP);
    const zmap = getHeaderMap(zs);
    const zh = resolveCols(zmap, ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand', 'qty', 'cost', 'costFull', 'cashPrice', 'tip']);
    const zx = appCols_(zmap, APP_ZH_EXTRA);
    if (!zx.date || !zx.supplier || !zx.usd || !zx.rate || !zx.exp || !zx.markup) {
      throw new Error('На листе ЗАКУПКИ не найдены колонки: ДАТА ПРИХОДА, SUPPLIER, ЦЕНА ($), КУРС, РАСХОДЫ, НАЦЕН.');
    }

    const r = appNextRow_(zs, zh.size, zh.brand);
    if (r <= DATA_START_ROW) throw new Error('В журнале приходов нет ни одной строки-образца. Выполните перенос данных.');
    const tplRow = r - 1;                                   // последняя строка с данными — образец формул

    appCopyFormat_(zs, tplRow, r);
    const wx = appCols_(zmap, APP_ZH_WHO);
    zs.getRange(r, zx.date).setValue(dateObj).setNumberFormat('dd.mm.yyyy');
    if (wx.who) zs.getRange(r, wx.who).setValue(email);
    if (wx.when) zs.getRange(r, wx.when).setValue(new Date()).setNumberFormat('dd.mm.yyyy HH:mm');
    zs.getRange(r, zx.supplier).setValue(supplier);
    zs.getRange(r, zh.size).setValue(size);
    zs.getRange(r, zh.brand).setValue(name);
    if (tip) zs.getRange(r, zh.tip).setValue(tip);
    zs.getRange(r, zh.qty).setValue(qty);

    const L = n => colLetter(n);
    if (cur === 'USD') {
      zs.getRange(r, zx.usd).setValue(usd);
      zs.getRange(r, zx.rate).setValue(rate);
      zs.getRange(r, zh.cost).setFormula('=' + L(zx.usd) + r + '*' + L(zx.rate) + r);
    } else {
      zs.getRange(r, zx.usd).clearContent();
      zs.getRange(r, zx.rate).clearContent();
      zs.getRange(r, zh.cost).setValue(cost);
    }
    if (exp > 0) zs.getRange(r, zx.exp).setValue(exp); else zs.getRange(r, zx.exp).clearContent();
    zs.getRange(r, zx.markup).setValue(markup);
    if (manual > 0) {
      zs.getRange(r, zh.cashPrice).setValue(manual);
    } else {
      zs.getRange(r, zh.cashPrice).setFormula('=CEILING(' + L(zh.cost) + r + '+(' + L(zh.cost) + r + '*' + L(zx.markup) + r + '),1000)+900');
    }
    // служебные формулы строки (сумма, под ключ, маржа, Kaspi...) — как в пустых строках-шаблонах
    appFillMissingFormulas_(zs, tplRow, r, zh, zx);

    recalcFifoForKeys([size + '|||' + name]);
    try { fillArtikulZakupki(); } catch (e) { console.error(e); }
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');

    const outCost = appNum_(zs.getRange(r, zh.costFull).getValue());
    const outPrice = appNum_(zs.getRange(r, zh.cashPrice).getValue());
    appLog_(email, 'ПРИХОД', SHEETS.ZAKUP, r, size + '|||' + name, qty, outCost, [size, name, qty, supplier].join('|'));

    if (p.extra) {
      Object.keys(p.extra).forEach(h => { zs.getRange(r, appEnsureCol_(zs, h)).setValue(p.extra[h]); });
    }
    if (lite) return { ok: true, row: r, costFull: outCost, price: outPrice };
    const idx = appGetIndex_(true);
    return Object.assign({ ok: true, row: r, costFull: outCost, price: outPrice }, idx, appTodayPack_(p.saleDate));
  }
}

function appUndoPurchase(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const zs = ss.getSheetByName(SHEETS.ZAKUP);
    const zmap = getHeaderMap(zs);
    const zh = resolveCols(zmap, ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand', 'qty', 'cost', 'costFull', 'cashPrice', 'tip']);
    const zx = appCols_(zmap, APP_ZH_EXTRA);
    const row = Math.round(appNum_(p.row));
    const logRec = appLogFind_(SHEETS.ZAKUP, row);
    if (!logRec) throw new Error('Этот приход записали не через приложение. Удалите строку в таблице вручную.');
    const cur = [zs.getRange(row, zh.size).getValue(), zs.getRange(row, zh.brand).getValue(),
      zs.getRange(row, zh.qty).getValue(), zs.getRange(row, zx.supplier).getValue()].map(String).join('|');
    if (cur !== logRec.sig) throw new Error('Строка в таблице изменилась после записи. Удалите её вручную.');
    if (zh.remainFifo) {
      const remain = appNum_(zs.getRange(row, zh.remainFifo).getValue());
      const qty = appNum_(zs.getRange(row, zh.qty).getValue());
      if (remain < qty) throw new Error('Партия уже частично продана. Отмена невозможна.');
    }
    const key = String(zs.getRange(row, zh.size).getValue()) + '|||' + String(zs.getRange(row, zh.brand).getValue());
    // очищаем только вводимые ячейки А:J, РАСХОДЫ и НАЦЕН; формулы К..T остаются, как в пустых строках-шаблонах
    zs.getRange(row, 1, 1, 10).clearContent();
    if (zx.exp) zs.getRange(row, zx.exp).clearContent();
    zs.getRange(row, zh.cost).setFormula('=' + colLetter(zx.usd) + row + '*' + colLetter(zx.rate) + row);
    if (zx.markup) zs.getRange(row, zx.markup).setValue(APP_DEFAULT_MARKUP);
    zs.getRange(row, zh.cashPrice).setFormula('=CEILING(' + colLetter(zh.cost) + row + '+(' + colLetter(zh.cost) + row + '*' + colLetter(zx.markup) + row + '),1000)+900');
    recalcFifoForKeys([key]);
    SpreadsheetApp.flush();
    appLogMarkUndone_(logRec.logRow);
    appLog_(email, 'ОТМЕНА ПРИХОДА', SHEETS.ZAKUP, row, key, '', '', cur);
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    return Object.assign({ ok: true }, appGetIndex_(true));
  });
}



function appFillMissingFormulas_(zs, tplRow, r, zh, zx) {
  if (tplRow === r) return;
  for (let c = 11; c <= 20; c++) {                       // K..T: сумма, под ключ, маржа, Kaspi, НАИМ
    const cell = zs.getRange(r, c);
    if (cell.getFormula() === '' && c !== zh.cashPrice && c !== zx.markup) {
      const tf = zs.getRange(tplRow, c).getFormulaR1C1();
      if (tf) cell.setFormulaR1C1(tf);
    }
  }
}


// ===== ЖУРНАЛЫ: общие помощники =====


// Скопировать оформление (форматы чисел, шрифты) из строки-образца
var APP_DOW_ = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function appDow_(d, tz) {
  const i = Number(Utilities.formatDate(d, tz, 'u')) % 7; // 1=пн ... 7=вс
  return APP_DOW_[i];
}

// Строка-заголовок дня в стиле старого листа ПРОДАЖИ: оранжевая дата + синий день недели
function appWriteDayHeader_(sh, row, dateObj) {
  appClearRowFormat_(sh, row);
  sh.getRange(row, 1).setValue(dateObj).setNumberFormat('dd.mm.yy').setBackground('#ff9900').setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange(row, 2).setValue(appDow_(dateObj, getSS_().getSpreadsheetTimeZone())).setBackground('#1c4587').setFontColor('#ffffff').setFontWeight('bold');
}

function appClearRowFormat_(sh, row) {
  try {
    const w = Math.max(sh.getLastColumn(), 14);
    sh.getRange(row, 1, 1, w).setBackground(null).setFontColor('#000000').setFontWeight('normal').setNumberFormat('General');
  } catch (e) { /* оформление не критично */ }
}

// Хвост журнала продаж: следующая свободная строка, дата последнего блока, последняя строка с продажей
function appSalesTail_(sh, sizeCol, brandCol, tz) {
  const last = sh.getLastRow();
  let lastRow = DATA_START_ROW - 1, lastSale = 0, lastDay = '';
  if (last >= DATA_START_ROW) {
    const n = last - DATA_START_ROW + 1;
    const a = sh.getRange(DATA_START_ROW, sizeCol, n, 1).getValues();
    const b = sh.getRange(DATA_START_ROW, brandCol, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      const av = a[i][0];
      if (av instanceof Date) { lastRow = DATA_START_ROW + i; lastDay = appDay_(av, tz); continue; }
      if (String(av).trim() === '' || String(b[i][0]).trim() === '') continue;
      lastRow = DATA_START_ROW + i; lastSale = lastRow;
    }
  }
  const next = lastRow + 1;
  if (next + 6 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1000);
  return { next: next, lastDay: lastDay, lastSale: lastSale };
}

function appCopyFormat_(sh, fromRow, toRow) {
  if (!fromRow || fromRow < DATA_START_ROW || fromRow === toRow) return;
  try {
    const w = sh.getLastColumn();
    sh.getRange(fromRow, 1, 1, w).copyTo(sh.getRange(toRow, 1, 1, w), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } catch (e) { /* оформление не критично */ }
}

// Первая свободная строка после последней строки с данными (размер и название заполнены)
function appNextRow_(sh, sizeCol, brandCol) {
  const last = sh.getLastRow();
  let lastData = DATA_START_ROW - 1;
  if (last >= DATA_START_ROW) {
    const n = last - DATA_START_ROW + 1;
    const a = sh.getRange(DATA_START_ROW, sizeCol, n, 1).getValues();
    const b = sh.getRange(DATA_START_ROW, brandCol, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      if (String(a[i][0]).trim() !== '' && String(b[i][0]).trim() !== '') lastData = DATA_START_ROW + i;
    }
  }
  const row = lastData + 1;
  if (row + 5 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1000);
  return row;
}

// Все строки продаж одним списком. Работает и с новым журналом (колонка ДАТА),
// и со старым листом (блоки дней со строкой даты) — пока данные не перенесены.
function appReadSales_(ps, tz) {
  const map = getHeaderMap(ps);
  const ph = resolveCols(map, PRODAJI_HEADERS, ps.getName(), ['size', 'brand', 'qty']);
  const priceCol = findProdajiPriceCol(ps);
  const px = appCols_(map, APP_PH_EXTRA);
  const last = ps.getLastRow();
  const out = [];
  if (last < DATA_START_ROW) return out;
  const w = ps.getLastColumn();
  const v = ps.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, w).getValues();
  let curMs = 0, curStr = '';
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    const a = r[ph.size - 1];
    if (a instanceof Date) { curMs = a.getTime(); curStr = appDay_(a, tz); continue; }
    const size = String(a || '').trim(), name = String(r[ph.brand - 1] || '').trim();
    const qty = appNum_(r[ph.qty - 1]);
    if (!size || !name || qty <= 0) continue;
    let ms = curMs, ds = curStr;
    if (px.date) {
      const d = r[px.date - 1];
      if (d instanceof Date) { ms = d.getTime(); ds = appDay_(d, tz); }
    }
    const price = appNum_(r[priceCol - 1]);
    const cost = px.sebes ? appNum_(r[px.sebes - 1]) : 0;
    const pay0 = px.pay ? String(r[px.pay - 1] || '') : '';
    const margin = appIsWo_(pay0) ? -cost : (px.marja ? appNum_(r[px.marja - 1]) : (price * qty - cost));
    out.push({
      cm: (i + 1 < v.length && !(v[i + 1][ph.size - 1] instanceof Date) && String(v[i + 1][ph.size - 1]).trim() === '' && String(v[i + 1][ph.brand - 1]).indexOf(APP_CM) === 0) ? String(v[i + 1][ph.brand - 1]).slice(APP_CM.length) : '',
      row: DATA_START_ROW + i, size: size, name: name, qty: qty, price: price, cost: cost, margin: margin,
      ms: ms, day: ds, sig: [r[ph.size - 1], r[ph.brand - 1], r[ph.qty - 1], r[priceCol - 1]].map(String).join('|'),
      who: px.who ? String(r[px.who - 1] || '') : '',
      pay: px.pay ? String(r[px.pay - 1] || '') : ''
    });
  }
  return out;
}

// ===== ИНДЕКС (кэш) =====

function appGetIndex_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const metaRaw = cache.get('APPIDX_meta');
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw);
        const keys = [];
        for (let i = 0; i < meta.n; i++) keys.push('APPIDX_' + meta.ver + '_' + i);
        const parts = cache.getAll(keys);
        let ok = true, s = '';
        for (let i = 0; i < meta.n; i++) { const c = parts[keys[i]]; if (c == null) { ok = false; break; } s += c; }
        if (ok) return JSON.parse(s);
      } catch (e) { /* пересоберём */ }
    }
  }
  const data = appBuildIndex_();
  try {
    const s = JSON.stringify(data);
    const ver = String(Date.now());
    const obj = {};
    let n = 0;
    for (let i = 0; i < s.length; i += APP_CHUNK) { obj['APPIDX_' + ver + '_' + n] = s.substr(i, APP_CHUNK); n++; }
    cache.putAll(obj, APP_CACHE_TTL + 60);
    cache.put('APPIDX_meta', JSON.stringify({ ver: ver, n: n }), APP_CACHE_TTL);
  } catch (e) { console.error(e); }
  return data;
}

function appBuildIndex_() {
  const ss = getSS_();
  const tz = ss.getSpreadsheetTimeZone();
  const zs = ss.getSheetByName(SHEETS.ZAKUP);
  const ps = ss.getSheetByName(SHEETS.PRODAJI);
  const os = ss.getSheetByName(SHEETS.OSTATKI);
  const bs = ss.getSheetByName(SHEETS.BAZA);

  const zmap = getHeaderMap(zs);
  const zh = resolveCols(zmap, ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand', 'qty', 'costFull', 'cashPrice', 'tip']);
  const zx = appCols_(zmap, APP_ZH_EXTRA);
  const items = {};
  const order = [];
  const supCount = {};
  let lastRate = 0;
  const dayMs = 86400000;
  const now = Date.now();

  // --- ЗАКУПКИ ---
  const zLast = zs.getLastRow();
  const zVals = zLast >= DATA_START_ROW
    ? zs.getRange(DATA_START_ROW, 1, zLast - DATA_START_ROW + 1, zs.getLastColumn()).getValues() : [];
  zVals.forEach((row, idx) => {
    const size = normKeyText(row[zh.size - 1] || '');
    const name = normKeyText(row[zh.brand - 1] || '');
    if (!size || !name) return;
    const key = appKey_(size, name);
    let it = items[key];
    if (!it) {
      it = items[key] = { k: size + '|||' + name, s: size, n: name, t: '', z: 0, p: 0, o: 0, c: 0, pr: 0, ka: 0, qr: 0,
        sup: '', art: '', ld: 0, ls: 0, s30: 0, mk: 0, b: [], _b: [] };
      order.push(key);
    }
    const qty = appNum_(row[zh.qty - 1]);
    it.z += qty;
    const sup0 = zx.supplier ? String(row[zx.supplier - 1] || '').trim() : '';
    if (appIsSpecialSup_(sup0)) {
      const d0 = zx.date ? row[zx.date - 1] : null;
      if (qty > 0) {
        const rem0 = zh.remainFifo && row[zh.remainFifo - 1] !== '' ? appNum_(row[zh.remainFifo - 1]) : qty;
        it._b.push({ ms: d0 instanceof Date ? d0.getTime() : 0, idx: idx, sup: sup0, rem: rem0, cost: appNum_(row[zh.costFull - 1]) });
      }
      return;
    }
    it.c = appNum_(row[zh.costFull - 1]);
    it.pr = appNum_(row[zh.cashPrice - 1]);
    if (zh.kaspi) it.ka = appNum_(row[zh.kaspi - 1]);
    if (zx.qr) it.qr = appNum_(row[zx.qr - 1]);
    const tip = String(row[zh.tip - 1] || '').trim();
    if (tip) it.t = tip;
    const sup = zx.supplier ? String(row[zx.supplier - 1] || '').trim() : '';
    if (sup) it.sup = sup;
    const art = zh.art ? String(row[zh.art - 1] || '').trim() : '';
    if (art) it.art = art;
    if (zx.markup) { const mk = appNum_(row[zx.markup - 1]); if (mk) it.mk = mk; }
    const d = zx.date ? row[zx.date - 1] : null;
    const dms = d instanceof Date ? d.getTime() : 0;
    if (dms > it.ld) it.ld = dms;
    if (qty > 0) {
      const rem = zh.remainFifo && row[zh.remainFifo - 1] !== '' ? appNum_(row[zh.remainFifo - 1]) : qty;
      it._b.push({ ms: dms || 0, idx: idx, sup: sup, rem: rem, cost: appNum_(row[zh.costFull - 1]) });
    }
    if (sup && sup !== 'ОСТАТКИ' && dms && now - dms < 120 * dayMs) supCount[sup] = (supCount[sup] || 0) + 1;
    if (zx.rate) { const rt = appNum_(row[zx.rate - 1]); if (rt > 0 && dms >= 0) lastRate = rt; }
  });

  // --- ПРОДАЖИ ---
  let unmatched = 0;
  appReadSales_(ps, tz).forEach(sale => {
    const it = items[appKey_(normKeyText(sale.size), normKeyText(sale.name))];
    if (!it) { unmatched += sale.qty; return; }
    it.p += sale.qty;
    if (appIsWo_(sale.pay)) return;
    if (sale.ms > it.ls) it.ls = sale.ms;
    if (sale.ms && now - sale.ms < 30 * dayMs) it.s30 += sale.qty;
  });

  // --- ОСТАТКИ: анализ Kaspi (W:AA) ---
  const kasp = {};
  const oLast = os.getLastRow();
  if (oLast >= DATA_START_ROW) {
    const oVals = os.getRange(DATA_START_ROW, 1, oLast - DATA_START_ROW + 1, Math.max(KASPI_WRITE_COL_URL + 2, 27)).getValues();
    oVals.forEach(r => {
      const s = normKeyText(r[0] || ''), n = normKeyText(r[1] || '');
      if (!s || !n) return;
      kasp[appKey_(s, n)] = {
        km: appNum_(r[KASPI_WRITE_COL_MIN - 1]), kv: appNum_(r[KASPI_WRITE_COL_AVG - 1]),
        ku: String(r[KASPI_WRITE_COL_URL - 1] || ''), ks: String(r[26] || '')
      };
    });
  }

  const list = order.map(key => {
    const it = items[key];
    it.o = it.z - it.p;
    it._b.sort((x, y) => (x.ms - y.ms) || (x.idx - y.idx));
    it.b = it._b.filter(b => b.rem > 0).map(b => [b.ms, b.sup, b.rem, b.cost]);
    delete it._b;
    const kk = kasp[key];
    if (kk) { it.km = kk.km; it.kv = kk.kv; it.ku = kk.ku; it.ks = kk.ks; }
    return it;
  });

  const suppliers = Object.keys(supCount).sort((a, b) => supCount[b] - supCount[a]);
  return {
    items: list,
    meta: { ts: now, rate: lastRate || 0, suppliers: suppliers, unmatchedSales: unmatched, tz: tz }
  };
}

function appPhotoUrl_(u) {
  u = String(u || '').trim();
  if (!u) return '';
  const m = u.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+?)(\?.*)?$/);
  if (m) return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3];
  return u;
}

// ===== Продажи дня + последние приходы =====

function appTodayPack_(dateStr) {
  const ss = getSS_();
  const tz = ss.getSpreadsheetTimeZone();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : appToday_();
  return { sales: appSalesOfDay_(day, tz) };
}

function appSalesOfDay_(day, tz) {
  const ss = getSS_();
  const ps = ss.getSheetByName(SHEETS.PRODAJI);
  const out = { date: day, exists: true, rows: [], qty: 0, sum: 0, cost: 0, margin: 0 };
  const logs = appLogMap_(SHEETS.PRODAJI);
  let times = {};
  try { times = appLogTimes_(SHEETS.PRODAJI); } catch (e) { console.error(e); }
  appReadSales_(ps, tz).forEach(s => {
    if (s.day !== day) return;
    out.rows.push({ cm: s.cm || '', t: times[s.row] || '', row: s.row, s: s.size, n: s.name, q: s.qty, pr: s.price, c: s.cost, m: s.margin, u: logs[s.row] === s.sig, w: s.who, y: s.pay });
    if (appIsWo_(s.pay)) { out.margin += s.margin; return; }
    out.qty += s.qty; out.sum += s.price * s.qty; out.cost += s.cost; out.margin += s.margin;
  });
  try { out.exp = appDayExpenses_(ps, day); out.expSum = out.exp.reduce((t, x) => t + x.sum, 0); } catch (e) { out.exp = []; out.expSum = 0; console.error(e); }
  try {
    appReturns_(day, day, tz).forEach(x => {
      out.rows.push({ row: x.row, s: x.size, n: x.name, q: x.q, pr: x.q ? x.refund / x.q : 0, c: x.cost, m: -(x.refund - x.cost), u: x.u, w: '', y: 'ВОЗВРАТ', ret: 1 });
      out.qty -= x.q; out.sum -= x.refund; out.cost -= x.cost; out.margin -= (x.refund - x.cost);
    });
  } catch (e) { console.error(e); }
  return out;
}

function appRecentPurchases_(tz) {
  const ss = getSS_();
  const zs = ss.getSheetByName(SHEETS.ZAKUP);
  const zmap = getHeaderMap(zs);
  const zh = resolveCols(zmap, ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand', 'qty', 'costFull', 'cashPrice', 'tip']);
  const zx = appCols_(zmap, APP_ZH_EXTRA);
  const last = zs.getLastRow();
  const from = Math.max(DATA_START_ROW, last - 260);
  const n = last - from + 1;
  const v = zs.getRange(from, 1, n, zs.getLastColumn()).getValues();
  const logs = appLogMap_(SHEETS.ZAKUP);
  const out = [];
  for (let i = n - 1; i >= 0 && out.length < 15; i--) {
    const r = v[i];
    const size = String(r[zh.size - 1] || '').trim(), name = String(r[zh.brand - 1] || '').trim();
    if (!size || !name) continue;
    const row = from + i;
    const d = zx.date ? r[zx.date - 1] : null;
    const sup = zx.supplier ? String(r[zx.supplier - 1] || '') : '';
    const sig = [r[zh.size - 1], r[zh.brand - 1], r[zh.qty - 1], zx.supplier ? r[zx.supplier - 1] : ''].map(String).join('|');
    const remain = zh.remainFifo ? appNum_(r[zh.remainFifo - 1]) : null;
    out.push({
      row: row, d: d instanceof Date ? appDay_(d, tz) : '', sup: sup, s: size, n: name, t: String(r[zh.tip - 1] || ''),
      q: appNum_(r[zh.qty - 1]), c: appNum_(r[zh.costFull - 1]), pr: appNum_(r[zh.cashPrice - 1]),
      u: logs[row] === sig && (remain === null || remain >= appNum_(r[zh.qty - 1]))
    });
  }
  return out;
}



// Возвраты клиентов за период (строки ПРИХОДЫ с поставщиком «ВОЗВРАТ»)
function appReturns_(from, to, tz) {
  const ss = getSS_();
  const zs = ss.getSheetByName(SHEETS.ZAKUP);
  const out = [];
  const zmap = getHeaderMap(zs);
  const zh = resolveCols(zmap, ZAKUP_HEADERS, SHEETS.ZAKUP, ['size', 'brand', 'qty']);
  const zx = appCols_(zmap, APP_ZH_EXTRA);
  const cR = zmap['ВОЗВРАТ ₸/ШТ'], cC = zmap['ВОЗВРАТ СС/ШТ'];
  const zl = zs.getLastRow();
  if (!zx.supplier || !zx.date || !cR || zl < DATA_START_ROW) return out;
  const logs = appLogMap_(SHEETS.ZAKUP);
  zs.getRange(DATA_START_ROW, 1, zl - DATA_START_ROW + 1, zs.getLastColumn()).getValues().forEach((r, i) => {
    if (String(r[zx.supplier - 1]).trim() !== 'ВОЗВРАТ') return;
    const d = r[zx.date - 1];
    const day = d instanceof Date ? appDay_(d, tz) : '';
    if (!day || day < from || day > to) return;
    const q = appNum_(r[zh.qty - 1]);
    const row = DATA_START_ROW + i;
    const sig = [r[zh.size - 1], r[zh.brand - 1], r[zh.qty - 1], r[zx.supplier - 1]].map(String).join('|');
    out.push({ row: row, day: day, size: normKeyText(r[zh.size - 1] || ''), name: normKeyText(r[zh.brand - 1] || ''), q: q,
      refund: appNum_(r[cR - 1]) * q, cost: cC ? appNum_(r[cC - 1]) * q : 0, u: logs[row] === sig });
  });
  return out;
}

// ===== ВОЗВРАТ, СПИСАНИЕ, ИНВЕНТАРИЗАЦИЯ =====

function appFindItem_(size, name) {
  const key = appKey_(normKeyText(size || ''), normKeyText(name || ''));
  const items = appGetIndex_(false).items;
  for (let i = 0; i < items.length; i++) { if (appKey_(items[i].s, items[i].n) === key) return items[i]; }
  return null;
}

// Возврат от клиента: шины возвращаются на склад (приход «ВОЗВРАТ»), выручка и маржа в итогах уменьшаются
function appAddReturn(p) {
  return appGuard_(p, true, email => {
    const qty = Math.round(appNum_(p.qty)), refund = appNum_(p.refund), unitCost = appNum_(p.unitCost);
    if (qty <= 0) throw new Error('Укажите, сколько штук вернули.');
    if (refund < 0) throw new Error('Сумма возврата не может быть отрицательной.');
    const it = appFindItem_(p.size, p.name);
    if (!it) throw new Error('Позиция не найдена на складе.');
    const cost = it.c > 0 ? it.c : unitCost;
    if (!(cost > 0)) throw new Error('Не известна себестоимость позиции.');
    const res = appPurchaseCore_(email, {
      size: it.s, name: it.n, tip: it.t, supplier: 'ВОЗВРАТ', qty: qty, cur: 'KZT', cost: cost, exp: 0,
      markup: it.mk || APP_DEFAULT_MARKUP, manual: it.pr || 0, date: p.date,
      extra: { 'ВОЗВРАТ ₸/шт': refund, 'ВОЗВРАТ СС/шт': unitCost > 0 ? unitCost : cost }
    }, true);
    return Object.assign({ ok: true, row: res.row }, appGetIndex_(true), appTodayPack_(p.saleDate || p.date));
  });
}

// Списание: брак, подарок, потеря. Идёт как продажа с ценой 0 (себестоимость уходит в убыток)
function appAddWriteoff(p) {
  return appGuard_(p, true, email => {
    const it = appFindItem_(p.size, p.name);
    if (!it) throw new Error('Позиция не найдена на складе.');
    return appSaleCore_(email, { size: it.s, name: it.n, qty: p.qty, price: 0, kind: 'writeoff', date: p.date }, false);
  });
}

// Инвентаризация: rows = [{size, name, fact}]. Излишек оформляется приходом, недостача списанием
function appApplyInventory(p) {
  return appGuard_(p, true, email => {
    const rows = (p && p.rows) || [];
    if (!rows.length) throw new Error('Нет расхождений для записи.');
    let plus = 0, minus = 0, plusQty = 0, minusQty = 0, minusCost = 0;
    const skipped = [];
    rows.forEach(r => {
      const it = appFindItem_(r.size, r.name);
      const fact = Math.round(appNum_(r.fact));
      if (!it || fact < 0) { skipped.push(r.size); return; }
      const diff = fact - it.o;
      if (diff > 0) {
        if (!(it.c > 0)) { skipped.push(it.s + ' (нет себестоимости)'); return; }
        appPurchaseCore_(email, {
          size: it.s, name: it.n, tip: it.t, supplier: 'ИНВЕНТАРИЗАЦИЯ', qty: diff, cur: 'KZT', cost: it.c, exp: 0,
          markup: it.mk || APP_DEFAULT_MARKUP, manual: it.pr || 0, date: p.date
        }, true);
        plus++; plusQty += diff;
      } else if (diff < 0) {
        const res = appSaleCore_(email, { size: it.s, name: it.n, qty: -diff, price: 0, kind: 'shortage', date: p.date }, true);
        minus++; minusQty += -diff; minusCost += appNum_(res.cost);
      }
    });
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    return Object.assign({ ok: true, plus: plus, minus: minus, plusQty: plusQty, minusQty: minusQty, minusCost: minusCost, skipped: skipped },
      appGetIndex_(true), appTodayPack_(p.date));
  });
}

// ===== РАСХОДЫ =====

function appExpSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(APP_EXP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(APP_EXP_SHEET);
    sh.getRange(1, 1, 1, 8).setValues([['ДАТА', 'КАТЕГОРИЯ', 'СУММА', 'КОММЕНТАРИЙ', 'КТО', 'ВРЕМЯ ЗАПИСИ', 'СЧЁТ', 'ЧЕК']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appExpenses_(from, to, tz) {
  const sh = getSS_().getSheetByName(APP_EXP_SHEET);
  const out = { sum: 0, cats: [], rows: [] };
  if (!sh || sh.getLastRow() < 2) return out;
  const logs = appLogMap_(APP_EXP_SHEET);
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  const byCat = {};
  v.forEach((r, i) => {
    const d = r[0], sum = appNum_(r[2]);
    if (!(d instanceof Date) || !(sum > 0)) return;
    const day = appDay_(d, tz);
    if (day < from || day > to) return;
    const cat = String(r[1] || 'Другое');
    out.sum += sum;
    const c = byCat[cat] || (byCat[cat] = { n: cat, s: 0 });
    c.s += sum;
    const row = i + 2;
    out.rows.push({ row: row, d: day, cat: cat, sum: sum, note: String(r[3] || ''), acc: String(r[6] || ''), f: String(r[7] || ''), u: logs[row] === [cat, sum, day].join('|') });
  });
  out.cats = Object.keys(byCat).map(k => byCat[k]).sort((a, b) => b.s - a.s);
  out.rows.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : b.row - a.row));
  out.rows = out.rows.slice(0, 40);
  return out;
}

function appAddExpense(p) {
  return appGuard_(p, true, email => {
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const sum = Math.round(appNum_(p.sum));
    if (!(sum > 0)) throw new Error('Укажите сумму расхода.');
    const cat = String(p.cat || 'Другое').trim().slice(0, 40) || 'Другое';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appToday_();
    const sh = appExpSheet_();
    const row = Math.max(sh.getLastRow() + 1, 2);
    opsNeedOwner_(email);
    const acc = String(p.acc || '').trim().slice(0, 30);
    const file = /^https:\/\/(drive|docs)\.google\.com\//.test(p.file || '') ? String(p.file) : '';
    sh.getRange(row, 1, 1, 8).setValues([[Utilities.parseDate(day, tz, 'yyyy-MM-dd'), cat, sum, String(p.note || '').slice(0, 200), email, new Date(), acc, file]]);
    if (acc) opsMove_(email, day, acc, -sum, 'РАСХОД', cat + (p.note ? ' · ' + p.note : ''), file, 'EX' + row);
    sh.getRange(row, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(row, 3).setNumberFormat('#,##0');
    sh.getRange(row, 6).setNumberFormat('dd.mm.yyyy HH:mm');
    appLog_(email, 'РАСХОД', APP_EXP_SHEET, row, cat, '', sum, [cat, sum, day].join('|'));
    return { ok: true, row: row, exp: appExpenses_(p.from || day, p.to || day, tz) };
  });
}

function appUndoExpense(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const tz = getSS_().getSpreadsheetTimeZone();
    const sh = appExpSheet_();
    const row = Math.round(appNum_(p.row));
    const logRec = appLogFind_(APP_EXP_SHEET, row);
    if (!logRec) throw new Error('Этот расход записали не через приложение. Удалите строку в таблице вручную.');
    const r = sh.getRange(row, 1, 1, 3).getValues()[0];
    const cur = [String(r[1]), appNum_(r[2]), r[0] instanceof Date ? appDay_(r[0], tz) : ''].join('|');
    if (cur !== logRec.sig) throw new Error('Строка в таблице изменилась после записи. Удалите её вручную.');
    sh.getRange(row, 1, 1, 8).clearContent();
    opsUnmoveByLink_('EX' + row);
    appLogMarkUndone_(logRec.logRow);
    return { ok: true, exp: appExpenses_(p.from, p.to, tz) };
  });
}

function appGetExpenses(p) {
  return appGuard_(p, false, email => {
    opsNeedOwner_(email);
    const tz = getSS_().getSpreadsheetTimeZone();
    const today = appToday_();
    return { ok: true, exp: appExpenses_((p && p.from) || today, (p && p.to) || today, tz) };
  });
}

// ===== ЖУРНАЛ =====

function appLogSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(APP_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(APP_LOG_SHEET);
    sh.getRange(1, 1, 1, 10).setValues([['Время', 'Пользователь', 'Действие', 'Лист', 'Строка', 'Позиция', 'Кол-во', 'Цена', 'Подпись строки', 'Отменено']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appLog_(email, action, sheetName, row, key, qty, price, sig) {
  const sh = appLogSheet_();
  sh.appendRow([new Date(), email, action, sheetName, row, key, qty, price, sig, '']);
}

function appLogMap_(sheetName) {
  const sh = appLogSheet_();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  const from = Math.max(2, last - 400);
  const v = sh.getRange(from, 1, last - from + 1, 10).getValues();
  v.forEach(r => {
    if (r[3] !== sheetName || (r[2] !== 'ПРОДАЖА' && r[2] !== 'ПРИХОД' && r[2] !== 'РАСХОД' && r[2] !== 'ПРАВКА')) return;
    if (r[9]) { delete map[r[4]]; return; }
    map[r[4]] = String(r[8]);
  });
  return map;
}

// Время записи продажи из APP_ЖУРНАЛ: строка листа -> «ЧЧ:мм» (по поясу скрипта)
function appLogTimes_(sheetName) {
  const sh = appLogSheet_();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  const from = Math.max(2, last - 600);
  let tz = 'Asia/Almaty';
  try { tz = Session.getScriptTimeZone() || tz; } catch (e) { /* в тестах нет */ }
  sh.getRange(from, 1, last - from + 1, 10).getValues().forEach(r => {
    if (r[3] !== sheetName || r[2] !== 'ПРОДАЖА') return;
    if (r[9]) { delete map[r[4]]; return; }
    if (r[0] instanceof Date) map[r[4]] = Utilities.formatDate(r[0], tz, 'HH:mm');
  });
  return map;
}

function appLogFind_(sheetName, row) {
  const sh = appLogSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const from = Math.max(2, last - 400);
  const v = sh.getRange(from, 1, last - from + 1, 10).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    const r = v[i];
    if (r[3] === sheetName && Number(r[4]) === row && (r[2] === 'ПРОДАЖА' || r[2] === 'ПРИХОД' || r[2] === 'РАСХОД' || r[2] === 'ПРАВКА')) {
      if (r[9]) return null;
      return { logRow: from + i, sig: String(r[8]) };
    }
  }
  return null;
}

function appLogMarkUndone_(logRow) {
  appLogSheet_().getRange(logRow, 10).setValue(new Date());
}

// ===== ПЕРЕНОС ДАННЫХ В НОВЫЕ ЛИСТЫ =====
// Запускается один раз из меню. Старые листы ЗАКУПКИ и ПРОДАЖИ НЕ меняются (остаются архивом).

function appMigrateUi() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'Перенос данных',
    'Будут созданы листы ПРИХОДЫ и ПРОДАЖИ_ЖУРНАЛ, в них скопируются все данные из ЗАКУПКИ и ПРОДАЖИ.\n' +
    'Старые листы не изменятся и останутся архивом. Дальше остатки, FIFO и АНАЛИЗАТОР будут считаться из новых листов.\n\n' +
    'Перед этим лучше сделать копию файла. Продолжить?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  try {
    const r = appMigrate();
    ui.alert(
      'Перенос выполнен',
      'Перенесено приходов: ' + r.purchases + '\nПеренесено продаж: ' + r.sales + '\n\n' +
      'Теперь нажмите в меню «🔄 Обновить всё сейчас», чтобы остатки и АНАЛИЗАТОР пересобрались из новых листов.',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Перенос не выполнен', String(e && e.message ? e.message : e), ui.ButtonSet.OK);
  }
}

// Копирование из листа с фильтром приносит фильтр и скрытые строки: без этого setFrozenRows падает (L-016)
function appClearFilter_(sh) {
  try { const f = sh.getFilter(); if (f) f.remove(); } catch (e) { /* нет фильтра */ }
  try { sh.showRows(1, sh.getMaxRows()); } catch (e) { /* не критично */ }
}

// Копия листа без фильтра и скрытых строк (copyTo с отфильтрованного листа копирует только видимое)
function appTempCopy_(ss, sh) {
  const c = sh.copyTo(ss);
  c.setName('_tmp_' + Date.now());
  appClearFilter_(c);
  return c;
}

function appMigrate() {
  const ss = getSS_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const created = [];
  let tmpZ = null;
  try {
    const srcZ = ss.getSheetByName('ЗАКУПКИ');
    const oldP = ss.getSheetByName('ПРОДАЖИ');
    if (!srcZ || !oldP) throw new Error('Не найдены старые листы ЗАКУПКИ и ПРОДАЖИ.');
    if (ss.getSheetByName(APP_NEW_ZAKUP) || ss.getSheetByName(APP_NEW_PRODAJI)) {
      throw new Error('Листы ' + APP_NEW_ZAKUP + ' и/или ' + APP_NEW_PRODAJI + ' уже существуют. Перенос уже выполнялся. ' +
        'Чтобы повторить, удалите эти два листа вручную и запустите перенос снова.');
    }
    const tz = ss.getSpreadsheetTimeZone();
    PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());

    // ---------- ПРИХОДЫ (копия ЗАКУПКИ без пустых строк и разделителей дат) ----------
    // copyTo с листа, где включён фильтр, переносит только видимые строки (L-017): работаем с копией без фильтра
    tmpZ = appTempCopy_(ss, srcZ);
    const oldZ = tmpZ;
    const zmap = getHeaderMap(oldZ);
    const zh = resolveCols(zmap, ZAKUP_HEADERS, 'ЗАКУПКИ', ['size', 'brand', 'qty']);
    const wz = oldZ.getLastColumn();
    const zLast = oldZ.getLastRow();
    const nz = ss.insertSheet(APP_NEW_ZAKUP);
    created.push(nz);
    appEnsureSize_(nz, 3000, wz + 3);
    oldZ.getRange(1, 1, 1, wz).copyTo(nz.getRange(1, 1, 1, wz));
    nz.getRange(1, wz + 1, 1, 2).setValues([['КТО', 'ВРЕМЯ ЗАПИСИ']]).setFontWeight('bold');
    const zv = zLast >= DATA_START_ROW ? oldZ.getRange(DATA_START_ROW, 1, zLast - DATA_START_ROW + 1, wz).getValues() : [];
    let dest = DATA_START_ROW, purchases = 0, runStart = -1;
    const flushZ = endIdx => {
      if (runStart < 0) return;
      const len = endIdx - runStart;
      oldZ.getRange(DATA_START_ROW + runStart, 1, len, wz).copyTo(nz.getRange(dest, 1, len, wz));
      dest += len; purchases += len; runStart = -1;
    };
    for (let i = 0; i < zv.length; i++) {
      const ok = String(zv[i][zh.size - 1]).trim() !== '' && String(zv[i][zh.brand - 1]).trim() !== '' && appNum_(zv[i][zh.qty - 1]) > 0;
      if (ok) { if (runStart < 0) runStart = i; } else flushZ(i);
    }
    flushZ(zv.length);
    if (purchases > 0) nz.getRange(DATA_START_ROW, wz + 1, purchases, 1).setValue('перенос');
    nz.getRange(2, 1).setValue('ЖУРНАЛ ПРИХОДОВ: одна партия = одна строка. Строки добавляет приложение, ниже 4-й строки ничего не вставляйте.');
    nz.getRange(3, 1).setValue('Данные перенесены из листа ЗАКУПКИ (архив): ' + appToday_());
    if (zh.qty) nz.getRange(2, zh.qty).setFormula('=SUM(' + colLetter(zh.qty) + DATA_START_ROW + ':' + colLetter(zh.qty) + ')');
    const sumCol = zmap['СУММА ЗАКУПА'];
    if (sumCol) nz.getRange(2, sumCol).setFormula('=SUM(' + colLetter(sumCol) + DATA_START_ROW + ':' + colLetter(sumCol) + ')');
    appClearFilter_(nz);
    nz.setFrozenRows(3);

    // ---------- ПРОДАЖИ_ЖУРНАЛ (плоский список: одна продажа = одна строка с датой) ----------
    const pmap = getHeaderMap(oldP);
    const ph = resolveCols(pmap, PRODAJI_HEADERS, 'ПРОДАЖИ', ['size', 'brand', 'qty']);
    const priceCol = findProdajiPriceCol(oldP);
    if (!priceCol) throw new Error('В листе ПРОДАЖИ не найдена колонка ЦЕНА.');
    const px = appCols_(pmap, APP_PH_EXTRA);
    const tipCol = pmap['ТИП'] || null;
    const fCost = pmap[PRODAJI_FIFO_COST_HEADER.toUpperCase()] || null;
    const fUnit = pmap[PRODAJI_FIFO_UNIT_COST_HEADER.toUpperCase()] || null;
    const fMar = pmap[PRODAJI_MARGIN_HEADER.toUpperCase()] || null;
    const wp = oldP.getLastColumn();
    const pLast = oldP.getLastRow();
    const pv = pLast >= DATA_START_ROW ? oldP.getRange(DATA_START_ROW, 1, pLast - DATA_START_ROW + 1, wp).getValues() : [];
    const pick = (r, c) => (c ? r[c - 1] : '');
    const items = [];
    let curDate = '';
    pv.forEach(r => {
      const a = r[ph.size - 1];
      if (a instanceof Date) { curDate = a; return; }
      const size = normKeyText(a || ''), name = normKeyText(r[ph.brand - 1] || '');
      const qty = appNum_(r[ph.qty - 1]);
      if (!size || !name || qty <= 0) return;
      items.push({ date: curDate, vals: [size, name, pick(r, priceCol), qty, pick(r, tipCol), '', pick(r, px.sebes), pick(r, px.marja),
        curDate, 'перенос', '', pick(r, fCost), pick(r, fUnit), pick(r, fMar)] });
    });
    const rows = items;
    const np = ss.insertSheet(APP_NEW_PRODAJI);
    created.push(np);
    appEnsureSize_(np, items.length + 3000, 16);
    np.getRange(1, 1, 1, 14).setValues([['РАЗМЕР', 'НАИМЕНОВАНИЕ', 'ЦЕНА', 'КОЛ', 'ТИП', 'СУММА', 'СЕБЕС', 'МАРЖА', 'ДАТА', 'КТО', 'ВРЕМЯ ЗАПИСИ',
      PRODAJI_FIFO_COST_HEADER, PRODAJI_FIFO_UNIT_COST_HEADER, PRODAJI_MARGIN_HEADER]]).setFontWeight('bold');
    appWriteSalesBlocks_(np, items, tz);
    np.getRange(2, 1).setValue('ЖУРНАЛ ПРОДАЖ: одна продажа = одна строка. Строки добавляет приложение, ниже 4-й строки ничего не вставляйте.');
    np.getRange(3, 1).setValue('Данные перенесены из листа ПРОДАЖИ (архив): ' + appToday_());
    ['D', 'F', 'G', 'H'].forEach(L => np.getRange(2, L.charCodeAt(0) - 64).setFormula('=SUM(' + L + DATA_START_ROW + ':' + L + ')'));
    appClearFilter_(np);
    np.setFrozenRows(3);

    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    CacheService.getScriptCache().remove('APPIDX_meta');
    return { purchases: purchases, sales: items.length };
  } catch (e) {
    created.forEach(sh => { try { ss.deleteSheet(sh); } catch (e2) { /* ignore */ } });
    throw e;
  } finally {
    try { if (tmpZ) ss.deleteSheet(tmpZ); } catch (e3) { /* ignore */ }
    lock.releaseLock();
  }
}

// Пишет продажи блоками по дням (как в старом листе ПРОДАЖИ). items: [{date: Date|'', vals: [14 колонок]}]
// в нужном порядке. Возвращает массив новых номеров строк для каждой продажи.
function appWriteSalesBlocks_(np, items, tz) {
  const out = [], headerRows = [], saleRows = [], pos = [];
  let curDay = null;
  items.forEach(it => {
    const day = it.date instanceof Date ? appDay_(it.date, tz) : '';
    if (day && day !== curDay) {
      const hr = DATA_START_ROW + out.length;
      const h = new Array(14).fill('');
      h[0] = it.date;
      h[1] = appDow_(it.date, tz);
      out.push(h); headerRows.push(hr);
    }
    if (day) curDay = day;
    const r = DATA_START_ROW + out.length;
    const v = it.vals.slice();
    v[5] = '=D' + r + '*C' + r;
    out.push(v); saleRows.push(r); pos.push(r);
  });
  if (!out.length) return pos;
  appEnsureSize_(np, DATA_START_ROW + out.length + 3000, 16);
  np.getRange(DATA_START_ROW, 1, out.length, 14).setValues(out);
  np.getRange(DATA_START_ROW, 9, out.length, 1).setNumberFormat('dd.mm.yyyy');
  if (headerRows.length) {
    const A1 = headerRows.map(r => 'A' + r), B1 = headerRows.map(r => 'B' + r);
    try {
      np.getRangeList(A1).setNumberFormat('dd.mm.yy').setBackground('#ff9900').setFontWeight('bold').setHorizontalAlignment('left');
      np.getRangeList(B1).setBackground('#1c4587').setFontColor('#ffffff').setFontWeight('bold');
    } catch (e) { /* оформление не критично */ }
  }
  return pos;
}

// Меню: починить подписи дней недели (#ERROR!) в уже созданном журнале продаж
function appFixDayNamesUi() {
  const ui = SpreadsheetApp.getUi();
  try { ui.alert('Готово', 'Исправлено дней: ' + appFixDayNames(), ui.ButtonSet.OK); }
  catch (e) { ui.alert('Не получилось', String(e && e.message ? e.message : e), ui.ButtonSet.OK); }
}

function appFixDayNames() {
  const ss = getSS_();
  const ps = ss.getSheetByName(APP_NEW_PRODAJI);
  if (!ps) throw new Error('Лист ' + APP_NEW_PRODAJI + ' не найден.');
  const tz = ss.getSpreadsheetTimeZone();
  const last = ps.getLastRow();
  if (last < DATA_START_ROW) return 0;
  const n = last - DATA_START_ROW + 1;
  const a = ps.getRange(DATA_START_ROW, 1, n, 1).getValues();
  const b = ps.getRange(DATA_START_ROW, 2, n, 1).getValues();
  let c = 0;
  for (let i = 0; i < n; i++) if (a[i][0] instanceof Date) { b[i][0] = appDow_(a[i][0], tz); c++; }
  ps.getRange(DATA_START_ROW, 2, n, 1).setValues(b);
  return c;
}

// Меню: перегруппировать уже существующий плоский журнал продаж в блоки по дням.
function appRelayoutSalesUi() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = appRelayoutSales();
    ui.alert('Готово', r.already ? 'Журнал уже разбит на дни, менять нечего.' :
      'Журнал продаж перегруппирован по дням: ' + r.sales + ' продаж, ' + r.days + ' дней.', ui.ButtonSet.OK);
  } catch (e) { ui.alert('Не получилось', String(e && e.message ? e.message : e), ui.ButtonSet.OK); }
}

function appRelayoutSales() {
  const ss = getSS_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ps = ss.getSheetByName(APP_NEW_PRODAJI);
    if (!ps) throw new Error('Лист ' + APP_NEW_PRODAJI + ' не найден.');
    const tz = ss.getSpreadsheetTimeZone();
    const map = getHeaderMap(ps);
    const ph = resolveCols(map, PRODAJI_HEADERS, APP_NEW_PRODAJI, ['size', 'brand', 'qty']);
    const px = appCols_(map, APP_PH_EXTRA);
    if (!px.date) throw new Error('В листе нет колонки ДАТА.');
    const last = ps.getLastRow();
    if (last < DATA_START_ROW) return { already: true };
    const w = Math.max(ps.getLastColumn(), 14);
    const v = ps.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, w).getValues();
    if (v.some(r => r[ph.size - 1] instanceof Date)) return { already: true };
    const items = [];
    v.forEach((r, i) => {
      if (!String(r[ph.size - 1]).trim() || !String(r[ph.brand - 1]).trim() || appNum_(r[ph.qty - 1]) <= 0) return;
      const d = r[px.date - 1];
      const vals = r.slice(0, w);
      while (vals.length < 14) vals.push('');
      items.push({ date: d instanceof Date ? d : '', vals: vals, ms: d instanceof Date ? d.getTime() : 0, old: DATA_START_ROW + i, i: i });
    });
    items.sort((x, y) => (x.ms - y.ms) || (x.i - y.i));
    ps.getRange(DATA_START_ROW, 1, ps.getMaxRows() - DATA_START_ROW + 1, w).clear();
    const pos = appWriteSalesBlocks_(ps, items, tz);
    const remap = {};
    items.forEach((it, k) => { remap[it.old] = pos[k]; });
    // номера строк в журнале действий
    const lg = appLogSheet_();
    const ll = lg.getLastRow();
    if (ll >= 2) {
      const rng = lg.getRange(2, 1, ll - 1, 10);
      const lv = rng.getValues();
      let changed = false;
      lv.forEach(r => {
        if (r[3] === APP_NEW_PRODAJI && remap[Number(r[4])]) { r[4] = remap[Number(r[4])]; changed = true; }
      });
      if (changed) rng.setValues(lv);
    }
    PropertiesService.getScriptProperties().setProperty('needsRebuild', 'true');
    CacheService.getScriptCache().remove('APPIDX_meta');
    let days = 0, prev = '';
    items.forEach(it => { const d = it.date ? appDay_(it.date, tz) : ''; if (d && d !== prev) { days++; prev = d; } });
    return { sales: items.length, days: days };
  } finally {
    lock.releaseLock();
  }
}

function appEnsureSize_(sh, minRows, minCols) {
  if (sh.getMaxRows() < minRows) sh.insertRowsAfter(sh.getMaxRows(), minRows - sh.getMaxRows());
  if (sh.getMaxColumns() < minCols) sh.insertColumnsAfter(sh.getMaxColumns(), minCols - sh.getMaxColumns());
}
