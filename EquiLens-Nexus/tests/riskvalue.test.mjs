import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRisk, percentile, exposure, level, retailSeries, foreignSpotSeries, trendRisk, RISK_TASKS, fetchRiskInputs } from '../lib/riskgauge.mjs';
import { mergeInputs, screen, STRATEGIES } from '../lib/valuescreen.mjs';

// ---- 風控水位 ----
const days = n => { const out = []; let d = Date.parse('2025-06-02T00:00:00Z'); while (out.length < n) { const w = new Date(d).getUTCDay(); if (w > 0 && w < 6) out.push(new Date(d).toISOString().slice(0, 10)); d += 864e5; } return out; };
function rawData(n = 320, { hot = false } = {}) {
  const D = days(n), raw = { index: [], mtxInst: [], mtxDaily: [], txInst: [], spot: [], margin: [], fx: [], errors: {} };
  D.forEach((d, i) => {
    const late = i > n - 15 && hot; // 最後幾天：散戶大幅偏多、外資大賣、融資暴增、台幣急貶、指數跌破均線
    raw.index.push({ date: d, close: late ? 20000 - (i - (n - 15)) * 300 : 20000 + Math.sin(i / 9) * 400 + i * 2 });
    const instNet = late ? -30000 : Math.round(Math.sin(i / 7) * 5000);
    raw.mtxInst.push({ date: d, institutional_investors: '外資', long_open_interest_balance_volume: Math.max(0, instNet) + 1000, short_open_interest_balance_volume: Math.max(0, -instNet) + 1000 });
    raw.mtxDaily.push({ date: d, trading_session: 'position', contract_date: '202611', close: 20000, open_interest: 60000 });
    raw.mtxDaily.push({ date: d, trading_session: 'position', contract_date: '202611/202612', close: 10, open_interest: 999 }); // 價差組合不計
    raw.txInst.push({ date: d, institutional_investors: '外資', long_open_interest_balance_volume: 20000, short_open_interest_balance_volume: late ? 80000 : 40000 + Math.round(Math.sin(i / 11) * 8000) });
    raw.spot.push({ date: d, name: 'Foreign_Investor', buy: 2e10, sell: late ? 6e10 : 2e10 + Math.sin(i / 5) * 5e9 });
    raw.margin.push({ date: d, name: 'MarginPurchaseMoney', TodayBalance: late ? 3.2e11 + i * 3e9 : 3e11 + Math.sin(i / 13) * 5e9, YesBalance: 3e11 });
    raw.fx.push({ date: d, currency: 'USD', spot_buy: late ? 31 + (i - (n - 15)) * 0.15 : 31 + Math.sin(i / 17) * 0.3, cash_buy: 0 });
  });
  return raw;
}

test('risk gauge: percentile and level helpers', () => {
  assert.equal(percentile([1, 2, 3, 4], 3), 62.5);
  assert.equal(percentile([], 1), null);
  assert.equal(exposure(50), 50); assert.equal(exposure(0), 90); assert.equal(exposure(100), 20); assert.equal(exposure(null), null);
  assert.equal(level(10).label, '低風險'); assert.equal(level(55).label, '中性'); assert.equal(level(90).tone, 'high');
  assert.equal(trendRisk({ dev: 10, up: true }), 10); assert.equal(trendRisk({ dev: -10, up: false }), 100);
});

test('risk gauge: retail ratio excludes spreads and flips institutional net', () => {
  const s = retailSeries([{ date: '2026-01-02', long_open_interest_balance_volume: 1000, short_open_interest_balance_volume: 7000 }], [{ date: '2026-01-02', trading_session: 'position', contract_date: '202601', open_interest: 30000 }, { date: '2026-01-02', trading_session: 'position', contract_date: '202601/202602', open_interest: 5000 }]);
  assert.deepEqual(s, [['2026-01-02', 20]]); // 法人淨空 6000 口 → 散戶淨多 6000 ÷ 30000
});

test('risk gauge: foreign spot sums 20 days in 億', () => {
  const rows = days(25).map(d => ({ date: d, name: 'Foreign_Investor', buy: 2e8, sell: 1e8 }));
  const s = foreignSpotSeries(rows); assert.equal(s.length, 6); assert.equal(s.at(-1)[1], 20);
});

