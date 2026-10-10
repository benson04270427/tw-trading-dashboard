// Alpha Vantage（以美股為主，另支援倫敦、多倫多、德國 XETRA、印度 BSE；需金鑰）：日 K、新聞情緒、本益比、季營收、美股清單與分 K。
// 免費方案每天約 25 次請求，只適合少量研究名單；付費方案另有美股批次即時報價。
import { DataError, fetchJSON, limiter, num } from './common.mjs';

const BASE = 'https://www.alphavantage.co/query';
const LABEL = 'Alpha Vantage';
// 衡析市場 → Alpha Vantage 代號後綴
export const SUFFIX = { US: '', GB: '.LON', CA: '.TRT', DE: '.DEX', IN: '.BSE' };
const queue = limiter(1200);
const sym = (id, market) => id + (SUFFIX[market.id] || '');
const unsym = (s, market) => { const x = SUFFIX[market.id]; return x && s.endsWith(x) ? s.slice(0, -x.length) : s; };

async function get(params, ctx, { csv = false } = {}) {
  return queue(async () => {
    const u = new URL(BASE); for (const [k, v] of Object.entries({ ...params, apikey: ctx.key })) if (v != null && v !== '') u.searchParams.set(k, v);
    const r = await fetchJSON(u, { signal: ctx.signal, label: LABEL, text: csv });
    if (!r.ok) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
    const b = r.body;
    if (csv) return b;
    if (b?.['Error Message']) return null; // 查無此股票
    const info = b?.Note || b?.Information;
    if (info) throw new DataError(/premium/i.test(info) ? '{label}：此資料需要付費方案' : '{label} 額度或頻率限制，稍後再試', { label: LABEL }, /premium/i.test(info) ? { code: 'plan' } : { fatal: true, code: 'quota' });
    return b;
  }, ctx);
}
// 20260109T143000 → 2026-01-09 14:30:00
const avTime = s => /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s))?.slice(1).reduce((a, v, i) => a + (i === 1 || i === 2 ? '-' : i === 3 ? ' ' : i > 3 ? ':' : '') + v, '') || null;
export const parseNews = (b, market, only) => (b?.feed || []).flatMap(n => (n.ticker_sentiment || []).map(t => unsym(t.ticker, market)).filter(id => !only || only === id).map(id => ({ date: avTime(n.time_published), stock_id: id, title: n.title, link: n.url, source: n.source })));

