// 當沖監控：引擎（VWAP、內外盤、OBI、分 K、同時段量、分數、訊號、排除條件、斷線補資料）、收盤檢討、富果事件解析、多連線訂閱、盤前資料
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDayTrade, buildBaseline, normalizeDaytrade, roundTripCost, tzOffset, evaluateSignal, reviewStats, DT_DEFAULTS } from '../lib/daytrade.mjs';
import { createStreamPool, splitSymbols } from '../lib/stream.mjs';
import fugle, { streamEvent, planOf } from '../lib/providers/fugle.mjs';
import { parseDayTradePrep } from '../lib/providers/finmind.mjs';
import { marketProfile } from '../lib/markets.mjs';

const tw = marketProfile('TW'), date = '2026-10-07', at = hms => Date.parse(`${date}T${hms}+08:00`);
const flat = (perMin, ids) => ({ days: 5, shape: null, stock: new Map(ids.map(id => [id, Float64Array.from({ length: tw.length + 1 }, (_, e) => perMin * e)])) });
const book = (id, time, bid, ask, bidSize = 100, askSize = 50) => ({ kind: 'book', id, time, bids: [{ price: bid, size: bidSize }], asks: [{ price: ask, size: askSize }] });
let serial = 0;
const trade = (id, hms, price, size, { bid = price - 0.1, ask = price } = {}) => ({ kind: 'trade', id, time: at(hms), price, size, bid, ask, serial: ++serial });
const engine = (opts = {}) => createDayTrade({ market: tw, date, ids: ['2330'], meta: new Map([['2330', { name: '台積電', groups: [] }]]), baseline: flat(10, ['2330']), prep: { ref: new Map([['2330', 50]]) }, settings: { ...DT_DEFAULTS, minScore: 0 }, offset: 8 * 3600e3, ...opts });
// 09:15 起每分鐘兩筆（50.1、50.2）共 10 張，五檔價差 1 檔
function quietMinutes(e, from, to) {
  for (let m = from; m <= to; m++) { const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; e.ingest([trade('2330', `${hm}:10`, 50.1, 5, { bid: 50.1, ask: 50.2 }), trade('2330', `${hm}:40`, 50.2, 5, { bid: 50.1, ask: 50.2 }), book('2330', at(`${hm}:41`), 50.1, 50.2)]); }
}

test('settings are normalized; round-trip cost and Taipei offset', () => {
  const s = normalizeDaytrade({ top: 999, minScore: -5, plan: 'x', signals: { vwap: false }, costs: { feeDiscount: 0.28, slipTicks: 9 }, stopNew: '25:00' });
  assert.deepEqual([s.top, s.minScore, s.plan, s.signals.vwap, s.signals.breakout, s.costs.feeDiscount, s.costs.slipTicks, s.stopNew], [20, 60, 'auto', false, true, 0.28, 1, '13:10']);
  assert.equal(Math.round(roundTripCost(DT_DEFAULTS.costs) * 1000) / 1000, 0.435);
  assert.equal(tzOffset('Asia/Taipei'), 8 * 3600e3);
});

test('baseline: average cumulative volume per traded minute; partial days skipped; market shape', () => {
  const frames = (k, until = 810) => { const out = []; for (let m = 540; m <= until; m++) out.push({ t: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, v: [k * (m - 539), 2 * k * (m - 539)] }); return out; };
  const days = [{ ids: ['A', 'B'], frames: frames(10) }, { ids: ['A', 'B'], frames: frames(20) }, { ids: ['A', 'B'], frames: frames(30) }, { ids: ['A', 'B'], frames: frames(1000, 600) }];
  const b = buildBaseline(days, ['A'], tw);
  assert.equal(b.days, 3, 'the day recorded only until 10:00 is skipped');
  assert.equal(b.stock.get('A')[10], 200, 'average of 100, 200, 300');
  assert.equal(b.stock.has('B'), false, 'only requested stocks');
  assert.ok(Math.abs(b.shape[135] - 135 / 270) < 0.01);
  assert.equal(buildBaseline(days.slice(0, 2), ['A'], tw).stock.has('A'), false, 'needs 3 days');
  // 早期的時光機紀錄沒有成交量（只有價格與成交金額）：略過，不可出錯
  const old = { ids: ['A', 'B'], frames: frames(50).map(({ t }) => ({ t, p: [1, 1], a: [1, 1] })) };
  assert.equal(buildBaseline([old, ...days], ['A'], tw).stock.get('A')[10], 200);
  assert.equal(buildBaseline([old, { ids: ['A'] }, null], ['A'], tw).days, 0);
});

