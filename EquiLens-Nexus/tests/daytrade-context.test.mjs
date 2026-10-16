import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMinutes, prepareContext, appendBook, bookWindow, analyzeContext } from '../lib/daytrade-context.mjs';
import { createDayTrade, DT_DEFAULTS, evaluateSignal, reviewStats, normalizeDaytrade } from '../lib/daytrade.mjs';
import fugle from '../lib/providers/fugle.mjs';
import { marketProfile } from '../lib/markets.mjs';
import { createHistoryLoader } from '../lib/daytrade-history.mjs';
const date = '2026-10-14', market = marketProfile('TW');
const at = t => Date.parse(`${date}T${t}+08:00`);
function history() {
  const daily = [], minutes = [];
  let day = Date.parse('2026-09-01T00:00:00Z');
  for (let i = 0; i < 30; day += 86400000) {
    const d = new Date(day); if ([0, 6].includes(d.getUTCDay())) continue;
    const date = d.toISOString().slice(0, 10), px = 45 + i * 0.15;
    daily.push({ date, o: px, h: px + 0.3, l: px - 0.2, c: px + 0.2, v: 1000 });
    const start = Date.parse(`${date}T09:00:00+08:00`);
    for (let m = 0; m < 265; m++) { const p = px + m / 2000; minutes.push({ time: start + m * 60000, o: p, h: p + 0.05, l: p - 0.05, c: p + 0.01, v: 10 }); }
    i++;
  }
  return { daily, minutes, rawClose: daily.at(-1).c, source: 'fixture' };
}
const hist = history();
function books(e, time = at('09:40:00'), negative = false) {
  for (let i = 0; i <= 6; i++) {
    const B = negative ? 100 : 240 + i * 20, A = negative ? 240 + i * 20 : 100;
    const ev = { kind: 'book', id: '2330', time: time - 30000 + i * 5000,
      bids: Array.from({ length: 5 }, (_, n) => ({ price: 50.5 - n * 0.1, size: B })),
      asks: Array.from({ length: 5 }, (_, n) => ({ price: 50.6 + n * 0.1, size: A })) };
    if (Array.isArray(e)) appendBook(e, ev); else e.ingest([ev]);
  }
}
let serial = 0;
const trade = (time, price = 50.6) => ({ kind: 'trade', id: '2330', time, price, size: 1, serial: ++serial, ask: price, bid: price - 0.1 });
function ready({ watch = true, historyValue = hist, negativeBook = false, settings = {} } = {}) {
  const e = createDayTrade({ market, date, ids: ['2330'], watch: new Set(watch ? ['2330'] : []), settings: { ...DT_DEFAULTS, minDailyAmount: 0, ...settings }, prep: { eligible: new Set(['2330']), ref: new Map([['2330', hist.rawClose]]) } });
  if (historyValue) e.setHistory('2330', historyValue);
  e.setFeed(true); e.setMode('full');
  for (let m = 0; m < 40; m++) {
    const px = m < 35 ? 50.1 : 50.5;
    e.ingest([{ kind: 'candle', id: '2330', time: at('09:00:00') + m * 60000, open: px, high: px + 0.1, low: px - 0.1, close: px + 0.05, volume: m < 35 ? 10 : 30 }]);
  }
  // Establish a real VWAP independently of the historical bars.
  e.ingest([{ ...trade(at('09:00:20'), 50), size: 100 }, trade(at('09:40:00'))]);
  books(e, at('09:40:00'), negativeBook); return e;
}

test('intervals are anchored at 09:00; incomplete, duplicate, future and closing partial bars cannot confirm', () => {
  const rows = hist.minutes.slice(0, 265);
  assert.equal(aggregateMinutes(rows, 60).length, 4);
  assert.equal(aggregateMinutes(rows, 5).length, 53);
  assert.equal(aggregateMinutes([...rows, rows[0]], 60).length, 4);
  assert.equal(aggregateMinutes(rows.slice(1), 60).length, 3);
  assert.equal(aggregateMinutes(rows, 60, rows[0].time + 59 * 60000).length, 0);
  assert.equal(prepareContext({ ...hist, daily: [...hist.daily, { ...hist.daily[0], date }] }, date).daily.length, 30);
});

