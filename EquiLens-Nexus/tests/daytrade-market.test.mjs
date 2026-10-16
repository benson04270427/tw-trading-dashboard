// 當沖大盤環境紀錄：指數狀態（漲跌、近 15 分鐘、日內均價）、順風／中性／逆風判斷、資料不足的原因、收盤檢討分組
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketTracker, marketRecord, regimeOf, strengthOf, MARKET_RULES } from '../lib/daytrade-market.mjs';
import { reviewStats } from '../lib/daytrade.mjs';

const date = '2026-10-16', at = hms => Date.parse(`${date}T${hms}+08:00`);
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// 09:00 起每分鐘一筆指數快照：price(m) 為第 m 分鐘（0＝09:00）的值
function feed(tr, key, minutes, price, ref = 100) { for (let m = 0; m <= minutes; m++) tr.sample(key, { at: at(`${hm(540 + m)}:30`), price: price(m), ref }); }

test('index state: change, 15-minute change and intraday average; regime rules', () => {
  const tr = createMarketTracker({ date });
  feed(tr, 'twse', 40, m => 100 + m * 0.02);
  const s = tr.state('twse', at('09:40:40'));
  assert.equal(s.chg, 0.8); assert.equal(s.r15, 0.3, '100.8 vs 100.5 at 09:25');
  assert.equal(s.avg, 100.4); assert.ok(s.vsAvg > 0); assert.equal(s.minutes, 41); assert.equal(s.stale, false);
  assert.equal(regimeOf(s), 'tailwind');
  assert.equal(regimeOf({ r15: -0.1, vsAvg: -0.2 }), 'headwind');
  assert.equal(regimeOf({ r15: MARKET_RULES.drop, vsAvg: 0.3 }), 'headwind', 'a sharp 15-minute drop is a headwind even above the average');
  assert.equal(regimeOf({ r15: 0.2, vsAvg: -0.1 }), 'neutral');
  assert.equal(regimeOf({ r15: -0.2, vsAvg: 0.1 }), 'neutral');
  assert.equal(regimeOf({ r15: null, vsAvg: 0.1 }), null);
  assert.equal(strengthOf({ rs15: 0.4 }), 'strong'); assert.equal(strengthOf({ rs15: 0 }), 'weak'); assert.equal(strengthOf({}), null);
});

test('stale, pre-open, other-day and early-session samples never produce a regime', () => {
  const tr = createMarketTracker({ date });
  assert.equal(tr.sample('twse', { at: at('08:59:50'), price: 100 }), false, 'before the open');
  assert.equal(tr.sample('twse', { at: Date.parse('2026-10-15T10:00:00+08:00'), price: 100 }), false, 'another day');
  assert.equal(tr.sample('xxx', { at: at('09:01:00'), price: 100 }), false);
  feed(tr, 'twse', 10, () => 100);
  assert.equal(tr.state('twse', at('09:10:40')).r15, null, 'less than 15 minutes of data');
  assert.equal(marketRecord(tr, '上市', { chg: 1, r15: 0.5 }, at('09:10:40')).reason, 'warmup');
  const late = at('09:10:30') + (MARKET_RULES.maxAgeSeconds + 5) * 1000;
  assert.equal(tr.state('twse', late).stale, true);
  assert.deepEqual(marketRecord(tr, '上市', {}, late), { index: 'twse', reason: 'stale', age: MARKET_RULES.maxAgeSeconds + 5 });
  assert.deepEqual(marketRecord(tr, '上櫃', {}, at('09:10:40')), { index: 'tpex', reason: 'noIndex' });
  assert.deepEqual(marketRecord(tr, null, {}, at('09:10:40')), { index: null, reason: 'exchange' });
  assert.equal(tr.age('tpex', at('09:10:40')), Infinity); assert.equal(tr.hasOpen('twse'), true); assert.equal(tr.hasOpen('tpex'), false);
});

test('signal record: relative strength against its own index; breadth only while fresh', () => {
  const tr = createMarketTracker({ date });
  feed(tr, 'tpex', 30, m => 200 - m * 0.2, 200);
  tr.breadth('tpex', { up: 300, down: 500, at: at('09:30:00') });
  const r = marketRecord(tr, '上櫃', { chg: 1.5, r15: 0.6 }, at('09:30:40'));
  assert.equal(r.index, 'tpex'); assert.equal(r.chg, -3); assert.equal(r.r15, -1.52);
  assert.equal(regimeOf(r), 'headwind'); assert.equal(r.rs, 4.5); assert.equal(r.rs15, 2.12); assert.equal(strengthOf(r), 'strong');
  assert.deepEqual([r.up, r.down], [300, 500]); assert.equal(r.reason, undefined);
  assert.equal(tr.state('tpex', at('09:30:00') + (MARKET_RULES.maxAgeSeconds + 1) * 1000).up, null, 'old breadth is dropped');
});

test('Fugle one-minute candles fill the morning after a mid-session start; snapshots continue on top', () => {
  const tr = createMarketTracker({ date });
  feed(tr, 'twse', 0, () => 101);
  tr.sample('twse', { at: at('10:00:10'), price: 102, ref: 100 });
  assert.equal(tr.state('twse', at('10:00:20')).r15, null, 'no data 15 minutes ago');
  assert.equal(tr.series('twse', { ref: 100, price: 101.9, at: at('09:59:59'), minutes: Array.from({ length: 60 }, (_, i) => [540 + i, 101 + i / 60]) }), true);
  const s = tr.state('twse', at('10:00:20'));
  assert.equal(s.price, 102, 'an older quote does not replace a newer snapshot');
  assert.equal(s.r15, Math.round((102 / (101 + 45 / 60) - 1) * 1e4) / 100);
  assert.equal(s.minutes, 61);
});

test('review groups v2 entries by the market regime and relative strength at signal time', () => {
  const sig = (r15, market, extra = {}) => ({ type: 'dt-breakout', version: 2, purpose: 'opportunity', outcome: { r15, rClose: r15 }, market, ...extra });
  const tail = { r15: 0.2, vsAvg: 0.1, rs15: 0.5 }, head = { r15: -0.6, vsAvg: 0.1, rs15: -0.3 };
  const stats = reviewStats([
    { date: '2026-10-15', signals: [sig(1, null), { type: 'dt-breakout', outcome: { r15: 5 } }] },
    { date: '2026-10-16', signals: [sig(1, tail), sig(-1, tail), sig(-2, head), sig(9, head, { purpose: 'risk', type: 'dt-weak' }), sig(3, { index: 'twse', reason: 'warmup' })] },
  ]);
  const g = Object.fromEntries(stats.market.regimes.map(x => [x.key, x]));
  assert.deepEqual([g.tailwind.n, g.tailwind.win15, g.tailwind.r15], [2, 50, 0]);
  assert.deepEqual([g.headwind.n, g.headwind.r15], [1, -2]);
  assert.equal(g.neutral.n, 0); assert.equal(g.none.n, 2, 'unrecorded and warm-up entries');
  assert.deepEqual(stats.market.strength.map(x => [x.key, x.n]), [['strong', 2], ['weak', 1], ['none', 2]]);
  assert.deepEqual([stats.market.signals, stats.market.recorded, stats.market.since], [5, 3, '2026-10-16'], 'recorded counts entries with a complete market state');
  const v2 = stats.types.find(x => x.version === 2), v1 = stats.types.find(x => x.version === 1);
  assert.equal(v2.regimes.tailwind.n, 2); assert.equal(v1.regimes, undefined, 'legacy entries are not split');
  assert.equal(stats.signals, 6, 'risk alerts are still excluded');
});
