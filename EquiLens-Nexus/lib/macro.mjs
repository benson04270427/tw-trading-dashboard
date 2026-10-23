// 總經大地圖（台股加權指數、美股 S&P 500）：近況走勢、依過去十年「同一時間點之後」的走勢推估未來路徑與區間，
// 每月的歷史統計（平均報酬、上漲機率）與重點事件。純計算；指數由 server.mjs 取得（台股 FinMind、美股 FRED）。
// 推估只是歷史季節性的統計，不是預測。
export const MACRO_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// 未來 n 個交易日（平日；台股另略過已知的休市日，美股用 holidays 參數）
export function nextSessions(from, n, holidays = new Set()) { const out = []; let d = from; while (out.length < n) { d = addDays(d, 1); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w > 0 && w < 6 && !holidays.has(d)) out.push(d); } return out; }

// 季節性推估：過去每一年，從「同月同日（含之前最近的交易日）」起算 k 個交易日的報酬，取中位數與 25%／75% 分位
export function seasonal(closes, { horizon = 40, years = 10 } = {}) {
  if (closes.length < 300) return null;
  const last = closes.at(-1), md = last[0].slice(5), y0 = Number(last[0].slice(0, 4)), paths = [];
  for (let y = y0 - 1; y >= y0 - years; y--) {
    const anchor = `${y}-${md}`; let i = -1;
    for (let j = closes.length - 1; j >= 0; j--) if (closes[j][0] <= anchor) { i = j; break; }
    if (i < 0 || i + horizon >= closes.length || closes[i][0] < `${y}-01-01`) continue;
    paths.push(Array.from({ length: horizon }, (_, k) => closes[i + k + 1][1] / closes[i][1] - 1));
  }
  if (paths.length < 5) return null;
  const at = k => paths.map(p => p[k]);
  return { years: paths.length, median: Array.from({ length: horizon }, (_, k) => q(at(k), 0.5)), p25: Array.from({ length: horizon }, (_, k) => q(at(k), 0.25)), p75: Array.from({ length: horizon }, (_, k) => q(at(k), 0.75)), upProb: r1(at(horizon - 1).filter(v => v > 0).length / paths.length * 100) };
}
// 各月份的歷史表現（月底收盤對上月底收盤）
export function monthStats(closes, months, years = 10) {
  const monthEnd = new Map(); for (const [d, c] of closes) monthEnd.set(d.slice(0, 7), c);
  const keys = [...monthEnd.keys()].sort(), y0 = Number(closes.at(-1)[0].slice(0, 4));
  return months.map(m => {
    const rets = [];
    for (let y = y0 - 1; y >= y0 - years; y--) { const k = `${y}-${String(m).padStart(2, '0')}`, i = keys.indexOf(k); if (i > 0) rets.push(monthEnd.get(k) / monthEnd.get(keys[i - 1]) - 1); }
    if (!rets.length) return { month: m, years: 0 };
    return { month: m, years: rets.length, avg: r2(rets.reduce((a, b) => a + b, 0) / rets.length * 100), median: r2(q(rets, 0.5) * 100), up: r1(rets.filter(v => v > 0).length / rets.length * 100), best: r2(Math.max(...rets) * 100), worst: r2(Math.min(...rets) * 100) };
  });
}
// 一年位階：目前收盤在近 250 個交易日中的百分位
export const position = closes => { const w = closes.slice(-250).map(x => x[1]), v = w.at(-1); return w.length ? r1(w.filter(x => x < v).length / w.length * 100) : null; };

// 例行重點事件（依規則產生；聯準會會議日期為已公布的排程）
const FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08'];
const nth = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return `${y}-${String(m).padStart(2, '0')}-${String(1 + (wd - first + 7) % 7 + (n - 1) * 7).padStart(2, '0')}`; };
export function monthEvents(market, y, m) {
  const mm = String(m).padStart(2, '0'), ev = [];
  const fomc = FOMC.filter(d => d.startsWith(`${y}-${mm}`)); for (const d of fomc) ev.push({ date: d, text: market === 'US' ? '聯準會利率決策（FOMC）' : '聯準會利率決策（台北時間隔天凌晨公布）' });
  if (market === 'US') {
    ev.push({ date: nth(y, m, 5, 1), text: '非農就業報告（每月第一個週五）' });
    ev.push({ date: `${y}-${mm}-10～15`, text: '消費者物價指數（CPI）' });
    ev.push({ date: nth(y, m, 5, 3), text: '個股與指數選擇權到期（第三個週五）' });
    if ([1, 4, 7, 10].includes(m)) ev.push({ date: `${y}-${mm} 中旬起`, text: '財報季（大型銀行率先公布）' });
    if (y === 2026 && m === 11) ev.push({ date: '2026-11-03', text: '美國期中選舉' });
  } else {
    ev.push({ date: `${y}-${mm}-10 前`, text: '上市櫃公司公布上月營收（台積電約 10 日）' });
    ev.push({ date: nth(y, m, 3, 3), text: '台指期月結算（第三個週三）' });
    if ([1, 4, 7, 10].includes(m)) ev.push({ date: `${y}-${mm} 中旬`, text: '台積電法說會與季報' });
    if ([3, 5, 8, 11].includes(m)) ev.push({ date: { 3: `${y}-03-31`, 5: `${y}-05-15`, 8: `${y}-08-14`, 11: `${y}-11-14` }[m], text: '上市櫃公司財報公告期限' });
    if ([6, 7, 8].includes(m)) ev.push({ date: `${y}-${mm}`, text: '除權息旺季' });
    if (m === 12) ev.push({ date: `${y}-12`, text: '年底作帳行情、外資封關' });
  }
  return ev;
}
// 組成畫面資料
export function buildMacro({ market, closes, today, holidays = new Set(), horizon = 40, risk = null }) {
  const c = closes.filter(x => x[1] > 0);
  if (c.length < 300) return { market, available: false };
  const last = c.at(-1), s = seasonal(c, { horizon }), dates = nextSessions(last[0], horizon, holidays);
  const projection = s ? dates.map((d, k) => [d, r2(last[1] * (1 + s.median[k])), r2(last[1] * (1 + s.p25[k])), r2(last[1] * (1 + s.p75[k]))]) : [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), months = [0, 1, 2].map(k => { const mm = (m - 1 + k) % 12 + 1; return { y: y + Math.floor((m - 1 + k) / 12), m: mm }; });
  const stats = monthStats(c, months.map(x => x.m));
  return { version: MACRO_VERSION, market, available: true, indexName: market === 'US' ? 'S&P 500' : '加權指數', date: last[0], close: last[1], position: position(c), risk,
    recent: c.slice(-90), projection, horizon, years: s?.years || 0, upProb: s?.upProb ?? null, endMedian: s ? r2(s.median.at(-1) * 100) : null,
    months: months.map((x, i) => ({ ...x, ...stats[i], events: monthEvents(market, x.y, x.m) })) };
}