export default {
  id: 'alphavantage', name: 'Alpha Vantage', site: 'https://www.alphavantage.co', docs: 'https://www.alphavantage.co/documentation/', markets: Object.keys(SUFFIX),
  key: 'required', keyEnv: 'ALPHAVANTAGE_API_KEY', interval: 1200,
  caps: { universe: ['US'], daily: 1, snapshot: 1, intraday: ['US'], news: 1, marketNews: 1, valuation: 1, revenue: 'quarterly' },
  snapshotMode: 'symbols',
  snapshotLimit: info => info?.tier === 'paid' ? 75 : 5,
  async validate(key) {
    const r = await fetchJSON(`${BASE}?function=GLOBAL_QUOTE&symbol=IBM&apikey=${encodeURIComponent(key)}`, { label: LABEL });
    if (!r.ok || r.body?.['Error Message'] || !r.body?.['Global Quote']) throw new DataError('Alpha Vantage 未接受此金鑰，或今日額度已用完');
    const bulk = await fetchJSON(`${BASE}?function=REALTIME_BULK_QUOTES&symbol=IBM&apikey=${encodeURIComponent(key)}`, { label: LABEL });
    const paid = bulk.ok && Array.isArray(bulk.body?.data);
    return { plan: paid ? 'premium' : 'free', tier: paid ? 'paid' : 'free' };
  },
  // 美股清單（CSV）
  universe: async ctx => {
    if (ctx.market.id !== 'US') throw new DataError('{label} 只提供美股股票清單', { label: LABEL });
    const csv = await get({ function: 'LISTING_STATUS' }, ctx, { csv: true }), lines = String(csv).trim().split(/\r?\n/).slice(1);
    return lines.map(l => l.split(',')).filter(c => c[3] === 'Stock' && ctx.market.symbolRe.test(c[0])).map(c => ({ id: c[0], name: c[1], sector: '', market: c[2] })).sort((a, b) => a.id.localeCompare(b.id));
  },
  daily: async (id, from, to, ctx) => {
    let b = await get({ function: 'TIME_SERIES_DAILY', symbol: sym(id, ctx.market), outputsize: 'full' }, ctx).catch(e => { if (/付費|premium/i.test(e.message)) return null; throw e; });
    if (!b) b = await get({ function: 'TIME_SERIES_DAILY', symbol: sym(id, ctx.market), outputsize: 'compact' }, ctx);
    const series = Object.entries(b?.['Time Series (Daily)'] || {}).filter(([d]) => d >= from && d <= to).sort(([a], [c]) => a.localeCompare(c));
    let prev = null; const price = [];
    for (const [date, v] of series) { const close = num(v['4. close']), vol = num(v['5. volume']) ?? 0; price.push({ date, stock_id: id, open: num(v['1. open']), max: num(v['2. high']), min: num(v['3. low']), close, Trading_Volume: vol, Trading_money: vol * close, spread: prev != null ? Math.round((close - prev) * 1e4) / 1e4 : null }); prev = close; }
    return { price, adjusted: price, adjustedIsRaw: true };
  },
  // 報價：付費方案用美股批次（每次 100 檔），否則逐檔查詢
  snapshot: async (ids, ctx) => {
    const out = [], today = new Date().toLocaleDateString('en-CA', { timeZone: ctx.market.tz });
    const row = (id, q) => { const close = num(q.price ?? q.close), prev = num(q['previous close'] ?? q.previous_close), vol = num(q.volume) ?? 0; return { stock_id: id, date: `${q['latest trading day'] || today} ${new Date().toLocaleTimeString('en-GB', { timeZone: ctx.market.tz, hour12: false })}`, open: num(q.open), high: num(q.high), low: num(q.low), close, change_price: prev ? close - prev : num(q.change), total_volume: vol / ctx.market.lot, total_amount: vol * close, yesterday_volume: null, buy_price: null, sell_price: null }; };
    if (ctx.info?.tier === 'paid' && ctx.market.id === 'US') {
      for (let i = 0; i < ids.length; i += 100) { const b = await get({ function: 'REALTIME_BULK_QUOTES', symbol: ids.slice(i, i + 100).join(',') }, ctx); for (const q of b?.data || []) if (num(q.close) > 0) out.push(row(q.symbol, q)); }
      return out;
    }
    for (const id of ids) { const b = await get({ function: 'GLOBAL_QUOTE', symbol: sym(id, ctx.market) }, ctx), q = b?.['Global Quote']; if (q && num(q['05. price']) > 0) out.push(row(id, Object.fromEntries(Object.entries(q).map(([k, v]) => [k.replace(/^\d+\.\s*/, ''), v])))); }
    return out;
  },
  intraday: async (id, date, ctx) => {
    if (ctx.market.id !== 'US') return [];
    const b = await get({ function: 'TIME_SERIES_INTRADAY', symbol: id, interval: '1min', month: date.slice(0, 7), outputsize: 'full' }, ctx);
    return Object.entries(b?.['Time Series (1min)'] || {}).filter(([t]) => t.startsWith(date)).sort(([a], [c]) => a.localeCompare(c)).map(([t, v]) => [t.slice(11, 16), num(v['1. open']), num(v['2. high']), num(v['3. low']), num(v['4. close']), (num(v['5. volume']) ?? 0) / ctx.market.lot]);
  },
  news: async (id, date, ctx) => parseNews(await get({ function: 'NEWS_SENTIMENT', tickers: sym(id, ctx.market), time_from: date.replace(/-/g, '') + 'T0000', limit: 50 }, ctx), ctx.market, id),
  marketNews: async (date, ctx) => parseNews(await get({ function: 'NEWS_SENTIMENT', time_from: date.replace(/-/g, '') + 'T0000', limit: 1000, sort: 'LATEST' }, ctx), ctx.market),
  valuation: async (id, from, to, ctx) => {
    const b = await get({ function: 'OVERVIEW', symbol: sym(id, ctx.market) }, ctx); if (!b?.Symbol) return [];
    const dy = num(b.DividendYield);
    return [{ date: b.LatestQuarter || to, stock_id: id, PER: num(b.PERatio), PBR: num(b.PriceToBookRatio), dividend_yield: dy == null ? null : Math.round(dy * 1e4) / 100 }];
  },
  // 季營收 → 營收列（revenue_quarter）
  revenue: async (id, from, to, ctx) => {
    const b = await get({ function: 'INCOME_STATEMENT', symbol: sym(id, ctx.market) }, ctx);
    return (b?.quarterlyReports || []).map(q => { const d = q.fiscalDateEnding, m = Number(d.slice(5, 7)); return { date: d, stock_id: id, revenue_year: Number(d.slice(0, 4)), revenue_quarter: Math.ceil(m / 3), revenue: num(q.totalRevenue), create_time: d }; }).filter(r => r.revenue != null).sort((a, b) => a.date.localeCompare(b.date));
  },
};
