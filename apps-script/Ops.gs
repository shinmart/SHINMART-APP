/**
 * ШИНМАРТ · Этап 1 «Деньги»: настройки, роли, счета, вложения.
 * Отдельный файл рядом с WebApp.gs. Использует его общие функции (appGuard_, appLog_, appNum_, appDay_).
 *
 * Данные лежат в простых листах, чтобы потом их можно было целиком перенести в базу:
 *   НАСТРОЙКИ      — способы оплаты, категории расходов, роли
 *   СЧЕТА          — кошельки и счета с начальным остатком
 *   ДВИЖЕНИЕ_ДЕНЕГ — каждое движение денег одной строкой (остаток = начальный + сумма движений)
 */

const OPS_SET_SHEET = 'НАСТРОЙКИ';
const OPS_ACC_SHEET = 'СЧЕТА';
const OPS_MOV_SHEET = 'ДВИЖЕНИЕ_ДЕНЕГ';
const OPS_FOLDER_NAME = 'ШИНМАРТ · вложения';

const OPS_DEF_PAYS = [['нал', 0, 0, 'Касса'], ['QR', 0.95, 1, 'Kaspi'], ['Kaspi', 1, 1, 'Kaspi'], ['рассрочка', 12, 7, 'Kaspi']];
const OPS_DEF_CATS = ['Аренда', 'Зарплата', 'Реклама', 'Доставка', 'Налоги', 'Другое'];
const OPS_DEF_ACCS = [['Касса', 'наличные', 0], ['Kaspi', 'банк', 0]];

// ---------- листы ----------

function opsSettingsSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(OPS_SET_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(OPS_SET_SHEET);
  sh.getRange(1, 1, 1, 4).setValues([['ОПЛАТА', 'КОМИССИЯ %', 'ДНЕЙ ДО ЗАЧИСЛЕНИЯ', 'СЧЁТ']]);
  sh.getRange(2, 1, OPS_DEF_PAYS.length, 4).setValues(OPS_DEF_PAYS);
  sh.getRange(1, 6).setValue('КАТЕГОРИИ РАСХОДОВ');
  sh.getRange(2, 6, OPS_DEF_CATS.length, 1).setValues(OPS_DEF_CATS.map(c => [c]));
  sh.getRange(1, 8, 1, 2).setValues([['ПОЧТА', 'РОЛЬ (владелец / продавец)']]);
  sh.getRange(1, 1, 1, 9).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function opsAccSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(OPS_ACC_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(OPS_ACC_SHEET);
  sh.getRange(1, 1, 1, 3).setValues([['СЧЁТ', 'ТИП', 'НАЧАЛЬНЫЙ ОСТАТОК']]).setFontWeight('bold');
  sh.getRange(2, 1, OPS_DEF_ACCS.length, 3).setValues(OPS_DEF_ACCS);
  sh.setFrozenRows(1);
  return sh;
}

function opsMovSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(OPS_MOV_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(OPS_MOV_SHEET);
  sh.getRange(1, 1, 1, 10).setValues([['ДАТА', 'СЧЁТ', 'СУММА', 'ВИД', 'ОПИСАНИЕ', 'ФАЙЛ', 'КТО', 'ВРЕМЯ ЗАПИСИ', 'СВЯЗЬ', 'ОТМЕНЕНО']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// Разовая подготовка: создаёт листы и папку для вложений. Запускать из меню.
function opsPrepare() {
  opsSettingsSheet_(); opsAccSheet_(); opsMovSheet_();
  opsFolder_();
  try { SpreadsheetApp.getUi().alert('Готово: листы НАСТРОЙКИ, СЧЕТА, ДВИЖЕНИЕ_ДЕНЕГ и папка вложений созданы.'); } catch (e) { /* не из меню */ }
}

// ---------- настройки и роли ----------

function opsReadSettings_() {
  const sh = opsSettingsSheet_();
  const last = Math.max(sh.getLastRow(), 2);
  const v = sh.getRange(2, 1, last - 1, 9).getValues();
  const pays = [], cats = [], roles = {};
  v.forEach(r => {
    const n = String(r[0] || '').trim();
    if (n) pays.push({ n: n, fee: appNum_(r[1]), days: Math.round(appNum_(r[2])), acc: String(r[3] || '').trim() });
    const c = String(r[5] || '').trim();
    if (c) cats.push(c);
    const m = String(r[7] || '').trim().toLowerCase();
    if (m) roles[m] = /прод/i.test(String(r[8] || '')) ? 'seller' : 'owner';
  });
  return { pays: pays, cats: cats.length ? cats : OPS_DEF_CATS.slice(), roles: roles };
}

// Роль по почте. Если почты нет в таблице ролей — владелец (чтобы ничего не сломалось у тех, кто уже работает).
function opsRole_(email, st) {
  st = st || opsReadSettings_();
  return st.roles[String(email || '').toLowerCase()] || 'owner';
}

function opsNeedOwner_(email) {
  if (opsRole_(email) !== 'owner') throw new Error('Это действие доступно только владельцу.');
}

function opsPayInfo_(st, pay) {
  const p = st.pays.filter(x => x.n.toLowerCase() === String(pay || '').toLowerCase())[0];
  return p || { n: pay, fee: 0, days: 0, acc: '' };
}

// ---------- счета ----------

function opsAccounts_() {
  const as = opsAccSheet_();
  const aLast = as.getLastRow();
  const accs = [];
  if (aLast >= 2) as.getRange(2, 1, aLast - 1, 3).getValues().forEach(r => {
    const n = String(r[0] || '').trim();
    if (n) accs.push({ n: n, t: String(r[1] || ''), bal: appNum_(r[2]) });
  });
  const ms = opsMovSheet_();
  const mLast = ms.getLastRow();
  if (mLast >= 2) ms.getRange(2, 1, mLast - 1, 10).getValues().forEach(r => {
    if (r[9]) return;
    const a = accs.filter(x => x.n === String(r[1]))[0];
    if (a) a.bal += appNum_(r[2]);
  });
  return accs;
}

// Движение денег. Возвращает номер строки.
function opsMove_(email, day, acc, sum, kind, note, fileUrl, link) {
  const tz = getSS_().getSpreadsheetTimeZone();
  const sh = opsMovSheet_();
  const row = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(row, 1, 1, 10).setValues([[Utilities.parseDate(day, tz, 'yyyy-MM-dd'), acc, sum, kind, String(note || '').slice(0, 200), fileUrl || '', email, new Date(), link || '', '']]);
  sh.getRange(row, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(row, 3).setNumberFormat('#,##0');
  sh.getRange(row, 8).setNumberFormat('dd.mm.yyyy HH:mm');
  return row;
}

function opsUnmoveByLink_(link) {
  const sh = opsMovSheet_();
  const last = sh.getLastRow();
  if (last < 2 || !link) return;
  const v = sh.getRange(2, 9, last - 1, 2).getValues();
  const now = new Date();
  v.forEach((r, i) => { if (String(r[0]) === link && !r[1]) sh.getRange(i + 2, 10).setValue(now); });
}

// ---------- вложения (фото чеков и накладных) ----------

function opsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('OPS_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* создадим заново */ } }
  const f = DriveApp.createFolder(OPS_FOLDER_NAME);
  props.setProperty('OPS_FOLDER_ID', f.getId());
  return f;
}

// Принимает фото (base64) и кладёт в папку по месяцам. Возвращает ссылку.
function appUploadFile(p) {
  return appGuard_(p, true, email => {
    const b64 = String(p.b64 || '');
    if (!b64) throw new Error('Файл пустой.');
    if (b64.length > 6 * 1024 * 1024) throw new Error('Файл слишком большой (больше ~4 МБ). Сделайте фото поменьше.');
    const mime = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(p.mime) ? p.mime : 'image/jpeg';
    const tz = getSS_().getSpreadsheetTimeZone();
    const month = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    const root = opsFolder_();
    const it = root.getFoldersByName(month);
    const dir = it.hasNext() ? it.next() : root.createFolder(month);
    const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const name = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmmss') + '_' + String(p.kind || 'чек').replace(/[^\wА-Яа-яЁё-]/g, '').slice(0, 20) + '.' + ext;
    const file = dir.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, name));
    // Остальные аккаунты приложения должны видеть чек: даём просмотр тем, кто имеет Google-аккаунт
    APP_ALLOWED.forEach(a => {
      const m = String(a).toLowerCase();
      if (m === email || /POCHTA_PAPY/i.test(m) || /@icloud\.com$/.test(m)) return;
      try { file.addViewer(m); } catch (e) { /* аккаунт не Google или нет прав — пропускаем */ }
    });
    appLog_(email, 'ВЛОЖЕНИЕ', 'ФАЙЛ', 0, name, '', '', file.getId());
    return { ok: true, url: file.getUrl(), name: name };
  });
}

// ---------- публичные методы ----------

function appOpsInit(p) {
  return appGuard_(p, false, email => {
    const st = opsReadSettings_();
    const role = opsRole_(email, st);
    const out = { ok: true, role: role, pays: st.pays, cats: st.cats };
    if (role === 'owner') out.accs = opsAccounts_();
    return out;
  });
}

// Сохранить настройки: способы оплаты, категории, счета. Только владелец.
function appSaveSettings(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const sh = opsSettingsSheet_();
    const clean = s => String(s || '').trim().slice(0, 40);
    const pays = (p.pays || []).map(x => [clean(x.n), Math.max(0, Math.min(50, appNum_(x.fee))), Math.max(0, Math.min(60, Math.round(appNum_(x.days)))), clean(x.acc)]).filter(x => x[0]);
    const cats = (p.cats || []).map(clean).filter(Boolean);
    if (!pays.length) throw new Error('Нужен хотя бы один способ оплаты.');
    if (!cats.length) throw new Error('Нужна хотя бы одна категория расходов.');
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).clearContent();
    sh.getRange(2, 1, pays.length, 4).setValues(pays);
    sh.getRange(2, 6, Math.max(sh.getMaxRows() - 1, 1), 1).clearContent();
    sh.getRange(2, 6, cats.length, 1).setValues(cats.map(c => [c]));
    appLog_(email, 'НАСТРОЙКИ', OPS_SET_SHEET, 0, '', '', '', '');
    const st = opsReadSettings_();
    return { ok: true, pays: st.pays, cats: st.cats };
  });
}

