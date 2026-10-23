import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCnyesRatings, summarize, parseNasdaqTargets, buildTargets } from '../lib/targets.mjs';
import { zonesTW, zonesUS, historyOf } from '../lib/zones.mjs';
import { seasonal, monthStats, nextSessions, monthEvents, buildMacro, position } from '../lib/macro.mjs';

test('目標價：鉅亨網表格、近 120 天摘要、Nasdaq 共識', () => {
  const html = `<table><tr><th>評等日期</th><th>券商</th><th>原評等</th><th>升/降</th><th>新評等</th><th class='cr'>財測EPS(年度)</th><th>目標價</th><th>現價</th><th>備註</th></tr>
  <tr><td class='lt'>20261015</td><td>Factset</td><td></td><td>--</td><td></td><td class='rt'>109.21 (2026)</td><td class='rt'>3220</td><td>306.50</td><td>--</td></tr>
  <tr><td class='lt'>20260716</td><td>Factset</td><td></td><td>--</td><td>強力買進</td><td class='rt'>--</td><td class='rt'>3090</td><td>306.50</td><td>--</td></tr>
  <tr><td class='lt'>20241022</td><td>美系券商</td><td></td><td>重申</td><td></td><td>--</td><td>--</td><td>1</td><td>--</td></tr></table>`;
  const h = parseCnyesRatings(html);
  assert.equal(h.length, 3); assert.deepEqual(h[0], { date: '2026-10-15', broker: 'Factset', rating: null, change: null, eps: 109.21, epsYear: 2026, target: 3220 });
  assert.equal(h[2].change, '重申'); assert.equal(h[2].target, null);
  const s = summarize(h, 2420, '2026-10-24');
  assert.equal(s.mean, 3220); assert.equal(s.count, 1); assert.equal(s.upside, 33.06); assert.equal(s.latest.target, 3220);
  const n = parseNasdaqTargets({ consensusOverview: { lowPriceTarget: 275, highPriceTarget: 465, priceTarget: 323.45, buy: 33, sell: 0, hold: 0 }, historicalConsensus: [{ z: { buy: 35, hold: 1, sell: 1, date: '10/01/2025', consensus: 'Buy' }, y: 187.24 }] });
  assert.equal(n.mean, 323.45); assert.equal(n.history[0].date, '2025-10-01');
  const b = buildTargets({ id: 'NVDA', market: 'US', raw: n, price: 212.21 });
  assert.equal(b.available, true); assert.equal(b.upside, 52.42); assert.equal(b.count, 33);
  assert.equal(buildTargets({ id: 'X', market: 'TW', raw: { history: [] } }).available, false);
});

test('策略選股：台股價值區與升溫區、美股、入選紀錄', () => {
  const v = (id, pe, revYoY, revMoM, sector = '半導體業') => ({ id, name: id, sector, pe, revYoY, revMoM, revCumYoY: revYoY });
  const value = [v('2330', 20, 30, 5), v('2303', 25, 12, 5), v('2454', 40, 20, 2), v('3017', 15, 5, 10), v('6669', 18, 15, -1), ...Array.from({ length: 6 }, (_, i) => v('9' + i, 30 + i, 0, 0))];
  const heat = [{ id: '2330', close: 100, change: 4, money: 5e9, moneyChange: 40 }, { id: '2454', close: 50, change: 9.9, money: 1e9, moneyChange: 0 }, { id: '3017', close: 30, change: 2, money: 1e9, moneyChange: 90 }];
  const z = zonesTW({ value, heat, scope: new Set(['2330', '2454', '3017', '6669']), chain: new Map([['2330', '晶圓代工與 IC 設計']]) });
  assert.deepEqual(z.value.map(r => r.id), ['2330']); // 2454 本益比偏高、3017 營收年增不足、6669 月減
  assert.equal(z.value[0].chain, '晶圓代工與 IC 設計'); assert.equal(z.value[0].revMoM, 5);
  assert.deepEqual(z.heat.map(r => r.id), ['2454', '2330']);
  const fund = new Map([['AAA', { pe: 10, revGrowth: 20, high52: 120 }], ['ADR', { pe: 5, revGrowth: 50, high52: 900 }], ['BBB', { pe: 40, revGrowth: 30, high52: 101 }], ['CCC', { pe: 25, revGrowth: 5, high52: 100 }], ['DDD', { pe: 30, revGrowth: 12, high52: 100 }], ['EEE', { pe: 35, revGrowth: 12, high52: 100 }]]);
  const uh = [{ id: 'AAA', close: 100, change: 1, sector: '科技' }, { id: 'ADR', close: 100, change: 0, sector: '科技' }, { id: 'BBB', close: 100, change: 3.5, sector: '科技' }, { id: 'CCC', close: 80, change: 0, sector: '科技' }, { id: 'DDD', close: 99, change: 0, sector: '科技' }, { id: 'EEE', close: 99, change: 0, sector: '科技' }];
  const u = zonesUS({ heat: uh, fund });
  assert.deepEqual(u.value.map(r => r.id), ['AAA']); assert.equal(u.value[0].offHigh, -16.7);
  assert.deepEqual(u.heat.map(r => r.id), ['BBB']);
  const files = [{ date: '2026-10-21', zones: { value: [{ id: '2330', close: 98 }], heat: [] } }, { date: '2026-10-22', zones: { value: [{ id: '2330', close: 100 }], heat: [{ id: '2330', close: 100 }] } }];
  assert.deepEqual(historyOf('2330', files).map(e => [e.date, e.zone]), [['2026-10-22', 'heat'], ['2026-10-22', 'value'], ['2026-10-21', 'value']]);
});

test('總經大地圖：季節性推估、月份統計、事件、交易日', () => {
  const closes = []; let t = Date.parse('2014-01-02T00:00:00Z'), c = 100;
  while (t <= Date.parse('2026-10-23T00:00:00Z')) { const d = new Date(t); if (d.getUTCDay() % 6) { const m = d.getUTCMonth() + 1; c *= m === 11 ? 1.002 : m === 10 ? 0.999 : 1.0003; closes.push([d.toISOString().slice(0, 10), Math.round(c * 100) / 100]); } t += 864e5; }
  const s = seasonal(closes, { horizon: 40 });
  assert.equal(s.years, 10); assert.ok(s.median.at(-1) > 0); assert.equal(s.upProb, 100);
  const ms = monthStats(closes, [11, 10]);
  assert.ok(ms[0].avg > 3 && ms[0].up === 100); assert.ok(ms[1].avg < 0 && ms[1].up === 0);
  assert.deepEqual(nextSessions('2026-10-23', 3, new Set(['2026-10-27'])), ['2026-10-26', '2026-10-28', '2026-10-29']);
  assert.ok(monthEvents('US', 2026, 11).some(e => e.text === '美國期中選舉'));
  assert.ok(monthEvents('TW', 2026, 10).some(e => e.date === '2026-10-28'));
  assert.equal(monthEvents('US', 2026, 11).find(e => e.text.startsWith('非農')).date, '2026-11-06');
  const m = buildMacro({ market: 'TW', closes, today: '2026-10-24' });
  assert.equal(m.available, true); assert.equal(m.projection.length, 40); assert.equal(m.months.map(x => x.m).join(), '10,11,12');
  assert.ok(position(closes) > 50 && position(closes) < 100);
});
