import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, prepare, analyzeAt, scanPullback, backtestPullback, summarize } from '../lib/pullback.mjs';

// 80 天盤整 → 30 天上漲 50%（每天跳空小缺口） → 回檔後在均線附近小幅整理
function crafted(start = '2025-01-01', after = [73, 71.5, 70.5, 71.5, 72.5, 71.8, 71.2, 71.6, 72.0, 71.7, 71.4, 71.6]) {
  const rows = []; let d = new Date(start);
  const push = (c, rng) => { d = new Date(d.getTime() + 86400e3); rows.push({ date: d.toISOString().slice(0, 10), open: c, max: c * (1 + rng), min: c * (1 - rng), close: c, Trading_Volume: 2e6 }); };
  for (let i = 0; i < 80; i++) push(50 + (i % 2 ? 0.2 : -0.2), 0.01);
  for (let i = 1; i <= 30; i++) push(50 + 25 * i / 30, 0.02);
  for (const c of after) push(c, 0.006);
  return rows;
}

test('ema matches the standard recursive definition', () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  assert.equal(e[0], null); assert.equal(e[1], null);
  assert.ok(Math.abs(e[5] - 5.03125) < 1e-9);
});

test('a strong stock consolidating at converging support is near entry with a trade plan', () => {
  const p = prepare(crafted()), i = p.b.length - 1, a = analyzeAt(p, i, { minVol: 0 });
  assert.equal(a.strong, true);
  assert.equal(a.stage, 'near', a.reasons.join(','));
  assert.ok(a.zone.keys.length >= 2);
  assert.ok(a.plan.stop < a.close && a.plan.trigger >= a.close);
  assert.ok(Math.abs(a.plan.t3 - (a.plan.trigger + 3 * a.plan.r)) < 0.02);
  assert.ok(a.plan.stopPct > 0 && a.plan.stopPct <= 8);
});

test('a flat stock is not strong; a collapse after the high breaks the structure', () => {
  const flat = []; let d = new Date('2025-01-01');
  for (let i = 0; i < 200; i++) { d = new Date(d.getTime() + 86400e3); flat.push({ date: d.toISOString().slice(0, 10), open: 50, max: 50.5, min: 49.5, close: 50, Trading_Volume: 2e6 }); }
  const pf = prepare(flat); assert.equal(analyzeAt(pf, pf.b.length - 1, { minVol: 0 }).strong, false);
  const crash = prepare(crafted('2025-01-01', [73, 70, 66, 62, 58, 55, 54, 53]));
  const a = analyzeAt(crash, crash.b.length - 1, { minVol: 0 });
  assert.notEqual(a.stage, 'near'); assert.notEqual(a.stage, 'base');
});

test('thin volume excludes a stock from the strong list', () => {
  const p = prepare(crafted());
  assert.equal(analyzeAt(p, p.b.length - 1, { minVol: 5e6 }).strong, false);
});

test('scan ranks near entries first and counts groups strengthening together', () => {
  const stocks = [
    { id: 'A', name: 'A', sector: 'X', rows: crafted() },
    { id: 'B', name: 'B', sector: 'X', rows: crafted('2025-01-01', [73, 72, 71, 70, 69, 70, 71, 73, 74, 75, 76, 77]) },
    ...Array.from({ length: 6 }, (_, k) => ({ id: 'F' + k, name: 'F' + k, sector: 'Y', rows: crafted().map(r => ({ ...r, close: 50, open: 50, max: 50.5, min: 49.5 })) })),
  ];
  const r = scanPullback(stocks, { market: 'US' });
  assert.equal(r.rows[0].id, 'A'); assert.equal(r.rows[0].stage, 'near');
  assert.equal(r.counts.near >= 1, true); assert.deepEqual(r.groups[0], { name: 'X', n: 2 });
  assert.equal(r.rows.find(x => x.id === 'A').groupStrong, true);
});

test('backtest enters on a break of the signal-day high and exits by its rules', () => {
  // 進場後續漲 → 3R 先賣一半，之後跌破 9 日 EMA 出場
  const up = crafted('2025-01-01', [73, 71.5, 70.5, 71.5, 72.5, 71.8, 71.2, 71.6, 72.0, 71.7, 71.4, 71.6, 72.5, 74, 76, 78, 80, 82, 84, 86, 88, 87, 85, 82, 79, 76]);
  const stocks = Array.from({ length: 6 }, (_, k) => ({ id: 'S' + k, rows: k ? up.map(r => ({ ...r, close: 50, open: 50, max: 50.5, min: 49.5 })) : up }));
  const r = backtestPullback(stocks, { market: 'US' });
  assert.ok(r.summary.n >= 1);
  const t = r.trades.find(x => x.id === 'S0'); assert.ok(t);
  assert.ok(t.r > 0 && t.partial, JSON.stringify(t));
  assert.ok(t.entry > t.signal && t.exit >= t.entry);
});

test('summarize computes win rate, profit factor and drawdown in R', () => {
  const s = summarize([{ r: 2, partial: false, days: 3, stopPct: 3, ret: 6 }, { r: -1, partial: false, days: 1, stopPct: 3, ret: -3 }, { r: -1, partial: false, days: 1, stopPct: 3, ret: -3 }, { r: 4, partial: true, days: 9, stopPct: 3, ret: 12 }]);
  assert.equal(s.n, 4); assert.equal(s.winRate, 50); assert.equal(s.pf, 3); assert.equal(s.maxDDR, -2); assert.equal(s.totalR, 4);
});
