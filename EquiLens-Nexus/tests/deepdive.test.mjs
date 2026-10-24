import test from 'node:test';
import assert from 'node:assert/strict';
import { twQuarters, secQuarters, nasdaqQuarters, buildRiver, twRiverPoints, usRiverPoints, buildFinancials } from '../lib/financials.mjs';
import { twEvents, usEvents, fillBack, buildDividends, twExRights, calendar } from '../lib/dividends.mjs';
import { parseTwHoldings, parseTwTransfers, mergeTransfers, buildTwInsiders, parseUsInsiders, buildUsInsiders } from '../lib/insiders.mjs';
import { buildTwShorts, buildUsShorts, twPeers, usPeers } from '../lib/shorts.mjs';
import { signalTrades, holdTrades, equity, stats, report } from '../lib/backtest.mjs';
import { normalizePortfolio, relative, buildPortfolio, newAlerts } from '../lib/portfolio.mjs';

const days = (n, from = '2024-01-01') => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));

test('財報：台股季報、現金流累計換單季、利潤率與年增', () => {
  const st = [], bs = [], cf = [];
  const qs = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31'];
  qs.forEach((d, i) => { st.push({ date: d, type: 'Revenue', value: 100 + i * 10 }, { date: d, type: 'GrossProfit', value: 50 + i * 5 }, { date: d, type: 'OperatingIncome', value: 40 }, { date: d, type: 'EquityAttributableToOwnersOfParent', value: 30 }, { date: d, type: 'EPS', value: 3 + i }); bs.push({ date: d, type: 'TotalAssets', value: 1000 }, { date: d, type: 'Liabilities', value: 400 }, { date: d, type: 'EquityAttributableToOwnersOfParent', value: 600 }); });
  [[qs[0], 60, -20], [qs[1], 130, -50], [qs[2], 190, -70], [qs[3], 260, -100], [qs[4], 70, -30]].forEach(([d, o, c]) => cf.push({ date: d, type: 'CashFlowsFromOperatingActivities', value: o }, { date: d, type: 'PropertyAndPlantAndEquipment', value: c }));
  const q = twQuarters({ statements: st, balance: bs, cashflow: cf });
  assert.equal(q.length, 5);
  assert.equal(q[1].cfo, 70); assert.equal(q[1].capex, -30); assert.equal(q[1].fcf, 40);
  assert.equal(q[4].cfo, 70); assert.equal(q[0].grossMargin, 50); assert.equal(q[0].debtRatio, 40); assert.equal(q[0].roe, 20);
  assert.equal(q[4].revYoY, 40); assert.equal(q[4].label, '26/03');
  const f = buildFinancials({ id: '2330', name: '台積電', market: 'TW', quarters: q });
  assert.equal(f.summary.epsTTM, 4 + 5 + 6 + 7);
});

test('財報：SEC 年初至今累計補單季、Q4 由全年推算、Nasdaq 千元單位', () => {
  const rev = [
    { start: '2025-01-01', end: '2025-03-31', val: 10, filed: '2025-05-01' }, { start: '2025-04-01', end: '2025-06-30', val: 12, filed: '2025-08-01' }, { start: '2025-01-01', end: '2025-06-30', val: 22, filed: '2025-08-01' },
    { start: '2025-07-01', end: '2025-09-30', val: 14, filed: '2025-11-01' }, { start: '2025-01-01', end: '2025-12-31', val: 52, filed: '2026-02-01' }];
  const cfo = [{ start: '2025-01-01', end: '2025-03-31', val: 5 }, { start: '2025-01-01', end: '2025-06-30', val: 11 }, { start: '2025-01-01', end: '2025-09-30', val: 18 }, { start: '2025-01-01', end: '2025-12-31', val: 30 }];
  const eps = [{ start: '2025-01-01', end: '2025-03-31', val: 1, filed: '2025-05-01' }, { start: '2025-04-01', end: '2025-06-30', val: 1.2, filed: '2025-08-01' }, { start: '2025-07-01', end: '2025-09-30', val: 1.4, filed: '2025-11-01' }, { start: '2025-01-01', end: '2025-12-31', val: 5.2, filed: '2026-02-01' }];
  const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: rev } }, NetCashProvidedByUsedInOperatingActivities: { units: { USD: cfo } }, EarningsPerShareDiluted: { units: { 'USD/shares': eps } }, Assets: { units: { USD: [{ end: '2025-12-31', val: 100 }] } }, Liabilities: { units: { USD: [{ end: '2025-12-31', val: 30 }] } } } } };
  const q = secQuarters(facts);
  assert.deepEqual(q.map(x => x.revenue), [10, 12, 14, 16]);
  assert.deepEqual(q.map(x => x.cfo), [5, 6, 7, 12]);
  assert.equal(q[3].eps, 1.6); assert.equal(q[3].debtRatio, 30);
  const nd = nasdaqQuarters({ incomeStatementTable: { headers: { value1: 'Quarterly Ending:', value2: '7/26/2026' }, rows: [{ value1: 'Total Revenue', value2: '$96,222,000' }, { value1: 'Gross Profit', value2: '$72,142,000' }] }, cashFlowTable: { rows: [{ value1: 'Capital Expenditures', value2: '-$1,000' }] } });
  assert.equal(nd[0].revenue, 96222000000); assert.equal(nd[0].grossMargin, 75); assert.equal(nd[0].capex, -1000000);
});