test('trades build VWAP, bid/ask volume and minute bars; duplicates and trial matches ignored', () => {
  const e = engine();
  const t1 = trade('2330', '09:00:05', 50, 10, { bid: 49.9, ask: 50 }), t2 = trade('2330', '09:00:30', 49.9, 30, { bid: 49.9, ask: 50 });
  e.ingest([t1, t2, { ...t1 }, { ...trade('2330', '09:00:40', 60, 999), trial: true }, trade('2330', '09:01:02', 50.2, 10, { bid: 50.1, ask: 50.2 })]);
  const r = e.row('2330');
  assert.deepEqual([r.close, r.total_volume, r.volume_at_ask, r.volume_at_bid, r.change_price, r.open, r.high, r.low], [50.2, 50, 20, 30, 0.2, 50, 50.2, 49.9]);
  assert.equal(r.total_amount, (50 * 10 + 49.9 * 30 + 50.2 * 10) * 1000);
  assert.match(r.date, /^2026-10-07 09:01:02$/);
  const bars = [...e.bars('2330').values()].sort((a, b) => a.m - b.m);
  assert.deepEqual(bars.map(b => [b.m, b.o, b.h, b.l, b.c, b.tv]), [[540, 50, 50, 49.9, 49.9, 40], [541, 50.2, 50.2, 50.2, 50.2, 10]]);
  e.tick(at('09:02:00'));
  const item = e.ranking().list[0];
  assert.equal(item.vwap, Math.round((50 * 10 + 49.9 * 30 + 50.2 * 10) / 50 * 100) / 100);
});

test('candles fill bars missed by trades without double counting', () => {
  const e = engine();
  e.ingest([trade('2330', '09:00:05', 50, 10)]);
  e.ingest([{ kind: 'candle', id: '2330', time: at('09:00:00'), open: 50, high: 50.3, low: 49.8, close: 50.1, volume: 25 }]);
  const b = e.bars('2330').get(540);
  assert.deepEqual([b.h, b.l, b.c, Math.max(b.tv, b.cv)], [50.3, 49.8, 50, 25]);
});

test('breakout signal: closes above the 15-minute high on 2x same-time volume, then cools down', () => {
  const e = engine(); e.setFeed(true);
  quietMinutes(e, 555, 574); // 09:15–09:34
  e.ingest([trade('2330', '09:35:10', 50.3, 30, { bid: 50.2, ask: 50.3 }), trade('2330', '09:35:50', 50.5, 20, { bid: 50.4, ask: 50.5 }), book('2330', at('09:35:51'), 50.4, 50.5)]);
  assert.deepEqual(e.tick(at('09:35:55')), [], 'the minute is not complete yet');
  const alerts = e.tick(at('09:36:01')), a = alerts.find(x => x.type === 'dt-breakout');
  assert.ok(a, 'breakout fired');
  assert.equal(a.title, '爆量突破');
  assert.match(a.detail, /突破前 15 分鐘高點 50\.2/);
  assert.match(a.detail, /5 倍/);
  assert.equal(e.signals.length >= 1, true);
  assert.equal(e.tick(at('09:36:30')).filter(x => x.type === 'dt-breakout').length, 0, 'cooldown');
});