test('book persistence is time weighted; incomplete depth, duplicate time, gaps and stale snapshots fail closed', () => {
  const xs = []; books(xs);
  const good = bookWindow(xs, at('09:40:00'), 0.1, DT_DEFAULTS);
  assert.equal(good.long, true); assert.ok(good.delta > 0.1);
  assert.equal(bookWindow(xs, at('09:40:20'), 0.1, DT_DEFAULTS).ready, false);
  assert.equal(bookWindow(xs.slice(1), at('09:40:00'), 0.1, DT_DEFAULTS).ready, false);
  assert.equal(bookWindow([xs[0], ...xs.slice(4)], at('09:40:00'), 0.1, DT_DEFAULTS).ready, false);
  const count = xs.length;
  appendBook(xs, { time: xs.at(-1).time, bids: [], asks: [] }); assert.equal(xs.length, count);
  appendBook(xs, { time: at('09:40:01'), bids: [], asks: [] }); assert.equal(bookWindow(xs, at('09:40:01'), 0.1, DT_DEFAULTS).ready, false);
});

test('a missing VWAP cannot pass confirmation through numeric null coercion', () => {
  const xs = []; books(xs);
  const c = analyzeContext(prepareContext(hist, date), [], xs, { date, now: at('09:40:00'), last: 50.6, lastAt: at('09:40:00'), ref: hist.rawClose, tick: 0.1, vwap: null, settings: DT_DEFAULTS, full: true });
  assert.ok(c.reasons.includes('vwap')); assert.equal(c.ready, false);
});

test('complete multi-timeframe breakout emits once, saves evidence and reference, and survives restart', () => {
  const e = ready(), alerts = e.tick(at('09:40:00'));
  assert.equal(alerts.length, 1, JSON.stringify(e.ranking().list[0].context));
  assert.equal(alerts[0].type, 'dt-breakout'); assert.equal(alerts[0].purpose, 'opportunity');
  assert.equal(e.signals[0].evidence.daily.count, 30);
  assert.ok(e.signals[0].reference.stop < alerts[0].close);
  assert.equal(e.tick(at('09:40:01')).length, 0);
  const restored = ready(); restored.restore(e.signals); assert.equal(restored.tick(at('09:40:01')).length, 0);
});

test('not watched, disabled, lite, missing history, stale quote, disconnected, and failed backfill never create entries', () => {
  for (const [name, setup] of [
    ['watch', () => ready({ watch: false })], ['disabled', () => ready({ settings: { enabled: false } })],
    ['history', () => ready({ historyValue: null })], ['lite', () => { const e = ready(); e.setMode('lite'); return e; }],
    ['feed', () => { const e = ready(); e.setFeed(false); return e; }],
    ['gap', () => { const e = ready(); e.markGap(['2330']); assert.equal(e.backfill('2330', {}), false); return e; }],
  ]) assert.equal(setup().tick(at('09:40:00')).length, 0, name);
  const stale = ready(); books(stale, at('09:40:30')); assert.equal(stale.tick(at('09:40:30')).length, 0);
  const future = ready(); future.ingest([trade(at('09:40:30'))]); assert.equal(future.tick(at('09:40:00')).length, 0);
});

test('reference stop is immediate, one-shot, independent of entry score and books, and continues after entry cutoff', () => {
  const e = ready(); e.tick(at('09:40:00'));
  e.setSettings({ ...DT_DEFAULTS, minScore: 100 });
  e.ingest([trade(at('13:12:00'), 49.8)]);
  const out = e.tick(at('13:12:00')).filter(x => x.type === 'dt-risk');
  assert.equal(out.length, 1); assert.equal(out[0].purpose, 'risk');
  assert.equal(e.tick(at('13:12:01')).filter(x => x.type === 'dt-risk').length, 0);
  assert.equal(evaluateSignal(e.signals.at(-1), e.bars('2330'), market, DT_DEFAULTS.costs), null);
  const auction = ready(); auction.tick(at('09:40:00')); auction.ingest([trade(at('13:25:00'), 49.8)]); assert.equal(auction.tick(at('13:25:00')).length, 0);
});

