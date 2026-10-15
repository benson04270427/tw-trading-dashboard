import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EQUITY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-feat-'));
const { scanRadar, createRadarState, seedRadarState, normalizeRadar, validRadarInput, limitPrices, sessionMinutes } = await import('../lib/radar.mjs');
const { recordFrame, loadDay, listDays, compactReplay, replaySummary, encodeFrame } = await import('../lib/replay.mjs');
const { aggregateBrokers, brokerAnalysis, parseHolders, holderSignal, kbarRows, replayMinuteBars, fiveMinBars, dailyKRows, replayDayBar } = await import('../lib/insight.mjs');
const { buildReportContext, normalizeReportSettings } = await import('../lib/report.mjs');
const card = await import('../lib/market-card.mjs');
const access = await import('../lib/access.mjs');
const grouprank = await import('../lib/grouprank.mjs');
const newswatch = await import('../lib/newswatch.mjs');
const wgroups = await import('../lib/watchgroups.mjs');
const { parseCnyes } = await import('../lib/providers/cnyes.mjs');
const { parseTpexDayTrade } = await import('../lib/providers/twse.mjs');

test('watch groups: create, rename, delete, reorder; deleted group members become ungrouped', () => {
  const list = ['2330', '2454', '3037'];
  let g = wgroups.editWatchGroups({ groups: [], assign: {} }, [{ name: '核心持股' }, { name: '短線' }], list);
  assert.deepEqual(g.groups, [{ id: 'w1', name: '核心持股' }, { id: 'w2', name: '短線' }]);
  let s = wgroups.setWatch({ watchlist: list, groups: g }, '2330', true, 'w1'); s = wgroups.setWatch(s, '2454', true, 'w2'); s = wgroups.setWatch(s, '6442', true, 'w2');
  assert.deepEqual(s.watchlist, ['2330', '2454', '3037', '6442']); assert.deepEqual(s.groups.assign, { 2330: 'w1', 2454: 'w2', 6442: 'w2' });
  assert.throws(() => wgroups.setWatch(s, '2330', true, 'w9'), /找不到/);
  assert.equal(wgroups.setWatch(s, '2330', true).groups.assign['2330'], 'w1', 'group undefined keeps current group');
  assert.equal(wgroups.setWatch(s, '2330', true, '').groups.assign['2330'], undefined, "'' moves to ungrouped");
  // 改名＋刪除 w2＋新增：新分組不能拿到被刪掉的 w2 代號，原 w2 成員回到未分組
  const g2 = wgroups.editWatchGroups(s.groups, [{ id: 'w1', name: '長抱' }, { name: '題材' }], s.watchlist);
  assert.deepEqual(g2.groups, [{ id: 'w1', name: '長抱' }, { id: 'w3', name: '題材' }]); assert.deepEqual(g2.assign, { 2330: 'w1' });
  assert.throws(() => wgroups.editWatchGroups(g2, [{ name: 'A' }, { name: 'A' }], list), /重複/);
  assert.throws(() => wgroups.editWatchGroups(g2, [{ name: '' }], list), /1–20/);
  assert.throws(() => wgroups.editWatchGroups(g2, Array.from({ length: 31 }, (_, i) => ({ name: `G${i}` })), list), /最多 30/);
  // 移除自選時一併清掉分組；讀檔時清掉不存在的分組與不在自選的股票
  assert.equal(wgroups.setWatch({ watchlist: s.watchlist, groups: g2 }, '2330', false).groups.assign['2330'], undefined);
  assert.deepEqual(wgroups.normalizeWatchGroups({ groups: [{ id: 'w1', name: ' A ' }, { id: 'bad', name: 'B' }, { id: 'w1', name: 'dup' }], assign: { 2330: 'w1', 9999: 'w1', 2454: 'w5' } }, ['2330', '2454']), { groups: [{ id: 'w1', name: 'A' }], assign: { 2330: 'w1' } });
});