test('河流圖：倍數分位、目前位置與合理價', () => {
  const d = days(400), closes = d.map((x, i) => [x, 100 + i * 0.1]), per = d.map((x, i) => ({ date: x, PER: 10 + (i % 20), PBR: 2 }));
  const r = buildRiver(twRiverPoints(per, closes), { kind: 'pe' });
  assert.equal(r.levels.length, 5); assert.ok(r.levels[0] < r.levels[4]);
  assert.equal(r.series[0].length, 8); assert.ok(r.fair > 0); assert.ok(['偏低', '合理', '偏高'].includes(r.zone));
  const us = usRiverPoints([{ date: '2023-03-31', eps: 1, filed: '2023-04-20' }, { date: '2023-06-30', eps: 1, filed: '2023-07-20' }, { date: '2023-09-30', eps: 1, filed: '2023-10-20' }, { date: '2023-12-31', eps: 1, filed: '2024-01-20' }], closes);
  assert.equal(us[0][2], 4);
  assert.equal(buildRiver(closes.slice(0, 50).map(x => [...x, 1])), null);
});

test('股利：台股事件、填息天數、殖利率、預告表與行事曆', () => {
  const ev = twEvents([{ year: '115年第1季', CashEarningsDistribution: 7, CashExDividendTradingDate: '2026-09-16', CashDividendPaymentDate: '2026-10-08', AnnouncementDate: '2026-09-01' }, { year: '115年第2季', CashEarningsDistribution: 7.5, CashExDividendTradingDate: '2026-12-17' }, { year: 'x', CashEarningsDistribution: 0 }]);
  assert.equal(ev.length, 2); assert.equal(ev[0].exDate, '2026-12-17');
  const closes = [['2026-09-15', 2385], ['2026-09-16', 2370], ['2026-09-17', 2380], ['2026-09-18', 2390]];
  assert.deepEqual(fillBack(closes, '2026-09-16', 2385), { before: 2385, filled: true, days: 3, date: '2026-09-18' });
  assert.equal(fillBack(closes, '2026-09-16', 2400).filled, false);
  const d = buildDividends({ id: '2330', name: '台積電', market: 'TW', events: ev, results: [{ date: '2026-09-16', before_price: 2385 }], closes, price: 2400, today: '2026-10-24', shares: 1000 });
  assert.equal(d.ttmCash, 7); assert.equal(d.upcoming.length, 1); assert.equal(d.income.next, 7500); assert.equal(d.avgFillDays, 3);
  const mk = twExRights([{ Date: '1151106', Code: '2330', Name: '台積電', Exdividend: '息', CashDividend: '' }], [{ ExRrightsExDividendDate: '1151101', SecuritiesCompanyCode: '6548', CompanyName: '長科*', ExRrightsExDividend: '除息', CashDividend: '0.45' }]);
  assert.equal(mk[0].id, '6548'); assert.equal(mk[0].type, '息'); assert.equal(mk[0].cash, 0.45);
  const cal = calendar({ today: '2026-10-24', market: mk, perStock: new Map([['2330', ev]]), holdings: [{ id: '2330', shares: 2000 }], watch: new Set(['6548']) });
  assert.deepEqual(cal.items.map(x => x.id), ['6548', '2330']); assert.equal(cal.items[1].held, true);
  const us = usEvents({ dividends: { rows: [{ exOrEffDate: '09/10/2026', type: 'Cash', amount: '$0.25', paymentDate: '10/01/2026' }] } });
  assert.equal(us[0].cash, 0.25); assert.equal(us[0].exDate, '2026-09-10');
});

