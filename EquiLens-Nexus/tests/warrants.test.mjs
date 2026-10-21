// 權證追蹤（只看認購權證）：標的對照、行情解析、發行商判斷、分點依標的彙總與提醒條件、個股權證清單，以及伺服器端的整合流程
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { warrantMaster, warrantOn, normalizeRatio, parseTwseWarrants, parseTpexWarrants, turnoverByTarget, issuerOf, issuerBranch, branchWarrants, stockWarrants, WARRANT_DEFAULTS } from '../lib/warrants.mjs';
import { brokerWatchAlerts, normalizeChipwatch } from '../lib/chipwatch.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROWS = [
  { stock_id: '030001', date: '2026-03-02', target_stock_id: '3017', type: '認購', end_date: '2027-03-01', exercise_ratio: 0.05, fulfillment_price: 1000 },
  { stock_id: '030002', date: '2026-05-04', target_stock_id: '3017', type: '認購', end_date: '2027-02-01', exercise_ratio: 50, fulfillment_price: 0 },
  { stock_id: '03001P', date: '2026-05-04', target_stock_id: '3017', type: '認售', end_date: '2027-02-01', exercise_ratio: 0.05, fulfillment_price: 900 },
  { stock_id: '030009', date: '2024-01-02', target_stock_id: '2330', type: '認購', end_date: '2025-12-31', exercise_ratio: 0.01, fulfillment_price: 600 },
  { stock_id: '030009', date: '2026-01-05', target_stock_id: '2454', type: '認購', end_date: '2027-01-04', exercise_ratio: 0.02, fulfillment_price: 1300 },
  { stock_id: 'BAD', date: '2026-01-05', target_stock_id: '2454', type: '認購', end_date: '2027-01-04' },
];
const meta = new Map([['3017', { name: '奇鋐' }], ['2454', { name: '聯發科' }], ['3661', { name: '世芯-KY' }]]);

test('lookup: a reused warrant code maps to the underlying of the period that contains the date; ratios normalized', () => {
  const m = warrantMaster(ROWS);
  assert.deepEqual(Object.keys(m).sort(), ['030001', '030002', '030009', '03001P']);
  assert.equal(warrantOn(m, '030009', '2025-06-30').target, '2330');
  assert.equal(warrantOn(m, '030009', '2026-10-16').target, '2454');
  assert.equal(warrantOn(m, '030009', '2026-01-01'), null, 'between the two periods');
  assert.equal(warrantOn(m, '030002', '2026-10-16').ratio, 0.05, 'per-thousand ratio converted');
  assert.equal(warrantOn(m, '030002', '2026-10-16').strike, null, 'missing strike stays unknown');
  assert.equal(warrantOn(m, '03001P', '2026-10-16').kind, 'P');
  assert.equal(normalizeRatio('65.00'), 0.065); assert.equal(normalizeRatio(0.1), 0.1); assert.equal(normalizeRatio(0), null);
  assert.equal(Object.keys(warrantMaster(ROWS, { keepFrom: '2026-06-01' })['030009']).length, 1, 'expired periods dropped');
});