test('missing preceding intervals never become a contiguous breakout, pullback or support window', () => {
  const e = ready(); e.bars('2330').delete(574); // Missing 09:34, so no complete 09:30–09:35 bar.
  assert.equal(e.tick(at('09:40:00')).length, 0);
  const c = e.ranking().list[0].context;
  assert.equal(c.ready, true); assert.equal(c.five.support, null);
  assert.ok(Object.values(c.conditions).every(x => !x));
});

test('muting stop notifications still persists reference invalidation across restart', () => {
  const e = ready({ settings: { signals: { risk: false } } }); e.tick(at('09:40:00'));
  e.ingest([trade(at('09:41:00'), 49.8)]);
  assert.equal(e.tick(at('09:41:00')).length, 0);
  assert.equal(e.signals.at(-1).type, 'dt-risk'); assert.equal(e.signals.at(-1).muted, true);
  const restored = ready(); restored.restore(e.signals); restored.tick(at('09:40:01'));
  assert.equal(restored.ranking().list[0].reference, null);
});

test('backfill rejects malformed prices and bars, and book updates cannot rejuvenate an old trade', () => {
  const e = ready(); e.markGap(['2330']);
  const candles = [{ date: `${date}T09:34:00+08:00`, open: 50, high: 50.1, low: 49.9, close: 50, volume: 10 }];
  const quote = { closePrice: 50.6, closeTime: at('09:39:00') * 1000, lastUpdated: at('09:40:00') * 1000 };
  assert.equal(e.backfill('2330', { quote: { ...quote, closePrice: NaN }, candles }), false);
  assert.equal(e.backfill('2330', { quote: { ...quote, closeTime: undefined }, candles }), false);
  assert.equal(e.backfill('2330', { quote, candles: [{ ...candles[0], high: 49 }] }), false);
  assert.equal(e.gaps.has('2330'), true);
  const clean = ready(); clean.markGap(['2330']);
  const old = { ...quote, closeTime: at('09:41:00') * 1000, lastUpdated: at('09:42:00') * 1000 };
  assert.equal(clean.backfill('2330', { quote: old, candles }), true);
  clean.tick(at('09:42:00'));
  assert.equal(clean.ranking().list[0].context.quoteFresh, false);
});

test('lite aggregate updates require a fresh actual trade time before issuing a stop alert', () => {
  const e = ready(); e.tick(at('09:40:00')); e.setMode('lite');
  const agg = { kind: 'agg', id: '2330', time: at('09:41:00'), tradeTime: at('09:40:00'), row: { close: 49.8, total_volume: 1000 } };
  e.ingest([agg]); assert.equal(e.tick(at('09:41:00')).length, 0);
  e.ingest([{ ...agg, time: at('09:41:01'), tradeTime: at('09:41:01') }]);
  assert.equal(e.tick(at('09:41:01'))[0]?.type, 'dt-risk');
});

test('membership updates retain current members, remove departed stocks and prepare new manual additions', () => {
  const e = ready(); e.syncIds(['2317']); e.setWatch(new Set(['2317']));
  e.ingest([trade(at('09:40:00'))]); assert.equal(e.row('2330'), null);
  assert.deepEqual(e.ids, ['2317']); assert.equal(e.tick(at('09:40:00')).length, 0);
});

test('daily/hour direction, eligibility, volume and price-basis gates independently prevent long entries', () => {
  const bearishDay = { ...hist, daily: hist.daily.map((b, i) => ({ ...b, o: 55 - i / 10, h: 56 - i / 10, l: 54 - i / 10, c: 55 - i / 10 })) };
  const bearishHour = { ...hist, minutes: hist.minutes.map((b, i) => ({ ...b, o: 60 - i / 1000, h: 60.1 - i / 1000, l: 59.9 - i / 1000, c: 60 - i / 1000 })) };
  for (const h of [bearishDay, bearishHour]) assert.equal(ready({ historyValue: h }).tick(at('09:40:00')).length, 0);
  const unknown = ready(); unknown.setPrep({ eligible: null }); assert.equal(unknown.tick(at('09:40:00')).length, 0);
  const basis = ready(); basis.setPrep({ ref: new Map([['2330', 45]]) }); assert.equal(basis.tick(at('09:40:00')).length, 0);
  const lowVolume = ready({ historyValue: { ...hist, minutes: hist.minutes.map(b => ({ ...b, v: 1000 })) } }); assert.equal(lowVolume.tick(at('09:40:00')).length, 0);
  const missingHour = ready(); missingHour.ingest([trade(at('10:00:00'))]); books(missingHour, at('10:00:00')); missingHour.tick(at('10:00:00')); assert.ok(missingHour.ranking().list[0].context.reasons.includes('hourStale'));
});

