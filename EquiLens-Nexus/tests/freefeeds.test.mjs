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
