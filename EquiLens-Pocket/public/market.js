// 市場相關的前端工具：當地時間、交易時段、漲跌配色、成交量單位。市場設定來自 /api/state 的 marketProfile（電腦版與手機版共用）。
const TW = { id: 'TW', name: { 'zh-TW': '台灣股市', en: 'Taiwan' }, tz: 'Asia/Taipei', currency: 'TWD', sessions: [['09:00', '13:30']], open: 540, close: 810, length: 270, settle: 5, lot: 1000, unit: { 'zh-TW': '張', en: 'lots' }, limit: { pct: 10 }, upColor: 'red', symbol: '^[1-9]\\d{3}$', sample: '2330', local: [], axis: ['09:00', '11:00', '13:30'] };
let P = TW, UP = 'red', LANG = 'zh-TW', symbolRe = new RegExp(TW.symbol);

export function setMarket(profile, upColor, lang) {
  if (profile) { P = profile; symbolRe = new RegExp(profile.symbol); }
  UP = upColor || P.upColor || 'red'; if (lang) LANG = lang;
  try { document.documentElement.dataset.up = UP; } catch { }
}
export const market = () => P;
export const marketName = () => P.name?.[LANG] || P.name?.en || P.id;
export const validSymbol = id => typeof id === 'string' && symbolRe.test(id);
// 漲跌配色：紅漲綠跌（台、日、韓、中港慣例）或綠漲紅跌（歐美慣例），可在設定頁改
export const upColors = () => UP === 'green' ? { up: '#16e38b', down: '#ff3d5a' } : { up: '#ff3d5a', down: '#16e38b' };
// 成交量顯示單位（台股為張；其他市場為股，不加單位字）
export const unit = () => P.unit?.[LANG] ?? P.unit?.en ?? '';
export const lotNote = () => P.lot > 1 ? (LANG === 'zh-TW' ? `1 ${unit()}＝${P.lot.toLocaleString('en-US')} 股` : `1 ${unit().replace(/s$/, '')} = ${P.lot.toLocaleString('en-US')} shares`) : '';

// 市場當地時間
export function parts(ms = Date.now()) {
  const o = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: P.tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { ...o, date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, hms: `${o.hour}:${o.minute}:${o.second}`, mod: Number(o.hour) * 60 + Number(o.minute), weekend: ['Sat', 'Sun'].includes(o.weekday) };
}
export const today = () => parts().date;
export const clock = (ms = Date.now()) => parts(ms).hms;
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
// 盤中（含收盤撮合緩衝）
export function isOpen(ms = Date.now()) { const p = parts(ms); return !p.weekend && p.mod >= P.open && p.mod < P.close + (P.settle || 5); }
// 市場狀態標籤（繁中原文，畫面會自動翻譯）
export function status(ms = Date.now()) {
  const p = parts(ms), m = p.mod;
  if (p.weekend) return ['休市', 'off'];
  if (m < P.open) return ['盤前', 'warn'];
  const s = (P.sessions || []).map(([a, b]) => [toMin(a), toMin(b)]);
  if (s.some(([a, b]) => m >= a && m < b)) return ['盤中 LIVE', ''];
  if (m < P.close) return ['午休', 'warn'];
  if (m < P.close + 90) return ['收盤整理', 'warn'];
  return ['盤後', 'off'];
}
// 開盤後經過的交易分鐘數（扣除午休）
export function elapsed(t) {
  const m = /(\d{2}):(\d{2})/.exec(String(t || '')); if (!m) return 0;
  const x = Number(m[1]) * 60 + Number(m[2]); let e = 0;
  for (const [a, b] of (P.sessions || []).map(([a, b]) => [toMin(a), toMin(b)])) e += Math.max(0, Math.min(x, b) - a);
  return Math.min(P.length || 270, e);
}
export const sessionLength = () => P.length || 270;
// 依瀏覽器語言或衡析設定的日期時間格式
export const dateTime = v => new Date(v).toLocaleString(LANG === 'zh-TW' ? 'zh-TW' : 'en-GB', { hour12: false, timeZone: P.tz });
export const lang = () => LANG;
// 圖表橫軸：各交易時段的開盤、中點與收盤
export const axis = () => P.axis || ['09:00', '11:00', '13:30'];
export const minutesOfDay = () => (P.sessions || []).map(([a, b]) => [toMin(a), toMin(b)]);
