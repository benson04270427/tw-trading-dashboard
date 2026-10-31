// 法人資金板塊：精簡日檔、板塊四象限、個股異常、法人成本與連續天數
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDay, analyzeFlows, costOf, streak, netOf, IF_RULES } from '../lib/instflow.mjs';

const dates = Array.from({ length: 21 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
// 每檔每日：外資淨股數 f、投信淨股數 t、收盤 close
function day(date, spec) {
  const inst = [], price = [];
  for (const [id, { f = 0, t = 0, close = 100 }] of Object.entries(spec)) {
    inst.push({ date, stock_id: id, name: 'Foreign_Investor', buy: Math.max(f, 0), sell: Math.max(-f, 0) });
    inst.push({ date, stock_id: id, name: 'Investment_Trust', buy: Math.max(t, 0), sell: Math.max(-t, 0) });
    price.push({ date, stock_id: id, close, spread: 1, Trading_money: 1e9 });
  }
  return compactDay(date, inst, price);
}

test('compactDay merges foreign dealer into foreign, keeps close and change, drops stocks without price', () => {
  const d = compactDay('2026-10-01', [
    { date: '2026-10-01', stock_id: '2330', name: 'Foreign_Investor', buy: 1000, sell: 200 },
    { date: '2026-10-01', stock_id: '2330', name: 'Foreign_Dealer_Self', buy: 10, sell: 0 },
    { date: '2026-10-01', stock_id: '2330', name: 'Dealer_Hedging', buy: 0, sell: 50 },
    { date: '2026-10-01', stock_id: '9999', name: 'Foreign_Investor', buy: 5, sell: 0 },
  ], [{ date: '2026-10-01', stock_id: '2330', close: 1010, spread: 10, Trading_money: 5e9 }]);
  assert.deepEqual(Object.keys(d.s), ['2330']);
  assert.equal(netOf(d.s['2330'], 'f').shares, 810);
  assert.equal(netOf(d.s['2330'], 'd').shares, -50);
  assert.equal(d.s['2330'][8], 1); // (1010/1000-1)*100
});

test('abnormal sell: today net vs 20-day average absolute net', () => {
  const days = dates.map((d, i) => day(d, { '3264': { f: i < 20 ? 10000 : -2000000, close: 100 }, '2330': { f: 50000, close: 1000 } }));
  const r = analyzeFlows(days);
  assert.equal(r.date, '2026-10-21'); assert.equal(r.baseDays, 20);
  assert.equal(r.abnormal.sell.length, 1);
  assert.equal(r.abnormal.sell[0].id, '3264');
  assert.equal(r.abnormal.sell[0].net, -2); // -2,000,000 股 × 100 元 = -2 億
  assert.equal(r.abnormal.sell[0].ratio, 200);
  assert.equal(r.abnormal.buy.length, 0, '2330 is steady, not abnormal');
});

test('sector quadrants: surge, rotate, wait, ebb from 5-day flow and bias vs normal', () => {
  const groups = { A: 'surge', B: 'rotate', C: 'wait', D: 'ebb' };
  // A：一直小買、今天大買 → 漲潮；B：前面大買、今天小買 → 輪動；C：前面大賣、今天小賣 → 觀望；D：一直小賣、今天大賣 → 退潮
  const plan = { A: [1e5, 1e6], B: [2e6, 1e5], C: [-2e6, -1e5], D: [-1e5, -1e6] };
  const days = dates.map((d, i) => day(d, Object.fromEntries(Object.entries(plan).map(([g, [early, last]]) => [g, { f: i < 20 ? early : last, close: 100 }]))));
  const r = analyzeFlows(days, { sectorsOf: id => [id] });
  for (const [g, state] of Object.entries(groups)) assert.equal(r.sectors.find(s => s.name === g).state, state, g);
  assert.deepEqual(r.counts, { surge: 1, rotate: 1, wait: 1, ebb: 1 });
  assert.equal(r.money.today.buy[0].name, 'A');
  assert.equal(r.money.five.sell[0].name, 'C');
});

test('flip and spike insights', () => {
  // X：前 4 日每日賣 5 億，今天買 8 億 → 買賣換邊；Y：平常每日 1 億，今天 6 億 → 跟平常比
  const days = dates.map((d, i) => day(d, { X: { f: i < 20 ? -5e6 : 8e6, close: 100 }, Y: { f: i < 20 ? 1e6 : 6e6, close: 100 } }));
  const r = analyzeFlows(days, { sectorsOf: id => [id] });
  const flip = r.insights.find(x => x.type === 'flip'), spike = r.insights.find(x => x.type === 'spike' && x.sector === 'Y');
  assert.equal(flip.sector, 'X'); assert.equal(flip.prior4, -20); assert.equal(flip.today, 8);
  assert.equal(spike.ratio, 6);
});

test('multi-group membership counts a stock in each group; stocks outside groups are skipped', () => {
  const days = dates.map(d => day(d, { '2337': { f: 1e6, close: 50 }, '1101': { f: 1e6, close: 50 } }));
  const r = analyzeFlows(days, { sectorsOf: id => id === '2337' ? ['記憶體', 'NOR Flash'] : [] });
  assert.deepEqual(r.sectors.map(s => s.name).sort(), ['NOR Flash', '記憶體']);
  assert.equal(r.coverage.sectored, 1);
});

test('institutional cost and streaks', () => {
  // 前 18 日外資每天買 1000 股、收盤 100；最後 2 日買 3000 股、收盤 110；今天收盤 110
  const days = dates.map((d, i) => day(d, { '3034': { f: i >= 19 ? 3000 : 1000, t: i === 20 ? 500 : -500, close: i >= 19 ? 110 : 100 } }));
  const c = costOf(days, '3034', 'f');
  // 近 20 日（第 2–21 天）：18 天 × 1000 × 100 + 2 × 3000 × 110 → (1,800,000 + 660,000) / 24000 = 102.5
  assert.equal(c.avg, 102.5); assert.equal(c.deviation, 7.32);
  assert.deepEqual(streak(days, '3034', 'f'), { days: 21, accel: false });
  assert.deepEqual(streak(days, '3034', 't'), { days: 1, accel: false });
  const r = analyzeFlows(days, { focus: ['3034'] });
  assert.equal(r.costs[0].cost.foreign.avg, 102.5);
  assert.equal(r.costs[0].focus, true);
});

test('too few base days: no ratio, no state', () => {
  const days = dates.slice(0, 5).map(d => day(d, { A: { f: 1e6 } }));
  const r = analyzeFlows(days, { sectorsOf: () => ['A'] });
  assert.equal(r.sectors[0].state, null); assert.equal(r.abnormal.buy.length, 0);
  assert.equal(IF_RULES.minBaseDays, 10);
});