test('risk gauge: calm vs stressed market', () => {
  const calm = buildRisk(rawData(320)), hot = buildRisk(rawData(320, { hot: true }));
  assert.ok(calm.available && hot.available);
  assert.equal(calm.coverage, 100);
  assert.ok(hot.risk > 75, `stressed risk ${hot.risk}`);
  assert.ok(hot.risk > calm.risk + 20);
  assert.ok(hot.exposure <= 30);
  assert.equal(hot.history.length, 120);
  assert.ok(hot.risk > hot.history.at(-20)[1]); assert.equal(typeof hot.change5, "number");
  assert.ok(hot.summary.some(s => s.tone === 'risk'));
  for (const f of hot.factors) assert.ok(f.risk == null || (f.risk >= 0 && f.risk <= 100), f.key);
});

test('risk gauge: not enough history leaves factors unscored', () => {
  const r = buildRisk(rawData(30));
  assert.equal(r.factors.find(f => f.key === 'retail').risk, null);
  assert.equal(r.factors.find(f => f.key === 'trend').risk, null);
  assert.equal(r.available, false);
  assert.equal(buildRisk({ index: [], mtxInst: [], mtxDaily: [], txInst: [], spot: [], margin: [], fx: [] }).available, false);
});

test('risk gauge: fetch stops after a fatal error', async () => {
  let calls = 0; const req = async () => { calls++; if (calls === 2) throw Object.assign(new Error('quota'), { fatal: true }); return [{ date: '2026-01-02' }]; };
  const raw = await fetchRiskInputs('2026-10-21', req);
  assert.equal(calls, 2); assert.equal(RISK_TASKS('2026-10-21').length, 7);
  assert.equal(raw.errors.mtxInst, 'quota'); assert.equal(raw.errors.fx, 'quota'); assert.equal(raw.index.length, 1);
});

// ---- 低估選股 ----
function screenRaw() {
  const universe = [], valTw = [], revTw = [], priceTw = [];
  for (let i = 0; i < 40; i++) {
    const id = String(2000 + i), sector = i < 20 ? '半導體業' : '航運業';
    universe.push({ id, name: '公司' + i, sector, market: '上市' });
    valTw.push({ Code: id, PEratio: String(8 + i % 20), PBratio: String(1 + (i % 20) / 10), DividendYield: String((i % 8) + 0.5), Date: '1151021' });
    revTw.push({ 公司代號: id, 資料年月: '11509', '營業收入-當月營收': String(1000 + i * 20), '營業收入-去年當月營收': '1000', '累計營業收入-當月累計營收': String(9000 + i * 300), '累計營業收入-去年累計營收': '9000' });
    priceTw.push({ Code: id, ClosingPrice: '50', TradeValue: i === 0 ? '100' : '50000000' });
  }
  valTw.push({ Code: '2039', PEratio: '', PBratio: '1.2', DividendYield: '0' }); // 虧損（本益比空白）覆蓋為無本益比
  return { universe, valTw, valTp: [], revTw, revTp: [], priceTw, priceTp: [], errors: {} };
}

test('value screen: merge open-data rows', () => {
  const rows = mergeInputs(screenRaw()), r = rows.find(x => x.id === '2005');
  assert.equal(rows.length, 40);
  assert.equal(r.pe, 13); assert.equal(r.pb, 1.5); assert.equal(r.revYoY, 10); assert.equal(r.revMonth, '2026-09'); assert.equal(r.close, 50);
  assert.equal(r.revCumYoY, r.revCumYoY); assert.ok(Math.abs(r.revCumYoY - 16.7) < 0.1);
  assert.equal(rows.find(x => x.id === '2039').pe, null);
});

test('value screen: strategies filter and rank', () => {
  const rows = mergeInputs(screenRaw());
  for (const k of Object.keys(STRATEGIES)) {
    const r = screen(rows, { strategy: k });
    assert.ok(r.rows.every((x, i, a) => i === 0 || a[i - 1].score >= x.score), k);
    assert.ok(!r.rows.some(x => x.id === '2000'), 'illiquid excluded'); // 成交金額不足
    assert.ok(!r.rows.some(x => x.id === '2039'), 'loss-making excluded');
    assert.ok(r.eligible === 38);
  }
  const v = screen(rows, { strategy: 'value' });
  assert.ok(v.rows.every(x => x.pe <= 25 && x.roe >= 8));
  assert.equal(v.rows[0].peerScope, 'sector');
  const g = screen(rows, { strategy: 'garp' });
  assert.ok(g.rows.every(x => x.revCumYoY >= 15 && x.peg <= 1.2));
  const inc = screen(rows, { strategy: 'income' });
  assert.ok(inc.rows.every(x => x.yield >= 5));
  assert.ok(inc.rows.every(x => Array.isArray(x.reasons) && Array.isArray(x.warnings)));
});