test('news watch: noise filtered, reposts merged, first scan seeds silently, then only new articles', () => {
  const scope = new Set(['2330', '2454']);
  const row = (id, title, link, source = '經濟日報') => ({ date: '2026-10-07 01:00:00', stock_id: id, title: `${title} - ${source}`, link, source });
  const day1 = [
    row('2330', '台積電法說會釋利多', 'https://money.udn.com/a/1'), row('2454', '台積電法說會釋利多', 'https://money.udn.com/a/1'), // 同一篇對應兩檔
    row('2330', 'AI 需求強勁，台積電 9 月營收創高', 'https://www.tradingview.com/news/x:1/', 'TradingView'), row('2330', 'AI 需求強勁，台積電 9 月營收創高', 'https://tw.tradingview.com/news/x:1/', 'TradingView'), // 不同網域轉載
    row('2330', '2330 台積電- 明天會漲嗎- 股市爆料同學會', 'https://www.cmoney.tw/forum/article/1', 'CMoney'), // 論壇
    row('2330', '台積電(2330) 個股概覽 | 個股 - 股市', 'https://www.cmoney.tw/finance/2330/f00025', 'CMoney'), // 概覽頁
    row('9999', '名單外個股新聞', 'https://x/1'),
  ];
  const arts = newswatch.collectArticles(day1, scope);
  assert.deepEqual(arts.map(a => [a.title, a.ids]), [['台積電法說會釋利多', ['2330', '2454']], ['AI 需求強勁，台積電 9 月營收創高', ['2330']]]);
  // 以查詢參數區分文章的網站不能被合併；utm 追蹤參數不影響比對
  const q = newswatch.collectArticles([row('2330', '甲新聞', 'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=111'), row('2330', '乙新聞', 'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=222'), row('2454', '乙新聞轉貼', 'https://moneydj.com/kmdj/news/newsviewer.aspx?a=222&utm_source=x')], scope);
  assert.deepEqual(q.map(a => [a.title, a.ids]), [['甲新聞', ['2330']], ['乙新聞', ['2330', '2454']]]);
  const st = newswatch.createNewsState(null), t0 = Date.parse('2026-10-07T01:00:00Z');
  const first = newswatch.scanNews(st, day1, { scope, now: t0 });
  assert.equal(first.seeded, true); assert.equal(first.fresh.length, 0, 'existing news on first scan are not pushed');
  const day2 = [...day1, row('2454', '聯發科推出新晶片', 'https://news.cnyes.com/b/2', '鉅亨網'), row('2330', 'AI 需求強勁，台積電 9 月營收創高', 'https://m.yahoo.com/c/3', 'Yahoo股市')];
  const second = newswatch.scanNews(st, day2, { scope, now: t0 + 60e3 });
  assert.deepEqual(second.fresh.map(a => a.title), ['聯發科推出新晶片'], 'only the genuinely new article; same headline on another site is not new');
  assert.equal(newswatch.scanNews(st, day2, { scope, now: t0 + 120e3 }).fresh.length, 0);
  // 停掉超過 10 分鐘再恢復：重新記錄現有新聞、不補推
  assert.equal(newswatch.scanNews(st, [...day2, row('2330', '晚到的舊聞', 'https://x/9')], { scope, now: t0 + 30 * 60e3 }).seeded, true);
  // 狀態可存檔還原；三天前的紀錄會清掉
  const back = newswatch.createNewsState(JSON.parse(JSON.stringify(newswatch.saveNewsState(st))));
  assert.equal(newswatch.scanNews(back, day2, { scope, now: t0 + 31 * 60e3 }).fresh.length, 0); assert.ok(back.seen.size > 0);
  newswatch.scanNews(back, [], { scope, now: t0 + 4 * 86400e3 }); assert.equal(back.seen.size, 0);
  assert.equal(newswatch.quietNow(23, true), true); assert.equal(newswatch.quietNow(6, true), true); assert.equal(newswatch.quietNow(7, true), false); assert.equal(newswatch.quietNow(2, false), false);
  assert.deepEqual(newswatch.normalizeNews({ enabled: 'yes', scope: 'x' }), { enabled: false, scope: 'all', quiet: false });
  assert.equal(newswatch.validNewsInput({ enabled: true, scope: 'watch', quiet: false }), true); assert.equal(newswatch.validNewsInput({ enabled: 1, scope: 'all', quiet: false }), false);
});

test('news watch: a newly added source is recorded silently once; the same article on both sources pushes once', () => {
  const scope = new Set(['2330', '3290']), t0 = Date.parse('2026-10-12T05:00:00Z');
  const fin = (title, link) => ({ date: '2026-10-12 13:00:00', stock_id: '2330', title, link, source: '經濟日報' });
  const st = newswatch.createNewsState(null);
  newswatch.scanNews(st, [fin('舊聞', 'https://u/1')], { scope, now: t0 });
  const cn = parseCnyes({ items: { data: [
    { newsId: 1, title: '東浦精密Q3營收創新高', publishAt: 1791783230, stock: ['3290'], market: [{ code: '3290', symbol: 'TWS:3290:STOCK' }] },
    { newsId: 2, title: '輝達財報（NVDA）', publishAt: 1791783000, stock: ['US-NVDA'], market: [{ code: 'NVDA', symbol: 'USS:NVDA:STOCK' }] },
    { newsId: 3, title: '台積電(2330)法說會', publishAt: 1791782000, stock: [], market: [] },
  ] } });
  assert.deepEqual(cn.map(r => [r.stock_id, r.date, r.link, r.source]), [['3290', '2026-10-12 13:33:50', 'https://news.cnyes.com/news/id/1', '鉅亨網'], ['2330', '2026-10-12 13:13:20', 'https://news.cnyes.com/news/id/3', '鉅亨網']]);
  assert.throws(() => parseCnyes({ items: {} }), /格式/);
  // 第一次加入鉅亨網：既有文章只記錄
  assert.equal(newswatch.scanNews(st, [fin('舊聞', 'https://u/1')], { scope, now: t0 + 60e3, seedOnly: cn }).fresh.length, 0);
  st.sources.add('cnyes');
  // 之後的新文章：鉅亨網與 FinMind 同一篇（同連結）只算一次
  const next = parseCnyes({ items: { data: [{ newsId: 9, title: '台積電擴產', publishAt: 1791783900, stock: ['2330'] }] } });
  const r = newswatch.scanNews(st, [...next, fin('台積電擴產 - 鉅亨網', 'https://news.cnyes.com/news/id/9'), ...cn], { scope, now: t0 + 120e3 });
  assert.deepEqual(r.fresh.map(a => a.title), ['台積電擴產']);
  assert.deepEqual(newswatch.createNewsState(JSON.parse(JSON.stringify(newswatch.saveNewsState(st)))).sources.has('cnyes'), true);
});

