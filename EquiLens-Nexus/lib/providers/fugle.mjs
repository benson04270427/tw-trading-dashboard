// 富果 Fugle 行情 API（台股，需金鑰）：盤中全市場快照（開發者／進階方案）、分 K（盤中與歷史）、日 K 歷史（含還原）。
// 沒有法人、分點、新聞等籌碼資料，可搭配證交所開放資料或 FinMind。
import { DataError, fetchJSON, limiter, num, addDays, httpError } from './common.mjs';

const BASE = 'https://api.fugle.tw/marketdata/v1.0/stock';
const LABEL = 'Fugle 富果';
const queue = limiter(150);
async function get(path, ctx) {
  return queue(async () => {
    const r = await fetchJSON(BASE + path, { headers: { 'X-API-KEY': ctx.key }, signal: ctx.signal, label: LABEL });
    if (r.status === 404) return null; // 查詢範圍沒有資料
    if (!r.ok) throw httpError(LABEL, r.status, r.body?.message);
    return r.body;
  }, ctx);
}
const hmOf = iso => /T(\d{2}:\d{2})/.exec(String(iso))?.[1] || null;

// 盤中快照：上市（TSE）＋上櫃（OTC）普通股。成交量單位自動判斷（張或股），統一成張
export function parseSnapshot(body, lot = 1000) {
  const date = body?.date, out = [];
  const items = (body?.data || []).filter(x => x.closePrice > 0 || x.lastPrice > 0);
  // 成交金額 ÷（量 × 價）≈ 1000 表示量的單位是張；≈ 1 表示是股
  const sample = items.filter(x => x.tradeVolume > 0 && x.tradeValue > 0).slice(0, 50).map(x => x.tradeValue / (x.tradeVolume * (x.closePrice || x.lastPrice)));
  const ratio = sample.length ? sample.sort((a, b) => a - b)[Math.floor(sample.length / 2)] : lot;
  const toLots = ratio > lot / 10 ? 1 : 1 / lot;
  for (const x of items) {
    const close = x.lastPrice || x.closePrice, ts = Number(x.lastUpdated);
    const time = ts ? new Date(ts > 1e14 ? ts / 1000 : ts > 1e11 ? ts : ts * 1000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false }) : (body.time || '13:30:00');
    out.push({ stock_id: x.symbol, date: `${date} ${time}`, open: x.openPrice, high: x.highPrice, low: x.lowPrice, close, change_price: x.change, change_rate: x.changePercent, total_volume: (x.tradeVolume ?? 0) * toLots, total_amount: x.tradeValue ?? 0, yesterday_volume: null, buy_price: null, sell_price: null });
  }
  return out;
}

export default {
  id: 'fugle', name: 'Fugle 富果行情', site: 'https://developer.fugle.tw', docs: 'https://developer.fugle.tw/docs/data/intro', markets: ['TW'],
  key: 'required', keyEnv: 'FUGLE_API_KEY', interval: 150,
  caps: { snapshot: 'paid', intraday: 1, daily: 1, adjusted: 1 },
  snapshotMode: 'market',
  async validate(key) {
    const r = await fetchJSON(`${BASE}/intraday/quote/2330`, { headers: { 'X-API-KEY': key }, label: LABEL });
    if (!r.ok) throw new DataError('Fugle 未接受此金鑰');
    // 快照需開發者以上方案；試一次就知道
    const s = await fetchJSON(`${BASE}/snapshot/quotes/TSE?type=COMMONSTOCK`, { headers: { 'X-API-KEY': key }, label: LABEL });
    return { plan: s.ok ? 'developer+' : 'basic', tier: s.ok ? 'paid' : 'free' };
  },
  snapshot: async (ids, ctx) => {
    const [a, b] = [await get('/snapshot/quotes/TSE?type=COMMONSTOCK', ctx), await get('/snapshot/quotes/OTC?type=COMMONSTOCK', ctx)];
    return [...parseSnapshot(a), ...parseSnapshot(b)];
  },
  // 分 K：今天用盤中 API，過去日期用歷史 API（2023-05-23 以後）；成交量單位為張
  intraday: async (id, date, ctx) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const body = date === today ? await get(`/intraday/candles/${id}?timeframe=1`, ctx) : await get(`/historical/candles/${id}?timeframe=1&from=${date}&to=${date}&sort=asc`, ctx);
    return (body?.data || []).filter(c => String(c.date).startsWith(date) && c.close > 0).map(c => [hmOf(c.date), c.open, c.high, c.low, c.close, c.volume]).filter(r => r[0]);
  },
  // 日 K：每次查詢需少於一年，分段取得；成交量單位為股
  daily: async (id, from, to, ctx) => {
    const fetchRange = async adjusted => {
      const rows = [];
      for (let a = from; a <= to; a = addDays(a, 360)) {
        const b = addDays(a, 359) < to ? addDays(a, 359) : to;
        const body = await get(`/historical/candles/${id}?timeframe=D&from=${a}&to=${b}&sort=asc&fields=open,high,low,close,volume,turnover,change${adjusted ? '&adjusted=true' : ''}`, ctx);
        for (const c of body?.data || []) if (c.close > 0) rows.push({ date: c.date, stock_id: id, open: c.open, max: c.high, min: c.low, close: c.close, Trading_Volume: c.volume, Trading_money: c.turnover ?? null, spread: num(c.change) });
      }
      return rows;
    };
    return { price: await fetchRange(false), adjusted: await fetchRange(true) };
  },
};
