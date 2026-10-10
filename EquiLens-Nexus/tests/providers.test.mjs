// 資料源回應 → 衡析內部格式（以模擬回應測試，不連網）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTwseDaily, parseTpexDaily, parseTwseInstitutional, parseTpexInstitutional } from '../lib/providers/twse.mjs';
import { parseQuotes } from '../lib/providers/twelvedata.mjs';
import { parseSnapshot } from '../lib/providers/fugle.mjs';
import { parseNews } from '../lib/providers/alphavantage.mjs';
import { httpError, DataError, rocDate, weekdays } from '../lib/providers/common.mjs';
import { marketProfile } from '../lib/markets.mjs';

test('TWSE / TPEx whole-market daily rows: common stocks only, signed change, numbers without commas', () => {
  const twse = { tables: [{ title: '115年10月08日每日收盤行情(全部(不含權證、牛熊證))', data: [
    ['2330', '台積電', '12,345,678', '45,000', '31,481,478,900', '2,540.00', '2,560.00', '2,530.00', '2,550.00', '<p style= color:red>+</p>', '15.00'],
    ['2603', '長榮', '8,000,000', '6,000', '1,600,000,000', '201.00', '202.00', '198.00', '199.50', '<p style= color:green>-</p>', '2.50'],
    ['0050', '元大台灣50', '1,000', '10', '200,000', '200', '200', '200', '200', '', '0.00'],
    ['2888', '新光金', '0', '0', '0', '--', '--', '--', '--', '', ''],
  ] }] };
  const rows = parseTwseDaily(twse, '2026-10-08');
  assert.deepEqual(rows.map(r => r.stock_id), ['2330', '2603']);
  assert.deepEqual(rows[0], { date: '2026-10-08', stock_id: '2330', Trading_Volume: 12345678, Trading_money: 31481478900, open: 2540, max: 2560, min: 2530, close: 2550, spread: 15 });
  assert.equal(rows[1].spread, -2.5);
  const tpex = { tables: [{ data: [['6488', '環球晶', '420.00', '-5.50', '425.00', '428.00', '418.00', '422.10', '1,234,000', '520,000,000'], ['00679B', '債券ETF', '30.00', '0.10', '30', '30', '30', '30', '1', '30']] }] };
  assert.deepEqual(parseTpexDaily(tpex, '2026-10-08'), [{ date: '2026-10-08', stock_id: '6488', close: 420, spread: -5.5, open: 425, max: 428, min: 418, Trading_Volume: 1234000, Trading_money: 520000000 }]);
});

test('TWSE / TPEx institutional rows map to per-investor buy/sell rows', () => {
  const t86 = { data: [['2330 ', '台積電', '10,000', '4,000', '6,000', '100', '50', '50', '2,000', '500', '1,500', '0', '300', '100', '200', '50', '20', '30', '7,780']] };
  const rows = parseTwseInstitutional(t86, '2026-10-08');
  assert.deepEqual(rows.map(r => [r.name, r.buy, r.sell]), [['Foreign_Investor', 10000, 4000], ['Foreign_Dealer_Self', 100, 50], ['Investment_Trust', 2000, 500], ['Dealer_self', 300, 100], ['Dealer_Hedging', 50, 20]]);
  assert.ok(rows.every(r => r.stock_id === '2330' && r.date === '2026-10-08'));
  const r = ['6488', '環球晶', '1,000', '400', '600', '10', '5', '5', '1,010', '405', '605', '200', '50', '150', '30', '10', '20', '5', '2', '3', '35', '12', '23', '778'];
  assert.deepEqual(parseTpexInstitutional({ tables: [{ data: [r] }] }, '2026-10-08').map(x => [x.name, x.buy, x.sell]), [['Foreign_Investor', 1000, 400], ['Foreign_Dealer_Self', 10, 5], ['Investment_Trust', 200, 50], ['Dealer_self', 30, 10], ['Dealer_Hedging', 5, 2]]);
});

test('Twelve Data quotes: single and batch responses become snapshot rows', () => {
  const one = { symbol: 'AAPL', datetime: '2026-10-09', open: '250', high: '255', low: '249', close: '254', previous_close: '250', change: '4', volume: '1000', average_volume: '2000', timestamp: 1791575400 };
  const [a] = parseQuotes(one, ['AAPL'], 1, 'America/New_York');
  assert.equal(a.stock_id, 'AAPL'); assert.equal(a.close, 254); assert.equal(a.change_price, 4); assert.equal(a.total_amount, 254000); assert.equal(a.yesterday_volume, 2000);
  assert.match(a.date, /^2026-10-09 \d{2}:\d{2}:\d{2}$/);
  const batch = { AAPL: one, MSFT: { ...one, symbol: 'MSFT', close: '500', change: null, previous_close: '490' }, BAD: { symbol: 'BAD', close: '0' } };
  const rows = parseQuotes(batch, ['AAPL', 'MSFT', 'BAD']);
  assert.deepEqual(rows.map(r => [r.stock_id, r.change_price]), [['AAPL', 4], ['MSFT', 10]]);
});

test('Fugle snapshot: volume unit is detected (lots or shares) and normalized to lots', () => {
  const base = { date: '2026-10-08', data: [{ symbol: '2330', openPrice: 2540, highPrice: 2560, lowPrice: 2530, closePrice: 2550, lastPrice: 2550, change: 15, changePercent: 0.59, tradeVolume: 12345, tradeValue: 2550 * 12345 * 1000, lastUpdated: 1791523800000000 }] };
  assert.equal(parseSnapshot(base)[0].total_volume, 12345, 'already in lots');
  const shares = { ...base, data: [{ ...base.data[0], tradeVolume: 12345000 }] };
  assert.equal(parseSnapshot(shares)[0].total_volume, 12345, 'shares converted to lots');
  assert.match(parseSnapshot(base)[0].date, /^2026-10-08 \d{2}:\d{2}:\d{2}$/);
});

test('Alpha Vantage news: market suffix removed, optional single-symbol filter', () => {
  const body = { feed: [{ title: 'Earnings beat', url: 'https://news.example/1', source: 'Example', time_published: '20261009T143000', ticker_sentiment: [{ ticker: 'VOD.LON' }, { ticker: 'BP.LON' }] }] };
  const gb = marketProfile('GB');
  assert.deepEqual(parseNews(body, gb).map(r => [r.stock_id, r.date]), [['VOD', '2026-10-09 14:30:00'], ['BP', '2026-10-09 14:30:00']]);
  assert.deepEqual(parseNews(body, gb, 'BP').map(r => r.stock_id), ['BP']);
});

test('common helpers: HTTP errors carry pause codes; ROC dates; weekdays', () => {
  const auth = httpError('X', 401), quota = httpError('X', 429), other = httpError('X', 500);
  assert.ok(auth instanceof DataError && auth.code === 'auth' && auth.fatal);
  assert.ok(quota.code === 'quota' && quota.fatal);
  assert.ok(!other.code && !other.fatal);
  assert.equal(rocDate('1151008'), '2026-10-08'); assert.equal(rocDate('115/10/08'), '2026-10-08'); assert.equal(rocDate('x'), null);
  assert.deepEqual(weekdays('2026-10-09', '2026-10-13'), ['2026-10-09', '2026-10-12', '2026-10-13']);
});
