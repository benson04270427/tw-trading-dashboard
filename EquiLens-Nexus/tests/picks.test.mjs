import test from 'node:test';
import assert from 'node:assert/strict';
import { movers, heatStocks, flowMap, scoreStock, choose, candidates } from '../lib/picks.mjs';

const st = (id, change, money, extra = {}) => ({ id, name: 'N' + id, close: 100, change, money, prevMoney: money / 2, ...extra });
const heat = { date: '2026-10-22', sectors: [{ name: '半導體業', stocks: [st('2330', 3, 5e9), st('2454', -4, 3e9), st('1111', 9.9, 2e8), st('2222', 5, 1e6)] }, { name: '電子零組件業', stocks: [st('3017', 2, 1e9), st('3324', -1, 8e8), st('9999', 0, 1e9, { close: 5 })] }] };

test('漲跌排行：門檻、排序、自選標記', () => {
  const m = movers(heat, { market: 'TW', watch: new Set(['3017']) });
  assert.deepEqual(m.gainers.map(x => x.id), ['1111', '2330', '3017']); // 2222 成交金額不足、9999 股價不足
  assert.deepEqual(m.losers.map(x => x.id), ['2454', '3324']);
  assert.equal(m.gainers[2].watch, true); assert.equal(heatStocks(heat)[0].moneyChange, 100);
});

test('法人排行、評分理由、精選分散', () => {
  const flows = flowMap({ rankings: [{ investor: 'foreign', buy: [{ id: '2330', netLots: 5000 }], sell: [{ id: '2454', netLots: -900 }] }, { investor: 'trust', buy: [{ id: '2330', netLots: 300 }], sell: [{ id: '2454', netLots: -50 }] }, { investor: 'dealer', buy: [{ id: '1111', netLots: 1 }], sell: [] }] });
  assert.deepEqual(flows.get('2330'), { foreign: 5000, foreignRank: 1, trust: 300, trustRank: 1 });
  assert.equal(flows.has('1111'), false);
  const a = scoreStock({ id: '2330', change: 3, money: 5e9, moneyChange: 100, flow: flows.get('2330'), signal: { side: 'buy', age: 1, date: '2026-10-21' }, revYoY: 40, news: [{ title: '好消息' }], chain: '晶圓代工與 IC 設計' }, { market: 'TW' });
  assert.ok(a.score >= 70); assert.ok(a.reasons.some(r => r.includes('外資、投信同步買超'))); assert.ok(a.reasons.some(r => r.includes('新聞：好消息')));
  const b = scoreStock({ id: '2454', change: -4, money: 3e9, flow: flows.get('2454'), signal: { side: 'sell', age: 0, date: '2026-10-22' } }, { market: 'TW' });
  assert.ok(b.score < 0); assert.ok(b.warnings.length >= 2);
  const c = scoreStock({ id: '1111', change: 9.9, money: 2e8 }, { market: 'TW' });
  assert.ok(c.warnings.includes('漲停，追價風險高'));
  const pool = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, chain: '散熱', score: 50 - i, reasons: ['x', 'y'], money: 1 })).concat([{ id: 'e', chain: 'PCB', score: 10, reasons: ['x', 'y'] }, { id: 'f', sector: '金融', score: 30, reasons: ['x'] }]);
  assert.deepEqual(choose(pool).map(x => x.id), ['a', 'b']); // 同供應鏈最多 2 檔、分數與理由門檻
});

test('候選池：研究、自選、AI 供應鏈、法人、成交熱門', () => {
  const ids = candidates({ heat, market: 'TW', research: new Set(['2454']), chain: new Map([['3324', '散熱']]), top: 1 }).map(x => x.id).sort();
  assert.deepEqual(ids, ['2330', '2454', '3324']);
});

import { flowMapFromRows, relevantNews, newHigh } from '../lib/picks.mjs';
test('證交所法人資料排行、新聞過濾、60 日新高', () => {
  const rows = [{ stock_id: '2330', name: 'Foreign_Investor', buy: 5e6, sell: 1e6 }, { stock_id: '2330', name: 'Foreign_Dealer_Self', buy: 1e6, sell: 0 }, { stock_id: '2330', name: 'Investment_Trust', buy: 0, sell: 2e5 }, { stock_id: '2454', name: 'Investment_Trust', buy: 3e5, sell: 0 }, { stock_id: '2454', name: 'Dealer_self', buy: 9e9, sell: 0 }];
  const m = flowMapFromRows(rows);
  assert.deepEqual(m.get('2330'), { foreign: 5000, foreignRank: 1, trust: -200, trustRank: -1 });
  assert.deepEqual(m.get('2454'), { trust: 300, trustRank: 1 });
  const n = relevantNews([{ title: '瑞昱：已布局3奈米ASIC - 自由時報' }, { title: '瑞昱：已布局3奈米ASIC - 中時' }, { title: '瑞昱(2379) 個股概覽', link: 'https://www.cmoney.tw/forum/stock/2379' }, { title: '大盤收跌' }], '2379', '瑞昱');
  assert.deepEqual(n.map(x => [x.title, x.source]), [['瑞昱：已布局3奈米ASIC', '自由時報']]);
  assert.equal(relevantNews([{ title: 'Apple downgrade' }, { title: 'Netflix jumps' }], 'NFLX', 'Netflix Inc. Common Stock').length, 1);
  const up = Array.from({ length: 70 }, (_, i) => ({ close: 100 + i })); assert.equal(newHigh(up), true); assert.equal(newHigh([...up, { close: 150 }]), false);
});
test('台股聚焦：只看研究、自選與 AI 供應鏈', () => {
  const ids = candidates({ heat, market: 'TW', research: new Set(['2454']), chain: new Map([['3324', '散熱']]), flows: new Map([['2330', { foreignRank: 1 }]]), top: 5, focus: true }).map(x => x.id).sort();
  assert.deepEqual(ids, ['2454', '3324']);
});
