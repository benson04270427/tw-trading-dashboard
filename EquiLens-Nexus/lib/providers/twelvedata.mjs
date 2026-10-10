// Twelve Data（全球多市場，需金鑰）：股票清單、日 K、分 K、批次即時報價。
// 依方案以「點數」計費：每檔股票每次查詢 1 點，免費方案每分鐘 8 點，因此盤中監控只適合少量股票，付費方案可監控更多。
import { DataError, fetchJSON, num, sleep } from './common.mjs';

const BASE = 'https://api.twelvedata.com';
const LABEL = 'Twelve Data';
// 衡析市場 → Twelve Data 的國家與交易所
export const VENUE = {
  US: { country: 'United States' }, TW: { country: 'Taiwan' }, JP: { country: 'Japan', exchange: 'JPX' }, HK: { country: 'Hong Kong', exchange: 'HKEX' },
  KR: { country: 'South Korea' }, GB: { country: 'United Kingdom', exchange: 'LSE' }, DE: { country: 'Germany', exchange: 'XETR' }, FR: { country: 'France', exchange: 'Euronext' },
  CA: { country: 'Canada', exchange: 'TSX' }, AU: { country: 'Australia', exchange: 'ASX' }, SG: { country: 'Singapore', exchange: 'SGX' }, IN: { country: 'India', exchange: 'NSE' },
};
// 點數限制：近 60 秒用掉的點數不超過每分鐘上限
const used = [];
async function spend(n, perMinute, signal) {
  for (;;) {
    const now = Date.now(); while (used.length && now - used[0] > 60000) used.shift();
    if (used.length + n <= perMinute) { for (let i = 0; i < n; i++) used.push(now); return; }
    await sleep(Math.max(500, 60000 - (now - used[0]) + 50), signal);
  }
}
const perMinuteOf = ctx => Math.max(1, Number(ctx.perMinute) || 8);
async function get(path, params, ctx, credits = 1) {
  await spend(Math.min(credits, perMinuteOf(ctx)), perMinuteOf(ctx), ctx.signal);
  const u = new URL(BASE + path); for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  const r = await fetchJSON(u, { headers: { Authorization: `apikey ${ctx.key}` }, signal: ctx.signal, label: LABEL });
  const b = r.body;
  if (!r.ok || b?.status === 'error') {
    const code = Number(b?.code || r.status);
    if (code === 429) throw new DataError('{label} 額度或頻率限制，稍後再試', { label: LABEL }, { fatal: true, code: 'quota' });
    if (code === 401 || code === 403) throw new DataError('{label}：金鑰或方案權限不足', { label: LABEL }, { fatal: code === 401, code: 'auth' });
    if (code === 404 || code === 400) return null; // 查無此股票或區間沒有資料
    throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: code });
  }
  return b;
}
const where = market => { const v = VENUE[market.id] || {}; return { country: v.country, exchange: v.exchange }; };
const seriesRows = (b, id) => (b?.values || []).map(v => ({ datetime: v.datetime, open: num(v.open), high: num(v.high), low: num(v.low), close: num(v.close), volume: num(v.volume) ?? 0 })).filter(v => v.close > 0).sort((a, b) => a.datetime.localeCompare(b.datetime));

export function parseQuotes(body, ids, lot = 1, tz = 'UTC') {
  const list = ids.length === 1 && body?.symbol ? [body] : Object.values(body || {}).filter(x => x && x.symbol);
  return list.filter(q => num(q.close) > 0).map(q => {
    const ts = Number(q.last_quote_at || q.timestamp), close = num(q.close), prev = num(q.previous_close);
    const time = ts ? new Date(ts * 1000).toLocaleTimeString('en-GB', { timeZone: tz, hour12: false }) : '00:00:00';
    return { stock_id: q.symbol, date: `${q.datetime?.slice(0, 10)} ${q.datetime?.length > 10 ? q.datetime.slice(11, 19) : time}`, open: num(q.open), high: num(q.high), low: num(q.low), close, change_price: num(q.change) ?? (prev ? close - prev : null), change_rate: num(q.percent_change), total_volume: (num(q.volume) ?? 0) / lot, total_amount: (num(q.volume) ?? 0) * close, yesterday_volume: (num(q.average_volume) ?? 0) / lot || null, buy_price: null, sell_price: null };
  });
}

export default {
  id: 'twelvedata', name: 'Twelve Data', site: 'https://twelvedata.com', docs: 'https://twelvedata.com/docs', markets: Object.keys(VENUE),
  key: 'required', keyEnv: 'TWELVEDATA_API_KEY', interval: 0,
  caps: { universe: 1, daily: 1, snapshot: 1, intraday: 1 },
  snapshotMode: 'symbols',
  // 盤中監控每分鐘可查詢的股票數＝方案每分鐘點數
  snapshotLimit: info => info?.perMinute || 8,
  async validate(key) {
    const r = await fetchJSON(`${BASE}/api_usage`, { headers: { Authorization: `apikey ${key}` }, label: LABEL });
    if (!r.ok || r.body?.status === 'error') throw new DataError('Twelve Data 未接受此金鑰');
    const perMinute = Number(r.body.plan_limit) || 8;
    return { plan: r.body.plan_category || 'basic', tier: perMinute > 8 ? 'paid' : 'free', perMinute, perDay: Number(r.body.plan_daily_limit) || null };
  },
  universe: async ctx => {
    const b = await get('/stocks', { ...where(ctx.market), type: 'Common Stock' }, ctx);
    const seen = new Map();
    for (const s of b?.data || []) if (ctx.market.symbolRe.test(s.symbol) && !seen.has(s.symbol)) seen.set(s.symbol, { id: s.symbol, name: s.name, sector: '', market: s.exchange });
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  },
  daily: async (id, from, to, ctx) => {
    const b = await get('/time_series', { symbol: id, ...where(ctx.market), interval: '1day', start_date: from, end_date: to, order: 'asc', outputsize: 5000 }, ctx);
    let prev = null; const price = [];
    for (const v of seriesRows(b, id)) { price.push({ date: v.datetime.slice(0, 10), stock_id: id, open: v.open, max: v.high, min: v.low, close: v.close, Trading_Volume: v.volume, Trading_money: v.volume * v.close, spread: prev != null ? Math.round((v.close - prev) * 1e4) / 1e4 : null }); prev = v.close; }
    return { price, adjusted: price, adjustedIsRaw: true };
  },
  // 批次報價：每次最多 120 檔，每檔 1 點
  snapshot: async (ids, ctx) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 120) { const chunk = ids.slice(i, i + 120), b = await get('/quote', { symbol: chunk.join(','), ...where(ctx.market) }, ctx, chunk.length); out.push(...parseQuotes(b, chunk, ctx.market.lot, ctx.market.tz)); }
    return out;
  },
  intraday: async (id, date, ctx) => {
    const b = await get('/time_series', { symbol: id, ...where(ctx.market), interval: '1min', start_date: `${date} 00:00:00`, end_date: `${date} 23:59:59`, order: 'asc', outputsize: 5000 }, ctx);
    return seriesRows(b, id).filter(v => v.datetime.startsWith(date)).map(v => [v.datetime.slice(11, 16), v.open, v.high, v.low, v.close, v.volume / ctx.market.lot]);
  },
};
