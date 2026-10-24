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
