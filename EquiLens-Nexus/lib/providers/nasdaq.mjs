// Nasdaq 官網公開資料（美股，免金鑰）：股票清單（含產業）、日 K、批次報價、當日走勢。
// 是 nasdaq.com 網頁使用的公開 API，沒有正式的服務條款保證；請求間隔至少 0.4 秒，批次報價每次 20 檔。
import { DataError, fetchJSON, sleep } from './common.mjs';

const BASE = 'https://api.nasdaq.com/api';
const LABEL = 'Nasdaq';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
export const money = v => { if (v == null) return null; const s = String(v).replace(/[$,%\s]/g, ''); if (!s || s === 'N/A' || s === '--') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const usDate = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

let last = 0, tail = Promise.resolve();
async function get(path, ctx = {}) {
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

export default {
  id: 'nasdaq', name: 'Nasdaq 公開資料', site: 'https://www.nasdaq.com', docs: 'https://www.nasdaq.com/market-activity', markets: ['US'],
  key: 'none', interval: 400,
  caps: { universe: 1, daily: 1, snapshot: 1, intraday: 1 },
  snapshotMode: 'symbols',
  snapshotLimit: () => 600,
  snapshotEvery: n => n <= 60 ? 20e3 : 60e3,
  universe: async ctx => {
    const data = await get('/screener/stocks?tableonly=true&download=true', ctx), re = ctx.market?.symbolRe || /^[A-Z][A-Z0-9.\-]{0,9}$/;
    const seen = new Map();
    for (const r of data?.rows || []) { const id = String(r.symbol || '').trim().toUpperCase().replace('/', '.'); if (re.test(id) && !seen.has(id)) seen.set(id, { id, name: String(r.name || id).replace(/\s+(Common Stock|Ordinary Shares|Class [A-Z] .*)$/i, '').trim(), sector: r.sector || '未分類', market: 'US' }); }
    if (!seen.size) throw new DataError('{label}：股票清單為空', { label: LABEL });
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  },
  daily: async (id, from, to, ctx) => {
    const price = parseHistorical(await get(`/quote/${encodeURIComponent(id)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`, ctx), id);
    return { price, adjusted: price, adjustedIsRaw: true };
  },
  snapshot: async (ids, ctx) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 20) {
      const q = ids.slice(i, i + 20).map(s => `symbol=${encodeURIComponent(s.toLowerCase() + '|stocks')}`).join('&');
      out.push(...parseWatchlist(await get(`/quote/watchlist?${q}`, ctx)));
    }
    return out;
  },
  intraday: async (id, date, ctx) => parseChart(await get(`/quote/${encodeURIComponent(id)}/chart?assetclass=stocks`, ctx), date),
};