test('TPEx day-trade list: eligible codes and sell-first suspensions', () => {
  const body = { tables: [{ title: '現股當沖交易標的', fields: ['證券代號', '證券名稱', '暫停現股賣出後現款買進當沖註記'], data: [['3260', '威剛', ''], ['6187', '萬潤', 'Y'], ['00679B', '元大美債20年', '']] }] };
  assert.deepEqual(parseTpexDayTrade(body), { eligible: ['3260', '6187', '00679B'], sellFirstOff: ['6187'] });
  assert.equal(parseTpexDayTrade({ tables: [] }), null);
});

test('group ranking: low-volume outliers excluded, sqrt-turnover weighting, ranks and rank moves', () => {
  const q = (name, rate, amount) => ({ name, close: 100, rate, amount });
  // A 族群：一檔冷門股漲停但成交只有 300 萬，其餘大量股小漲 → 不應被冷門股拉到第一
  // B 族群：三檔普遍上漲 3%
  // C 族群：一檔權值股占九成成交大跌，其餘小漲 → √加權讓權值股影響大但不獨占
  const quotes = new Map([
    ['1', q('冷門', 9.9, 3e6)], ['2', q('大A1', 1, 5e8)], ['3', q('大A2', 0.5, 4e8)],
    ['4', q('B1', 3, 2e8)], ['5', q('B2', 3, 1.5e8)], ['6', q('B3', 3, 1e8)],
    ['7', q('權值', -4, 9e9)], ['8', q('C1', 1, 5e8)], ['9', q('C2', 1, 5e8)],
  ]);
  const groups = [{ id: 'a', name: 'A', stockIds: ['1', '2', '3'] }, { id: 'b', name: 'B', stockIds: ['4', '5', '6'] }, { id: 'c', name: 'C', stockIds: ['7', '8', '9'] }, { id: 'd', name: 'D', stockIds: ['99'] }];
  const r = grouprank.buildGroupRanking(groups, quotes);
  const A = r.find(g => g.id === 'a'), C = r.find(g => g.id === 'c');
  assert.equal(A.avg, 3.8, 'simple average is distorted by the illiquid limit-up stock');
  assert.equal(A.excluded, 1); assert.equal(A.items.find(x => x.id === '1').excluded, true); assert.equal(A.items.find(x => x.id === '1').weight, 0);
  const sa = Math.sqrt(5e8), sb = Math.sqrt(4e8); assert.equal(A.score, Math.round((1 * sa + 0.5 * sb) / (sa + sb) * 100) / 100);
  assert.deepEqual(r.map(g => [g.id, g.rank]), [['b', 1], ['a', 2], ['c', 3], ['d', null]], 'B ranks first, illiquid outlier no longer lifts A, no-data group unranked');
  const sw = Math.sqrt(9e9), sc = Math.sqrt(5e8); assert.equal(C.score, Math.round((-4 * sw + 2 * sc) / (sw + 2 * sc) * 100) / 100);
  assert.ok(C.wavg < C.score, 'pure turnover weighting would be dominated by the heavyweight');
  assert.equal(C.breadth, 66.67); assert.equal(C.top, '7');
  const moved = grouprank.compareRanks(r, { groups: [{ id: 'a', rank: 13 }, { id: 'b', rank: 1 }, { id: 'c', rank: 2 }] });
  assert.deepEqual(moved.map(g => g.move), [0, 11, -1, null]);
  const snap = grouprank.quotesFromSnapshot([{ stock_id: '2330', close: 110, change_price: 10, total_amount: 5e9, date: '2026-10-05 10:00:00.000' }, { stock_id: '0000', close: 0, change_price: 0 }], new Map([['2330', { name: '台積電' }]]));
  assert.deepEqual(snap.get('2330'), { name: '台積電', close: 110, rate: 10, amount: 5e9, time: '2026-10-05 10:00:00' }); assert.equal(snap.size, 1);
  const rep = grouprank.quotesFromReplay({ date: '2026-09-30', ids: ['2330'], prev: [10000], frames: [{ t: '13:30', p: [10500], a: [3000] }] }, new Map());
  assert.deepEqual(rep.get('2330'), { name: '2330', close: 105, rate: 5, amount: 3e9, time: '2026-09-30 13:30:00' });
});
const crypto = await import('node:crypto');

test('Cloudflare Access JWT: valid token passes; bad signature, audience, issuer, expiry and missing config are rejected', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const team = 'equilens.cloudflareaccess.com', aud = 'aud-123', now = 1_790_000_000_000;
  const sign = (claims, key = privateKey, kid = 'k1') => { const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url'), b = Buffer.from(JSON.stringify(claims)).toString('base64url'); return `${h}.${b}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${b}`), key).toString('base64url')}`; };
  let fetches = 0; const fetcher = async url => { fetches++; assert.equal(url, `https://${team}/cdn-cgi/access/certs`); return { ok: true, json: async () => ({ keys: [jwk] }) }; };
  const base = { iss: `https://${team}`, aud: [aud], email: 'me@example.com', exp: now / 1000 + 600, iat: now / 1000 };
  const cfg = { teamDomain: team, aud }, opt = { fetcher, now };
  assert.deepEqual(await access.verifyAccessJwt(sign(base), cfg, opt), { email: 'me@example.com' });
  await access.verifyAccessJwt(sign(base), cfg, opt); assert.equal(fetches, 1, 'JWKS cached');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(access.verifyAccessJwt(sign(base, other), cfg, opt), /簽章無效/);
  await assert.rejects(access.verifyAccessJwt(sign({ ...base, aud: ['x'] }), cfg, opt), /不屬於此應用程式/);
  await assert.rejects(access.verifyAccessJwt(sign({ ...base, iss: 'https://evil.cloudflareaccess.com' }), cfg, opt), /簽發者不符/);
  await assert.rejects(access.verifyAccessJwt(sign({ ...base, exp: now / 1000 - 100 }), cfg, opt), /已過期/);
  await assert.rejects(access.verifyAccessJwt('', cfg, opt), /缺少/);
  await assert.rejects(access.verifyAccessJwt(sign(base), { teamDomain: '', aud: '' }, opt), /尚未完成/);
  assert.equal(access.isRemoteHost('nexus.example.com'), false, 'no remote host without remote.json');
});

