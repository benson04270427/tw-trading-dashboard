// 市場設定：時區、交易時段（含午休）、價格跳動、漲跌幅限制、交易單位與漲跌配色。
// 一套衡析研究一個市場；所有和交易時間、價格規則有關的判斷都從這裡取得，不在程式各處寫死台股規則。
// 時間一律以「HH:MM」或「當地午夜起算的分鐘數」表示；日期為當地日期 YYYY-MM-DD。

const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
export const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// 價格跳動表：[價格上限（不含）, 跳動單位]
const TICKS = {
  TW: [[10, .01], [50, .05], [100, .1], [500, .5], [1000, 1], [Infinity, 5]],
  US: [[1, .0001], [Infinity, .01]],
  JP: [[3000, 1], [5000, 5], [30000, 10], [50000, 50], [300000, 100], [500000, 500], [3e6, 1000], [5e6, 5000], [3e7, 10000], [5e7, 50000], [Infinity, 100000]],
  HK: [[.25, .001], [.5, .005], [10, .01], [20, .02], [100, .05], [200, .1], [500, .2], [1000, .5], [2000, 1], [5000, 2], [Infinity, 5]],
  KR: [[2000, 1], [5000, 5], [20000, 10], [50000, 50], [200000, 100], [500000, 500], [Infinity, 1000]],
  DEFAULT: [[1, .0001], [Infinity, .01]],
};
// 日本：依基準價的每日價格限制（日圓）
const JP_LIMIT = [[100, 30], [200, 50], [500, 80], [700, 100], [1000, 150], [1500, 300], [2000, 400], [3000, 500], [5000, 700], [7000, 1000], [10000, 1500], [15000, 3000], [20000, 4000], [30000, 5000], [50000, 7000], [70000, 10000], [100000, 15000], [150000, 30000], [200000, 40000], [300000, 50000], [500000, 70000], [700000, 100000], [1e6, 150000], [Infinity, 300000]];

