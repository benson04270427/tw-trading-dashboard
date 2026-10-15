// 自訂提醒、分點追蹤、大戶集中度排行與日報逐檔短評
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeRule, createRuleState, scanPriceAlerts, evalRule } from '../lib/pricealerts.mjs';
import { aggregateTrader, branchDay, brokerWatchAlerts, holderMarketDay, rankHolders, holderRankAlert, normalizeChipwatch, streakOf } from '../lib/chipwatch.mjs';
import { parseHolders } from '../lib/insight.mjs';
import { reportSchema } from '../lib/report.mjs';
import { marketProfile } from '../lib/markets.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tw = marketProfile('TW');
const row = (close, chg, time = '10:00:00', extra = {}) => ({ stock_id: '2330', date: `2026-10-13 ${time}`, close, change_price: chg, total_volume: 1000, yesterday_volume: 1000, ...extra });
const ctx = { meta: new Map([['2330', { name: '台積電' }]]), watch: new Set(['2330']), market: tw, lang: 'zh-TW' };

test('price rules: validation keeps ids, change of condition resets the fired state', () => {
  assert.ok(normalizeRule({ stockId: '2330', kind: 'nope', value: 1 }).error);
  assert.ok(normalizeRule({ stockId: '2330', kind: 'above', value: -1 }).error);
  assert.ok(normalizeRule({ stockId: '2330', kind: 'pct-up', value: 40 }).error);
  const r = normalizeRule({ stockId: '2330', kind: 'above', value: 1000, note: ' 突破 ' });
  assert.equal(r.active, true); assert.equal(r.note, '突破'); assert.equal(r.repeat, false);
  const fired = { ...r, firedDate: '2026-10-13', firedAt: 'x', active: false };
  const same = normalizeRule({ note: 'n' }, fired);
  assert.equal(same.id, r.id); assert.equal(same.firedDate, '2026-10-13'); assert.equal(same.active, false);
  const again = normalizeRule({ active: true }, fired); assert.equal(again.firedDate, null, 're-enabling clears the fired state');
  assert.equal(normalizeRule({ value: 1100 }, fired).firedDate, null);
});

test('price alerts fire on the crossing; one-time rules disable, repeat rules re-arm after the condition clears', () => {
  const once = normalizeRule({ stockId: '2330', kind: 'above', value: 1000 }), rep = normalizeRule({ stockId: '2330', kind: 'pct-down', value: 2, repeat: true });
  const st = createRuleState('2026-10-13'), rules = [once, rep];
  let r = scanPriceAlerts(st, [row(990, 0)], rules, ctx); assert.equal(r.alerts.length, 0);
  r = scanPriceAlerts(st, [row(1001, 11, '10:00:10')], rules, ctx);
  assert.equal(r.alerts.length, 1); assert.equal(r.alerts[0].type, 'custom'); assert.equal(r.alerts[0].dir, 'up'); assert.equal(once.active, false); assert.equal(r.changed[0], once);
  assert.equal(scanPriceAlerts(st, [row(1005, 15, '10:00:20')], rules, ctx).alerts.length, 0, 'disabled after firing');
  // 重複規則：跌幅 ≥ 2%（昨收 1000）
  assert.equal(scanPriceAlerts(st, [row(975, -25, '10:01:00')], rules, ctx).alerts.length, 1);
  assert.equal(scanPriceAlerts(st, [row(970, -30, '10:01:10')], rules, ctx).alerts.length, 0, 'still true: no repeat');
  scanPriceAlerts(st, [row(990, -10, '10:02:00')], rules, ctx);
  assert.equal(scanPriceAlerts(st, [row(975, -25, '10:03:00')], rules, ctx).alerts.length, 0, '5-minute cooldown');
  scanPriceAlerts(st, [row(990, -10, '10:08:00')], rules, ctx);
  assert.equal(scanPriceAlerts(st, [row(975, -25, '10:09:00')], rules, ctx).alerts.length, 1, 're-armed after cooldown');
  assert.equal(rep.hits, 2); assert.equal(rep.active, true);
  // 重新啟動：今天已提醒過且條件仍成立 → 不重發；其他日期的列不比對
  const restart = createRuleState('2026-10-13'), fresh = normalizeRule({ stockId: '2330', kind: 'below', value: 980, repeat: true });
  fresh.firedDate = '2026-10-13';
  assert.equal(scanPriceAlerts(restart, [row(975, -25)], [fresh], ctx).alerts.length, 0);
  assert.equal(scanPriceAlerts(createRuleState('2026-10-14'), [row(975, -25)], [normalizeRule({ stockId: '2330', kind: 'below', value: 980 })], ctx).alerts.length, 0, 'stale date ignored');
});