test('market card: near month, retail long/short ratio, margin, put/call and sector ranks', () => {
  const daily = [{ date: D, trading_session: 'position', contract_date: '202611', close: 2, open_interest: 100 }, { date: D, trading_session: 'position', contract_date: '202610', close: 1, open_interest: 900 }, { date: D, trading_session: 'position', contract_date: '202610/202611', close: 5, open_interest: 50 }, { date: D, trading_session: 'after_market', contract_date: '202610', close: 9, open_interest: 0 }];
  assert.equal(card.nearMonth(daily, D).close, 1); assert.equal(card.totalOI(daily, D), 1000);
  const inst = (d, l, s) => ({ date: d, long_open_interest_balance_volume: l, short_open_interest_balance_volume: s });
  const rows = [inst('2026-09-29', 100, 300), inst('2026-09-29', 0, 0), inst(D, 400, 100), inst(D, 0, 100)];
  assert.deepEqual(card.retailPosition(rows, daily, D), { net: -200, change: -400, oi: 1000, ratio: -20 });
  const m = card.marginSummary([{ date: D, name: 'MarginPurchaseMoney', TodayBalance: 622252453000, YesBalance: 618653344000 }, { date: D, name: 'ShortSale', TodayBalance: 235296, YesBalance: 217999 }], '2026-10-01');
  assert.deepEqual(m, { date: D, marginMoney: 6222.52, marginChange: 35.99, shortLots: 235296, shortChange: 17297 });
  assert.equal(card.putCallRatio({ contracts: [{ strikes: [{ call: 100, put: 50 }, { call: 100, put: 100 }] }] }), 75);
  assert.deepEqual(card.indexRow({ close: 48353.49, change_price: 413.36, total_amount: 8.37e11, date: '2026-10-01 13:33:00' }), { close: 48353.49, change: 413.36, pct: 0.86, amount: 8.37e11, time: '13:33' });
  const heat = { total: { money: 1, moneyChange: 2, up: 3, down: 4, flat: 5, limitUp: 6, limitDown: 7, change: 1 }, sectors: [['A', 3, 5], ['B', -2, 5], ['C', 9, 0.1], ['D', 1, 5]].map(([name, change, share]) => ({ name, change, share, up: 1, down: 1, money: 1 })) };
  const s = card.sectorRanks(heat, 2); assert.deepEqual(s.strong.map(x => x.name), ['A', 'D'], 'tiny sectors excluded'); assert.deepEqual(s.weak.map(x => x.name), ['B', 'D']);
  const c = card.assembleCard({ date: D, heat, flows: null, report: { headline: 'h', sections: [{ points: ['a', 'b', 'c'] }], tomorrow: ['t'] } });
  assert.deepEqual(c.points.highlights, ['a', 'b'], 'falls back to section points when report has no card field'); assert.equal(c.institutions, null);
});

const D = '2026-09-30';
const snap = (id, time, close, change, extra = {}) => ({ stock_id: id, date: `${D} ${time}.000000`, close, change_price: change, total_volume: 1000, total_amount: 5e8, yesterday_volume: 10000, ...extra });
const ctx = (over = {}) => ({ settings: normalizeRadar({}), meta: new Map([['2330', { name: '台積電' }], ['2454', { name: '聯發科' }], ['9999', { name: '名單外' }]]), watch: new Set(['2330']), research: new Set(['2330', '2454']), plans: new Map(), ...over });

test('radar settings are clamped and validated', () => {
  const r = normalizeRadar({ scope: 'all', volume: { on: false, ratio: 99 }, surge: { pct: 0.01, minutes: 100 } });
  assert.equal(r.scope, 'all'); assert.equal(r.volume.on, false); assert.equal(r.volume.ratio, 10); assert.equal(r.surge.pct, 0.5); assert.equal(r.surge.minutes, 30);
  assert.equal(validRadarInput({ scope: 'x' }), false);
  assert.equal(validRadarInput({ scope: 'watch', volume: { on: true }, surge: { on: true }, limit: { on: false }, pattern: { on: true }, stop: { on: true } }), true);
  assert.equal(sessionMinutes(`${D} 10:30:00`), 90); assert.equal(sessionMinutes(`${D} 08:50:00`), 0); assert.equal(sessionMinutes(`${D} 13:40:00`), 270);
  assert.deepEqual(limitPrices(100), { up: 110, down: 90 }); assert.deepEqual(limitPrices(2475), { up: 2720, down: 2230 });
});

