// FinMind（台股）：股票清單、交易日曆、日成交與還原股價、法人、月營收、本益比、個股新聞、股權分散、期貨與融資。
// Sponsor 方案另有：全市場即時快照、分 K、全市場單日資料、全市場新聞、券商分點。
import { getSecret } from '../secrets.mjs';
import { normalizeUniverse } from '../engine.mjs';
import { kbarRows } from '../insight.mjs';
import { DataError, stopped, sleep, addDays } from './common.mjs';

export const DATASETS = { price: 'TaiwanStockPrice', adjusted: 'TaiwanStockPriceAdj', institutions: 'TaiwanStockInstitutionalInvestorsBuySell', revenue: 'TaiwanStockMonthRevenue', valuation: 'TaiwanStockPER' };
const tokenOf = t => t ?? getSecret('finmind', 'FINMIND_API_TOKEN');
let lastRequest = 0, requestTail = Promise.resolve();

// 所有 FinMind 請求共用一條佇列（含金鑰驗證），避免瞬間大量請求
// timeout：大型資料集（例如權證標的對照表約需 1 分鐘）可延長
export async function request(dataset, params = {}, { interval = 7000, token, signal, timeout = 45000 } = {}) {
  const previous = requestTail; let release;
  requestTail = new Promise(r => release = r);
  await previous;
  try {
    const delay = Math.max(0, lastRequest + interval - Date.now());
    if (delay) await sleep(delay, signal);
    if (signal?.aborted) throw stopped();
    const secret = await tokenOf(token);
    // dataset 以「/」開頭時為獨立端點（例如依券商代碼查分點：/taiwan_stock_trading_daily_report）
    const path = dataset.startsWith('/'), url = new URL(`https://api.finmindtrade.com/api/v4${path ? dataset : '/data'}`);
    url.search = new URLSearchParams(path ? params : { dataset, ...params }).toString();
    lastRequest = Date.now();
    return await fetchData(url, secret, signal, dataset, timeout);
  } finally { release(); }
}
async function fetchData(url, secret, signal, label, timeout) {
  let response;
  try { response = await fetch(url, { headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
  catch { if (signal?.aborted) throw stopped(); throw new DataError('FinMind 連線失敗或逾時'); }
  let body; try { body = await response.json(); } catch { throw new DataError('FinMind 回傳格式無法辨識'); }
  const status = Number(body.status || response.status);
  if (!response.ok || status !== 200) {
    if ([401, 403].includes(status)) throw new DataError('{label}：金鑰或方案權限不足', { label }, { fatal: status === 401, code: 'auth' });
    if ([402, 429].includes(status) || /limit|quota|次數|上限/i.test(String(body.msg))) throw new DataError('FinMind 額度或頻率限制，已保留進度，稍後可續傳', null, { fatal: true, code: 'quota' });
    // 帳號等級不足（例如 Sponsor 到期變回免費）：FinMind 回 400「Your level is register…」
    if (/your level|user level|sponsor/i.test(String(body.msg))) throw new DataError('{label}：FinMind 帳號目前不是 Sponsor 等級，沒有此資料的權限', { label }, { code: 'plan' });
    throw new DataError('{label}：資料服務回應 {status}', { label, status });
  }
  if (!Array.isArray(body.data)) throw new DataError('{label}：資料欄位格式錯誤', { label });
  return body.data;
}
// 盤中即時快照（Sponsor 方案，約每 10 秒更新）：一次取回全市場；不排入日資料佇列，避免被長時間更新卡住。
export async function tickSnapshot({ token, signal } = {}) {
  const url = new URL('https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot');
  url.search = new URLSearchParams({ data_id: '' }).toString();
  return fetchData(url, await tokenOf(token), signal, 'FinMind 即時快照', 20000);
}
export async function universe(options = {}) {
  const info = await request('TaiwanStockInfo', {}, options);
  const delisted = await request('TaiwanStockDelisting', {}, options);
  return normalizeUniverse(info, delisted, options.cutoff);
}
const range = (id, from, to) => ({ ...(id ? { data_id: id } : {}), start_date: from, ...(to ? { end_date: to } : {}) });

// 當沖盤前資料（Sponsor，全市場依日期）：當日可當沖標的（盤前公布）、暫停交易、暫停先賣後買、參考價。
// 個別資料集失敗時該項留空並記下原因，其餘照用。
export function parseDayTradePrep({ list, suspended, sellFirst, limits }, date) {
  const ids = rows => [...new Set((rows || []).map(r => String(r.stock_id)))];
  const eligible = list ? ids(list.filter(r => r.date === date)) : null;
  const susp = ids((suspended || []).filter(r => r.date <= date && (!r.resumption_date || r.resumption_date > date)));
  const off = ids((sellFirst || []).filter(r => r.date <= date && (!r.end_date || r.end_date >= date)));
  const ref = Object.fromEntries((limits || []).filter(r => r.date === date && r.reference_price > 0).map(r => [String(r.stock_id), r.reference_price]));
  return { eligible: eligible?.length ? eligible : null, suspended: susp, sellFirstOff: off, ref };
}
async function dayTradePrep(date, ctx) {
  const errors = [], get = async (dataset, params) => { try { return await request(dataset, params, ctx); } catch (e) { errors.push(`${dataset}：${e.message}`); return null; } };
  const list = await get('TaiwanStockDayTrading', { start_date: date, end_date: date });
  const suspended = await get('TaiwanStockSuspended', { start_date: addDays(date, -30), end_date: date });
  const sellFirst = await get('TaiwanStockDayTradingSuspension', { start_date: addDays(date, -40), end_date: date });
  const limits = await get('TaiwanStockPriceLimit', { start_date: date, end_date: date });
  return { ...parseDayTradePrep({ list, suspended, sellFirst, limits }, date), errors };
}

export default {
  id: 'finmind', name: 'FinMind', site: 'https://finmindtrade.com', docs: 'https://finmind.github.io/', markets: ['TW'],
  key: 'required', keyEnv: 'FINMIND_API_TOKEN', interval: 1000,
  // 1：免費可用；'sponsor'：需 Sponsor 方案
  caps: { dayTrade: 'sponsor', universe: 1, calendar: 1, daily: 1, adjusted: 1, dailyAll: 'sponsor', snapshot: 'sponsor', intraday: 'sponsor', news: 1, marketNews: 'sponsor', valuation: 1, revenue: 'monthly', institutional: 1, institutionalAll: 'sponsor', brokers: 'sponsor', holders: 1, flows: 1, futures: 1, margin: 1 },
  snapshotMode: 'market',
  async validate(key) {
    const r = await fetch('https://api.web.finmindtrade.com/v2/user_info', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (!j || !(Number(j.api_request_limit) > 0)) throw new DataError('FinMind 未接受此金鑰');
    const level = Number(j.level) || 0;
    return { plan: j.level_title || `level ${level}`, tier: level >= 3 ? 'sponsor' : 'free', limitHour: Number(j.api_request_limit_hour) || null };
  },
  universe: ctx => universe(ctx),
  calendar: async (from, ctx) => [...new Set((await request('TaiwanStockTradingDate', from ? { start_date: from } : {}, ctx)).map(r => r.date))].sort(),
  daily: async (id, from, to, ctx) => ({ price: await request(DATASETS.price, range(id, from, to), ctx), adjusted: await request(DATASETS.adjusted, range(id, from, to), ctx) }),
  dailyAll: (date, ctx) => request(DATASETS.price, range(null, date, date), ctx),
  dailyAllAdjusted: (date, ctx) => request(DATASETS.adjusted, range(null, date, date), ctx),
  snapshot: (ids, ctx) => tickSnapshot(ctx),
  intraday: async (id, date, ctx) => kbarRows(await request('TaiwanStockKBar', { data_id: id, start_date: date }, ctx), date),
  news: (id, date, ctx) => request('TaiwanStockNews', { data_id: id, start_date: date }, ctx),
  marketNews: (date, ctx) => request('TaiwanStockNews', { start_date: date }, ctx),
  valuation: (id, from, to, ctx) => request(DATASETS.valuation, range(id, from, to), ctx),
  revenue: (id, from, to, ctx) => request(DATASETS.revenue, range(id, from, to), ctx),
  institutional: (id, from, to, ctx) => request(DATASETS.institutions, range(id, from, to), ctx),
  institutionalAll: (date, ctx) => request(DATASETS.institutions, range(null, date, date), ctx),
  dayTrade: (date, ctx) => dayTradePrep(date, ctx),
  request, // 台股在地模組（法人籌碼、分點、股權分散、期貨、融資）直接使用
};
