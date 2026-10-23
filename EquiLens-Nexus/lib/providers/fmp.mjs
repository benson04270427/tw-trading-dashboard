// Financial Modeling Prep（美股，需金鑰，免費方案每天 250 次）：季營收（損益表）、本益比／淨值比。
// 免費方案若不提供季報，改用年報的營收（每年一筆）。
import { DataError, fetchJSON, limiter, num } from './common.mjs';

const BASE = 'https://financialmodelingprep.com/stable';
const LABEL = 'Financial Modeling Prep';
const queue = limiter(600);
async function get(path, params, ctx, { quiet = false } = {}) {
  return queue(async () => {
    const u = new URL(BASE + path); for (const [k, v] of Object.entries({ ...params, apikey: ctx.key })) if (v != null && v !== '') u.searchParams.set(k, v);
    const r = await fetchJSON(u, { signal: ctx.signal, label: LABEL });
    const msg = String(r.body?.['Error Message'] || r.body?.message || '');
    if (r.status === 429 || /limit reach/i.test(msg)) throw new DataError('{label} 額度或頻率限制，稍後再試', { label: LABEL }, { fatal: true, code: 'quota' });
    if (r.status === 401) throw new DataError('{label}：金鑰或方案權限不足', { label: LABEL }, { fatal: true, code: 'auth' });
    if (r.status === 402 || r.status === 403 || /premium|subscription|upgrade/i.test(msg)) { if (quiet) return null; throw new DataError('{label}：此資料需要付費方案', { label: LABEL }, { code: 'plan' }); }
    if (!r.ok) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
    return r.body;
  }, ctx);
}
export function parseIncome(list, id) {
  return (Array.isArray(list) ? list : []).map(q => {
    const d = String(q.date || ''), quarter = /^Q[1-4]$/.test(q.period) ? Number(q.period[1]) : null;
    return { date: d, stock_id: id, revenue_year: Number(q.fiscalYear || q.calendarYear || d.slice(0, 4)), revenue_quarter: quarter ?? 4, // 年報（免費方案沒有季報時）以第 4 季計，年增率即全年年增
      revenue: num(q.revenue), create_time: q.filingDate || d };
  }).filter(r => r.date && r.revenue != null).sort((a, b) => a.date.localeCompare(b.date));
}

export default {
  id: 'fmp', name: 'Financial Modeling Prep', site: 'https://site.financialmodelingprep.com', docs: 'https://site.financialmodelingprep.com/developer/docs', markets: ['US'],
  key: 'required', keyEnv: 'FMP_API_KEY', interval: 600,
  caps: { revenue: 'quarterly', valuation: 1 },
  async validate(key) {
    const r = await fetchJSON(`${BASE}/profile?symbol=AAPL&apikey=${encodeURIComponent(key)}`, { label: LABEL });
    if (!r.ok || !Array.isArray(r.body) || !r.body.length) throw new DataError('Financial Modeling Prep 未接受此金鑰');
    return { plan: 'free', tier: 'free', perDay: 250 };
  },
  revenue: async (id, from, to, ctx) => {
    const q = await get('/income-statement', { symbol: id, period: 'quarter', limit: 12 }, ctx, { quiet: true });
    if (Array.isArray(q) && q.length) return parseIncome(q, id);
    return parseIncome(await get('/income-statement', { symbol: id, limit: 5 }, ctx), id);
  },
  valuation: async (id, from, to, ctx) => {
    const b = await get('/ratios-ttm', { symbol: id }, ctx), x = Array.isArray(b) ? b[0] : b; if (!x) return [];
    const dy = num(x.dividendYieldTTM);
    return [{ date: to, stock_id: id, PER: num(x.priceToEarningsRatioTTM ?? x.peRatioTTM), PBR: num(x.priceToBookRatioTTM), dividend_yield: dy == null ? null : Math.round(dy * 1e4) / 100 }];
  },
};
