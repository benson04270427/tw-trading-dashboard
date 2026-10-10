import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatmap, queryHeatmap, normalizeSector, resolveSessions, validHeatDate, cacheableHeatmap, buildLiveHeatmap, liveWindow } from '../lib/heatmap.mjs';

const universe = [
  { id: '2330', name: '台積電', sector: '半導體業', market: '上市' },
  { id: '2454', name: '聯發科', sector: '半導體業', market: '上市' },
  { id: '3105', name: '穩懋', sector: '半導體業', market: '上櫃' },
  { id: '2317', name: '鴻海', sector: '其他電子業', market: '上市' },
  { id: '6147', name: '頎邦', sector: '其他電子類', market: '上櫃' },
];
const row = (id, date, close, spread, money, volume = 1e6) => ({ stock_id: id, date, close, spread, Trading_money: money, Trading_Volume: volume, open: close, max: close, min: close });

test('sector names from TWSE/TPEx are merged and suffixes normalized', () => {
  assert.equal(normalizeSector('其他電子類'), '其他電子業');
  assert.equal(normalizeSector('數位雲端類'), '數位雲端');
  assert.equal(normalizeSector('創新版股票'), '創新板股票');
  assert.equal(normalizeSector('半導體業'), '半導體業');
  assert.equal(normalizeSector(''), '未分類');
});

test('heatmap aggregates money, money-weighted change, breadth, limit moves and day-over-day money', () => {
  const d = '2026-09-21', p = '2026-09-18';
  const rows = [row('2330', d, 1000, 10, 300e8), row('2454', d, 1100, 100, 100e8), row('3105', d, 90, -10, 10e8), row('2317', d, 200, -2, 50e8), row('6147', d, 50, 0, 5e8),
    row('9999', d, 10, 1, 1e8), row('2330', '2026-09-18', 990, 0, 1e8), { ...row('0050', d, 100, 1, 1e8) }];
  const previous = [row('2330', p, 990, 0, 200e8), row('2454', p, 1000, 0, 100e8), row('2317', p, 202, 0, 100e8)];
  const h = buildHeatmap(d, { universe, rows, previous, previousDate: p });
  assert.equal(h.total.count, 5, 'only universe common stocks on the date');
  assert.equal(h.sectors[0].name, '半導體業');
  assert.equal(h.sectors.length, 2, 'TPEx 其他電子類 merged into 其他電子業');
  const semi = h.sectors[0];
  assert.equal(semi.money, 410e8);
  // 2330: 10/990=1.0101%, 2454: 100/1000=10%, 3105: -10/100=-10%
  const expected = (10 / 990 * 100 * 300 + 10 * 100 + -10 * 10) / 410;
  assert.ok(Math.abs(semi.change - Math.round(expected * 100) / 100) < 1e-9);
  assert.equal(semi.up, 2); assert.equal(semi.down, 1); assert.equal(semi.limitUp, 1); assert.equal(semi.limitDown, 1);
  assert.equal(semi.moneyChange, Math.round(((300 + 100) / (200 + 100) - 1) * 1000) / 10, 'only stocks traded both days');
  const other = h.sectors[1]; assert.equal(other.flat, 1); assert.equal(other.moneyChange, -50);
  assert.equal(h.total.limitUp, 1); assert.equal(h.total.twse.count, 3); assert.equal(h.total.tpex.count, 2);
  assert.ok(Math.abs(h.sectors.reduce((a, s) => a + s.share, 0) - 100) < 0.05);
  assert.deepEqual(semi.stocks.map(s => s.id), ['2330', '2454', '3105'], 'stocks ordered by money');
});

test('zero-volume and invalid rows are excluded, missing previous day leaves money change empty', () => {
  const d = '2026-09-21';
  const h = buildHeatmap(d, { universe, rows: [row('2330', d, 1000, 5, 0), row('2454', d, 0, 0, 1e8), row('2317', d, 100, 1, 1e8)] });
  assert.equal(h.total.count, 1); assert.equal(h.sectors[0].moneyChange, null); assert.equal(h.previousDate, null);
});