test('volume spike fires once, projected against yesterday and respecting minimum amount', () => {
  const s = createRadarState(D);
  // 10:30 = 90 分鐘；1000 張 / (90/270) = 3000 張預估 → 昨量 1000 時為 3 倍
  let a = scanRadar(s, [snap('2330', '10:30:00', 100, 1, { yesterday_volume: 1000 })], ctx());
  assert.equal(a.length, 1); assert.equal(a[0].type, 'volume'); assert.equal(a[0].level, 'hi'); assert.match(a[0].detail, /3\.0 倍/);
  a = scanRadar(s, [snap('2330', '10:31:00', 100, 1, { yesterday_volume: 1000 })], ctx());
  assert.equal(a.filter(x => x.type === 'volume').length, 0, 'once per day');
  a = scanRadar(createRadarState(D), [snap('2454', '10:30:00', 100, 1, { yesterday_volume: 1000, total_amount: 1e7 })], ctx());
  assert.equal(a.length, 0, 'below minimum amount');
  a = scanRadar(createRadarState(D), [snap('2330', '09:05:00', 100, 1, { yesterday_volume: 10 })], ctx());
  assert.equal(a.length, 0, 'first 15 minutes ignored');
});

test('surge: within one minute, change of at least 2% (inclusive) vs the window low/high, cooldown and scope', () => {
  const c = ctx(), only = (list, type) => list.filter(x => x.type === type);
  assert.equal(normalizeRadar({}).surge.minutes, 1); assert.equal(normalizeRadar({}).surge.pct, 2);
  // 昨收 100：10:00:00 漲跌幅 0% → 10:00:30 +1.5%（未達）→ 10:00:50 +2%（恰好 2%，含）
  const s = createRadarState(D);
  assert.equal(only(scanRadar(s, [snap('2454', '10:00:00', 100, 0)], c), 'surge-up').length, 0);
  assert.equal(only(scanRadar(s, [snap('2454', '10:00:30', 101.5, 1.5)], c), 'surge-up').length, 0, '1.5% is below the threshold');
  const a = only(scanRadar(s, [snap('2454', '10:00:50', 102, 2)], c), 'surge-up');
  assert.equal(a.length, 1, 'exactly 2% fires'); assert.equal(a[0].level, 'mid'); assert.match(a[0].detail, /1 分鐘內漲幅 \+2\.00%（100 → 102，漲跌幅 0\.00% → \+2\.00%）/);
  assert.equal(only(scanRadar(s, [snap('2454', '10:01:10', 104, 4)], c), 'surge-up').length, 0, 'cooldown');
  // 視窗中段才拉：10:00:00 100.5、10:00:20 100（低點）、10:00:55 102 → 以區間低點計 +2%
  const mid = createRadarState(D); for (const [tm, p] of [['10:00:00', 100.5], ['10:00:20', 100]]) scanRadar(mid, [snap('2454', tm, p, p - 100)], c);
  assert.equal(only(scanRadar(mid, [snap('2454', '10:00:55', 102, 2)], c), 'surge-up').length, 1);
  // 超過一分鐘才漲到 2.5%：不算急拉
  const slow = createRadarState(D); scanRadar(slow, [snap('2454', '10:00:00', 100, 0)], c);
  assert.equal(only(scanRadar(slow, [snap('2454', '10:01:30', 102.5, 2.5)], c), 'surge-up').length, 0, 'move took longer than one minute');
  // 急殺：一分鐘內從 +1% 跌到 -1%
  const dn = createRadarState(D); scanRadar(dn, [snap('2454', '10:00:00', 101, 1)], c);
  const d = only(scanRadar(dn, [snap('2454', '10:00:40', 99, -1)], c), 'surge-down'); assert.equal(d.length, 1); assert.match(d[0].detail, /1 分鐘內跌幅 -2\.00%/);
  // 浮點誤差不影響「含 2%」：昨收 105，105 → 107.1
  const fp = createRadarState(D); scanRadar(fp, [snap('2454', '10:00:00', 105, 0)], c);
  assert.equal(only(scanRadar(fp, [snap('2454', '10:00:30', 107.1, 2.1)], c), 'surge-up').length, 1);
  const out = createRadarState(D); scanRadar(out, [snap('9999', '10:00:00', 100, 0)], c);
  assert.equal(scanRadar(out, [snap('9999', '10:00:30', 105, 5)], c).length, 0, 'outside research scope');
  const all = createRadarState(D), ca = ctx({ settings: normalizeRadar({ scope: 'all' }) }); scanRadar(all, [snap('9999', '10:00:00', 100, 0)], ca);
  assert.equal(only(scanRadar(all, [snap('9999', '10:00:30', 103, 3)], ca), 'surge-up').length, 1);
});

test('limit up, open and relock are reported as transitions', () => {
  const s = createRadarState(D), c = ctx({ settings: normalizeRadar({ volume: { on: false }, surge: { on: false } }) });
  assert.deepEqual(scanRadar(s, [snap('2330', '10:00:00', 110, 10)], c).map(a => a.title), ['觸及漲停']);
  assert.deepEqual(scanRadar(s, [snap('2330', '10:01:00', 110, 10)], c).map(a => a.title), []);
  assert.deepEqual(scanRadar(s, [snap('2330', '10:02:00', 109.5, 9.5)], c).map(a => a.title), ['漲停打開']);
  assert.deepEqual(scanRadar(s, [snap('2330', '10:20:00', 110, 10)], c).map(a => a.title), ['漲停再鎖']);
  assert.deepEqual(scanRadar(createRadarState(D), [snap('2454', '10:00:00', 90, -10)], c).map(a => a.title), ['觸及跌停']);
});

