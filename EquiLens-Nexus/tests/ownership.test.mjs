import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnership, insiderTotals } from '../lib/ownership.mjs';

test('insider totals count only own holdings and split out the board', () => {
  const t = insiderTotals([['董事長本人', 'A', 0, 5000, 0, 0], ['董事長之配偶', 'A2', 0, 999, 0, 0], ['經理人本人', 'B', 0, 1000, 0, 0], ['監察人本人', 'C', 0, 2000, 0, 0], ['大股東本人', 'D', 0, 3000, 0, 0]]);
  assert.deepEqual(t, { total: 11000, board: 7000 });
  assert.equal(insiderTotals([]), null);
});

test('ownership combines weekly big holders, monthly insider ratio and price', () => {
  const weeks = Array.from({ length: 14 }, (_, k) => ({ date: new Date(Date.UTC(2026, 6, 3 + k * 7)).toISOString().slice(0, 10), big1000: 80 + k * 0.1, big400: 85, people: 1000 - k * 10, shares: 1e8 }));
  const price = weeks.map((w, k) => ({ date: w.date, close: 100 + k }));
  const o = buildOwnership({ id: '2330', name: 'TSMC', weeks, price, insiders: [{ ym: '2026-08', total: 5e6, board: 4e6 }, { ym: '2026-09', total: 5.5e6, board: 4e6 }] });
  assert.equal(o.available, true);
  assert.equal(o.latest.big1000, 81.3);
  assert.equal(o.latest.chg4, 0.4);
  assert.equal(o.latest.chg12, 1.2);
  assert.equal(o.insiders[0].pct, 5);
  assert.equal(o.latest.insider.pct, 5.5);
  assert.equal(o.latest.insider.chg, 0.5);
  assert.equal(o.price.length, 14);
  assert.equal(buildOwnership({ id: 'x', weeks: [] }).available, false);
});
