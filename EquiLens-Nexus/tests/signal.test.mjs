import test from 'node:test';
import assert from 'node:assert/strict';
import { toBars, resample, atr, supertrend, adx, trendOf, volumeFlow, track, sizing, buildSignal, newSignal, normalizeSignalSettings } from '../lib/signal.mjs';
import { MARKETS } from '../lib/markets.mjs';

// 合成日 K：先漲 60 天、再跌 40 天
function series(up = 60, down = 40, start = 100) {
  const rows = []; let c = start, t = Date.parse('2026-01-05T00:00:00Z');
  const push = d => { const o = c; c = c + d; rows.push({ date: new Date(t).toISOString().slice(0, 10), open: o, max: Math.max(o, c) + 1, min: Math.min(o, c) - 1, close: c, Trading_Volume: d > 0 ? 2000 : 1000 }); t += 864e5; if (new Date(t).getUTCDay() === 6) t += 2 * 864e5; };
  for (let i = 0; i < up; i++) push(i % 5 === 4 ? -0.5 : 1.5);
  for (let i = 0; i < down; i++) push(i % 5 === 4 ? 0.5 : -2);
  return rows;
}

test('ATR、SuperTrend、ADX 基本性質', () => {
  const b = toBars(series());
  const a = atr(b, 14); assert.equal(a[12], null); assert.ok(a[13] > 0);
  const st = supertrend(b, 10, 3);
  assert.equal(st.dir[55], 1); assert.equal(st.dir.at(-1), -1);
  assert.ok(st.line[55] < b[55].close && st.line.at(-1) > b.at(-1).close);
  const x = adx(b, 14); assert.ok(x.at(-1) > 20);
  assert.equal(trendOf(b), -1);
});

test('週 K／月 K 合併', () => {
  const b = toBars(series(10, 0));
  const w = resample(b, 'week'); assert.equal(w.length, 2); assert.equal(w[0].open, b[0].open); assert.equal(w[0].close, b[4].close); assert.equal(w[0].volume, b.slice(0, 5).reduce((s, x) => s + x.volume, 0));
  assert.equal(resample(b, 'month').length, 1);
});

test('量能流向、停損停利追蹤、部位計算', () => {
  const b = toBars(series(30, 0));
  assert.equal(volumeFlow(b).label, '多方主導');
  const bars = [{ date: 'a', high: 10, low: 9, close: 10 }, { date: 'b', high: 12, low: 9.8, close: 11.5 }, { date: 'c', high: 13.2, low: 11, close: 13 }];
  assert.deepEqual(track(bars, 0, 1, 9, [11.5, 12.5, 14]), { hit: 2, stopped: null });
  assert.deepEqual(track(bars, 0, 1, 9.8, [11.5, 12.5, 14]), { hit: 0, stopped: 'b' }); // 同一根先算停損
  const s = sizing({ capital: 1e6, riskPct: 1 }, 500, 20, 1000);
  assert.equal(s.budget, 10000); assert.equal(s.shares, 500); assert.equal(s.lots, 0); assert.equal(s.odd, 500); assert.equal(s.over, true);
  assert.equal(sizing({ capital: 1e5, riskPct: 2 }, 50, 1, 1).shares, 2000); // 以總資金為上限
  assert.equal(sizing({}, 500, 20, 1000), null);
});

test('buildSignal：賣出訊號、停損停利依 ATR 與 R 倍數、信心分數', () => {
  const p = MARKETS.TW, sig = buildSignal({ id: '2454', name: '聯發科', rows: series(), today: '2026-06-30', p, settings: { capital: 2e6, riskPct: 1 } });
  assert.equal(sig.available, true);
  const s = sig.signal; assert.equal(s.side, 'sell');
  assert.ok(s.stop > s.entry);
  const R = s.stop - s.entry; assert.ok(Math.abs((s.entry - s.targets[0].price) / R - 1.5) < 0.2);
  assert.ok(sig.confidence >= 0 && sig.confidence <= 100);
  assert.equal(sig.stance.tone, -1);
  assert.ok(sig.trail > sig.price);
  assert.ok(sig.chart.bars.length <= 90 && sig.chart.flips.length >= 1);
  assert.equal(sig.resonance.frames.length >= 2, true);
});

test('盤中以即時快照暫代今天的 K 棒；資料不足時不計算', () => {
  const rows = series(60, 0), last = rows.at(-1);
  const sig = buildSignal({ id: 'X', rows, live: { date: '2026-12-31 10:00:00', close: last.close - 30, open: last.close, high: last.close, low: last.close - 31, total_volume: 5 }, today: '2026-12-31', p: MARKETS.TW });
  assert.equal(sig.provisional, true); assert.equal(sig.date, '2026-12-31'); assert.equal(sig.signal.side, 'sell'); assert.equal(newSignal(sig), null);
  assert.equal(buildSignal({ id: 'X', rows: series(10, 0), p: MARKETS.TW }).available, false);
});

test('設定正規化', () => {
  assert.deepEqual(normalizeSignalSettings({ capital: '1000000', riskPct: '1.5' }), { capital: 1e6, riskPct: 1.5, push: true });
  assert.deepEqual(normalizeSignalSettings({ capital: -1, riskPct: 50, push: false }), { capital: null, riskPct: null, push: false });
});