test('restart restores cooldowns and limit state from today\'s alerts', () => {
  const s = seedRadarState(createRadarState(D), [{ type: 'volume', stockId: '2330', t: '10:30:00' }, { type: 'limit-up', stockId: '2454', t: '10:00:00' }]);
  const c = ctx({ settings: normalizeRadar({ surge: { on: false } }) });
  assert.deepEqual(scanRadar(s, [snap('2330', '10:31:00', 100, 1, { yesterday_volume: 1000 }), snap('2454', '10:31:00', 110, 10)], c), [], 'no duplicate volume or limit-up');
  assert.deepEqual(scanRadar(s, [snap('2454', '10:32:00', 109, 9)], c).map(a => a.title), ['漲停打開']);
});

test('pattern entry and stop fire only on crossings', () => {
  const plans = new Map([['2330', [{ key: 'cup', name: '杯柄', entry: 105, entryMax: 107, stop: 95 }]]]);
  const c = ctx({ plans, settings: normalizeRadar({ volume: { on: false }, surge: { on: false }, limit: { on: false } }) }), s = createRadarState(D);
  assert.equal(scanRadar(s, [snap('2330', '10:00:00', 106, 6)], c).length, 0, 'already above on first sight');
  assert.equal(scanRadar(s, [snap('2330', '10:01:00', 104, 4)], c).length, 0);
  assert.deepEqual(scanRadar(s, [snap('2330', '10:02:00', 105, 5)], c).map(a => a.title), ['站上進場價']);
  scanRadar(s, [snap('2330', '10:03:00', 96, -4)], c);
  assert.deepEqual(scanRadar(s, [snap('2330', '10:04:00', 95, -5)], c).map(a => a.title), ['跌破防守']);
});

test('replay records one frame per minute, summarises sectors and compacts old days', () => {
  const uni = new Set(['2330', '2454']);
  const rows = [snap('2330', '09:01:00', 101, 1, { total_amount: 2e9 }), snap('2454', '09:01:00', 99, -1, { total_amount: 1e9 }), snap('0050', '09:01:00', 50, 0)];
  assert.equal(recordFrame(D, '09:01', rows, uni), true);
  assert.equal(recordFrame(D, '09:01', rows, uni), false, 'same minute skipped');
  assert.equal(recordFrame(D, '09:02', rows.map(r => ({ ...r, total_amount: r.total_amount * 2 })), uni), true);
  const day = loadDay(D);
  assert.deepEqual(day.ids, ['2330', '2454']); assert.deepEqual(day.prev, [10000, 10000]); assert.equal(day.frames.length, 2);
  assert.deepEqual(day.frames[1], { t: '09:02', p: [10100, 9900], a: [4000, 2000], v: [1000, 1000] });
  const sum = replaySummary(day, [{ id: '2330', name: '台積電', sector: '半導體業', market: '上市' }, { id: '2454', name: '聯發科', sector: '半導體業', market: '上市' }]);
  assert.deepEqual(sum.times, ['09:01', '09:02']); assert.deepEqual(sum.total, [3000, 6000]);
  assert.equal(sum.sectors[0].name, '半導體業'); assert.deepEqual(sum.sectors[0].a, [3000, 6000]); assert.equal(sum.sectors[0].c[0], Math.round((1 * 2000 - 1 * 1000) / 3000 * 100) / 100);
  compactReplay('2026-10-01');
  assert.ok(fs.existsSync(path.join(process.env.EQUITY_DATA_DIR, 'replay', `${D}.ndjson.gz`)));
  assert.deepEqual(listDays(), [D]);
  assert.deepEqual(encodeFrame([], ['1101']), { p: [0], a: [0], v: [0] });
  // 開盤第一個畫格還沒成交的股票（快照日期仍是前一日）也要列入表頭，昨收＝快照收盤價，之後成交才記錄價格
  const D2 = '2026-09-29', early = [snap('2330', '09:00:05', 101, 1)].map(r => ({ ...r, date: `${D2} 09:00:05.000` }));
  const stale = { stock_id: '2454', date: '2026-09-26 13:30:00.000', close: 99, change_price: -1, total_volume: 0, total_amount: 0 };
  assert.equal(recordFrame(D2, '09:00', early, uni, { all: [...early, stale] }), true);
  const d2 = loadDay(D2); assert.deepEqual(d2.ids, ['2330', '2454']); assert.deepEqual(d2.prev, [10000, 9900]); assert.deepEqual(d2.frames[0].p, [10100, 0]);
  // 13:30 收盤集合競價：同一分鐘的較新快照覆寫最後一個畫格（重新開檔後也一樣）
  const late = p => [{ ...snap('2330', '13:30:00', p, p - 100), date: `${D2} 13:30:20.000` }];
  assert.equal(recordFrame(D2, '13:30', late(102), uni), true);
  assert.equal(recordFrame(D2, '13:30', late(103), uni), true, 'closing auction overwrites the 13:30 frame');
  assert.equal(recordFrame(D2, '13:29', late(104), uni), false);
  assert.deepEqual(loadDay(D2).frames.map(f => [f.t, f.p[0]]), [['09:00', 10100], ['13:30', 10300]]);
  recordFrame('2026-09-28', '09:00', [{ ...snap('2330', '09:00:00', 100, 0), date: '2026-09-28 09:00:00.000' }], uni);
  assert.equal(recordFrame(D2, '13:30', late(105), uni), true, 'after reopening the file');
  assert.deepEqual(loadDay(D2).frames.map(f => [f.t, f.p[0]]), [['09:00', 10100], ['13:30', 10500]]);
});