test('no signals before the watch window, while gaps are pending, or when excluded', () => {
  const opening = engine(); opening.setFeed(true);
  quietMinutes(opening, 540, 553);
  opening.ingest([trade('2330', '09:14:10', 51, 80)]);
  assert.equal(opening.tick(at('09:14:50')).length, 0, '09:00–09:15 is observation only');
  assert.equal(opening.phase(at('09:14:50')), 'opening');
  const gap = engine(); gap.setFeed(true); quietMinutes(gap, 555, 574); gap.markGap(['2330']);
  gap.ingest([trade('2330', '09:35:10', 50.5, 50, { bid: 50.4, ask: 50.5 })]);
  assert.equal(gap.tick(at('09:36:01')).length, 0, 'waiting for backfill');
  assert.equal(gap.ranking().list[0].pending, true);
  const banned = engine({ prep: { ref: new Map([['2330', 50]]), eligible: new Set(['2317']), disposition: new Set(['2330']) } }); banned.setFeed(true);
  quietMinutes(banned, 555, 574); banned.ingest([trade('2330', '09:35:10', 50.5, 50, { bid: 50.4, ask: 50.5 })]);
  assert.equal(banned.tick(at('09:36:01')).length, 0);
  assert.deepEqual(banned.ranking().list[0].filters, ['noDayTrade', 'disposition']);
  assert.deepEqual(banned.ranking().counts, { noDayTrade: 1, disposition: 1 });
});

test('wide spread and limit-up exclude; stop time sends one reminder', () => {
  const e = engine(); e.setFeed(true);
  e.ingest([trade('2330', '13:09:00', 55, 10), book('2330', at('13:09:01'), 54.5, 55)]); // 價差 5 檔
  e.tick(at('13:09:30'));
  assert.deepEqual(e.ranking().list[0].filters, ['spread', 'limitUp'], '55 is the limit-up price for 50');
  const stop = e.tick(at('13:10:05')).filter(a => a.type === 'dt-stop');
  assert.equal(stop.length, 1); assert.match(stop[0].detail, /13:10 起不再發出當沖訊號/);
  assert.equal(e.tick(at('13:11:00')).filter(a => a.type === 'dt-stop').length, 0);
});

test('order-book imbalance signal needs persistence, rising price and volume', () => {
  const e = engine(); e.setFeed(true);
  quietMinutes(e, 555, 574);
  const evs = [];
  for (let s = 0; s < 50; s += 5) evs.push(book('2330', at(`09:35:${String(s).padStart(2, '0')}`), 50.3, 50.4, 400, 100));
  evs.push(trade('2330', '09:35:20', 50.3, 20, { bid: 50.3, ask: 50.4 }), trade('2330', '09:35:55', 50.4, 20, { bid: 50.3, ask: 50.4 }));
  e.ingest(evs);
  e.ingest([book('2330', at('09:36:00'), 50.3, 50.4, 400, 100), trade('2330', '09:36:00', 50.4, 1, { bid: 50.3, ask: 50.4 })]);
  const a = e.tick(at('09:36:00')).find(x => x.type === 'dt-bid');
  assert.ok(a, 'bid-strength fired');
  assert.match(a.detail, /五檔不平衡 0\.6/);
});

test('backfill after a reconnect restores totals, reference, book and minute bars', () => {
  const e = engine({ prep: {} }); e.markGap(['2330']);
  e.backfill('2330', { quote: { referencePrice: 48, openPrice: 48.5, highPrice: 50.5, lowPrice: 48.2, closePrice: 50, avgPrice: 49.5, lastUpdated: at('10:00:00') * 1000, total: { tradeVolume: 1000, tradeValue: 49.5e6, tradeVolumeAtBid: 400, tradeVolumeAtAsk: 600 }, lastTrade: { serial: 500 }, bids: [{ price: 49.9, size: 10 }], asks: [{ price: 50, size: 10 }] }, candles: [{ date: `${date}T09:00:00.000+08:00`, open: 48.5, high: 48.8, low: 48.2, close: 48.7, volume: 300 }] });
  assert.equal(e.gaps.size, 0);
  const r = e.row('2330');
  assert.deepEqual([r.close, r.change_price, r.total_volume, r.volume_at_ask, r.buy_price], [50, 2, 1000, 600, 49.9]);
  assert.equal(e.bars('2330').get(540).cv, 300);
  e.ingest([trade('2330', '10:00:01', 50, 5)]);
  assert.equal(e.row('2330').total_volume, 1000, 'trades with older serials are ignored');
});