// Добавить счёт (кошелёк). Только владелец.
function appAddAccount(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const n = String(p.n || '').trim().slice(0, 30);
    if (!n) throw new Error('Введите название счёта.');
    if (opsAccounts_().some(a => a.n.toLowerCase() === n.toLowerCase())) throw new Error('Такой счёт уже есть.');
    const sh = opsAccSheet_();
    sh.appendRow([n, String(p.t || 'банк').slice(0, 20), Math.round(appNum_(p.bal))]);
    appLog_(email, 'СЧЁТ', OPS_ACC_SHEET, sh.getLastRow(), n, '', '', '');
    return { ok: true, accs: opsAccounts_() };
  });
}

// Перевод между счетами (например, из Kaspi в кассу).
function appTransfer(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const tz = getSS_().getSpreadsheetTimeZone();
    const sum = Math.round(appNum_(p.sum));
    if (!(sum > 0)) throw new Error('Укажите сумму перевода.');
    const accs = opsAccounts_().map(a => a.n);
    if (accs.indexOf(p.from) < 0 || accs.indexOf(p.to) < 0) throw new Error('Выберите оба счёта.');
    if (p.from === p.to) throw new Error('Счета должны быть разными.');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : appDay_(new Date(), tz);
    const link = 'TR' + Date.now();
    opsMove_(email, day, p.from, -sum, 'ПЕРЕВОД', 'на ' + p.to + (p.note ? ' · ' + p.note : ''), '', link);
    opsMove_(email, day, p.to, sum, 'ПЕРЕВОД', 'с ' + p.from + (p.note ? ' · ' + p.note : ''), '', link);
    appLog_(email, 'ПЕРЕВОД', OPS_MOV_SHEET, 0, p.from + '→' + p.to, '', sum, link);
    return { ok: true, accs: opsAccounts_() };
  });
}

// Ручная корректировка остатка: «в кассе по факту X» → записывает разницу.
function appAdjustAccount(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const tz = getSS_().getSpreadsheetTimeZone();
    const a = opsAccounts_().filter(x => x.n === p.acc)[0];
    if (!a) throw new Error('Счёт не найден.');
    const fact = Math.round(appNum_(p.fact));
    const diff = fact - Math.round(a.bal);
    if (diff !== 0) opsMove_(email, appDay_(new Date(), tz), a.n, diff, 'КОРРЕКТИРОВКА', p.note || 'пересчёт по факту', '', 'AD' + Date.now());
    return { ok: true, accs: opsAccounts_(), diff: diff };
  });
}