test('group ranking close quotes can be rebuilt from local daily prices', () => {
  const stocks = [{ id: '2330', name: '台積電', bars: [{ date: '2026-10-05', close: 110, spread: 10, Trading_money: 5e9 }, { date: '2026-10-06', close: 100, spread: -10, Trading_money: 4e9 }] }, { id: '2454', name: '聯發科', bars: [{ date: '2026-10-06', close: 0 }] }];
  const q = grouprank.quotesFromDaily(stocks, '2026-10-05');
  assert.deepEqual(q.get('2330'), { name: '台積電', close: 110, rate: 10, amount: 5e9, time: '2026-10-05 13:30:00' }); assert.equal(q.size, 1);
  assert.equal(grouprank.quotesFromDaily(stocks, '2026-10-06').size, 1, 'zero close skipped');
});

test('K lines: replay minute bars with live tick, 5-minute buckets, daily rows and moving averages', async () => {
  const day = { date: D, ids: ['2330', '2454'], prev: [10000, 5000], frames: [
    { t: '09:01', p: [10100, 5000], a: [1000, 10], v: [1000, 20] },
    { t: '09:02', p: [10200, 0], a: [1500, 10], v: [1500, 20] },
    { t: '09:05', p: [10150, 5100], a: [2000, 20], v: [1800, 40] },
  ] };
  // 第一根用當日開盤價；量取累計張數差額；最新快照（09:06 進行中）接成新的一根
  const m = replayMinuteBars(day, '2330', { open: 100.5, tick: { t: '09:06', close: 102, volume: 2000, amount: 2.1e9 } });
  assert.deepEqual(m, [['09:01', 100.5, 101, 100.5, 101, 1000], ['09:02', 101, 102, 101, 102, 500], ['09:05', 102, 102, 101.5, 101.5, 300], ['09:06', 101.5, 102, 101.5, 102, 200]]);
  assert.deepEqual(replayMinuteBars(day, '2330', { tick: { t: '09:05', close: 103, volume: 1900 } }).at(-1), ['09:05', 102, 103, 101.5, 103, 300], 'same minute updates the last bar');
  assert.deepEqual(replayMinuteBars(null, '2330', { open: 100, tick: { t: '09:01', close: 101, volume: 50, high: 101.5, low: 99.5 } }), [['09:01', 100, 101.5, 99.5, 101, 50]], 'snapshot only, no frame yet');
  // 舊紀錄沒有張數：以成交金額差額（百萬元）÷ 價格估算張數
  const old = { ...day, frames: day.frames.map(({ t, p, a }) => ({ t, p, a })) };
  assert.deepEqual(replayMinuteBars(old, '2330').map(b => b[5]), [Math.round(1000 * 1000 / 101), Math.round(500 * 1000 / 102), Math.round(500 * 1000 / 101.5)]);
  assert.deepEqual(replayMinuteBars(day, '9999'), []);
  // 5 分 K 以結束時間標示；FinMind 分 K 以起始時間標示（09:00–09:04 → 09:05），13:30 收盤集合競價併入 13:30 那根
  assert.deepEqual(fiveMinBars(m), [['09:05', 100.5, 102, 100.5, 101.5, 1800], ['09:10', 101.5, 102, 101.5, 102, 200]]);
  const fm = [['09:00', 10, 11, 9.5, 10.5, 5], ['09:04', 10.5, 10.8, 10.4, 10.6, 3], ['09:05', 10.6, 10.7, 10.2, 10.3, 2], ['13:24', 10, 10.1, 9.9, 10, 1], ['13:30', 10.2, 10.2, 10.2, 10.2, 40]];
  assert.deepEqual(fiveMinBars(fm, { start: true }), [['09:05', 10, 11, 9.5, 10.6, 8], ['09:10', 10.6, 10.7, 10.2, 10.3, 2], ['13:25', 10, 10.1, 9.9, 10, 1], ['13:30', 10.2, 10.2, 10.2, 10.2, 40]]);
  assert.deepEqual(fiveMinBars([['13:31', 10, 10, 10, 10, 1], ['13:35', 10, 10, 10, 10, 2]]).map(b => b[0]), ['13:30']);
  assert.deepEqual(kbarRows([{ date: '2026-09-29', minute: '09:00:00', open: 1, high: 1, low: 1, close: 1, volume: 1 }, { date: D, minute: '09:00:00', open: 2, high: 2, low: 2, close: 2, volume: 2 }], D), [['09:00', 2, 2, 2, 2, 2]]);
  // 日 K：股數換算張數、無成交日略過；盤後沒有快照時以時光機畫格組成當日 K 棒
  assert.deepEqual(dailyKRows([{ date: '2026-09-29', open: 100, max: 102, min: 99, close: 101, Trading_Volume: 1234567 }, { date: D, open: 0, max: 0, min: 0, close: 0, Trading_Volume: 0 }]), [['2026-09-29', 100, 102, 99, 101, 1235]]);
  assert.deepEqual(replayDayBar(day, '2330'), [D, 101, 102, 101, 101.5, 1800]);
  const { maOf, candleSVG } = await import('../public/insight-ui.js');
  assert.deepEqual(maOf([1, 2, 3, 4, 5, 6], 5), [null, null, null, null, 3, 4]);
  const svg = candleSVG(Array.from({ length: 30 }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, 10 + i, 11 + i, 9 + i, 10.5 + i, 100 + i]), { period: 'day', show: 25, key: 't' });
  assert.equal((svg.match(/<polyline/g) || []).length, 2, 'MA5 and MA20 lines'); assert.equal((svg.match(/opacity="\.45"/g) || []).length, 25, 'only the last 25 bars are drawn');
  assert.match(svg, /MA5 <b>37\.50<\/b>.*MA20 <b>30\.00<\/b>/, 'readout shows the latest MA5 / MA20');
  assert.match(candleSVG([], {}), /尚無 K 線資料/);
  // 5 分 K 的漲跌幅比該日昨收（中間缺一天時不能拿更早一天的收盤比）
  assert.match(candleSVG([['2026-10-02 13:30', 10, 10, 10, 10, 1], ['2026-10-06 09:05', 11, 11, 11, 11, 1]], { period: '5m', prevs: { '2026-10-06': 10.5 } }), /\+4\.76%/);
});