test('lite mode: aggregate rows become minute bars from cumulative volume', () => {
  const e = engine();
  const agg = (hms, close, vol, ask, bid) => ({ kind: 'agg', id: '2330', time: at(hms), row: { close, total_volume: vol, total_amount: vol * close * 1000, volume_at_ask: ask, volume_at_bid: bid, change_price: close - 50 }, book: { bids: [{ price: close - 0.1, size: 10 }], asks: [{ price: close, size: 10 }] } });
  e.ingest([agg('09:00:10', 50, 100, 60, 40)]); e.ingest([agg('09:01:10', 50.2, 130, 80, 50)]);
  const bars = [...e.bars('2330').values()].sort((a, b) => a.m - b.m);
  assert.deepEqual(bars.map(b => [b.tv, b.ask, b.bid]), [[100, 60, 40], [30, 20, 10]]);
  assert.equal(e.row('2330').sell_price, 50.2);
});

test('restored signals keep their cooldown after a restart', () => {
  const e = engine(); e.setFeed(true);
  e.restore([{ type: 'dt-breakout', id: '2330', m: 575, t: '09:35:59', price: 50.5 }]);
  quietMinutes(e, 555, 574);
  e.ingest([trade('2330', '09:35:10', 50.5, 50, { bid: 50.4, ask: 50.5 })]);
  assert.equal(e.tick(at('09:36:01')).filter(a => a.type === 'dt-breakout').length, 0);
  assert.equal(e.signals.filter(s => s.type === 'dt-breakout').length, 1);
});

test('review: net returns after slippage, fees and tax; statistics per signal type', () => {
  const bars = new Map([[575, { m: 575, h: 50.5, l: 50.3, c: 50.5 }], [580, { m: 580, h: 51, l: 50.4, c: 51 }], [590, { m: 590, h: 51.2, l: 50.6, c: 50.8 }], [810, { m: 810, h: 50, l: 49.8, c: 50 }]]);
  const o = evaluateSignal({ m: 575, price: 50.5 }, bars, tw, DT_DEFAULTS.costs);
  // 買 50.6（滑價 1 檔）；5 分鐘後 51 − 0.1 = 50.9 → +0.593% − 0.435% 成本
  assert.equal(o.r5, Math.round(((50.9 / 50.6 - 1) * 100 - 0.435) * 100) / 100);
  assert.equal(o.rClose, Math.round(((49.9 / 50.6 - 1) * 100 - 0.435) * 100) / 100);
  assert.equal(o.mfe, Math.round((51.2 / 50.6 - 1) * 10000) / 100);
  const stats = reviewStats([{ date, signals: [{ type: 'dt-breakout', outcome: o }, { type: 'dt-breakout', outcome: { ...o, r15: 1 } }, { type: 'dt-vwap', outcome: o }] }]);
  const br = stats.types.find(x => x.type === 'dt-breakout');
  assert.deepEqual([stats.signals, br.n, br.win15], [3, 2, 50]);
});

