import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFearGreed, indexFear, buildContrarian, contraExposure } from '../lib/contrarian.mjs';

const closes = (n, f) => Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10), f(i)]);

test('逆勢布局：CNN 恐懼與貪婪、指數跌深、持股建議方向與風控相反', () => {
  const fg = parseFearGreed({ fear_and_greed: { score: 20.98, rating: 'extreme fear', timestamp: '2026-10-23T23:59:44+00:00', previous_close: 19.8, previous_1_week: 22.07, previous_1_month: 32.5 }, fear_and_greed_historical: { data: [{ x: 1761264000000, y: 32.4 }] } });
  assert.equal(fg.score, 21); assert.equal(fg.date, '2026-10-23'); assert.equal(fg.history[0][0], '2025-10-24');
  assert.equal(parseFearGreed({}), null);
  // 先漲到高點、最後 5 天急跌
  const c = closes(400, i => i < 395 ? 100 + i * 0.2 : 179 - (i - 394) * 4);
  const ix = indexFear(c); assert.ok(ix.drop > 95); assert.ok(ix.ret5 < -8);
  const risk = { exposure: 20, date: '2026-10-22', factors: [{ key: 'retail', pct: 90 }, { key: 'foreignFut', pct: 10 }, { key: 'foreignSpot', pct: 20 }] };
  const tw = buildContrarian({ market: 'TW', fg, risk, closes: c });
  assert.equal(tw.factors.find(f => f.key === 'global').fear, 79);
  assert.equal(tw.factors.find(f => f.key === 'foreign').fear, 85);
  assert.equal(tw.factors.find(f => f.key === 'panic').fear, 10);
  assert.ok(tw.score > 50); assert.equal(tw.exposure, contraExposure(tw.score)); assert.equal(tw.riskExposure, 20);
  const us = buildContrarian({ market: 'US', fg: null, risk: { factors: [{ key: 'vix', pct: 80 }, { key: 'term', pct: 60 }, { key: 'credit', pct: 70 }] }, closes: c });
  assert.equal(us.factors.find(f => f.key === 'panic').fear, 70); assert.equal(us.coverage, 75);
  assert.equal(buildContrarian({ market: 'TW' }).available, false);
  assert.equal(contraExposure(5), 20); assert.equal(contraExposure(81), 80); assert.equal(contraExposure(99), 90);
});