test('pullback and book-strength modes produce opportunities when their distinct conditions confirm', () => {
  const bid = ready({ settings: { signals: { breakout: false, vwap: false } } });
  assert.equal(bid.tick(at('09:40:00'))[0]?.type, 'dt-bid');
  const pullback = ready({ settings: { signals: { breakout: false, bid: false } } });
  pullback.ingest([{ kind: 'candle', id: '2330', time: at('09:34:00'), open: 50.05, high: 50.2, low: 49.95, close: 50.05, volume: 10 }]);
  assert.equal(pullback.tick(at('09:40:00'))[0]?.type, 'dt-vwap');
});

test('weakness ignores entry score, fires once, and rearms only after a later false setup and cooldown', () => {
  const e = ready({ negativeBook: true, settings: { minScore: 100, signals: { breakout: false, vwap: false, bid: false } } });
  function bar(start, px) {
    for (let i = 0; i < 5; i++) e.ingest([{ kind: 'candle', id: '2330', time: start + i * 60000, open: px, high: px + 0.1, low: px - 0.1, close: px, volume: 20 }]);
  }
  bar(at('09:35:00'), 49); e.ingest([trade(at('09:40:01'), 49)]); books(e, at('09:40:01'), true);
  assert.equal(e.tick(at('09:40:01'))[0]?.type, 'dt-weak');
  assert.equal(e.tick(at('09:40:02')).length, 0);
  bar(at('09:40:00'), 51); e.ingest([trade(at('09:45:01'), 51)]); books(e, at('09:45:01'));
  assert.equal(e.tick(at('09:45:01')).length, 0);
  bar(at('09:45:00'), 48); e.ingest([trade(at('09:50:01'), 48)]); books(e, at('09:50:01'), true);
  assert.equal(e.tick(at('09:50:01'))[0]?.type, 'dt-weak');
});

test('new strategy statistics never combine legacy outcomes or risk alerts with v2 entries', () => {
  const stats = reviewStats([{ signals: [{ type: 'dt-breakout', outcome: { r15: 1 } }, { type: 'dt-breakout', version: 2, purpose: 'opportunity', outcome: { r15: -1 } }, { type: 'dt-risk', version: 2, purpose: 'risk', outcome: { r15: 99 } }] }]);
  assert.equal(stats.signals, 2); assert.equal(stats.types.length, 2); assert.deepEqual(stats.types.map(x => x.version), [1, 2]);
});

test('Fugle history loads exactly 30 sessions, uses adjusted price factors and keeps minute lots', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    const u = new URL(url); calls.push(u);
    if (u.searchParams.get('timeframe') === 'D') {
      const factor = u.searchParams.has('adjusted') ? 0.5 : 1;
      return Response.json({ data: hist.daily.map(b => ({ date: b.date, open: b.o * factor, high: b.h * factor, low: b.l * factor, close: b.c * factor, volume: 1000000, turnover: 50000000 })) });
    }
    // 1 分 K 區間請求：區間內每個交易日回一根（第 5 個交易日故意缺，應單獨補抓）
    const from = u.searchParams.get('from'), to = u.searchParams.get('to'), skip = hist.daily[4].date;
    return Response.json({ data: hist.daily.filter(b => b.date >= from && b.date <= to && (from === to || b.date !== skip)).map(b => ({ date: `${b.date}T09:00:00+08:00`, open: 50, high: 51, low: 49, close: 50, volume: 12 })) });
  };
  try {
    const h = await fugle.streamHistory('2330', date, { key: 'fixture', interval: 0, historyInterval: 0 });
    // 日 K 2 次＋1 分 K 每 15 日 1 次（2 次）＋缺日補抓 1 次（原本每日一次共 32 次，超過歷史 API 每分鐘 60 次的上限）
    assert.equal(calls.length, 5); assert.equal(h.daily.length, 30); assert.equal(h.minutes.length, 30);
    assert.equal(h.minutes[0].c, 25); assert.equal(h.minutes[0].v, 12); assert.equal(h.daily[0].v, 1000); assert.equal(h.daily[0].amount, 50000000);
    assert.ok(h.minutes.every((m, i) => !i || m.time > h.minutes[i - 1].time), 'minutes in time order');
    assert.equal(prepareContext(h, date).complete, false, 'one minute per session is not complete context');
  } finally { globalThis.fetch = original; }
});

