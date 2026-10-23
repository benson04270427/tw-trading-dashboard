// Finnhub（美股，需金鑰，免費方案每分鐘約 60 次、限個人非商業使用）：個股新聞、市場新聞、本益比／淨值比／殖利率。
import { DataError, fetchJSON, limiter, num } from './common.mjs';

const BASE = 'https://finnhub.io/api/v1';
const LABEL = 'Finnhub';
const queue = limiter(1100);
async function get(path, params, ctx) {
  return queue(async () => {
    const u = new URL(BASE + path); for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    const r = await fetchJSON(u, { headers: { 'X-Finnhub-Token': ctx.key }, signal: ctx.signal, label: LABEL });
    if (r.status === 429) throw new DataError('{label} 額度或頻率限制，稍後再試', { label: LABEL }, { fatal: true, code: 'quota' });
    if (r.status === 401 || r.status === 403) throw new DataError('{label}：金鑰或方案權限不足', { label: LABEL }, { fatal: r.status === 401, code: 'auth' });
    if (!r.ok) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
    return r.body;
  }, ctx);
}
const stamp = (sec, tz) => { const d = new Date(Number(sec) * 1000); return Number.isFinite(d.getTime()) ? d.toLocaleString('sv-SE', { timeZone: tz || 'America/New_York' }) : null; };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const parseNews = (list, tz, id = null) => (Array.isArray(list) ? list : []).filter(n => n.headline && n.url).map(n => ({ date: stamp(n.datetime, tz), stock_id: id || String(n.related || '').split(',')[0].trim().toUpperCase(), title: n.headline, link: n.url, source: n.source || 'Finnhub', summary: n.summary || '' })).filter(n => n.date);
export function parseMetric(b, id, date) {
  const m = b?.metric; if (!m) return [];
  const pe = num(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual), pb = num(m.pbQuarterly ?? m.pbAnnual), dy = num(m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual);
  return pe == null && pb == null && dy == null ? [] : [{ date, stock_id: id, PER: pe, PBR: pb, dividend_yield: dy }];
}

// 策略選股用的基本面（本益比、營收與 EPS 成長、52 週高低）：每檔 1 個請求
export function parseFundamentals(b) {
  const m = b?.metric; if (!m) return null;
  return { pe: num(m.peTTM ?? m.peBasicExclExtraTTM), revGrowth: num(m.revenueGrowthTTMYoy) ?? (Number.isFinite(m.revenueGrowthTTMYoy) ? m.revenueGrowthTTMYoy : null), epsGrowth: Number.isFinite(m.epsGrowthTTMYoy) ? m.epsGrowthTTMYoy : null, high52: num(m['52WeekHigh']), low52: num(m['52WeekLow']), mcap: num(m.marketCapitalization) };
}
export const fundamentals = async (id, ctx) => parseFundamentals(await get('/stock/metric', { symbol: id, metric: 'all' }, ctx));
export default {
  id: 'finnhub', name: 'Finnhub', site: 'https://finnhub.io', docs: 'https://finnhub.io/docs/api', markets: ['US'],
  key: 'required', keyEnv: 'FINNHUB_API_KEY', interval: 1100,
  caps: { news: 1, marketNews: 1, valuation: 1 },
  async validate(key) {
    const r = await fetchJSON(`${BASE}/quote?symbol=AAPL`, { headers: { 'X-Finnhub-Token': key }, label: LABEL });
    if (!r.ok || !(num(r.body?.c) > 0)) throw new DataError('Finnhub 未接受此金鑰');
    return { plan: 'free', tier: 'free', perMinute: 60 };
  },
  news: async (id, date, ctx) => parseNews(await get('/company-news', { symbol: id, from: date, to: addDays(date, 1) }, ctx), ctx.market?.tz, id),
  marketNews: async (date, ctx) => parseNews(await get('/news', { category: 'general' }, ctx), ctx.market?.tz).filter(n => n.date.slice(0, 10) >= date),
  valuation: async (id, from, to, ctx) => parseMetric(await get('/stock/metric', { symbol: id, metric: 'all' }, ctx), id, to),
};
