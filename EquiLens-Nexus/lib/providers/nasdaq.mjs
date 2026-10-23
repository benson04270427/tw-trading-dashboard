// Nasdaq 官網公開資料（美股，免金鑰）：股票清單（含產業）、日 K、批次報價、當日走勢、交易日曆，
// 以及熱浪圖用的全市場收盤行情（篩選器一次取回約 7,000 檔；只有最新一個交易日，每天存一份到本機供之後比較）。
// 是 nasdaq.com 網頁使用的公開 API，沒有正式的服務條款保證；請求間隔至少 0.4 秒，批次報價每次 20 檔。
import fs from 'node:fs';
import path from 'node:path';
import { DataError, fetchJSON, sleep } from './common.mjs';
import { LOCAL } from '../storage.mjs';

const BASE = 'https://api.nasdaq.com/api';
const LABEL = 'Nasdaq';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
export const money = v => { if (v == null) return null; const s = String(v).replace(/[$,%\s]/g, ''); if (!s || s === 'N/A' || s === '--') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const usDate = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

// 產業（Nasdaq 篩選器的 sector）→ 中文
export const SECTOR_ZH = { Technology: '科技', Telecommunications: '通訊', 'Health Care': '醫療保健', Finance: '金融', 'Real Estate': '不動產', 'Consumer Discretionary': '非必需消費', 'Consumer Staples': '必需消費', Industrials: '工業', 'Basic Materials': '原物料', Energy: '能源', Utilities: '公用事業', Miscellaneous: '其他' };
const sectorZh = s => SECTOR_ZH[String(s || '').trim()] || (String(s || '').trim() ? String(s).trim() : '未分類');

// 紐約證交所休市日（固定規則；遇週末依規則補假）
const ymdUTC = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const nthWeekday = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), d = 1 + (wd - first + 7) % 7 + (n - 1) * 7; return ymdUTC(y, m, d); };
const lastWeekday = (y, m, wd) => { const last = new Date(Date.UTC(y, m, 0)), d = last.getUTCDate() - (last.getUTCDay() - wd + 7) % 7; return ymdUTC(y, m, d); };
const observed = (y, m, d) => { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 6 ? ymdUTC(y, m, d - 1) : w === 0 ? ymdUTC(y, m, d + 1) : ymdUTC(y, m, d); };
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = (h + l - 7 * m + 114) % 31 + 1; return [mo, da]; }
export function nyseHolidays(y) {
  const [em, ed] = easter(y), gf = new Date(Date.UTC(y, em - 1, ed) - 2 * 864e5).toISOString().slice(0, 10);
  const list = [observed(y, 1, 1), nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), gf, lastWeekday(y, 5, 1), observed(y, 6, 19), observed(y, 7, 4), nthWeekday(y, 9, 1, 1), nthWeekday(y, 11, 4, 4), observed(y, 12, 25)];
  return new Set(list.filter(d => d.startsWith(String(y)))); // 元旦遇週六不補假（補到前一年 12/31 時排除）
}
export function nyseCalendar(from, to) {
  const out = [], hol = new Map();
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
    const d = new Date(t), w = d.getUTCDay(), y = d.getUTCFullYear(), ds = d.toISOString().slice(0, 10);
    if (!hol.has(y)) hol.set(y, nyseHolidays(y));
    if (w > 0 && w < 6 && !hol.get(y).has(ds)) out.push(ds);
  }
  return out;
}
const nyDate = (now = new Date()) => now.toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 10);

let last = 0, tail = Promise.resolve();
export async function get(path, ctx = {}) {
  const previous = tail; let release; tail = new Promise(r => release = r); await previous;
  try {
    const wait = Math.max(0, last + (ctx.interval || 400) - Date.now()); if (wait) await sleep(wait, ctx.signal);
    last = Date.now();
    const r = await fetchJSON(BASE + path, { headers: HEADERS, signal: ctx.signal, label: LABEL, timeout: 40000 });
    if (r.status === 429) throw new DataError('{label} 額度或頻率限制，稍後再試', { label: LABEL }, { fatal: true, code: 'quota' });
    if (!r.ok || !r.body) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
    return r.body.data ?? null;
  } finally { release(); }
}