test('Fugle historical API: 429 waits for Retry-After and retries instead of failing every stock', async () => {
  const original = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => (++n === 1 ? new Response(JSON.stringify({ statusCode: 429, message: 'Rate limit exceeded' }), { status: 429, headers: { 'retry-after': '0.01' } }) : Response.json({ data: [] }));
  try {
    const h = await fugle.streamHistory('2330', date, { key: 'fixture', interval: 0, historyInterval: 0 });
    assert.equal(n, 3, 'raw daily retried once, then adjusted daily'); assert.deepEqual(h.daily, []);
  } finally { globalThis.fetch = original; }
});

test('history loader caches only complete data and retries errors; generation change cannot populate another engine', async () => {
  let calls = 0, clock = 0; const files = new Map(), e = ready({ historyValue: null });
  const loader = createHistoryLoader({ read: k => files.get(k), write: (k, v) => files.set(k, v), now: () => clock, fetchHistory: async () => { if (!calls++) throw new Error('offline'); return hist; } });
  const args = { ids: ['2330'], date, source: 'fixture', engine: e };
  await loader.load(args); assert.equal(loader.status(['2330'])[0].status, 'error');
  await loader.load(args); assert.equal(calls, 1);
  clock = 600001; await loader.load(args); assert.equal(e.historyReady('2330'), true); assert.equal(files.size, 1);
  loader.reset(); const other = ready({ historyValue: null }); await loader.load({ ...args, engine: other }); assert.equal(calls, 2); assert.equal(other.historyReady('2330'), true);
  let release; const pending = createHistoryLoader({ read: () => null, write() { throw Error('should not write'); }, fetchHistory: () => new Promise(r => { release = r; }) });
  const work = pending.load(args); pending.reset(); release(hist); await work; assert.equal(pending.status(['2330'])[0].status, 'pending');
});

test('scan scope: a research-list stock outside the watchlist is scanned when it is in the scan set; settings default to all', () => {
  const e = ready({ watch: false });
  assert.equal(e.tick(at('09:40:00')).length, 0, 'not in the watchlist and no scan set: no alerts');
  const scanned = ready({ watch: false }); scanned.setScan(new Set(['2330']));
  const alerts = scanned.tick(at('09:40:00'));
  assert.ok(alerts.length > 0, 'scanned stock gets alerts');
  assert.equal(scanned.ranking().list[0].scan, true); assert.equal(scanned.ranking().list[0].watch, false);
  assert.equal(normalizeDaytrade({}).scope, 'all'); assert.equal(normalizeDaytrade({ scope: 'watchlist' }).scope, 'watchlist'); assert.equal(normalizeDaytrade({ scope: 'x' }).scope, 'all');
});

test('history loader caches incomplete history for the day instead of refetching every 10 minutes', async () => {
  let calls = 0, clock = 0; const files = new Map(), e = ready({ historyValue: null });
  const thin = { ...hist, minutes: hist.minutes.filter((_, i) => i % 3 === 0) }; // 成交稀疏：大部分分鐘沒有 K 棒
  const loader = createHistoryLoader({ read: k => files.get(k), write: (k, v) => files.set(k, v), now: () => clock, fetchHistory: async () => { calls++; return thin; } });
  const args = { ids: ['2330'], date, source: 'fixture', engine: e };
  await loader.load(args); assert.equal(loader.status(['2330'])[0].status, 'incomplete'); assert.equal(files.size, 1);
  clock = 3600e3; await loader.load(args); assert.equal(calls, 1, 'not refetched');
  const restarted = createHistoryLoader({ read: k => files.get(k), write: (k, v) => files.set(k, v), now: () => clock, fetchHistory: async () => { calls++; return thin; } });
  await restarted.load({ ...args, engine: ready({ historyValue: null }) }); assert.equal(calls, 1, 'cache used after a restart');
});
