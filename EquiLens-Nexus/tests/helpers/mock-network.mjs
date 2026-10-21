// 測試用：以 node --import 載入，取代對外的 fetch（FinMind、證交所、櫃買），回傳權證追蹤測試用的固定資料。
// 每次請求記錄到 MOCK_LOG（一行一個網址），供測試檢查請求次數。
import fs from 'node:fs';
const realFetch = globalThis.fetch, log = process.env.MOCK_LOG;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const weekdays = n => { const out = []; for (let d = Date.now() + 8 * 3600e3; out.length < n; d -= 864e5) { const x = new Date(d); if (x.getUTCDay() % 6) out.unshift(x.toISOString().slice(0, 10)); } return out; };
// 權證：030001／030002 是奇鋐（3017）的認購權證（凱基、元大發行），03001P 是認售，030009 對應已到期的舊標的
const SUMMARY = [
  { stock_id: '030001', date: '2026-03-02', target_stock_id: '3017', type: '認購', end_date: '2027-03-01', exercise_ratio: 0.05, fulfillment_price: 1000 },
  { stock_id: '030002', date: '2026-05-04', target_stock_id: '3017', type: '認購', end_date: '2027-02-01', exercise_ratio: 50, fulfillment_price: 1200 },
  { stock_id: '03001P', date: '2026-05-04', target_stock_id: '3017', type: '認售', end_date: '2027-02-01', exercise_ratio: 0.05, fulfillment_price: 900 },
  { stock_id: '030009', date: '2024-01-02', target_stock_id: '2330', type: '認購', end_date: '2025-12-31', exercise_ratio: 0.01, fulfillment_price: 600 },
  { stock_id: '030009', date: '2026-01-05', target_stock_id: '2454', type: '認購', end_date: '2027-01-04', exercise_ratio: 0.02, fulfillment_price: 1300 },
];
const MI_INDEX = { stat: 'OK', tables: [{ title: '價格指數', fields: ['指數'], data: [['x']] }, { title: '每日收盤行情(認購權證(不含牛證))', fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價'],
  data: [['030001', '奇鋐凱基56購01', '3,000,000', '120', '6,000,000', '1.9', '2.1', '1.9', '2.05'], ['030002', '奇鋐元大56購02', '1,000,000', '40', '1,500,000', '1.4', '1.6', '1.4', '1.50'], ['030009', '聯發科群益56購01', '500,000', '9', '600,000', '1.2', '1.2', '1.2', '1.20']] }] };
const STOCK_ROWS = id => id === '9268' ? [{ stock_id: '3017', securities_trader: '凱基台北', securities_trader_id: '9268', price: 1000, buy: 200000, sell: 0 }] : [{ stock_id: '2330', securities_trader: '凱基', securities_trader_id: '9200', price: 1450, buy: 1000, sell: 0 }];
const WARRANT_ROWS = id => id === '9268'
  ? [{ stock_id: '030001', securities_trader: '凱基台北', securities_trader_id: '9268', price: 2, buy: 3000000, sell: 0 }, { stock_id: '03001P', securities_trader: '凱基台北', securities_trader_id: '9268', price: 1, buy: 900000, sell: 0 }, { stock_id: '999999', securities_trader: '凱基台北', securities_trader_id: '9268', price: 1, buy: 1000, sell: 0 }]
  : [{ stock_id: '030001', securities_trader: '凱基', securities_trader_id: '9200', price: 2, buy: 0, sell: 2500000 }, { stock_id: '030002', securities_trader: '凱基', securities_trader_id: '9200', price: 1.5, buy: 400000, sell: 0 }];
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url?.url || url));
  if (/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return realFetch(url, opts);
  if (log) fs.appendFileSync(log, u.pathname + u.search + '\n');
  const q = u.searchParams;
  if (u.hostname === 'api.finmindtrade.com') {
    if (u.pathname.endsWith('/taiwan_stock_trading_daily_report')) return json({ status: 200, data: STOCK_ROWS(q.get('securities_trader_id')).map(r => ({ ...r, date: q.get('date') })) });
    if (u.pathname.endsWith('/taiwan_stock_warrant_trading_daily_report')) {
      if (q.get('data_id')) return json({ status: 200, data: [{ stock_id: q.get('data_id'), securities_trader: '凱基台北', securities_trader_id: '9268', price: 2, buy: 3000000, sell: 0, date: q.get('date') }, { stock_id: q.get('data_id'), securities_trader: '元大', securities_trader_id: '9800', price: 2, buy: 0, sell: 1000000, date: q.get('date') }] });
      return json({ status: 200, data: WARRANT_ROWS(q.get('securities_trader_id')).map(r => ({ ...r, date: q.get('date') })) });
    }
    const ds = q.get('dataset');
    if (ds === 'TaiwanStockInfoWithWarrantSummary') return json({ status: 200, data: q.get('data_id') ? SUMMARY.filter(r => r.target_stock_id === q.get('data_id')) : SUMMARY });
    if (ds === 'TaiwanStockTradingDate') return json({ status: 200, data: weekdays(40).map(date => ({ date })) });
    return json({ status: 200, data: [] });
  }
  if (u.hostname === 'www.twse.com.tw' && u.pathname.includes('MI_INDEX') && q.get('type') === '0999') return json(MI_INDEX);
  if (u.hostname === 'www.tpex.org.tw' && u.pathname.endsWith('tpex_warrant_daily_quts')) return json([{ Date: '1140101', Code: '700001', Name: '某某元大5A購01', 'TradeVol.': '1000', TradeValue: '5000', Close: '5', UnderlyingStockCode: '6488' }]);
  return json({ msg: 'offline' }, 503);
};
