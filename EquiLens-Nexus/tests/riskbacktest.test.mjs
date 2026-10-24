import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestRecipes, RECIPES } from '../lib/riskbacktest.mjs';
import { FACTORS, trendSeries } from '../lib/riskgauge.mjs';

test('風控配方回測：每組配方都有績效、命中率與排名', () => {
  const dates = [], index = []; let px = 100;
  for (let i = 0; i < 900; i++) { const d = new Date(Date.UTC(2022, 0, 3) + i * 864e5).toISOString().slice(0, 10); dates.push(d); px *= 1 + Math.sin(i / 40) * 0.01 + 0.0003; index.push([d, px]); }
  // 散戶指標：剛好在大盤轉折前偏多（有預測力），其他是雜訊
  const lead = dates.map((d, i) => [d, Math.sin((i + 15) / 40) * -10]), noise = dates.map((d, i) => [d, ((i * 7919) % 101) - 50]);
  const s = { retail: lead, margin: noise, foreignFut: noise, foreignSpot: noise, fx: noise, trend: trendSeries(index) };
  const r = backtestRecipes({ market: 'TW', s, index, dates, defs: FACTORS });
  assert.equal(r.available, true); assert.equal(r.results.length, RECIPES.TW.length);
  for (const x of r.results) { assert.ok(Number.isFinite(x.cagr)); assert.ok(x.mdd <= 0); assert.equal(x.buckets.length, 5); assert.ok(x.rank >= 1); }
  assert.ok(r.order.includes(r.best)); assert.ok(r.buyHold.cagr != null);
  assert.equal(backtestRecipes({ market: 'TW', s, index: index.slice(0, 100), dates: dates.slice(0, 100), defs: FACTORS }).available, false);
});

test('權重最佳化：找出有預測力的指標，並在驗證期間檢驗', async () => {
  const { optimizeWeights } = await import('../lib/riskbacktest.mjs');
  const dates = [], index = []; let px = 100;
  for (let i = 0; i < 1100; i++) { const d = new Date(Date.UTC(2021, 0, 3) + i * 864e5).toISOString().slice(0, 10); dates.push(d); px *= 1 + Math.sin(i / 30) * 0.01 + 0.0002; index.push([d, px]); }
  // good：20 天後跌的時候偏高（有預測力）；bad：雜訊
  const good = dates.map((d, i) => [d, -Math.sin((i + 20) / 30)]), bad = dates.map((d, i) => [d, ((i * 7919) % 101) - 50]);
  const defs = [{ key: 'good', dir: 1 }, { key: 'bad', dir: 1 }, { key: 'bad2', dir: 1 }];
  const r = optimizeWeights({ s: { good, bad, bad2: bad.map(([d, v]) => [d, -v]) }, index, dates, defs, keys: ['good', 'bad', 'bad2'], split: '2023-06-01', current: { good: 1, bad: 1, bad2: 1 } });
  assert.equal(r.available, true); assert.equal(r.combos, 26);
  const g = r.single.find(x => x.key === 'good'); assert.ok(g.train.ic < 0); assert.ok(g.test.ic < 0);
  assert.ok(r.robust.weights.good > 0); assert.ok(r.robust.test.J >= r.current.test.J - 0.01);
});
