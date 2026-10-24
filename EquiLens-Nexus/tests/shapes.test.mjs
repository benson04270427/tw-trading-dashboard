import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, zigzag, buildShapes, SHAPES } from '../lib/shapes.mjs';

// 依關鍵點線性內插出收盤，高低點 ±1%
function path(keys, n = 90) {
  const out = []; for (let i = 0; i < n; i++) { const t = i / (n - 1) * (keys.length - 1), k = Math.floor(t), f = t - k, a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)]; out.push(a + (b - a) * f); }
  return out.map((c, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), open: c, close: c, max: c * 1.01, min: c * 0.99, Trading_Volume: 1e6 }));
}
const ids = bars => classify(bars).matches.map(m => m.id);

test('zigzag 依門檻找出交替的高低點', () => {
  const z = zigzag(path([100, 130, 100, 140, 110]), 0.08);
  assert.deepEqual(z.map(q => q.t), ['L', 'H', 'L', 'H', 'L']);
});
test('W 底與 M 頂', () => {
  assert.ok(ids(path([130, 125, 100, 118, 101, 112])).includes('doubleBottom'));
  assert.ok(ids(path([100, 105, 130, 112, 129, 118])).includes('doubleTop'));
});
test('頭肩底與頭肩頂', () => {
  assert.ok(ids(path([130, 110, 122, 95, 122, 111, 118])).includes('ihs'));
  assert.ok(ids(path([100, 120, 108, 135, 108, 119, 112])).includes('hs'));
});
test('上升與下降通道、階梯', () => {
  const up = ids(path([100, 112, 106, 118, 112, 124, 118, 130, 124]));
  assert.ok(up.includes('channelUp') || up.includes('stairsUp'), up.join());
  const dn = ids(path([130, 118, 124, 112, 118, 106, 112, 100, 106]));
  assert.ok(dn.includes('channelDown') || dn.includes('stairsDown'), dn.join());
});
test('V 型反轉與倒 V', () => {
  assert.ok(ids(path([120, 121, 120, 119, 120, 118, 100, 116, 118], 90)).includes('vUp'));
  assert.ok(ids(path([100, 99, 100, 101, 100, 102, 120, 104, 101], 90)).includes('vDown'));
});
test('多頭旗形', () => {
  const r = ids(path([100, 101, 100, 101, 100, 101, 100, 100, 101, 100, 101, 100, 124, 120, 118, 119, 117, 118]));
  assert.ok(r.includes('bullFlag'), r.join());
});
test('分組統計與型態清單', () => {
  const r = buildShapes([{ id: 'A', name: 'A', sector: '半導體業', bars: path([130, 125, 100, 118, 101, 112]) }, { id: 'B', name: 'B', sector: '光電業', bars: path([100, 101]).slice(0, 10) }]);
  assert.equal(r.scanned, 2); assert.equal(r.matched, 1); assert.equal(r.shapes.length, SHAPES.length);
  assert.equal(r.shapes.find(s => s.id === 'doubleBottom').count, 1);
  assert.ok(new Set(SHAPES.map(s => s.id)).size === SHAPES.length);
});
