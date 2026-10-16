// 看板個股即時走勢（lib/intraday.mjs）：分 K → 價量序列、當日均價線、族群均價線（量能加權、換算到本股價位）、時光機備援
import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesFromBars, seriesFromReplay, replayRef, vwapLine, groupLine } from '../lib/intraday.mjs';
import { marketProfile } from '../lib/markets.mjs';
const tw = marketProfile('TW');
const bar = (m, c, v, amt) => ({ m, o: c, h: c + 1, l: c - 1, c, tv: v, cv: 0, amt });

test('minute series uses trade value when available and estimates it from the typical price otherwise', () => {
  const bars = new Map([[541, bar(541, 101, 10, 1012)], [540, bar(540, 100, 20, 2000)], [542, { m: 542, h: 103, l: 99, c: 102, tv: 0, cv: 30 }], [900, bar(900, 1, 1, 1)]]);
  const s = seriesFromBars(bars, tw);
  assert.deepEqual(s.m, [540, 541, 542], 'sorted, outside the session dropped');
  assert.deepEqual(s.v, [20, 10, 30]); assert.deepEqual(s.cv, [20, 30, 60]);
  assert.equal(s.ca[2], 2000 + 1012 + (103 + 99 + 102) / 3 * 30);
  assert.equal(vwapLine(s)[1], 3012 / 30);
});

test('group line is the amount-weighted VWAP change of the members, mapped onto this stock\'s price', () => {
  const mk = (ref, rows) => ({ ref, s: { m: rows.map(r => r[0]), c: rows.map(r => r[1]), v: [], cv: rows.map(r => r[2]), ca: rows.map(r => r[3]) } });
  const a = mk(100, [[540, 101, 10, 1010], [541, 102, 20, 2030]]);   // VWAP 101 → 101.5（+1%、+1.5%）
  const b = mk(50, [[541, 49, 10, 490]]);                            // 09:01 才有成交，VWAP 49（−2%）
  const line = groupLine([540, 541, 542], [a, b], 200);
  assert.equal(line[0], null, 'fewer than two members traded');
  const w = (0.015 * 2030 + -0.02 * 490) / (2030 + 490);
  assert.equal(line[1], Math.round(200 * (1 + w) * 1e4) / 1e4);
  assert.equal(line[2], line[1], 'carries the last cumulative values forward');
});

test('time-machine frames give the same series when the live stream is not available', () => {
  const day = { ids: ['2330', '2317'], ps: 100, as: 1e6, prev: [100000, 20000], frames: [{ t: '09:00', p: [101000, 20100], a: [10, 1], v: [10, 5] }, { t: '09:01', p: [102000, 20200], a: [31, 2], v: [30, 9] }] };
  const s = seriesFromReplay(day, '2330', tw);
  assert.deepEqual([s.m, s.c, s.v, s.cv], [[540, 541], [1010, 1020], [10, 20], [10, 30]]);
  assert.equal(vwapLine(s)[1], 31e6 / 1000 / 30, 'amount in TWD converted to price × lots');
  assert.equal(replayRef(day, '2330', tw), 1000); assert.equal(seriesFromReplay(day, '9999', tw).m.length, 0);
});

test('engine backfill resets VWAP to the quote average even when the stream volume is slightly ahead of the quote', async () => {
  const { createDayTrade, DT_DEFAULTS } = await import('../lib/daytrade.mjs');
  const date = '2026-10-15', at = hms => Date.parse(`${date}T${hms}+08:00`);
  const e = createDayTrade({ market: tw, date, ids: ['6278'], settings: DT_DEFAULTS, prep: { ref: new Map([['6278', 290]]) } });
  e.ingest([{ kind: 'trade', id: '6278', time: at('12:24:50'), price: 304.5, size: 10, volume: 47600, bid: 304, ask: 304.5, serial: 1 }]); // 重連後第一筆：累計量比 REST 報價新
  assert.equal(e.backfill('6278', { quote: { referencePrice: 290, avgPrice: 296.17, closePrice: 303.5, closeTime: at('12:24:40') * 1000, lastUpdated: at('12:24:40') * 1000, total: { tradeVolume: 47584, tradeValue: 296.17 * 47584 * 1000 } }, candles: [{ date: '2026-10-15T09:00:00.000+08:00', open: 288, high: 289, low: 287, close: 288.5, volume: 900 }] }) !== false, true);
  assert.equal(Math.round(e.quote('6278').vwap * 100) / 100, 296.17);
});

test('REST minute candles: cumulative value from the running average when present, typical price otherwise', async () => {
  const { seriesFromCandles } = await import('../lib/intraday.mjs');
  const s = seriesFromCandles([{ date: '2026-10-16T09:00:00.000+08:00', open: 50, high: 51, low: 49, close: 50.5, volume: 10, average: 50.2 }, { date: '2026-10-16T09:01:00.000+08:00', open: 50.5, high: 52, low: 50, close: 51, volume: 30 }, { date: '2026-10-16T08:59:00.000+08:00', close: 1, volume: 1 }], tw);
  assert.deepEqual([s.m, s.v, s.cv], [[540, 541], [10, 30], [10, 40]]);
  assert.equal(s.ca[0], 50.2 * 10); assert.equal(s.ca[1], 50.2 * 10 + (52 + 50 + 51) / 3 * 30);
});