// symbol：普通股代號格式（正規表示式字串，前端也會用）；priceScale／amountScale：時光機畫格儲存價格與成交金額的精度
// lot：成交量顯示單位（台股 1 張＝1,000 股）；local：此市場才有的在地模組（需資料源支援）
export const MARKETS = {
  TW: { name: { 'zh-TW': '台灣股市', en: 'Taiwan' }, tz: 'Asia/Taipei', currency: 'TWD', sessions: [['09:00', '13:30']], settle: 5, lot: 1000, unit: { 'zh-TW': '張', en: 'lots' }, ticks: 'TW', limit: { pct: 10 }, upColor: 'red', symbol: '^[1-9]\\d{3}$', sample: '2330', priceScale: 100, amountScale: 1e6, liquidity: 300e3, local: ['institutional', 'brokers', 'holders', 'futures', 'margin', 'flows', 'monthlyRevenue'], lang: 'zh-TW' },
  US: { name: { 'zh-TW': '美國股市', en: 'United States' }, tz: 'America/New_York', currency: 'USD', sessions: [['09:30', '16:00']], settle: 5, lot: 1, ticks: 'US', limit: null, upColor: 'green', symbol: '^[A-Z][A-Z0-9.\\-]{0,9}$', sample: 'AAPL', priceScale: 10000, amountScale: 1e4, liquidity: 500e3 },
  JP: { name: { 'zh-TW': '日本股市', en: 'Japan' }, tz: 'Asia/Tokyo', currency: 'JPY', sessions: [['09:00', '11:30'], ['12:30', '15:30']], settle: 5, lot: 1, ticks: 'JP', limit: { table: 'JP' }, upColor: 'red', symbol: '^\\d{3}[0-9A-Z]$', sample: '7203', priceScale: 10, amountScale: 1e6, liquidity: 100e3 },
  HK: { name: { 'zh-TW': '香港股市', en: 'Hong Kong' }, tz: 'Asia/Hong_Kong', currency: 'HKD', sessions: [['09:30', '12:00'], ['13:00', '16:00']], settle: 10, lot: 1, ticks: 'HK', limit: null, upColor: 'green', symbol: '^\\d{4,5}$', sample: '0700', priceScale: 1000, amountScale: 1e6, liquidity: 500e3 },
  KR: { name: { 'zh-TW': '韓國股市', en: 'South Korea' }, tz: 'Asia/Seoul', currency: 'KRW', sessions: [['09:00', '15:30']], settle: 5, lot: 1, ticks: 'KR', limit: { pct: 30 }, upColor: 'red', symbol: '^\\d{6}$', sample: '005930', priceScale: 1, amountScale: 1e8, liquidity: 100e3 },
  GB: { name: { 'zh-TW': '英國股市', en: 'United Kingdom' }, tz: 'Europe/London', currency: 'GBP', sessions: [['08:00', '16:30']], settle: 10, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9][A-Z0-9.]{0,6}$', sample: 'VOD', priceScale: 100, amountScale: 1e5, liquidity: 500e3 },
  DE: { name: { 'zh-TW': '德國股市', en: 'Germany' }, tz: 'Europe/Berlin', currency: 'EUR', sessions: [['09:00', '17:30']], settle: 10, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9][A-Z0-9.]{0,6}$', sample: 'SAP', priceScale: 1000, amountScale: 1e5, liquidity: 100e3 },
  FR: { name: { 'zh-TW': '法國股市', en: 'France' }, tz: 'Europe/Paris', currency: 'EUR', sessions: [['09:00', '17:30']], settle: 10, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9][A-Z0-9.]{0,6}$', sample: 'MC', priceScale: 1000, amountScale: 1e5, liquidity: 100e3 },
  CA: { name: { 'zh-TW': '加拿大股市', en: 'Canada' }, tz: 'America/Toronto', currency: 'CAD', sessions: [['09:30', '16:00']], settle: 5, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z][A-Z0-9.\\-]{0,9}$', sample: 'SHOP', priceScale: 1000, amountScale: 1e5, liquidity: 200e3 },
  AU: { name: { 'zh-TW': '澳洲股市', en: 'Australia' }, tz: 'Australia/Sydney', currency: 'AUD', sessions: [['10:00', '16:00']], settle: 15, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9]{2,6}$', sample: 'BHP', priceScale: 1000, amountScale: 1e5, liquidity: 500e3 },
  SG: { name: { 'zh-TW': '新加坡股市', en: 'Singapore' }, tz: 'Asia/Singapore', currency: 'SGD', sessions: [['09:00', '12:00'], ['13:00', '17:00']], settle: 10, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9]{2,6}$', sample: 'D05', priceScale: 1000, amountScale: 1e5, liquidity: 500e3 },
  IN: { name: { 'zh-TW': '印度股市', en: 'India' }, tz: 'Asia/Kolkata', currency: 'INR', sessions: [['09:15', '15:30']], settle: 5, lot: 1, ticks: 'DEFAULT', limit: null, upColor: 'green', symbol: '^[A-Z0-9&\\-]{1,12}$', sample: 'RELIANCE', priceScale: 100, amountScale: 1e5, liquidity: 500e3 },
};
export const MARKET_IDS = Object.keys(MARKETS);

const cache = new Map();
// 取得市場設定（附上計算好的開收盤分鐘數）；未知代號回到台股
export function marketProfile(id = 'TW') {
  const key = MARKETS[id] ? id : 'TW';
  if (cache.has(key)) return cache.get(key);
  const m = MARKETS[key], sessions = m.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
  const p = { id: key, local: [], unit: null, lang: 'en', ...m, sessionMinutes: sessions, open: sessions[0][0], close: sessions.at(-1)[1], length: sessions.reduce((s, [a, b]) => s + b - a, 0), symbolRe: new RegExp(m.symbol) };
  cache.set(key, p); return p;
}