test('內部人：台股逐月增減、申報轉讓、美股 Nasdaq', () => {
  const row = (ym, title, name, el, cur, pl = 0) => ({ 資料年月: ym, 公司代號: '2317', 職稱: title, 姓名: name, '選任時持股 ': String(el), 目前持股: String(cur), 設質股數: String(pl), 內部人關係人目前持股合計: '0' });
  const cur = parseTwHoldings([row('11509', '董事長本人', '甲', 1000, 3000, 500), row('11509', '總經理本人', '乙', 0, 2000), row('11509', '董事之法人代表人', '丙', 0, 0)]);
  const prev = parseTwHoldings([row('11508', '董事長本人', '甲', 1000, 4000), row('11508', '總經理本人', '乙', 0, 2000)]);
  assert.equal(cur.ym, '2026-09');
  const tr = parseTwTransfers([{ 出表日期: '1151022', 公司代號: '2317', 公司名稱: '鴻海', 申報人身分: '董事長本人', 姓名: '甲', '預定轉讓方式及股數-轉讓方式': '一般交易', '預定轉讓總股數-自有持股': '100000', '目前持有股數-自有持股': '3000', '預定轉讓後持股-自有持股': '0' }, { Date: '1151022', SecuritiesCompanyCode: '' }]);
  assert.equal(tr.length, 1); assert.equal(tr[0].date, '2026-10-22');
  assert.equal(mergeTransfers(tr, tr, '2026-10-24').length, 1);
  const x = buildTwInsiders({ id: '2317', name: '鴻海', cur: cur.data['2317'], prev: prev.data['2317'], curYm: cur.ym, prevYm: prev.ym, transfers: tr });
  assert.equal(x.board.change, -1000); assert.equal(x.board.pledgeRatio, 16.7); assert.equal(x.board.sinceElected, 2000);
  assert.equal(x.changed.length, 1); assert.equal(x.people.length, 2); assert.equal(x.transfers.length, 1);
  const us = parseUsInsiders({ numberOfTrades: { rows: [{ insiderTrade: 'Number of Open Market Buys', months3: '2', months12: '23' }, { insiderTrade: 'Number of Sells', months3: '18', months12: '84' }] }, numberOfSharesTraded: { rows: [{ insiderTrade: 'Net Activity', months3: '(6,255,354)', months12: '1,000' }] }, transactionTable: { table: { rows: [{ insider: 'A', relation: 'Officer', lastDate: '9/17/2026', transactionType: 'Sell', ownType: 'Direct', sharesTraded: '34,918', lastPrice: '$218.01', sharesHeld: '765,103' }] } } });
  assert.equal(us.net.m3, -6255354); assert.equal(us.net.m12, 1000); assert.equal(us.trades[0].date, '2026-09-17');
  assert.equal(buildUsInsiders({ id: 'NVDA', name: 'NVIDIA', parsed: us }).openMarket.sells, 1);
});

test('借券與放空、同業比較', () => {
  const d = days(30), rows = d.map((x, i) => ({ date: x, SBLShortSalesCurrentDayBalance: 1e6 + i * 1e4, SBLShortSalesShortSales: 2e4, SBLShortSalesReturns: 1e4, MarginShortSalesCurrentDayBalance: 5e4 }));
  const s = buildTwShorts({ id: '2330', name: '台積電', rows, price: d.map(x => ({ date: x, Trading_Volume: 5e5 })) });
  assert.equal(s.sbl, 1290); assert.equal(s.margin, 50); assert.equal(s.daysToCover, 2.7); assert.equal(s.sellRatio, 4); assert.equal(s.series.length, 30);
  const u = buildUsShorts({ id: 'NVDA', name: 'NVIDIA', data: { shortInterestTable: { rows: [{ settlementDate: '09/30/2026', interest: '311,389,688', avgDailyShareVolume: '110,290,688', daysToCover: 2.82 }, { settlementDate: '09/15/2026', interest: '294,225,803', avgDailyShareVolume: '1', daysToCover: 2.55 }] } }, shares: 24.1e9 });
  assert.equal(u.change, 5.8); assert.equal(u.floatPct, 1.29);
  const value = [{ id: '2330', name: '台積電', sector: '半導體業', pe: 20, pb: 6, yield: 1.5, revYoY: 30 }, { id: '2303', name: '聯電', sector: '半導體業', pe: 12, pb: 1.5, yield: 4, revYoY: 5 }, { id: '2454', name: '聯發科', sector: '半導體業', pe: 18, pb: 5, yield: 3, revYoY: 10 }];
  const p = twPeers({ id: '2330', value, chainOf: new Map([['2330', 'A'], ['2303', 'A']]), chains: { A: ['2330', '2303'] } });
  assert.equal(p.kind, 'chain'); assert.equal(p.rows.length, 2); assert.equal(p.rows[0].self, true); assert.deepEqual(p.rank.pe, { rank: 2, of: 2 }); assert.deepEqual(p.rank.revYoY, { rank: 1, of: 2 });
  assert.equal(twPeers({ id: '2454', value }).rows.length, 3);
  const up = usPeers({ id: 'NVDA', heat: [{ id: 'NVDA', name: 'NVIDIA', sector: '科技', close: 200, money: 9 }, { id: 'AMD', name: 'AMD', sector: '科技', close: 100, money: 5 }], fund: new Map([['AMD', { pe: 40, revGrowth: 20, high52: 120 }]]) });
  assert.equal(up.rows.length, 2); assert.equal(up.rows[1].offHigh, -16.7);
});