// Деньги, которые ещё в пути: продажи безналом за последние дни, срок зачисления которых не прошёл.
function opsPending_(tz, st) {
  const ps = getSS_().getSheetByName(SHEETS.PRODAJI);
  const out = { sum: 0, fee: 0, items: [] };
  if (!ps) return out;
  const today = new Date();
  const fromDay = appDay_(new Date(today.getTime() - 40 * 864e5), tz);
  const byPay = {};
  appReadSales_(ps, tz).forEach(s => {
    if (!s.day || s.day < fromDay || appIsWo_(s.pay)) return;
    const info = opsPayInfo_(st, s.pay || 'нал');
    if (!(info.days > 0)) return;
    const due = new Date(Utilities.parseDate(s.day, tz, 'yyyy-MM-dd').getTime() + info.days * 864e5);
    if (due <= today) return;
    const rev = s.price * s.qty;
    const x = byPay[info.n] || (byPay[info.n] = { n: info.n, s: 0, fee: 0, due: '' });
    x.s += rev; x.fee += rev * info.fee / 100;
    const dd = appDay_(due, tz);
    if (!x.due || dd > x.due) x.due = dd;
    out.sum += rev; out.fee += rev * info.fee / 100;
  });
  out.items = Object.keys(byPay).map(k => byPay[k]);
  return out;
}

// Комиссия банков за период по продажам и сумма «ждём зачисления».
function appBankInfo(p) {
  return appGuard_(p, false, email => {
    opsNeedOwner_(email);
    const ss = getSS_();
    const tz = ss.getSpreadsheetTimeZone();
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const to = re.test(p && p.to) ? p.to : appDay_(new Date(), tz);
    const from = re.test(p && p.from) ? p.from : to;
    const st = opsReadSettings_();
    const byPay = {};
    let fee = 0;
    appReadSales_(ss.getSheetByName(SHEETS.PRODAJI), tz).forEach(s => {
      if (!s.day || s.day < from || s.day > to || appIsWo_(s.pay)) return;
      const info = opsPayInfo_(st, s.pay || 'нал');
      const rev = s.price * s.qty, f = rev * info.fee / 100;
      const x = byPay[info.n] || (byPay[info.n] = { n: info.n, s: 0, fee: 0 });
      x.s += rev; x.fee += f; fee += f;
    });
    return { ok: true, fee: Math.round(fee), pays: Object.keys(byPay).map(k => { const x = byPay[k]; return { n: x.n, s: Math.round(x.s), fee: Math.round(x.fee) }; }), pending: opsPending_(tz, st) };
  });
}

// Продавцу не отдаём себестоимость и маржу ни в каком ответе: вычищаем перед отправкой.
function opsScrub_(email, res) {
  if (!res || typeof res !== 'object') return res;
  let role = 'owner';
  try { role = opsRole_(email); } catch (e) { return res; }
  if (role !== 'seller') return res;
  const walk = (o, key) => {
    if (Array.isArray(o)) return o.map(x => walk(x, key));
    if (!o || typeof o !== 'object') return o;
    const c = {};
    Object.keys(o).forEach(k => {
      if (k === 'b' || k === 'kv' || k === 'cost' || k === 'margin' || k === 'profit' || k === 'c' || k === 'm') {
        c[k] = Array.isArray(o[k]) ? [] : 0;
      } else c[k] = walk(o[k], k);
    });
    return c;
  };
  return walk(res, '');
}

// ===== СЛИВ: «продаю по низкой цене, пока не останется N шт» =====
// Лист СЛИВ: одно правило на позицию. АКТИВНО → когда остаток дошёл до порога → СТОП (один раз письмо) → владелец снимает или ставит новое.

const OPS_DUMP_SHEET = 'СЛИВ';

function opsDumpSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(OPS_DUMP_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(OPS_DUMP_SHEET);
  sh.getRange(1, 1, 1, 10).setValues([['КЛЮЧ', 'РАЗМЕР', 'МОДЕЛЬ', 'СТОП (ОСТАТОК)', 'ЦЕНА СЛИВА', 'ОСТАТОК НА СТАРТЕ', 'СОЗДАНО', 'КТО', 'СТАТУС', 'УВЕДОМЛЕНО']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function opsDumpRules_() {
  const sh = opsDumpSheet_();
  const last = sh.getLastRow();
  const out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 10).getValues().forEach((r, i) => {
    const st = String(r[8] || '');
    if (!r[0] || !st || st === 'СНЯТО') return;
    out.push({ row: i + 2, k: String(r[0]), s: String(r[1]), n: String(r[2]), stop: appNum_(r[3]), price: appNum_(r[4]), start: appNum_(r[5]), st: st });
  });
  return out;
}

function opsDumpItem_(items, key) {
  for (let i = 0; i < items.length; i++) { if (appKey_(items[i].s, items[i].n) === key) return items[i]; }
  return null;
}

// Письмо владельцам (в приложении сигнал и так виден). Ошибка отправки не должна ломать продажу.
function opsDumpMail_(rule, left) {
  try {
    const to = APP_ALLOWED.filter(a => !/example\.com|POCHTA/i.test(a) && opsRole_(String(a).toLowerCase()) === 'owner').join(',');
    if (!to) return;
    MailApp.sendEmail(to, 'ШИНМАРТ: хватит сливать ' + rule.s,
      rule.s + ' · ' + rule.n + '\nОсталось ' + left + ' шт (порог ' + rule.stop + '). Перестаньте продавать по цене слива' + (rule.price ? ' (' + rule.price + ' ₸)' : '') + '.');
  } catch (e) { console.error(e); }
}

// Проверка правил по текущим остаткам. onlyKeys — проверить только эти позиции (после продажи).
function opsDumpCheck_(items, onlyKeys) {
  const hit = [];
  const sh = opsDumpSheet_();
  opsDumpRules_().forEach(r => {
    if (r.st !== 'АКТИВНО') return;
    if (onlyKeys && onlyKeys.indexOf(r.k) < 0) return;
    const it = opsDumpItem_(items, r.k);
    if (!it || !(it.o <= r.stop)) return;
    sh.getRange(r.row, 9, 1, 2).setValues([['СТОП', new Date()]]);
    opsDumpMail_(r, it.o);
    hit.push(r.k);
  });
  return hit;
}

// Правила для экрана: с текущим остатком. Видят все роли (продавцу важно знать, что слив закончен).
function opsDumpView_(items) {
  return opsDumpRules_().map(r => {
    const it = opsDumpItem_(items, r.k);
    return { row: r.row, k: r.k, s: r.s, n: r.n, stop: r.stop, price: r.price, start: r.start, st: r.st, o: it ? it.o : 0 };
  });
}

function appDumpList(p) {
  return appGuard_(p, false, () => ({ ok: true, dump: opsDumpView_(appGetIndex_(false).items) }));
}

function appDumpSet(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const items = appGetIndex_(false).items;
    const it = appFindItem_(p.size, p.name);
    if (!it) throw new Error('Позиция не найдена на складе.');
    const stop = Math.round(appNum_(p.stop));
    if (!(stop >= 0)) throw new Error('Укажите, сколько шин оставить.');
    if (!(it.o > stop)) throw new Error('На складе сейчас ' + it.o + ' шт, порог должен быть меньше.');
    const price = Math.round(appNum_(p.price));
    const sh = opsDumpSheet_();
    const key = appKey_(it.s, it.n);
    const ex = opsDumpRules_().filter(r => r.k === key)[0];
    const row = ex ? ex.row : Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, 1, 1, 10).setValues([[key, it.s, it.n, stop, price || '', it.o, new Date(), email, 'АКТИВНО', '']]);
    appLog_(email, 'СЛИВ', OPS_DUMP_SHEET, row, key, it.o, stop, '');
    return { ok: true, dump: opsDumpView_(items) };
  });
}

function appDumpClear(p) {
  return appGuard_(p, true, email => {
    opsNeedOwner_(email);
    const row = Math.round(appNum_(p.row));
    const r = opsDumpRules_().filter(x => x.row === row)[0];
    if (!r) throw new Error('Правило не найдено.');
    opsDumpSheet_().getRange(row, 9).setValue('СНЯТО');
    return { ok: true, dump: opsDumpView_(appGetIndex_(false).items) };
  });
}