export function parseHistorical(data, id) {
  const rows = (data?.tradesTable?.rows || []).map(r => ({ date: usDate(r.date), stock_id: id, open: money(r.open), max: money(r.high), min: money(r.low), close: money(r.close), Trading_Volume: money(r.volume) ?? 0 }))
    .filter(r => r.date && r.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  let prev = null;
  for (const r of rows) { r.Trading_money = r.Trading_Volume * r.close; r.spread = prev != null ? Math.round((r.close - prev) * 1e4) / 1e4 : null; prev = r.close; }
  return rows;
}
// 批次報價（watchlist）→ 即時快照格式；美股量的單位為股
export function parseWatchlist(list, now = new Date()) {
  const tzNow = now.toLocaleString('sv-SE', { timeZone: 'America/New_York' });
  return (Array.isArray(list) ? list : []).map(q => {
    const close = money(q.lastSalePrice), prev = money(q.previousClosePrice), open = money(q.openingPrice), vol = money(q.volume) ?? 0;
    const day = String(q.lastTradeTimestampDateTime || '').slice(0, 10) || tzNow.slice(0, 10);
    const time = /open/i.test(q.marketStatus || '') && day === tzNow.slice(0, 10) ? tzNow.slice(11, 19) : '16:00:00';
    const ch = money(q.netChange) ?? (close != null && prev != null ? close - prev : null);
    return close > 0 ? { stock_id: String(q.symbol).toUpperCase(), date: `${day} ${time}`, open, high: null, low: null, close, change_price: ch, change_rate: money(q.percentageChange), total_volume: vol, total_amount: vol * close, yesterday_volume: null, buy_price: null, sell_price: null } : null;
  }).filter(Boolean);
}
// 當日走勢（每分鐘一點，x 為美東時間的時鐘值）→ [時:分, 開, 高, 低, 收, 量]，只保留 09:30–16:00
export function parseChart(data, date) {
  const out = new Map();
  for (const p of data?.chart || []) {
    const d = new Date(p.x), ymd = d.toISOString().slice(0, 10), hm = d.toISOString().slice(11, 16);
    if (ymd !== date || hm < '09:30' || hm > '16:00' || !(p.y > 0)) continue;
    out.set(hm, [hm, p.y, p.y, p.y, p.y, 0]);
  }
  return [...out.values()];
}

// ---- 全市場：篩選器（約 7,000 檔，收盤後的資料；盤中仍是前一交易日）----
let screenerCache = { at: 0, rows: null };
async function screener(ctx) {
  if (screenerCache.rows && Date.now() - screenerCache.at < 5 * 60e3) return screenerCache.rows;
  const rows = (await get('/screener/stocks?tableonly=true&download=true', ctx))?.rows || [];
  if (rows.length) screenerCache = { at: Date.now(), rows };
  return rows;
}
// 篩選器沒有日期：與幾檔大型股的即時報價比對，價格等於「最新成交」就是最新交易日，等於「昨收」就是前一交易日
export function screenerSession(rows, quotes, calendar, today) {
  const by = new Map(rows.map(r => [String(r.symbol).toUpperCase(), money(r.lastsale)]));
  let sameLast = 0, samePrev = 0, lastDay = null;
  for (const q of quotes) {
    const v = by.get(String(q.symbol).toUpperCase()), lp = money(q.lastSalePrice), pc = money(q.previousClosePrice); if (v == null) continue;
    const day = String(q.lastTradeTimestampDateTime || '').slice(0, 10); if (day) lastDay = day;
    if (lp != null && Math.abs(v - lp) < 1e-6) sameLast++; else if (pc != null && Math.abs(v - pc) < 1e-6) samePrev++;
  }
  const days = calendar.filter(d => d <= (lastDay || today));
  if (!lastDay || (!sameLast && !samePrev)) return days.at(-1) || null;
  return sameLast >= samePrev ? (days.includes(lastDay) ? lastDay : days.at(-1)) : days.filter(d => d < lastDay).at(-1) || null;
}
export function screenerRows(rows, date, re = /^[A-Z][A-Z0-9.\-]{0,9}$/) {
  const out = [];
  for (const r of rows) {
    const id = String(r.symbol || '').trim().toUpperCase().replace('/', '.'), close = money(r.lastsale), vol = money(r.volume) ?? 0;
    if (!re.test(id) || !(close > 0)) continue;
    out.push({ date, stock_id: id, close, spread: money(r.netchange), Trading_Volume: vol, Trading_money: vol * close, open: null, max: null, min: null });
  }
  return out;
}
const DIR = () => path.join(LOCAL, 'nasdaq-daily');
const saveDay = (date, rows) => { try { fs.mkdirSync(DIR(), { recursive: true }); fs.writeFileSync(path.join(DIR(), date + '.json'), JSON.stringify(rows.map(r => [r.stock_id, r.close, r.spread, r.Trading_Volume]))); const files = fs.readdirSync(DIR()).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); for (const f of files.slice(0, -30)) fs.unlinkSync(path.join(DIR(), f)); } catch { } };
const loadDay = date => { try { return JSON.parse(fs.readFileSync(path.join(DIR(), date + '.json'), 'utf8')).map(([id, close, spread, vol]) => ({ date, stock_id: id, close, spread, Trading_Volume: vol, Trading_money: vol * close, open: null, max: null, min: null })); } catch { return []; } };
async function heatAll(date, ctx) {
  const rows = await screener(ctx), cal = nyseCalendar(minusDays(nyDate(), 20), nyDate());
  const quotes = (await get(`/quote/watchlist?${['aapl', 'msft', 'nvda', 'amzn', 'googl'].map(s => `symbol=${s}%7cstocks`).join('&')}`, ctx)) || [];
  const session = screenerSession(rows, quotes, cal, nyDate());
  if (session === date) { const out = screenerRows(rows, date, ctx.market?.symbolRe); if (out.length > 1000) saveDay(date, out); return out; }
  return loadDay(date);
}
const minusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
// 盤中熱浪：研究名單與自選之外，再加上市值最大的 500 檔
let topCache = { at: 0, ids: [] };
async function topCaps(ctx, n = 500) {
  if (topCache.ids.length && Date.now() - topCache.at < 6 * 3600e3) return topCache.ids;
  try { const re = ctx.market?.symbolRe || /^[A-Z][A-Z0-9.\-]{0,9}$/; topCache = { at: Date.now(), ids: (await screener(ctx)).map(r => [String(r.symbol || '').trim().toUpperCase().replace('/', '.'), money(r.marketCap) ?? 0]).filter(([id, c]) => re.test(id) && c > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id) }; } catch { }
  return topCache.ids;
}