test('回測：訊號交易、持有天數交易、組合權益與最大回撤', () => {
  const d = days(160), px = d.map((x, i) => i < 60 ? 100 - i * 0.5 : i < 120 ? 70 + (i - 60) : 130 - (i - 120) * 2);
  const rows = d.map((x, i) => ({ date: x, open: px[i], max: px[i] + 1, min: px[i] - 1, close: px[i], Trading_Volume: 1000 }));
  const t = signalTrades('X', rows); assert.ok(t.length >= 1); assert.ok(t[0].ret > 0);
  const prices = new Map(d.slice(0, 30).map((x, i) => [x, new Map([['A', 100 + i], ['B', 100 - i]])]));
  const h = holdTrades([{ id: 'A', date: d[0] }, { id: 'B', date: d[0] }, { id: 'A', date: d[25] }], prices, 5);
  assert.equal(h.length, 3); assert.equal(h[0].ret, 5); assert.equal(h[1].ret, -5); assert.equal(h[2].open, true);
  const s = stats(h); assert.equal(s.trades, 2); assert.equal(s.winRate, 50); assert.equal(s.open, 1);
  const e = equity([{ entryDate: 'a', path: [['a', 100], ['b', 110], ['c', 99]] }]); assert.equal(e.total, -1); assert.equal(e.mdd, -10);
  const r = report({ key: 'k', name: 'n', trades: h, index: d.slice(0, 30).map((x, i) => [x, 1000 + i]) }); assert.equal(r.enough, false); assert.ok(r.benchmark > 0); assert.equal(r.recent[0].path, undefined);
});

test('持股：損益、權重、集中度、風控對照、替代候選與提醒', () => {
  const pf = normalizePortfolio({ cash: '500000', holdings: [{ id: '2330', shares: '1000', cost: '1000', stop: '900', target: '' }, { id: '2303', shares: 2000, cost: 60 }, { id: 'bad!', shares: 1, cost: 1 }, { id: '2330', shares: 1, cost: 1 }] });
  assert.equal(pf.holdings.length, 2); assert.equal(pf.cash, 500000);
  const idx = days(300).map((x, i) => [x, 100 + i * 0.1]), weak = days(300).map((x, i) => [x, 100 - i * 0.05]);
  const rs = relative(weak, idx); assert.equal(rs.label, '落後');
  const quotes = new Map([['2330', { close: 880, prev: 900, name: '台積電', sector: '半導體業', chain: '晶圓代工與 IC 設計' }], ['2303', { close: 50, prev: 50, name: '聯電', sector: '半導體業', chain: '晶圓代工與 IC 設計' }]]);
  const p = buildPortfolio({ holdings: pf.holdings, cash: pf.cash, quotes, rs: new Map([['2303', rs]]), risk: { risk: 70, exposure: 30, label: '偏高' }, ideas: [{ id: '2454', name: '聯發科', chain: '晶圓代工與 IC 設計' }, { id: '2330', name: '台積電', chain: '晶圓代工與 IC 設計' }], lot: 1000 });
  assert.equal(p.totals.value, 980000); assert.equal(p.totals.pnl, -140000); assert.equal(p.rows[0].weight, 89.8);
  assert.equal(p.exposure.actual, 66.2); assert.equal(p.exposure.diff, 36.2); assert.match(p.exposure.advice, /高於/);
  assert.ok(p.warnings.some(w => w.kind === 'stock')); assert.ok(p.warnings.some(w => w.kind === 'sector'));
  assert.equal(p.alerts.length, 1); assert.equal(p.alerts[0].kind, 'stop');
  assert.deepEqual(p.swaps.map(s => s.id).sort(), ['2303', '2330']); assert.deepEqual(p.swaps[0].candidates.map(c => c.id), ['2454']);
  const a = newAlerts(p, {}, '2026-10-24'); assert.equal(a.out.length, 1); assert.equal(newAlerts(p, a.seen, '2026-10-24').out.length, 0);
});

