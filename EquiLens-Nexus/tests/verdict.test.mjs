import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS } from '../lib/markets.mjs';
import { pivots, limitState, institutions, margin, buildVerdict } from '../lib/verdict.mjs';
const TW = { id: 'TW', ...MARKETS.TW };
const days = ['2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21'];

test('verdict: pivots round to tick', () => {
  const v = pivots({ date: '2026-10-20', high: 298.5, low: 280, close: 288 }, TW);
  assert.equal(v.pivot, 289); assert.equal(v.resistance, 297.5); assert.equal(v.support, 279);
});
test('verdict: limit states', () => {
  assert.equal(limitState({ close: 316.5, high: 316.5 }, 288, TW).kind, 'up-locked');
  assert.equal(limitState({ close: 310, high: 316.5 }, 288, TW).kind, 'up-open');
  assert.equal(limitState({ close: 300, high: 305 }, 288, TW), null);
});
test('verdict: institutions 20 days', () => {
  const bars = days.map(d => ({ date: d, close: 100 })), rows = [];
  days.forEach((d, i) => { rows.push({ date: d, name: 'Foreign_Investor', buy: i % 7 === 0 ? 0 : 2e6, sell: i % 7 === 0 ? 1e6 : 0 }, { date: d, name: 'Investment_Trust', buy: 1e5, sell: 0 }, { date: d, name: 'Dealer_self', buy: 0, sell: 0 }); });
  const r = institutions(rows, bars);
  assert.equal(r.days, 20); assert.equal(r.tone, 'add'); assert.ok(r.buyDays >= 16); assert.ok(r.foreign > 0 && r.trust > 0); assert.equal(r.list.at(-1).date, '2026-10-21');
});
test('verdict: margin changes', () => {
  const m = margin(days.slice(-7).map((d, i) => ({ date: d, MarginPurchaseTodayBalance: 1000 + i * 100, MarginPurchaseLimit: 10000 })));
  assert.equal(m.balance, 1600); assert.equal(m.d1, 100); assert.equal(m.d5, 500); assert.equal(m.usage, 16);
});
test('verdict: full card with live limit-up', () => {
  const rows = days.map((d, i) => ({ date: d, open: 280, max: d === '2026-10-20' ? 298.5 : 290, min: 280, close: d === '2026-10-21' ? 288 : 285, Trading_money: 1e9 }));
  const live = { date: '2026-10-22 13:30:00', open: 300, high: 316.5, low: 298, close: 316.5, change_price: 28.5, total_amount: 5.7e9 };
  const v = buildVerdict({ id: '6278', name: '台表科', sector: '光電業', rows, live, today: '2026-10-22', p: TW, inst: [], marginRows: [] });
  assert.equal(v.session, 'live'); assert.equal(v.change, 28.5); assert.equal(v.limit.label, '漲停鎖住');
  assert.equal(v.levels.from, '2026-10-21'); assert.ok(v.levels.above);
  assert.deepEqual(v.points.map(p => p.text).slice(0, 2), ['今日漲停鎖住', '現價已站上壓力位']);
  assert.equal(buildVerdict({ id: 'x', rows: [], today: '2026-10-22', p: TW }).available, false);
});