export default {
  id: 'nasdaq', name: 'Nasdaq 公開資料', site: 'https://www.nasdaq.com', docs: 'https://www.nasdaq.com/market-activity', markets: ['US'],
  key: 'none', interval: 400,
  caps: { universe: 1, calendar: 1, daily: 1, heatAll: 1, snapshot: 1, intraday: 1 },
  snapshotMode: 'symbols',
  snapshotLimit: () => 700,
  // 加上市值前 500 大後約 30 個請求（每次 0.4 秒），每分鐘更新一次
  snapshotEvery: () => 60e3,
  universe: async ctx => {
    const rows = await screener(ctx), re = ctx.market?.symbolRe || /^[A-Z][A-Z0-9.\-]{0,9}$/;
    const seen = new Map();
    for (const r of rows) { const id = String(r.symbol || '').trim().toUpperCase().replace('/', '.'); if (re.test(id) && !seen.has(id)) seen.set(id, { id, name: String(r.name || id).replace(/\s+(Common Stock|Ordinary Shares|Class [A-Z] .*)$/i, '').trim(), sector: sectorZh(r.sector), market: 'US' }); }
    if (!seen.size) throw new DataError('{label}：股票清單為空', { label: LABEL });
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  },
  daily: async (id, from, to, ctx) => {
    const price = parseHistorical(await get(`/quote/${encodeURIComponent(id)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`, ctx), id);
    return { price, adjusted: price, adjustedIsRaw: true };
  },
  calendar: async (from, ctx) => nyseCalendar(from || minusDays(nyDate(), 400), nyDate()),
  heatAll,
  snapshot: async (ids, ctx) => {
    ids = [...new Set([...ids, ...await topCaps(ctx)])].slice(0, 700);
    const out = [];
    for (let i = 0; i < ids.length; i += 20) {
      const q = ids.slice(i, i + 20).map(s => `symbol=${encodeURIComponent(s.toLowerCase() + '|stocks')}`).join('&');
      out.push(...parseWatchlist(await get(`/quote/watchlist?${q}`, ctx)));
    }
    return out;
  },
  intraday: async (id, date, ctx) => parseChart(await get(`/quote/${encodeURIComponent(id)}/chart?assetclass=stocks`, ctx), date),
};
