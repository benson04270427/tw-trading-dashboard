import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFred, parseCboe, ratio, bpChange, relative, buildRiskUS, fetchRiskInputsUS, US_FACTORS } from '../lib/riskgauge-us.mjs';

test('FRED／Cboe CSV 解析', () => {
  assert.deepEqual(parseFred('observation_date,VIXCLS\n2026-10-21,18.5\n2026-10-22,\n2026-10-23,.\n2026-10-20,17'), [['2026-10-20', 17], ['2026-10-21', 18.5]]);
  assert.deepEqual(parseCboe('DATE,OPEN,HIGH,LOW,CLOSE\n10/22/2026,19,20,18,19.03\n1/2/2026,15,16,14,15.5'), [['2026-01-02', 15.5], ['2026-10-22', 19.03]]);
});

test('比值、基點變化、相對表現', () => {
  assert.deepEqual(ratio([['a', 20], ['b', 30]], [['a', 25]]), [['a', 80]]);
  const y = Array.from({ length: 22 }, (_, i) => [`d${String(i).padStart(2, '0')}`, 4 + i * 0.01]);
  assert.equal(bpChange(y).at(-1)[1], 20);
  const a = Array.from({ length: 21 }, (_, i) => [`d${String(i).padStart(2, '0')}`, 100 + i]), b = Array.from({ length: 21 }, (_, i) => [`d${String(i).padStart(2, '0')}`, 100]);
  assert.equal(relative(a, b).at(-1)[1], 20);
});

// 合成一年資料：最後一段 VIX 飆高、利差擴大、大盤下跌
function synth() {
  const days = []; let t = Date.parse('2025-09-01T00:00:00Z');
  while (days.length < 280) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); t += 864e5; }
  const late = i => i > 260;
  return { errors: {},
    spx: days.map((d, i) => [d, late(i) ? 6000 - (i - 260) * 60 : 5000 + i * 4]), vix: days.map((d, i) => [d, late(i) ? 35 : 15 + (i % 5)]),
    vixCboe: days.map((d, i) => [d, late(i) ? 35 : 15]), vix3m: days.map((d, i) => [d, late(i) ? 28 : 18]),
    hy: days.map((d, i) => [d, late(i) ? 5 : 3 + (i % 7) * 0.05]), dgs10: days.map((d, i) => [d, 4 + (i % 9) * 0.01]), usd: days.map((d, i) => [d, 120 + (i % 11) * 0.1]),
    rsp: days.map((d, i) => [d, late(i) ? 170 - (i - 260) : 170]), spy: days.map((d, i) => [d, 600]) };
}
test('buildRiskUS：恐慌時風險高、建議持股低', () => {
  const r = buildRiskUS(synth());
  assert.equal(r.available, true); assert.equal(r.market, 'US'); assert.equal(r.indexName, 'S&P 500');
  assert.equal(r.factors.length, US_FACTORS.length); assert.equal(r.coverage, 100);
  assert.ok(r.risk >= 75, `risk ${r.risk}`); assert.equal(r.exposure, 20);
  assert.ok(r.factors.find(f => f.key === 'term').value > 100);
  assert.ok(r.history.length > 100);
});
test('fetchRiskInputsUS：個別來源失敗不影響其他', async () => {
  const fetcher = async url => url.includes('cboe') ? { ok: false, status: 403 } : url.includes('nasdaq') ? { ok: true, body: { data: { tradesTable: { rows: [{ date: '10/22/2026', open: '$1', high: '$1', low: '$1', close: '$170.5', volume: '1' }] } } } } : { ok: true, body: 'observation_date,X\n2026-10-22,5' };
  const raw = await fetchRiskInputsUS('2026-10-23', { fetcher });
  assert.deepEqual(raw.spx, [['2026-10-22', 5]]); assert.deepEqual(raw.rsp, [['2026-10-22', 170.5]]);
  assert.ok(raw.errors.vixCboe && raw.errors.vix3m); assert.equal(raw.vixCboe.length, 0);
});