test('Fugle stream events: trades, books, candles and aggregates', () => {
  const ev = streamEvent({ event: 'data', channel: 'trades', data: { symbol: '2330', price: 568, size: 4778, volume: 54538, bid: 567, ask: 568, serial: 6652422, time: 1685338200000000, isClose: true } });
  assert.deepEqual([ev.kind, ev.id, ev.time, ev.price, ev.size, ev.volume, ev.serial, ev.key], ['trade', '2330', 1685338200000, 568, 4778, 54538, 6652422, undefined]);
  const b = streamEvent({ event: 'data', channel: 'books', data: { symbol: '2330', bids: [{ price: 567, size: 87 }], asks: [{ price: 568, size: 800 }], time: 1685338200000000 } });
  assert.deepEqual([b.kind, b.key, b.bids[0].size, b.asks[0].price], ['book', 'b:2330', 87, 568]);
  const c = streamEvent({ event: 'data', channel: 'candles', data: { symbol: '2330', date: '2023-05-29T13:30:00.000+08:00', open: 568, high: 568, low: 568, close: 568, volume: 4778, average: 566.69 } });
  assert.deepEqual([c.kind, c.time, c.volume], ['candle', Date.parse('2023-05-29T05:30:00Z'), 4778]);
  assert.equal(streamEvent({ event: 'heartbeat', data: { time: 1 } }), null);
  const g = streamEvent({ event: 'data', channel: 'aggregates', data: { date: '2026-10-08', symbol: '2330', closePrice: 1460, change: 10, bids: [{ price: 1455, size: 1 }], total: { tradeVolume: 10, tradeValue: 14600000 }, lastUpdated: Date.UTC(2026, 9, 8, 2) * 1000 } }, { tz: 'Asia/Taipei', lot: 1000 });
  assert.deepEqual([g.kind, g.row.close, g.book.bids[0].price], ['agg', 1460, 1455]);
  assert.deepEqual([planOf({ tier: 'free' }, 'advanced'), planOf({ tier: 'paid' }, 'auto'), planOf({ tier: 'paid' }, 'advanced')], ['basic', 'developer', 'advanced']);
  assert.deepEqual(fugle.stream.channels.full, ['trades', 'candles', 'books']);
});

test('stream pool: symbols split into fixed groups, every channel subscribed on each connection', () => {
  const socks = [], states = [];
  class Sock extends EventTarget { constructor(url) { super(); this.sent = []; socks.push(this); } send(s) { this.sent.push(JSON.parse(s)); } close() { } emit(type, data) { this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) })); } }
  const ids = Array.from({ length: 281 }, (_, i) => String(1101 + i)), groups = splitSymbols(ids.slice().reverse(), 2).map(symbols => ({ symbols, channels: fugle.stream.channels.full }));
  assert.deepEqual(groups.map(g => g.symbols.length), [141, 140]);
  assert.equal(groups[0].symbols[0], '1101', 'sorted, so restarts give the same groups');
  const timers = { setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { } };
  const pool = createStreamPool({ spec: fugle.stream, key: 'k', market: tw, groups, onEvents() { }, onStatus: s => states.push(s), connect: u => new Sock(u), timers });
  assert.equal(socks.length, 2);
  for (const s of socks) { s.emit('open'); s.emit('message', { event: 'authenticated' }); }
  const subs = socks.flatMap(s => s.sent.filter(m => m.event === 'subscribe'));
  assert.deepEqual(['trades', 'candles', 'books'].map(ch => subs.filter(m => m.data.channel === ch).reduce((a, m) => a + m.data.symbols.length, 0)), [281, 281, 281]);
  for (const s of socks) for (const m of s.sent.filter(x => x.event === 'subscribe')) s.emit('message', { event: 'subscribed', data: m.data.symbols.map(symbol => ({ symbol, channel: m.data.channel })) });
  const last = states.at(-1);
  assert.deepEqual([last.connected, last.expected, last.subscribed, last.connections.length], [true, 843, 843, 2]);
  pool.update([{ symbols: ids, channels: ['aggregates'] }]);
  assert.equal(pool.size, 1);
});

test('FinMind pre-market data: eligible list, ongoing suspensions, sell-first bans and reference prices', () => {
  const p = parseDayTradePrep({
    list: [{ date, stock_id: '2330', BuyAfterSale: 'Y' }, { date, stock_id: '2317', BuyAfterSale: '＊' }, { date: '2026-10-06', stock_id: '9999' }],
    suspended: [{ date: '2026-10-05', stock_id: '1234', resumption_date: '' }, { date: '2026-10-01', stock_id: '5678', resumption_date: '2026-10-03' }],
    sellFirst: [{ date: '2026-10-06', stock_id: '2317', end_date: '2026-10-09' }],
    limits: [{ date, stock_id: '2330', reference_price: 1450, limit_up: 1595, limit_down: 1305 }],
  }, date);
  assert.deepEqual([p.eligible, p.suspended, p.sellFirstOff, p.ref], [['2330', '2317'], ['1234'], ['2317'], { 2330: 1450 }]);
  assert.equal(parseDayTradePrep({ list: [] }, date).eligible, null, 'unknown when the list is not out yet');
});