test('official quotes: TWSE call warrants by field name, TPEx calls only with its own date; turnover per underlying', () => {
  const tw = parseTwseWarrants({ tables: [{ fields: ['指數'], data: [['x']] }, { fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價'], data: [['030001', '奇鋐凱基56購01', '3,000,000', '9', '6,000,000', '', '', '', '2.05'], ['030009', '聯發科群益56購01', '500,000', '1', '600,000', '', '', '', '--'], ['2330', '台積電', '1', '1', '1', '', '', '', '1']] }] });
  assert.deepEqual(tw['030001'], ['奇鋐凱基56購01', 2.05, 3000000, 6000000]);
  assert.equal(tw['030009'][1], null, 'no closing price'); assert.equal(tw['2330'], undefined);
  const tp = parseTpexWarrants([{ Date: '1151016', Code: '72479U', Name: '擎亞群益5B購01', 'TradeVol.': '1,000', TradeValue: '5,000', Close: '5', UnderlyingStockCode: '8096' }, { Date: '1151016', Code: '72480P', Name: '擎亞群益5B售01', TradeValue: '9' }, { Date: '1151016', Code: '72481C', Name: '擎亞群益牛01', TradeValue: '9' }]);
  assert.equal(tp.date, '2026-10-16'); assert.deepEqual(Object.keys(tp.q), ['72479U']); assert.equal(tp.q['72479U'][4], '8096');
  const m = warrantMaster(ROWS);
  assert.deepEqual(turnoverByTarget({ ...tw, ...tp.q }, m, '2026-10-16'), { 3017: 6000000, 2454: 600000, 8096: 5000 });
});

test('issuer: parsed from the warrant name; only the issuer head office is treated as market making', () => {
  assert.equal(issuerOf('奇鋐凱基56購01', '奇鋐'), '凱基');
  assert.equal(issuerOf('友達台新6A購01', '友達'), '台新');
  assert.equal(issuerOf('世芯元大5C購01', '世芯-KY'), '元大', 'shortened underlying name');
  assert.equal(issuerOf('台指富邦5A購01', '臺股指數'), '富邦', 'fallback: two characters before the code');
  assert.equal(issuerOf(''), '');
  assert.equal(issuerBranch('凱基', '凱基'), true); assert.equal(issuerBranch('凱基台北', '凱基'), false); assert.equal(issuerBranch('凱基', ''), false);
});

test('branch warrants: calls grouped by underlying; puts, unknown codes and the issuer head office excluded; big buy and streak', () => {
  const m = warrantMaster(ROWS), quotes = { '030001': ['奇鋐凱基56購01', 2.05, 0, 6000000], '030002': ['奇鋐元大56購02', 1.5, 0, 1500000], '030009': ['聯發科群益56購01', 1.2, 0, 600000] }, turnover = { 3017: 7500000, 2454: 600000 };
  const rows = [{ stock_id: '030001', price: 2, buy: 1500000, sell: 0 }, { stock_id: '030001', price: 2.1, buy: 1500000, sell: 500000 }, { stock_id: '03001P', price: 1, buy: 900000, sell: 0 }, { stock_id: '999999', price: 1, buy: 1, sell: 0 }, { stock_id: '030009', price: 1.2, buy: 0, sell: 300000 }];
  const w = branchWarrants(rows, { date: '2026-10-16', branchName: '凱基台北', master: m, quotes, turnover, meta, watch: new Set(['3017']), history: [{ 3017: 1e6 }, { 3017: 2e6 }] });
  assert.deepEqual(w.skipped, { puts: 1, unknown: 1, issuer: 0 });
  const k = w.buy[0];
  assert.equal(k.id, '3017'); assert.equal(k.netAmt, 6150000 - 1050000); assert.equal(k.share, 68); assert.equal(k.big, true);
  assert.equal(k.streak, 3); assert.equal(k.streakAmt, 5100000 + 3e6); assert.equal(k.run, true); assert.equal(k.watch, true);
  assert.equal(w.sell[0].id, '2454'); assert.equal(w.nets['2454'], -360000);
  assert.deepEqual(w.signals.map(x => x.id), ['3017']); assert.equal(w.shareKnown, true);
  // 發行商總公司的自家權證不列入；沒有行情時單日大買只看金額
  const hq = branchWarrants([{ stock_id: '030001', price: 2, buy: 0, sell: 2500000 }, { stock_id: '030002', price: 1.5, buy: 4000000, sell: 0 }], { date: '2026-10-16', branchName: '凱基', master: m, quotes, meta, turnover: null });
  assert.equal(hq.skipped.issuer, 1); assert.equal(hq.buy[0].netAmt, 6000000); assert.equal(hq.buy[0].share, null); assert.equal(hq.buy[0].big, true); assert.equal(hq.shareKnown, false);
  // 門檻：占比不足、連續天數不足
  const low = branchWarrants(rows, { date: '2026-10-16', master: m, quotes, turnover: { 3017: 1e9 }, meta, settings: { warrantAmount: 5e6, warrantPct: 10, warrantDays: 3 } });
  assert.equal(low.buy[0].big, undefined); assert.equal(low.signals.length, 0);
});

test('stock warrant list: calls of this underlying only, moneyness, days left, nominal leverage, sorted by turnover', () => {
  const quotes = { '030001': ['奇鋐凱基56購01', 2, 3000000, 6000000], '030002': ['奇鋐元大56購02', 1.5, 1000000, 9000000] };
  const r = stockWarrants(ROWS, { id: '3017', date: '2026-10-16', quotes, close: 1100, targetName: '奇鋐' });
  assert.equal(r.count, 2); assert.equal(r.traded, 2); assert.equal(r.turnover, 15000000);
  assert.deepEqual(r.list.map(x => x.id), ['030002', '030001']);
  const a = r.list[1];
  assert.equal(a.moneyness, 10); assert.equal(a.days, 136); assert.equal(a.leverage, 27.5); assert.equal(a.issuer, '凱基');
  assert.equal(r.list[0].moneyness, null, 'unknown strike');
  assert.equal(stockWarrants(ROWS, { id: '3017', date: '2027-02-15', quotes }).count, 1, 'expired warrants disappear');
});

test('settings and alerts: warrant thresholds normalized; warrant signals produce a broker alert even without stock signals', () => {
  const s = normalizeChipwatch({ warrantAmount: 1, warrantPct: 500, warrantDays: 30, warrants: false });
  assert.deepEqual([s.warrants, s.warrantAmount, s.warrantPct, s.warrantDays], [false, 1e5, 100, 10]);
  assert.deepEqual(Object.fromEntries(Object.keys(WARRANT_DEFAULTS).map(k => [k, normalizeChipwatch({})[k]])), WARRANT_DEFAULTS);
  const doc = { date: '2026-10-16', branches: [{ id: '9268', name: '凱基台北', count: 3, signals: [], warrants: { signals: [{ id: '3017', name: '奇鋐', netAmt: 12060000, share: 15.2, streak: 3, streakAmt: 2e7, big: true, run: true, watch: true }, { id: '2454', name: '聯發科', netAmt: 3e6, streak: 4, streakAmt: 9e6, run: true }] } }, { id: '9200', name: '凱基', count: 2, signals: [] }] };
  const [a, ...rest] = brokerWatchAlerts(doc);
  assert.equal(rest.length, 0, 'branches without any signal are skipped');
  assert.equal(a.title, '分點追蹤：凱基台北'); assert.equal(a.watch, true);
  assert.match(a.detail, /認購權證：奇鋐（自選） 淨買 1,206 萬（占 15.2%），連 3 日 \+2,000 萬、聯發科 連 4 日 \+900 萬/);
});

test('server: broker tracking adds call warrants per branch; stock warrant panel and per-warrant branches; cached lookups', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equilens-warrants-')), log = path.join(dir, 'requests.log');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, setupDone: true, market: 'TW', language: 'zh-TW', providers: { enabled: ['finmind'], prefer: {} }, llm: { provider: 'anthropic' } }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ interval: 20, monitor: false, chipwatch: { branches: [{ id: '9268', name: '凱基台北' }, { id: '9200', name: '凱基' }], auto: false } }));
  fs.writeFileSync(path.join(dir, 'universe.json'), JSON.stringify([{ id: '3017', name: '奇鋐', sector: '電腦及週邊設備業', market: '上市' }, { id: '2454', name: '聯發科', sector: '半導體業', market: '上市' }, { id: '2330', name: '台積電', sector: '半導體業', market: '上市' }]));
  fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify(['3017']));
  const child = spawn(process.execPath, ['--import', path.join(root, 'tests/helpers/mock-network.mjs'), 'server.mjs'], { cwd: root, env: { ...process.env, PORT: '4397', EQUITY_DATA_DIR: dir, FINMIND_API_TOKEN: 'mock', MOCK_LOG: log }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', c => reject(new Error(`Server exited ${c}`))); setTimeout(() => reject(new Error('Server startup timeout')), 10000).unref(); });
    const base = 'http://127.0.0.1:4397/api/', get = async p => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
    const s = (await get('state')).body, post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
    const q = await post('chipwatch/query', { date: '2026-10-16' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const r = q.body.report, [b1, b2] = r.branches;
    assert.deepEqual(r.warrantRules, { amount: 5e6, pct: 10, days: 3 }); assert.equal(r.warrantInfo.turnover, true); assert.equal(r.warrantInfo.error, '');
    assert.equal(b1.warrants.buy[0].id, '3017'); assert.equal(b1.warrants.buy[0].netAmt, 6e6); assert.equal(b1.warrants.buy[0].share, 80); assert.equal(b1.warrants.buy[0].big, true); assert.equal(b1.warrants.buy[0].watch, true);
    assert.deepEqual(b1.warrants.skipped, { puts: 1, unknown: 1, issuer: 0 });
    assert.equal(b2.warrants.skipped.issuer, 1, 'the issuer head office trading its own warrants'); assert.equal(b2.warrants.signals.length, 0);
    // 個股權證：清單依成交金額、行使比例換算、追蹤分點的進出
    const w = await get('warrants?id=3017');
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual(w.body.list.map(x => x.id), ['030001', '030002']); assert.equal(w.body.list[1].ratio, 0.05); assert.equal(w.body.list[0].issuer, '凱基');
    assert.deepEqual(w.body.tracked.map(x => [x.branch, x.netAmt, x.big]), [['凱基台北', 6e6, true], ['凱基', 6e5, false]]);
    assert.equal((await get('warrants?id=3017')).status, 200);
    const wb = await get('warrants/brokers?wid=030001&date=2026-10-16');
    assert.deepEqual([wb.body.buy[0].name, wb.body.buy[0].net, wb.body.sell[0].name], ['凱基台北', 3e6, '元大']); assert.deepEqual(wb.body.tracked, ['9268', '9200']);
    assert.equal((await get('warrants/brokers?wid=../x&date=2026-10-16')).status, 400);
    assert.equal((await get('warrants?id=../x')).status, 400);
    // 對照表：全市場與個股各只查一次；權證分點每個分點 1 次
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.filter(u => /TaiwanStockInfoWithWarrantSummary/.test(u) && !/data_id/.test(u)).length, 1);
    assert.equal(calls.filter(u => /TaiwanStockInfoWithWarrantSummary/.test(u) && /data_id=3017/.test(u)).length, 1);
    assert.equal(calls.filter(u => /taiwan_stock_warrant_trading_daily_report\?securities_trader_id/.test(u)).length, 2);
    // 門檻設定
    const set = await post('chipwatch/settings', { warrantAmount: 3e6, warrantPct: 20, warrantDays: 2, warrants: false });
    assert.deepEqual([set.body.settings.warrantAmount, set.body.settings.warrantPct, set.body.settings.warrantDays, set.body.settings.warrants], [3e6, 20, 2, false]);
  } finally { child.kill(); await new Promise(r => child.once('close', r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
