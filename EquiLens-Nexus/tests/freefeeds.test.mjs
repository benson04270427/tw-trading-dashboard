import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMis } from '../lib/providers/twsemis.mjs';
import { parseHistorical, parseWatchlist, parseChart, money } from '../lib/providers/nasdaq.mjs';

test('twse mis: stock and index rows', () => {
  const body = { rtcode: '0000', msgArray: [
    { c: '2330', ex: 'tse', d: '20261022', t: '13:30:00', z: '2385.0000', y: '2420.0000', o: '2435.0000', h: '2435.0000', l: '2385.0000', v: '22651', a: '2390.0000_2395.0000_', b: '2385.0000_2380.0000_' },
    { c: '6664', ex: 'otc', d: '20261022', t: '13:30:00', z: '-', trade: { z: '330.0000' }, y: '348.0000', o: '348.0000', h: '355.0000', l: '330.0000', v: '375' },
    { tv: '-', s: '-', c: '', z: '-' },
    { c: 't00', ex: 'tse', d: '20261022', t: '13:33:00', z: '46041.43', y: '46887.77', o: '46942.75', h: '47332.18', l: '46041.43', m: '11818813' },
  ] };
  const r = parseMis(body), tsmc = r.find(x => x.stock_id === '2330'), q = r.find(x => x.stock_id === '6664'), ix = r.find(x => x.stock_id === '001');
  assert.equal(r.length, 3);
  assert.equal(tsmc.close, 2385); assert.equal(tsmc.change_price, -35); assert.equal(tsmc.total_volume, 22651); assert.equal(tsmc.date, '2026-10-22 13:30:00'); assert.equal(tsmc.buy_price, 2385);
  assert.equal(q.close, 330); assert.equal(q.change_price, -18);
  assert.equal(ix.close, 46041.43); assert.equal(ix.total_volume, null); assert.equal(ix.total_amount, 11818813e6);
});

test('nasdaq: historical, quotes and chart', () => {
  assert.equal(money('$1,207.82'), 1207.82); assert.equal(money('-12.51%'), -12.51); assert.equal(money('N/A'), null);
  const h = parseHistorical({ tradesTable: { rows: [{ date: '10/22/2026', close: '$207.82', volume: '12,538,390', open: '$223.15', high: '$224.56', low: '$204.38' }, { date: '10/21/2026', close: '$237.53', volume: '5,000,001', open: '$240.44', high: '$243.6357', low: '$232.8616' }] } }, 'COHR');
  assert.deepEqual(h.map(x => x.date), ['2026-10-21', '2026-10-22']); assert.equal(h[1].spread, -29.71); assert.equal(h[1].max, 224.56); assert.equal(h[1].Trading_Volume, 12538390);
  const q = parseWatchlist([{ symbol: 'COHR', lastSalePrice: '$207.82', netChange: '-29.71', percentageChange: '-12.51%', lastTradeTimestampDateTime: '2026-10-22T00:00:00', volume: '12,538,425', previousClosePrice: 237.53, openingPrice: 224.56, marketStatus: 'Market Closed' }], new Date('2026-10-23T06:00:00Z'));
  assert.equal(q[0].stock_id, 'COHR'); assert.equal(q[0].close, 207.82); assert.equal(q[0].change_price, -29.71); assert.equal(q[0].date, '2026-10-22 16:00:00'); assert.equal(q[0].open, 224.56);
  const c = parseChart({ chart: [{ x: Date.parse('2026-10-22T04:00:00Z'), y: 224.45 }, { x: Date.parse('2026-10-22T09:30:00Z'), y: 223.1 }, { x: Date.parse('2026-10-22T15:59:00Z'), y: 208 }] }, '2026-10-22');
  assert.deepEqual(c.map(x => x[0]), ['09:30', '15:59']);
});

import { parseNews as fhNews, parseMetric } from '../lib/providers/finnhub.mjs';
import { parseIncome } from '../lib/providers/fmp.mjs';
test('finnhub and fmp parsers', () => {
  const n = fhNews([{ datetime: 1792680000, headline: 'Coherent falls', url: 'https://x/a', source: 'Reuters', related: 'COHR' }, { headline: '' }], 'America/New_York', 'COHR');
  assert.equal(n.length, 1); assert.equal(n[0].stock_id, 'COHR'); assert.match(n[0].date, /^2026-10-2\d \d\d:\d\d:\d\d$/);
  assert.deepEqual(parseMetric({ metric: { peTTM: 56.3, pbQuarterly: 4.2, currentDividendYieldTTM: 0 } }, 'COHR', '2026-10-22'), [{ date: '2026-10-22', stock_id: 'COHR', PER: 56.3, PBR: 4.2, dividend_yield: 0 }]);
  assert.deepEqual(parseMetric({}, 'X', 'd'), []);
  const q = parseIncome([{ date: '2026-06-30', period: 'Q4', fiscalYear: '2026', revenue: 1.6e9, filingDate: '2026-08-15' }, { date: '2025-12-31', period: 'FY', fiscalYear: '2025', revenue: 6e9 }], 'COHR');
  assert.equal(q[1].revenue_quarter, 4); assert.equal(q[0].revenue_quarter, 4); assert.equal(q[1].create_time, '2026-08-15');
});

import { parseFacts } from '../lib/providers/sec.mjs';
test('SEC EDGAR companyfacts → 季營收（合併標籤、第 4 季由全年扣前三季）', () => {
  const v = (start, end, val, filed = end) => ({ start, end, val, filed });
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [v('2022-01-01', '2022-03-31', 1)] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
      v('2024-01-01', '2024-03-31', 100), v('2024-04-01', '2024-06-30', 110), v('2024-07-01', '2024-09-30', 120),
      v('2024-01-01', '2024-12-31', 460), v('2024-01-01', '2024-06-30', 210), v('2025-01-01', '2025-03-31', 139, '2025-04-30'), v('2025-01-01', '2025-03-31', 140, '2025-07-30')] } } } } };
  const rows = parseFacts(facts, 'COHR');
  assert.deepEqual(rows.map(r => [r.revenue_year, r.revenue_quarter, r.revenue]), [[2022, 1, 1], [2024, 1, 100], [2024, 2, 110], [2024, 3, 120], [2024, 4, 130], [2025, 1, 140]]);
  assert.equal(rows[0].stock_id, 'COHR');
  assert.deepEqual(parseFacts({ facts: { 'ifrs-full': { Revenue: { units: { USD: [v('2025-04-01', '2025-06-30', 50)] } } } } }, 'NBIS').map(r => r.revenue), [50]);
  assert.deepEqual(parseFacts({}, 'X'), []);
});
test('SEC EDGAR：6 月結帳的公司，換標籤後的季度與年報推得的第 4 季', () => {
  const v = (start, end, val) => ({ start, end, val, filed: end });
  const facts = { facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [v('2024-12-29', '2025-03-29', 425), v('2024-06-30', '2025-06-28', 1645), v('2025-06-29', '2026-06-27', 3014)] } },
    RevenueFromContractWithCustomerIncludingAssessedTax: { units: { USD: [v('2025-06-29', '2025-09-27', 534), v('2025-09-28', '2025-12-27', 665), v('2025-06-29', '2026-03-28', 2007), v('2025-12-28', '2026-03-28', 808), v('2025-06-29', '2026-06-27', 3014)] } } } } };
  assert.deepEqual(parseFacts(facts, 'LITE').map(r => [r.revenue_year, r.revenue_quarter, r.revenue]), [[2025, 1, 425], [2025, 3, 534], [2025, 4, 665], [2026, 1, 808], [2026, 2, 1007]]);
});