test('broker aggregation, day-trader detection, streaks and concentration', () => {
  const rows = (d, list) => list.flatMap(([id, name, price, buy, sell]) => [{ securities_trader_id: id, securities_trader: name, price, buy, sell, date: d }]);
  const d1 = aggregateBrokers(rows('2026-09-28', [['A', '甲', 100, 100000, 0], ['B', '乙', 100, 0, 20000], ['C', '丙', 100, 30000, 0]]));
  const d2 = aggregateBrokers([...rows('2026-09-29', [['A', '甲', 101, 0, 80000], ['B', '乙', 101, 0, 10000], ['C', '丙', 100, 20000, 0], ['C', '丙', 102, 20000, 0], ['b', '乙小寫', 101, 5000, 0]])]);
  const c = d2.find(b => b.id === 'C'); assert.equal(c.buy, 40000); assert.equal(c.avgBuy, 101); assert.equal(d2.length, 4, 'ids are case sensitive');
  const r = brokerAnalysis([{ date: '2026-09-28', brokers: d1 }, { date: '2026-09-29', brokers: d2 }]);
  assert.equal(r.date, '2026-09-29'); assert.equal(r.buy[0].id, 'C'); assert.equal(r.buy[0].streak, 2); assert.equal(r.sell[0].id, 'A');
  assert.deepEqual(r.dayTraders.map(b => b.id), ['A']); assert.equal(r.sell[0].dayTrader, true); assert.equal(r.sell.find(b => b.id === 'B').streak, -2);
  assert.equal(r.volume, 45000); assert.equal(r.concentration, Math.round((45000 - 90000) / 45000 * 1e4) / 100);
});

test('holder levels parse into big-holder, retail and people series', () => {
  const lv = (date, level, people, percent) => ({ date, HoldingSharesLevel: level, people, percent });
  const rows = ['2026-09-18', '2026-09-24'].flatMap((d, i) => [lv(d, '1-999', 1000, 2), lv(d, '40,001-50,000', 50, 3), lv(d, '400,001-600,000', 5, 5), lv(d, 'more than 1,000,001', 10, 70 + i), lv(d, 'total', 1065 - i * 10, 100), lv(d, '差異數調整（說明4）', 0, 0)]);
  const s = parseHolders(rows);
  assert.equal(s.length, 2); assert.deepEqual(s[0], { date: '2026-09-18', big1000: 70, big400: 75, small: 5, people: 1065, peopleBig: 10, shares: 0 });
  const sig = holderSignal(s); assert.equal(sig.d1, 1); assert.equal(sig.tone, '籌碼集中');
  assert.deepEqual(kbarRows([{ minute: '09:00:00', open: 1, high: 2, low: 1, close: 2, volume: 5 }, { minute: '09:01:00', close: 0 }]), [['09:00', 1, 2, 1, 2, 5]]);
});

test('report context is compact and settings fall back to defaults', () => {
  const heat = { live: false, total: { money: 5e11, change: 1.2, up: 900, down: 700, limitUp: 20, limitDown: 1, moneyChange: 5 }, sectors: [{ name: '半導體業', money: 2e11, share: 40, change: 2, up: 50, down: 10, limitUp: 3, moneyChange: 8 }] };
  const c = buildReportContext({ date: D, heat, flows: null, alerts: Array.from({ length: 80 }, (_, i) => ({ t: '10:00:00', stockId: '2330', name: '台積電', title: '急拉', detail: String(i) })), watch: [], movers: {}, patterns: [], news: [], agenda: null });
  assert.equal(c.大盤.成交金額億, 5000); assert.equal(c.資金板塊[0].成交億, 2000); assert.equal(c.盤中異動.length, 60); assert.equal(c.法人, null);
  // 模型與思考強度改在「推理模型」設定（config.llm），日報設定只剩自動產生與時間
  assert.deepEqual(normalizeReportSettings({ model: 'gpt', time: '25:00', effort: 'max' }), { auto: true, time: '16:30' });
  // 英文介面：資料欄位名稱跟著翻譯（字典沒有的 key 保留原文）
  const en = buildReportContext({ date: D, heat, flows: null, alerts: [], watch: [], movers: {}, patterns: [], news: [], agenda: null }, 'en');
  assert.ok(Object.keys(en).length >= 10);
});