test('volume rule uses the projected full-day volume and waits 15 minutes', () => {
  const r = normalizeRule({ stockId: '2330', kind: 'volume', value: 2 });
  assert.equal(evalRule(r, row(100, 1, '09:10:00', { total_volume: 5000 }), tw), null);
  const v = evalRule(r, row(100, 1, '09:27:00', { total_volume: 300 }), tw); // 27/270 → 預估 3000 張 = 3 倍
  assert.equal(v.ok, true); assert.ok(Math.abs(v.ratio - 3) < 1e-9);
});

const traderRows = [
  { stock_id: '2330', price: 1000, buy: 300000, sell: 0 }, { stock_id: '2330', price: 1010, buy: 100000, sell: 50000 },
  { stock_id: '2317', price: 200, buy: 0, sell: 400000 }, { stock_id: '1101', price: 30, buy: 20000, sell: 0 },
];
test('branch tracking: per-stock totals, average prices, ranking, streaks and alerts', () => {
  const a = aggregateTrader(traderRows), tsmc = a.find(x => x.id === '2330');
  assert.equal(tsmc.net, 350000); assert.equal(tsmc.avgBuy, 1002.5); assert.equal(tsmc.netAmt, 401000000 - 50500000);
  const meta = new Map([['2330', { name: '台積電' }], ['2317', { name: '鴻海' }]]);
  const d = branchDay(traderRows, { meta, watch: new Set(['2317']), research: new Set(['2330']), history: [{ '2330': 1000 }, { '2330': 5, '2317': 7 }] });
  assert.deepEqual(d.buy.map(x => x.id), ['2330', '1101']); assert.deepEqual(d.sell.map(x => x.id), ['2317']);
  assert.equal(d.buy[0].streak, 3); assert.equal(d.sell[0].streak, -1);
  assert.deepEqual(d.mine.map(x => x.id), ['2330', '2317']); assert.equal(d.nets['1101'], 20000);
  assert.equal(streakOf([{ x: -1 }, { x: 2 }], 'x', 3), 2);
  const doc = { date: '2026-10-13', branches: [{ id: '9200', name: '凱基台北', ...d }, { id: 'x', name: 'err', error: 'quota', count: 0 }] };
  const al = brokerWatchAlerts(doc, { minLots: 100, lang: 'zh-TW' });
  assert.equal(al.length, 1); assert.equal(al[0].type, 'broker'); assert.equal(al[0].level, 'hi', 'watchlist stock involved');
  assert.match(al[0].detail, /台積電 \+350（連3買）/); assert.match(al[0].detail, /鴻海 -400/); assert.doesNotMatch(al[0].detail, /1101/, 'below the threshold');
  assert.equal(brokerWatchAlerts(doc, { minLots: 1000 }).length, 0);
  const s = normalizeChipwatch({ branches: [{ id: '9200', name: 'A' }, { id: '9200', name: 'dup' }, { id: '../x' }], minLots: 3 });
  assert.deepEqual(s.branches, [{ id: '9200', name: 'A' }]); assert.equal(s.minLots, 10); assert.equal(s.auto, true);
});