// 當地時間各欄位
export function localParts(p, now = new Date()) {
  const o = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: p.tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  const minute = Number(o.hour) * 60 + Number(o.minute);
  return { date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, hms: `${o.hour}:${o.minute}:${o.second}`, hour: Number(o.hour), minute, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
export const localDate = (p, now) => localParts(p, now).date;
export const isWeekday = (p, now) => { const w = localParts(p, now).weekday; return w >= 1 && w <= 5; };
// 前一個平日（不判斷國定假日；休市日由熱浪圖的交易日曆確認）
export function prevWeekday(date) {
  const d = new Date(date + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
// 補抓錯過的收盤後更新：電腦在每日更新時間到午夜之間關機或睡眠時，週末與隔天早上不會再自動更新。
// 週末、或平日在每日更新時間前，本機最新資料早於前一個平日時，每天最多補抓一次（盤中與收盤後 90 分鐘內不補抓）。
export function catchupDue(x, { updateTime, newest, last, open = 0, close = 0 }) {
  if (!newest || last === x.date) return false;
  const weekday = x.weekday >= 1 && x.weekday <= 5;
  if (weekday && x.hm >= updateTime) return false;
  if (weekday && x.minute >= open && x.minute < close + 90) return false;
  return newest < prevWeekday(x.date);
}
export const minuteOf = t => { const m = /(\d{2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// 盤中（含收盤後撮合的緩衝時間）：平日、開盤到收盤＋settle 分鐘；國定假日由資料日期判斷
export function liveWindow(p, now = new Date()) {
  const x = localParts(p, now);
  return x.weekday >= 1 && x.weekday <= 5 && x.minute >= p.open && x.minute < p.close + p.settle;
}
// 收盤後 plus 分鐘以後（平日）
export function afterClose(p, now = new Date(), plus = 0) { const x = localParts(p, now); return x.weekday >= 1 && x.weekday <= 5 && x.minute >= p.close + plus; }
// 開盤後經過的「交易」分鐘數（扣除午休），限制在 0 到全日交易分鐘數之間
export function elapsedTrading(p, t) {
  const m = typeof t === 'number' ? t : minuteOf(t); if (m == null) return 0;
  let e = 0; for (const [a, b] of p.sessionMinutes) e += Math.max(0, Math.min(m, b) - a);
  return Math.min(p.length, e);
}
// 收盤時間（HH:MM）
export const closeHM = p => hhmm(p.close);
export const openHM = p => hhmm(p.open);

// 價格跳動
const table = p => TICKS[p.ticks] || TICKS.DEFAULT;
export function tickSize(p, price) { for (const [lim, step] of table(p)) if (price < lim) return step; return .01; }
const decimals = step => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
export function roundTick(p, value, up = true) {
  const step = tickSize(p, value), n = decimals(step);
  const v = (up ? Math.ceil(value / step - 1e-9) : Math.floor(value / step + 1e-9)) * step;
  return Math.round(v * 10 ** n) / 10 ** n;
}
// 漲跌停價（沒有漲跌幅限制的市場回傳 null）
export function limitPrices(p, prev) {
  if (!p.limit || !(prev > 0)) return null;
  if (p.limit.pct) return { up: roundTick(p, prev * (1 + p.limit.pct / 100), false), down: roundTick(p, prev * (1 - p.limit.pct / 100), true) };
  if (p.limit.table === 'JP') { const w = JP_LIMIT.find(([lim]) => prev < lim)[1]; return { up: prev + w, down: Math.max(1, prev - w) }; }
  return null;
}
// 接近漲跌停的判定門檻（%）：例如台股 10% 以 9.5% 判定
export const limitNearPct = p => p.limit?.pct ? p.limit.pct * .95 : null;

// K 線分組：把以「結束時間」標示的一分鐘（當地午夜起算分鐘）歸到 size 分鐘的 K 棒，標示為該 K 棒的結束時間；
// 每個交易時段各自從開盤起算，午休或收盤後的資料併入前一個時段的最後一根
export function bucketEnd(p, endMinute, size = 5) {
  const ss = p.sessionMinutes;
  let s = ss[0];
  for (const x of ss.slice(1)) if (endMinute >= x[0]) s = x; // 下午時段開盤那一刻（例如 12:30 的開盤撮合）歸下午
  const k = Math.max(size, Math.ceil((endMinute - s[0]) / size) * size);
  return Math.min(s[1], s[0] + k);
}
// 圖表橫軸刻度（各時段開盤、中點與收盤）
export function axisTicks(p) {
  const out = []; for (const [a, b] of p.sessionMinutes) { out.push(a); if (b - a >= 180) out.push(a + Math.round((b - a) / 2 / 30) * 30); out.push(b); }
  return [...new Set(out)].map(hhmm);
}
// 股數 → 顯示單位（台股為張）
export const toLots = (p, shares) => shares == null ? null : shares / p.lot;

// 前端用的精簡版（可序列化）
export function clientMarket(p) {
  return { id: p.id, name: p.name, tz: p.tz, currency: p.currency, sessions: p.sessions, open: p.open, close: p.close, length: p.length, settle: p.settle, lot: p.lot, unit: p.unit, limit: p.limit, upColor: p.upColor, symbol: p.symbol, sample: p.sample, local: p.local, ticks: table(p).map(([l, s]) => [Number.isFinite(l) ? l : null, s]), axis: axisTicks(p) };
}