test('財報：股票分割後回溯調整舊 EPS', async () => {
  const { splitAdjust } = await import('../lib/financials.mjs');
  const rows = [{ date: '2023-12-31', netIncome: 100, eps: 4 }, { date: '2024-03-31', netIncome: 110, eps: 4.4 }, { date: '2024-06-30', netIncome: 120, eps: 0.48 }, { date: '2024-09-30', netIncome: 130, eps: 0.52 }];
  const a = splitAdjust(rows);
  assert.deepEqual(a.map(x => Math.round(x.eps * 100) / 100), [0.4, 0.44, 0.48, 0.52]);
  assert.equal(a[0].split, 10); assert.equal(a[3].split, undefined);
});

test('財報：新舊口徑交錯的季度逐季換算成最新口徑', async () => {
  const { splitAdjust } = await import('../lib/financials.mjs');
  const q = (d, ni, eps) => ({ date: d, netIncome: ni, eps });
  // 2021 年 4:1、2024 年 10:1；2022-01 那季的 EPS 是另一種口徑（股數差 5 倍），也換算到最新口徑
  const rows = [q('2021-01-31', 100, 4), q('2021-04-30', 100, 4), q('2021-07-31', 100, 1), q('2021-10-31', 100, 1), q('2022-01-31', 100, 0.5), q('2022-04-30', 100, 1), q('2022-07-31', 100, 1), q('2024-04-30', 100, 0.1), q('2024-07-31', 100, 0.1)];
  const a = splitAdjust(rows).map(x => Math.round(x.eps * 1000) / 1000);
  assert.deepEqual(a, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  // 股數只變動 30%（增資或買回）時不調整
  assert.deepEqual(splitAdjust([q('2023-03-31', 100, 1.3), q('2023-06-30', 100, 1)]).map(x => x.eps), [1.3, 1]);
});

test('財報：全年 EPS 已依分割重編、單季未重編時，推算的第四季改用股數換算', () => {
  const eps = [{ start: '2022-01-31', end: '2022-05-01', val: 0.64, filed: '2022-05-27' }, { start: '2022-05-02', end: '2022-07-31', val: 0.26, filed: '2022-08-31' }, { start: '2022-08-01', end: '2022-10-30', val: 0.27, filed: '2022-11-18' },
    { start: '2022-01-31', end: '2023-01-29', val: 1.74, filed: '2023-02-24' }, { start: '2022-01-31', end: '2023-01-29', val: 0.17, filed: '2025-02-26' }];
  const ni = [{ start: '2022-01-31', end: '2022-05-01', val: 1618 }, { start: '2022-05-02', end: '2022-07-31', val: 656 }, { start: '2022-08-01', end: '2022-10-30', val: 680 }, { start: '2022-01-31', end: '2023-01-29', val: 4368, filed: '2025-02-26' }];
  const q = secQuarters({ facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': eps } }, NetIncomeLoss: { units: { USD: ni } } } } });
  assert.equal(q.length, 4); assert.equal(q[3].eps, 0.06);
});

test('持股：成本 0（配股取得）也能保存，損益率不計算', () => {
  const pf = normalizePortfolio({ holdings: [{ id: '3483', shares: 32, cost: 0 }, { id: '2330', shares: 1, cost: '' }] });
  assert.deepEqual(pf.holdings.map(h => h.id), ['3483']);
  const p = buildPortfolio({ holdings: pf.holdings, quotes: new Map([['3483', { close: 92.4, prev: 90, name: '力致' }]]) });
  assert.equal(p.rows[0].pnl, 2956.8); assert.equal(p.rows[0].pnlPct, null);
});