const level = (date, id, rows) => rows.map(([lv, people, percent]) => ({ date, stock_id: id, HoldingSharesLevel: lv, people, percent }));
const week = (date, big, people) => [...level(date, '2330', [['1-999', people - 10, 100 - big], ['more than 1,000,001', 10, big], ['total', people, 100]]), ...level(date, '0050', [['1-999', 50, 90], ['more than 1,000,001', 1, 10]])];
test('holder concentration: whole-market day summary, 1/4-week changes, tone and weekly alert', () => {
  const day = holderMarketDay(week('2026-10-09', 72, 5000), '2026-10-09');
  assert.deepEqual(day['2330'], [72, 72, 28, 5000]);
  assert.deepEqual(parseHolders(week('2026-10-09', 72, 5000).filter(r => r.stock_id === '2330'))[0].big1000, 72, 'refactored parser unchanged');
  const D = (date, big, people) => ({ date, s: holderMarketDay(week(date, big, people), date) });
  const meta = new Map([['2330', { name: '台積電' }], ['0050', { name: '元大台灣50' }]]);
  const r = rankHolders({ latest: D('2026-10-09', 72, 4800), prev1: D('2026-10-02', 71.5, 4900), prev4: D('2026-09-11', 71, 5000) }, { meta, watch: new Set(['2330']) });
  assert.equal(r.count, 1, 'market scope keeps common stocks only');
  assert.deepEqual([r.rows[0].d1, r.rows[0].d4, r.rows[0].dp4, r.rows[0].tone], [0.5, 1, -4, '籌碼集中']);
  const a = holderRankAlert(r, { lang: 'zh-TW' }); assert.equal(a.type, 'holders'); assert.match(a.detail, /台積電 \+1%/);
  assert.equal(rankHolders({ latest: D('2026-10-09', 72, 4800) }, { ids: ['2330'] }).rows[0].tone, '資料累積中');
});

test('report schema asks for one note per watchlist stock with a fixed stance', () => {
  const s = reportSchema('zh-TW');
  assert.ok(s.required.includes('notes'));
  assert.deepEqual(s.properties.notes.items.properties.stance.enum, ['偏多', '中性', '偏空']);
  assert.ok(!/[一-鿿]/.test(reportSchema('en').properties.notes.description));
});

test('price alert and chip tracking APIs: validation, persistence per market, no FinMind needed for alerts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equilens-chips-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, setupDone: true, market: 'TW', language: 'zh-TW', providers: { enabled: [], prefer: {} }, llm: { provider: 'anthropic' } }));
  fs.writeFileSync(path.join(dir, 'universe.json'), JSON.stringify([{ id: '2330', name: '台積電', sector: '半導體業', market: '上市' }]));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '4396', EQUITY_DATA_DIR: dir, FINMIND_API_TOKEN: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', c => reject(new Error(`Server exited ${c}`))); setTimeout(() => reject(new Error('Server startup timeout')), 10000).unref(); });
    const base = 'http://127.0.0.1:4396/api/', get = async p => (await fetch(base + p)).json();
    const s = await get('state'), post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(b) });
    assert.deepEqual((await get('price-alerts')).rules, []);
    assert.equal((await post('price-alerts', { stockId: '9999', kind: 'above', value: 1 })).status, 400, 'not in the stock list');
    assert.equal((await post('price-alerts', { stockId: '2330', kind: 'above', value: 0 })).status, 400);
    let r = await (await post('price-alerts', { stockId: '2330', kind: 'above', value: 1100, note: '新高' })).json();
    assert.equal(r.rules.length, 1); assert.equal(r.rules[0].name, '台積電'); assert.equal(r.rules[0].label, '價格 ≥ 1100');
    const id = r.rules[0].id;
    r = await (await post('price-alerts', { id, active: false })).json(); assert.equal(r.rules[0].active, false);
    assert.equal((await post('price-alerts', { id: 'missing', active: true })).status, 400);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'price-alerts.json'), 'utf8')).length, 1);
    r = await (await post('price-alerts/delete', { id })).json(); assert.deepEqual(r.rules, []);
    // 籌碼追蹤沒有 FinMind 時：回報不可用，查詢給可讀的錯誤
    const cw = await get('chipwatch'); assert.equal(cw.capable, false); assert.deepEqual(cw.settings.branches, []);
    const q = await post('chipwatch/query', {}); assert.equal(q.status, 400); assert.match((await q.json()).error, /FinMind/);
    const set = await (await post('chipwatch/settings', { branches: [{ id: '9200', name: '凱基台北' }], minLots: 200 })).json();
    assert.deepEqual(set.settings.branches, [{ id: '9200', name: '凱基台北' }]); assert.equal(set.settings.minLots, 200);
    assert.equal((await post('chipwatch/settings', { branches: Array.from({ length: 21 }, (_, i) => ({ id: String(i), name: 'x' })) })).status, 400);
    const hr = await get('holders/rank'); assert.equal(hr.capable, false); assert.equal(hr.rank, null);
  } finally { child.kill(); await new Promise(r => child.once('close', r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