test('non-trading request date resolves to latest session and previous session', async () => {
  const calls = [];
  const calendar = ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22'].map(date => ({ date }));
  const requestData = async (dataset, params) => { calls.push([dataset, params.start_date]); if (dataset === 'TaiwanStockTradingDate') return calendar; const date = params.start_date; return universe.map(u => row(u.id, date, 100, 1, 1e8)); };
  assert.deepEqual(resolveSessions(calendar, '2026-09-20'), { session: '2026-09-18', previous: '2026-09-17' });
  const h = await queryHeatmap('2026-09-20', { universe, requestData });
  assert.equal(h.date, '2026-09-18'); assert.equal(h.previousDate, '2026-09-17'); assert.equal(h.requestedDate, '2026-09-20');
  assert.deepEqual(calls.map(c => c[0]), ['TaiwanStockTradingDate', 'TaiwanStockPrice', 'TaiwanStockPrice']);
});

test('unpublished session is an error and never cached; date validation rejects traversal', async () => {
  const requestData = async dataset => dataset === 'TaiwanStockTradingDate' ? [{ date: '2026-09-21' }] : [];
  await assert.rejects(queryHeatmap('2026-09-21', { universe, requestData }), /尚未公布/);
  await assert.rejects(queryHeatmap('2026-09-21', { universe: [], requestData }), /股票基本資料/);
  assert.equal(validHeatDate('../../x'), false); assert.equal(validHeatDate('2026-02-30'), false); assert.equal(validHeatDate('2026-09-21', '2026-09-29'), true); assert.equal(validHeatDate('2026-09-30', '2026-09-29'), false);
  assert.equal(cacheableHeatmap(buildHeatmap('2026-09-21', { universe, rows: [row('2330', '2026-09-21', 1, 0, 1)] })), false);
});

const tick = (id, date, close, change, amount, vol) => ({ stock_id: id, date, close, change_price: change, total_amount: amount, total_volume: vol, open: close, high: close, low: close, change_rate: 0 });
test('live snapshot builds an intraday heatmap from cumulative amount, skipping stale and non-universe rows', () => {
  const t = '2026-09-30';
  const snap = [tick('2330', `${t} 10:31:23.098000`, 1010, 10, 300e8, 30000), tick('2454', `${t} 10:31:20.000000`, 1100, 100, 100e8, 9000),
    tick('2317', '2026-09-29 13:30:00.000000', 200, -2, 50e8, 25000), tick('001', `${t} 10:31:25.000000`, 22000, 100, 1e12, 1), tick('3105', `${t} 10:30:00.000000`, 0, 0, 0, 0)];
  const h = buildLiveHeatmap(snap, { universe, today: t });
  assert.equal(h.live, true); assert.equal(h.date, t); assert.equal(h.asOf, `${t}T10:31:23`);
  assert.equal(h.total.count, 2, 'stale 2317, index 001 and untraded 3105 excluded');
  assert.equal(h.total.money, 400e8); assert.equal(h.sectors[0].stocks[0].volume, 30000, 'total_volume is in lots');
  assert.equal(h.sectors[0].stocks[0].change, 1, '10 / (1010 - 10)');
  assert.equal(h.total.moneyChange, null, 'no intraday vs full-day comparison');
  assert.throws(() => buildLiveHeatmap(snap.slice(2, 3), { universe, today: t }), /尚無盤中行情/);
});
test('live window is weekdays 09:00-13:35 Taipei', () => {
  const at = s => liveWindow(new Date(s));
  assert.equal(at('2026-09-30T01:00:00Z'), true);  // Wed 09:00
  assert.equal(at('2026-09-30T00:59:00Z'), false); // 08:59
  assert.equal(at('2026-09-30T05:34:00Z'), true);  // 13:34
  assert.equal(at('2026-09-30T05:35:00Z'), false); // 13:35
  assert.equal(at('2026-10-03T02:00:00Z'), false); // Sat
});
