// 當沖監控引擎（台股）：盤中把富果 WebSocket 的逐筆成交、1 分 K、五檔委買賣（或精簡模式的聚合行情）整理成每檔的即時狀態，
// 以 30 日日 K、完成的 60／5 分 K、VWAP 與連續五檔變化確認觀察名單做多機會，另發轉弱與參考停損提醒。
// 分數及門檻是研究初值，尚未回測；收盤後只檢討做多機會扣除成本後的結果。
// 純計算模組：資料取得、排程與推播在 server.mjs；時間一律用毫秒時間戳，交易所當地時間以固定時差換算。
import { elapsedTrading, tickSize, hhmm, minuteOf, limitPrices } from './markets.mjs';
import { t } from './i18n.mjs';
import { prepareContext, analyzeContext, appendBook, contextDate, validBar } from './daytrade-context.mjs';
import { createMarketTracker, marketRecord, regimeOf, regimeKey, strengthKey, INDEX_KEYS, MARKET_RULES, REGIMES, STRENGTHS } from './daytrade-market.mjs';

export const DT_TYPES = { breakout: 'dt-breakout', vwap: 'dt-vwap', bid: 'dt-bid', weak: 'dt-weak', risk: 'dt-risk' };
export const DT_TITLES = { 'dt-breakout': '多週期爆量突破', 'dt-vwap': '多週期回測轉強', 'dt-bid': '五檔增強確認', 'dt-weak': '多單轉弱警示', 'dt-risk': '跌破參考停損', 'dt-stop': '停止新增部位' };
export const signalTitle = s => (s.version === 2 ? DT_TITLES : { 'dt-breakout': '爆量突破', 'dt-vwap': 'VWAP 趨勢延續', 'dt-bid': '買盤持續增強' })[s.type] || DT_TITLES[s.type] || s.type;
// 分數權重（研究用初始值）：日 K 20、60 分 K 25、5 分 K 30、五檔 25
export const DT_WEIGHTS = Object.freeze({ daily: 20, hour: 25, five: 30, book: 25 });
export const DT_PLANS = ['auto', 'basic', 'developer', 'advanced'];
export const DT_SCOPES = ['all', 'watchlist'];
export const DT_DEFAULTS = Object.freeze({
  enabled: true, plan: 'auto', top: 20, minScore: 60,
  displayMin: 80,                                // 掃描清單只顯示分數 ≥ 此值的股票（只影響畫面，不影響訊號）
  scope: 'all',                                  // 掃描範圍：all＝全部研究族群＋自選（即時推播訂閱的股票）；watchlist＝只掃自選
  signals: { breakout: true, vwap: true, bid: true, weak: true, risk: true },
  bookWindowSeconds: 30, bookMaxAgeSeconds: 10, quoteMaxAgeSeconds: 15, bookImbalance: 0.3,
  watchFrom: '09:15', stopNew: '13:10',          // 開盤觀察期結束、停止發出新訊號的時間
  maxSpreadTicks: 3,                             // 委買賣價差超過幾檔不發訊號
  minDailyAmount: 100e6,                         // 近 20 日平均成交金額下限（流動性）
  breakoutLookback: 15, breakoutVolume: 2,       // 突破前 N 分鐘高點、完成 5 分量 ≥ 同時段均量倍數
  costs: { feeRate: 0.001425, feeDiscount: 1, taxRate: 0.0015, slipTicks: 1 }, // 手續費（買賣各一次）、當沖證交稅、滑價（每邊檔數）
});
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const round = (x, n = 2) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n;

export function normalizeDaytrade(input = {}) {
  const d = DT_DEFAULTS, s = input || {}, c = s.costs || {}, num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
  return {
    enabled: s.enabled !== false, plan: DT_PLANS.includes(s.plan) ? s.plan : d.plan, scope: DT_SCOPES.includes(s.scope) ? s.scope : d.scope,
    top: Math.round(num(s.top, 5, 50, d.top)), minScore: Math.round(num(s.minScore, 0, 100, d.minScore)), displayMin: Math.round(num(s.displayMin, 0, 100, d.displayMin)),
    signals: Object.fromEntries(Object.keys(d.signals).map(k => [k, s.signals?.[k] !== false])),
    watchFrom: HM.test(s.watchFrom) ? s.watchFrom : d.watchFrom, stopNew: HM.test(s.stopNew) ? s.stopNew : d.stopNew,
    maxSpreadTicks: Math.round(num(s.maxSpreadTicks, 1, 20, d.maxSpreadTicks)), minDailyAmount: num(s.minDailyAmount, 0, 1e11, d.minDailyAmount),
    breakoutLookback: Math.round(num(s.breakoutLookback, 5, 60, d.breakoutLookback) / 5) * 5, breakoutVolume: num(s.breakoutVolume, 1, 10, d.breakoutVolume),
    bookWindowSeconds: Math.round(num(s.bookWindowSeconds, 20, 60, d.bookWindowSeconds)), bookMaxAgeSeconds: Math.round(num(s.bookMaxAgeSeconds, 3, 15, d.bookMaxAgeSeconds)),
    quoteMaxAgeSeconds: Math.round(num(s.quoteMaxAgeSeconds, 5, 30, d.quoteMaxAgeSeconds)), bookImbalance: num(s.bookImbalance, 0.2, 0.6, d.bookImbalance),
    costs: { feeRate: num(c.feeRate, 0, 0.01, d.costs.feeRate), feeDiscount: num(c.feeDiscount, 0.1, 1, d.costs.feeDiscount), taxRate: num(c.taxRate, 0, 0.01, d.costs.taxRate), slipTicks: Math.round(num(c.slipTicks, 0, 5, d.costs.slipTicks)) },
  };
}
// 一次來回的成本（%）：買賣手續費各一次 × 折扣，加當沖證交稅
export const roundTripCost = costs => (costs.feeRate * costs.feeDiscount * 2 + costs.taxRate) * 100;

// 交易所時區相對 UTC 的毫秒差（台股固定 +8；盤中不會遇到日光節約切換）
export function tzOffset(tz, at = Date.now()) {
  const o = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(at / 1000) * 1000;
}

/* ---------- 同時段歷史量 ---------- */
// 由時光機的每分鐘畫格（累計成交量）建立基準：每檔、每個「已交易分鐘數」的平均累計量。
// 某檔有效天數不足 3 天時，用全市場的日內量能曲線 × 該檔近 20 日均量推估。days：[{ ids, frames:[{t, v}] }]
export function buildBaseline(days, ids, p, { minDays = 3 } = {}) {
  const want = new Set(ids), L = p.length, shapeSum = new Float64Array(L + 1), per = new Map();
  let shapeDays = 0;
  for (const day of days) {
    const frames = (day?.frames || []).filter(f => Array.isArray(f.v)); // 早期的時光機紀錄沒有成交量，略過
    if (!frames.length || !Array.isArray(day.ids)) continue;
    const cover = new Set(frames.map(f => elapsedTrading(p, minuteOf(f.t) + 1))).size;
    if (cover < L * 0.6) continue; // 只記錄到部分時段的日子不納入
    const idx = day.ids.map((id, i) => [id, i]), cum = new Map(), total = new Float64Array(L + 1);
    for (const f of frames) {
      const e = elapsedTrading(p, minuteOf(f.t) + 1); if (e < 1) continue;
      let sum = 0;
      for (const [id, i] of idx) { const v = f.v[i] || 0; sum += v; if (want.has(id)) { let a = cum.get(id); if (!a) cum.set(id, a = new Float64Array(L + 1)); a[e] = Math.max(a[e], v); } }
      total[e] = Math.max(total[e], sum);
    }
    fill(total);
    if (total[L] > 0) { for (let e = 0; e <= L; e++) shapeSum[e] += total[e] / total[L]; shapeDays++; }
    for (const [id, a] of cum) { fill(a); if (!(a[L] > 0)) continue; let s = per.get(id); if (!s) per.set(id, s = { n: 0, sum: new Float64Array(L + 1) }); s.n++; for (let e = 0; e <= L; e++) s.sum[e] += a[e]; }
  }
  const shape = shapeDays ? shapeSum.map(x => x / shapeDays) : null, stock = new Map();
  for (const [id, s] of per) if (s.n >= minDays) stock.set(id, s.sum.map(x => x / s.n));
  return { days: shapeDays, shape, stock };
}
// 補齊沒有畫格的分鐘（沿用前一分鐘的累計量）
function fill(a) { for (let e = 1; e < a.length; e++) if (!(a[e] > 0)) a[e] = a[e - 1]; }

/* ---------- 盤中引擎 ---------- */
// meta：Map(id → { name, groups:[族群 id], exchange:'上市'／'上櫃' })；prep：{ eligible:Set|null, disposition:Set, suspended:Set, sellFirstOff:Set, ref:Map(id → 參考價), avgAmount:Map, avgVolume:Map }
// watch：自選（標示用）；scan：掃描與發訊號的股票（未提供時同 watch）
export function createDayTrade({ market: p, date, ids, meta = new Map(), watch = new Set(), scan = null, baseline = null, prep = {}, settings = DT_DEFAULTS, offset = 8 * 3600e3, lang }) {
  const S = new Map(), log = [], lot = p.lot || 1000, T = (msg, params) => t(msg, params, lang), unit = p.unit?.[lang || 'zh-TW'] || T('股');
  let cfg = normalizeDaytrade(settings), info = { eligible: null, disposition: new Set(), suspended: new Set(), sellFirstOff: new Set(), ref: new Map(), avgAmount: new Map(), avgVolume: new Map(), ...prep };
  let gaps = new Set(), feedOk = false, fullFeed = false, stopNotified = false;
  const history = new Map();
  // 大盤環境（只記錄）：上市對照加權、上櫃對照櫃買；server.mjs 餵入指數資料，訊號紀錄附上當下狀態，不影響分數與訊號
  const market = createMarketTracker({ date, open: p.open, offset });
  const modOf = ms => Math.floor((ms + offset) / 60000) % 1440;
  const hmsOf = ms => { const s = Math.floor((ms + offset) / 1000) % 86400; return `${hhmm(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`; };
  const eOf = m => elapsedTrading(p, m + 1); // 分鐘 m 結束時已交易的分鐘數
  for (const id of ids) S.set(id, blank(id));
  function blank(id) { return { id, ref: null, last: null, lastAt: 0, quoteAt: 0, open: null, high: null, low: null, cumVol: 0, cumAmt: 0, vNum: 0, vDen: 0, atAsk: 0, atBid: 0, serial: -1, bars: new Map(), book: null, bookAt: 0, obi: [], books: [], gates: new Map(), reference: null, fired: new Map(), limitUp: false, halted: false, tape: [] }; }
  const st = id => { let s = S.get(id); if (!s) S.set(id, s = blank(id)); return s; };
  const refOf = s => s.ref ?? info.ref.get(s.id) ?? null;
  const barOf = (s, m) => { let b = s.bars.get(m); if (!b) s.bars.set(m, b = { m, o: null, h: -Infinity, l: Infinity, c: null, tv: 0, cv: 0, ask: 0, bid: 0, lastAt: 0 }); return b; };
  const vol = b => Math.max(b.tv, b.cv);
  function price(s, b, px, at) { if (b.o == null) b.o = px; b.h = Math.max(b.h, px); b.l = Math.min(b.l, px); if (at >= b.lastAt) { b.c = px; b.lastAt = at; } if (at >= s.lastAt) { s.last = px; s.lastAt = at; } s.open ??= px; s.high = Math.max(s.high ?? px, px); s.low = Math.min(s.low ?? px, px); }

  // 收到一批推播事件；回傳有變動的股票代號
  function ingest(events) {
    const changed = new Set();
    for (const ev of events) {
      if (!ev?.id || !S.has(ev.id) || ev.trial || !Number.isFinite(ev.time) || contextDate(ev.time) !== date) continue;
      const s = st(ev.id);
      if (ev.kind === 'trade') {
        if (ev.serial != null && ev.serial <= s.serial) continue; // 重複（例如斷線補資料後又收到）
        if (ev.serial != null) s.serial = ev.serial;
        const px = ev.price, size = ev.size || 0; if (!(px > 0)) continue;
        const b = barOf(s, modOf(ev.time)); price(s, b, px, ev.time); s.quoteAt = Math.max(s.quoteAt, ev.time); b.tv += size; b.amt = (b.amt || 0) + px * size;
        s.cumVol = ev.volume > 0 ? Math.max(s.cumVol, ev.volume) : s.cumVol + size;
        s.cumAmt += px * size * lot; s.vNum += px * size; s.vDen += size;
        const side = ev.ask > 0 && px >= ev.ask ? 1 : ev.bid > 0 && px <= ev.bid ? -1 : 0;
        if (side > 0) { s.atAsk += size; b.ask += size; } else if (side < 0) { s.atBid += size; b.bid += size; }
        s.tape.push([ev.time, px, size, side]); if (s.tape.length > 80) s.tape.splice(0, s.tape.length - 60); // 最近成交明細（看板個股走勢用）
        s.limitUp = !!ev.limitUp; s.halted = !!ev.halted;
      } else if (ev.kind === 'book') {
        if (ev.time <= s.bookAt) continue;
        appendBook(s.books, ev);
        s.book = { bids: ev.bids || [], asks: ev.asks || [] }; s.bookAt = ev.time || s.lastAt;
        const B = s.book.bids.reduce((x, l) => x + (l.size || 0), 0), A = s.book.asks.reduce((x, l) => x + (l.size || 0), 0);
        if (B + A > 0) { s.obi.push([s.bookAt, (B - A) / (B + A)]); while (s.obi.length && s.obi[0][0] < s.bookAt - 60e3) s.obi.shift(); }
      } else if (ev.kind === 'candle') {
        const b = barOf(s, modOf(ev.time)); b.cv = Math.max(b.cv, ev.volume || 0);
        if (ev.open > 0 && b.o == null) b.o = ev.open; if (ev.high > 0) b.h = Math.max(b.h, ev.high); if (ev.low > 0) b.l = Math.min(b.l, ev.low);
        // Provider OHLC replaces trade-derived OHLC: candles can fill missing trades.
        if (ev.close > 0) { b.o = ev.open; b.h = ev.high; b.l = ev.low; b.c = ev.close; if (s.last == null) s.last = ev.close; }
      } else if (ev.kind === 'agg') { // 精簡模式：累計量的差額歸到當下這一分鐘
        const r = ev.row; if (!(r?.close > 0)) continue;
        const at = ev.time || s.lastAt, b = barOf(s, modOf(at)), dv = Math.max(0, (r.total_volume || 0) - s.cumVol);
        price(s, b, r.close, at); s.quoteAt = Number.isFinite(ev.tradeTime) ? ev.tradeTime : 0; b.tv += dv;
        if (r.volume_at_ask != null) { b.ask += Math.max(0, r.volume_at_ask - s.atAsk); s.atAsk = r.volume_at_ask; }
        if (r.volume_at_bid != null) { b.bid += Math.max(0, r.volume_at_bid - s.atBid); s.atBid = r.volume_at_bid; }
        s.cumVol = Math.max(s.cumVol, r.total_volume || 0); s.cumAmt = Math.max(s.cumAmt, r.total_amount || 0);
        if (s.cumVol > 0 && s.cumAmt > 0) { s.vNum = s.cumAmt / lot; s.vDen = s.cumVol; } // VWAP＝累計成交金額 ÷ 累計量
        if (r.open > 0) s.open = r.open; if (r.high > 0) s.high = r.high; if (r.low > 0) s.low = r.low;
        if (s.ref == null && r.change_price != null) s.ref = round(r.close - r.change_price, 4);
        if (ev.book) ingest([{ kind: 'book', id: ev.id, time: at, ...ev.book }]);
      } else continue;
      changed.add(ev.id);
    }
    return changed;
  }
  // 斷線重連後以 REST 補資料：quote（累計量、內外盤、均價、五檔、參考價）＋ 1 分 K
  function backfill(id, { quote, candles } = {}) {
    // A failed/empty REST response must not release a pending gap.
    if (!S.has(id) || !quote || !Array.isArray(candles) || !candles.length || quote.isTrial || !Number.isFinite(quote.closePrice) || !(quote.closePrice > 0)) return false;
    // Snapshot updates (including books) must not rejuvenate an old last trade.
    const quoteTime = usTime(quote.closeTime ?? quote.lastTrade?.time);
    const validCandles = candles.filter(c => Number.isFinite(Date.parse(c.date)) && contextDate(Date.parse(c.date)) === date && validBar({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
    if (!Number.isFinite(quoteTime) || !quoteTime || contextDate(quoteTime) !== date || !validCandles.length) return false;
    const s = st(id), q = quote;
    if (q) {
      const t = q.total || {}, at = quoteTime;
      if (q.referencePrice > 0) s.ref = q.referencePrice;
      if (t.tradeVolume >= s.cumVol) { s.cumVol = t.tradeVolume; s.cumAmt = t.tradeValue ?? s.cumAmt; s.atAsk = t.tradeVolumeAtAsk ?? s.atAsk; s.atBid = t.tradeVolumeAtBid ?? s.atBid; }
      // 均價一律以報價的全日均價重設：推播的累計量可能比 REST 報價稍新，若沿用上面的條件，VWAP 只會剩下重連後的成交
      if (q.avgPrice > 0 && t.tradeVolume > 0) { s.vNum = q.avgPrice * t.tradeVolume; s.vDen = t.tradeVolume; }
      if (q.openPrice > 0) s.open = q.openPrice; if (q.highPrice > 0) s.high = q.highPrice; if (q.lowPrice > 0) s.low = q.lowPrice;
      if (q.closePrice > 0 && at >= s.lastAt) { s.last = q.closePrice; s.lastAt = at; s.quoteAt = at; }
      if (q.lastTrade?.serial > s.serial) s.serial = q.lastTrade.serial;
      s.halted = !!q.tradingHalt?.isHalted; s.limitUp = !!q.isLimitUpPrice;
      if (q.bids || q.asks) ingest([{ kind: 'book', id, time: usTime(q.lastUpdated ?? t.time), bids: q.bids, asks: q.asks }]);
    }
    for (const c of validCandles) ingest([{ kind: 'candle', id, time: Date.parse(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }]);
    gaps.delete(id); return true;
  }

  // 每檔的即時快照列（與資料源快照格式相同，供異動雷達與即時看板使用）
  function row(id) {
    const s = S.get(id); if (!s || !(s.last > 0)) return null;
    const ref = refOf(s), bid = s.book?.bids?.[0]?.price, ask = s.book?.asks?.[0]?.price;
    return { stock_id: id, date: `${date} ${hmsOf(s.lastAt)}`, open: s.open, high: s.high, low: s.low, close: s.last, change_price: ref > 0 ? round(s.last - ref, 4) : null, change_rate: ref > 0 ? round((s.last / ref - 1) * 100) : null,
      total_volume: s.cumVol, total_amount: s.cumAmt, yesterday_volume: null, buy_price: bid ?? null, sell_price: ask ?? null, volume_at_bid: s.atBid, volume_at_ask: s.atAsk };
  }

  /* 指標 */
  const base = (id, e) => { if (e <= 0) return 0; const a = baseline?.stock?.get(id); if (a) return a[Math.min(e, a.length - 1)]; const v = info.avgVolume.get(id), sh = baseline?.shape; return v > 0 && sh ? v * sh[Math.min(e, sh.length - 1)] : null; };
  const vwapOf = s => s.vDen > 0 ? s.vNum / s.vDen : s.cumVol > 0 ? s.cumAmt / (s.cumVol * lot) : null;
  function metrics(s, cur, now) {
    const ref = refOf(s), last = s.last, done = [...s.bars.values()].filter(b => b.m < cur && b.c != null).sort((a, b) => a.m - b.m);
    const winVol = k => { let v = 0; for (const b of done) if (b.m > cur - 1 - k) v += vol(b); return v; };
    const eNow = eOf(cur - 1), ratio = k => { const b0 = base(s.id, eNow), b1 = base(s.id, eNow - k); return b0 != null && b1 != null && b0 - b1 > 0 ? winVol(k) / (b0 - b1) : null; };
    const r1 = ratio(1), r3 = ratio(3), r5 = ratio(5), bCum = base(s.id, eNow), rvol = bCum > 0 ? sumVol(done) / bCum : null;
    const vwap = vwapOf(s), closes = done.map(b => b.c), ema = n => closes.reduce((e, c, i) => i ? e + (c - e) * 2 / (n + 1) : c, null);
    const look = done.filter(b => b.m >= cur - 1 - cfg.breakoutLookback && b.m < cur - 1), hi = look.length ? Math.max(...look.map(b => b.h)) : null;
    const last5 = done.filter(b => b.m > cur - 6), ask5 = last5.reduce((x, b) => x + b.ask, 0), bid5 = last5.reduce((x, b) => x + b.bid, 0);
    const ob = s.obi.filter(o => o[0] >= now - 30e3 && o[0] <= now), obiAvg = ob.length ? ob.reduce((x, o) => x + o[1], 0) / ob.length : null, obiMin = ob.length ? Math.min(...ob.map(o => o[1])) : null;
    const b1 = s.book?.bids?.[0]?.price, a1 = s.book?.asks?.[0]?.price, tick = last > 0 ? tickSize(p, last) : null;
    const spread = b1 > 0 && a1 > 0 && tick ? Math.round((a1 - b1) / tick) : null, bookStale = !s.book || now - s.bookAt > cfg.bookMaxAgeSeconds * 1000;
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    const live = done.map(b => ({ time: midnight + b.m * 60000, o: b.o, h: b.h, l: b.l, c: b.c, v: vol(b) }));
    const context = analyzeContext(history.get(s.id), live, s.books, { date, now, last, lastAt: s.quoteAt, ref, tick, vwap, settings: cfg, full: fullFeed });
    if (context.risk > 0) { const low = context.risk + tick; context.risk = round(low - tickSize(p, low - 1e-7), 4); }
    if (!info.eligible) { context.ready = false; context.reasons.push('eligibility'); context.conditions = { breakout: false, vwap: false, bid: false, weak: false }; }
    return { ref, last, change: ref > 0 && last > 0 ? (last / ref - 1) * 100 : null, gap: ref > 0 && s.open > 0 ? (s.open / ref - 1) * 100 : null, vwap, r1, r3, r5, rvol, hi, done, ema5: ema(5), ema20: ema(20),
      outer5: ask5 + bid5 > 0 ? ask5 / (ask5 + bid5) : null, obi: context.book.obi ?? obiAvg, obiMin, spread, bookStale, tick, context };
  }
  const sumVol = bars => bars.reduce((x, b) => x + vol(b), 0);
  // 個股近 15 分鐘漲跌（%）：現價對 15 分鐘前最後一根完成 1 分 K 的收盤
  const recentChange = (m, cur) => { const b = m.done.filter(x => x.m <= cur - MARKET_RULES.window).at(-1); return b?.c > 0 && m.last > 0 ? (m.last / b.c - 1) * 100 : null; };

  // 排除條件：不可當沖、處置、暫停交易、價差過大、流動性不足、已漲停（買不到）
  function filters(s, m) {
    const out = [];
    if (info.eligible && !info.eligible.has(s.id)) out.push('noDayTrade');
    if (info.disposition.has(s.id)) out.push('disposition');
    if (info.suspended.has(s.id) || s.halted) out.push('suspended');
    if (m.spread != null && m.spread > cfg.maxSpreadTicks) out.push('spread');
    const amt = info.avgAmount.get(s.id); if (amt != null && amt < cfg.minDailyAmount) out.push('liquidity');
    const lim = m.ref > 0 ? limitPrices(p, m.ref) : null; if (s.limitUp || (lim && m.last >= lim.up)) out.push('limitUp');
    return out;
  }
  // 當沖機會分數（0–100）：各部分的得分與最高分
  function score(s, m) {
    const c = m.context, part = {
      daily: c.daily.long ? 20 : 0,
      hour: c.hour.long ? 25 : 0,
      five: c.five.current ? (m.last > m.vwap ? 10 : 0) + (c.five.close > c.five.resistance ? 10 : 0) + 10 * clamp(((c.five.volumeRatio || 0) - 1) / (cfg.breakoutVolume - 1 || 1)) : 0,
      book: c.book.ready ? (c.book.long ? 25 : 15 * clamp((c.book.obi || 0) / cfg.bookImbalance)) : 0,
    };
    for (const key in part) part[key] = round(part[key], 1);
    return { total: round(Object.values(part).reduce((a, b) => a + b, 0), 1), part };
  }
  // 交易階段：盤前、開盤觀察、掃描、停止新訊號、收盤集合競價、收盤
  function phase(cur) {
    const w = minuteOf(cfg.watchFrom), stop = minuteOf(cfg.stopNew), auction = p.close - (p.id === 'TW' ? 5 : 0);
    return cur < p.open ? 'pre' : cur < w ? 'opening' : cur < Math.min(stop, auction) ? 'scan' : cur < auction ? 'stop' : cur < p.close + p.settle ? 'auction' : 'closed';
  }

  let lastEval = { at: 0, list: [], counts: {} };
  // 每秒呼叫：計算全部股票的分數與排名，偵測訊號；回傳新訊號（雷達事件格式）
  function tick(now) {
    if (contextDate(now) !== date) return [];
    const cur = modOf(now), ph = phase(cur), alerts = [], list = [];
    const all = [...S.values()].filter(s => s.last > 0), ms = new Map(all.map(s => [s.id, metrics(s, cur, now)]));
    const chg = [...ms.values()].map(m => m.change).filter(x => x != null), marketChg = chg.length ? chg.reduce((a, b) => a + b, 0) / chg.length : null;
    const groupChg = new Map();
    for (const s of all) for (const g of meta.get(s.id)?.groups || []) { const c = ms.get(s.id).change; if (c == null) continue; const x = groupChg.get(g) || [0, 0]; x[0] += c; x[1]++; groupChg.set(g, x); }
    const counts = {};
    for (const s of all) {
      const m = ms.get(s.id), gs = (meta.get(s.id)?.groups || []).map(g => groupChg.get(g)).filter(x => x?.[1] > 1), gc = gs.length ? Math.max(...gs.map(([a, n]) => a / n)) : null;
      const sc = score(s, m, gc, marketChg), why = filters(s, m);
      for (const f of why) counts[f] = (counts[f] || 0) + 1;
      const item = { id: s.id, name: meta.get(s.id)?.name || s.id, watch: watch.has(s.id), scan: (scan || watch).has(s.id), price: m.last, change: round(m.change), gap: round(m.gap), vwap: round(m.vwap, 2), vwapDist: m.vwap > 0 ? round((m.last / m.vwap - 1) * 100) : null,
        rvol: round(m.rvol), r1: round(m.r1), outer5: m.outer5 == null ? null : round(m.outer5 * 100, 0), obi: round(m.obi), spread: m.spread, score: sc.total, part: sc.part, filters: why, pending: gaps.has(s.id), context: m.context, reference: s.reference, last: s.lastSignal || null, at: hmsOf(s.lastAt) };
      list.push(item);
      // Risk alerts continue after the entry cutoff, and never depend on a high long score.
      if (!cfg.enabled || !item.scan || !['scan', 'stop'].includes(ph) || !feedOk || gaps.has(s.id) || !m.context.quoteFresh || why.includes('suspended')) continue;
      for (const a of detect(s, m, cur, sc, now, ph === 'scan' && !why.length && sc.total >= cfg.minScore)) { if (!a.muted) alerts.push({ ...a, stockId: s.id, name: item.name, close: m.last, change: item.change, t: hmsOf(now), watch: item.watch, level: 'hi', score: sc.total });
        s.lastSignal = { type: a.type, t: hmsOf(now) }; log.push({ ...a, version: 2, id: s.id, name: item.name, at: now, m: cur, t: hmsOf(now), price: m.last, vwap: round(m.vwap, 2), score: sc.total, part: sc.part, evidence: m.context, market: marketRecord(market, meta.get(s.id)?.exchange, { chg: m.change, r15: recentChange(m, cur) }, now) }); }
    }
    if (cfg.enabled && ph === 'stop' && !stopNotified && Object.values(cfg.signals).some(Boolean)) { stopNotified = true; alerts.push({ type: 'dt-stop', stockId: '', name: '', detail: T('{time} 起停止做多機會提醒；轉弱與參考停損仍監控至 13:25', { time: cfg.stopNew }), t: hmsOf(now), level: 'hi', watch: true }); }
    list.sort((a, b) => (a.filters.length ? 1 : 0) - (b.filters.length ? 1 : 0) || b.score - a.score);
    lastEval = { at: now, phase: ph, list, counts, marketChange: round(marketChg) };
    return alerts.map(a => ({ title: T(DT_TITLES[a.type]), ...a }));
  }
  // 做多機會與風險提醒分流；同類條件先解除再重新成立，才可重新提醒。
  function detect(s, m, cur, sc, now, allowEntry) {
    const c = m.context, out = [], end = c.five.end;
    if (s.reference && m.last <= s.reference.stop) {
      out.push({ type: DT_TYPES.risk, purpose: 'risk', muted: !cfg.signals.risk, reference: s.reference, detail: T('現價 {price} 跌破參考停損 {stop}；此為先前訊號失效提醒，非持倉確認', { price: m.last, stop: s.reference.stop }) });
      s.reference = null;
    }
    if (!c.ready) return out;
    for (const key of ['breakout', 'vwap', 'bid', 'weak']) {
      const type = DT_TYPES[key], condition = c.conditions[key], gate = s.gates.get(type);
      if (!condition) { if (gate && end > gate.end) gate.armed = true; continue; }
      if (!cfg.signals[key] || (gate && (!gate.armed || end <= gate.end || now - gate.at < 10 * 60000))) continue;
      if (key !== 'weak' && (!allowEntry || out.length || s.reference)) continue;
      s.gates.set(type, { armed: false, end, at: now }); s.fired.set(type, cur);
      const purpose = key === 'weak' ? 'risk' : 'opportunity';
      if (purpose === 'opportunity') s.reference = { stop: c.risk, price: m.last, at: now, type };
      out.push({ type, purpose, reference: s.reference,
        detail: purpose === 'risk' ? T('5 分 K 跌破支撐 {support} 與 VWAP {vwap}；五檔轉弱 {obi}，請檢查多單風險', { support: round(c.five.support), vwap: round(m.vwap), obi: round(c.book.obi) })
          : T('30 日日 K 與 60 分 K 偏多；5 分量 {ratio} 倍；五檔 OBI {obi}、變化 {delta}；參考停損 {stop}', { ratio: round(c.five.volumeRatio), obi: round(c.book.obi), delta: round(c.book.delta), stop: c.risk }) });
    }
    return out;
  }

  return {
    ingest, backfill, row, tick, date,
    setHistory(id, data) { const h = prepareContext(data, date); history.set(id, h); if (h.daily.length === 30) { const rows = h.daily.slice(-20); info.avgVolume.set(id, rows.reduce((n,b)=>n+b.v,0)/20); if (rows.every(b=>Number.isFinite(b.amount))) info.avgAmount.set(id, rows.reduce((n,b)=>n+b.amount,0)/20); } },
    historyReady: id => !!history.get(id)?.complete,
    setMode(mode) { fullFeed = mode === 'full'; },
    syncIds(ids) { const want = new Set(ids); for (const id of S.keys()) if (!want.has(id)) { S.delete(id); history.delete(id); gaps.delete(id); } for (const id of want) st(id); },
    // 服務重新啟動：還原今天已發出的訊號（供收盤檢討）與冷卻時間
    restore(signals) { for (const x of signals || []) { if (!S.has(x.id)) continue; log.push(x); const s = st(x.id); s.fired.set(x.type, x.m); s.lastSignal = { type: x.type, t: x.t }; s.gates.set(x.type, { armed: false, end: x.evidence?.five?.end || x.at || 0, at: x.at || 0 }); if (x.version === 2 && x.purpose === 'opportunity') s.reference = x.reference; if (x.type === DT_TYPES.risk) s.reference = null; } },
    ranking: () => lastEval,
    get signals() { return log; },
    bars: id => S.get(id)?.bars || new Map(),
    // 個股即時走勢：參考價、最新價、五檔、最近成交（看板個股走勢；每分鐘量價與均價由 bars 計算）
    quote(id) { const s = S.get(id); if (!s) return null; return { ref: refOf(s), last: s.last, lastAt: s.lastAt, open: s.open, high: s.high, low: s.low, cumVol: s.cumVol, cumAmt: s.cumAmt, vwap: vwapOf(s), atAsk: s.atAsk, atBid: s.atBid, book: s.book, bookAt: s.bookAt, tape: s.tape.slice(-40), limitUp: s.limitUp }; },
    setPrep(next) { const av = new Map([...info.avgVolume, ...(next.avgVolume || [])]), aa = new Map([...info.avgAmount, ...(next.avgAmount || [])]); info = { ...info, ...next, avgVolume: av, avgAmount: aa }; },
    setSettings(next) { cfg = normalizeDaytrade(next); },
    setWatch(next) { watch = next; },
    setScan(next) { scan = next; },
    // 斷線：這些股票在補完資料前不發訊號；feed：連線是否正常
    markGap(list) { for (const id of list) { gaps.add(id); const s = S.get(id); if (s) { s.books = []; s.obi = []; } } },
    setFeed(ok) { feedOk = !!ok; },
    get gaps() { return gaps; },
    get ids() { return [...S.keys()]; },
    modOf, hmsOf, phase: now => phase(modOf(now)),
    // 大盤環境（只記錄）：指數快照、富果指數 1 分 K、漲跌家數；目前狀態（介面顯示用）
    indexSample: (key, x) => market.sample(key, x), indexSeries: (key, x) => market.series(key, x), indexBreadth: (key, x) => market.breadth(key, x),
    indexAge: (key, now) => market.age(key, now), indexHasOpen: key => market.hasOpen(key),
    marketState(now) { return Object.fromEntries(INDEX_KEYS.map(k => { const x = market.state(k, now); return [k, x && { ...x, regime: x.stale ? null : regimeOf(x) }]; })); },
  };
}
const usTime = v => { const n = Number(v); return n > 1e14 ? n / 1000 : n > 1e11 ? n : n > 0 ? n * 1000 : 0; };

/* ---------- 收盤後檢討 ---------- */
// 每個訊號：以訊號價加滑價買進，於 5／15／30 分鐘後與收盤時以收盤價減滑價賣出，扣除手續費與證交稅的淨報酬（%）；
// 另記 30 分鐘內最大有利／不利幅度。bars：Map(分鐘 → 分 K)
export function evaluateSignal(sig, bars, p, costs) {
  if (sig.purpose === 'risk') return null;
  const list = [...bars.values()].filter(b => b.c != null).sort((a, b) => a.m - b.m), cost = roundTripCost(costs);
  const entry = sig.price + tickSize(p, sig.price) * costs.slipTicks, after = list.filter(b => b.m > sig.m);
  const exitAt = h => { const b = after.filter(x => x.m <= sig.m + h).at(-1); return b ? b.c : null; };
  const net = x => x == null ? null : round(((x - tickSize(p, x) * costs.slipTicks) / entry - 1) * 100 - cost);
  const w = after.filter(b => b.m <= sig.m + 30), hi = w.length ? Math.max(...w.map(b => b.h)) : null, lo = w.length ? Math.min(...w.map(b => b.l)) : null;
  return { r5: net(exitAt(5)), r15: net(exitAt(15)), r30: net(exitAt(30)), rClose: net(list.at(-1)?.c ?? null), mfe: hi == null ? null : round((hi / entry - 1) * 100), mae: lo == null ? null : round((lo / entry - 1) * 100), cost: round(cost, 3) };
}
// 多日訊號紀錄的統計：每種訊號的次數、15 分鐘勝率與平均淨報酬；v2 做多訊號另依訊號當下的大盤環境與相對強弱分組
const summarize = xs => {
  const avg = k => { const v = xs.map(o => o[k]).filter(n => n != null); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null; }, v15 = xs.filter(o => o.r15 != null);
  return { n: xs.length, win15: v15.length ? round(v15.filter(o => o.r15 > 0).length / v15.length * 100, 0) : null, r5: avg('r5'), r15: avg('r15'), r30: avg('r30'), rClose: avg('rClose'), mfe: avg('mfe'), mae: avg('mae') };
};
const groupBy = (list, keyOf, keys) => keys.map(key => ({ key, ...summarize(list.filter(s => keyOf(s) === key).map(s => s.outcome)) }));
export function reviewStats(days) {
  const by = new Map(), v2 = [];
  for (const d of days) for (const s of d.signals || []) {
    if (!s.outcome || s.purpose === 'risk') continue;
    const key = `${s.version || 1}:${s.type}`; let x = by.get(key); if (!x) by.set(key, x = { type: s.type, version: s.version || 1, list: [] }); x.list.push(s);
    if (s.version === 2) v2.push({ ...s, date: d.date });
  }
  const regimeRows = [...REGIMES, 'none'], types = [...by.values()].map(({ type, version, list }) => ({ type, version, title: signalTitle({ type, version }), ...summarize(list.map(s => s.outcome)),
    ...(version === 2 ? { regimes: Object.fromEntries(groupBy(list, regimeKey, regimeRows).map(({ key, ...x }) => [key, x])) } : {}) }));
  const recorded = v2.filter(s => s.market), complete = recorded.filter(s => regimeOf(s.market));
  return { days: days.length, signals: types.reduce((a, t) => a + t.n, 0), types: types.sort((a, b) => b.n - a.n), byDay: days.map(d => ({ date: d.date, n: (d.signals || []).length })),
    market: { signals: v2.length, recorded: complete.length, since: recorded.map(s => s.date).filter(Boolean).sort()[0] || null, rules: MARKET_RULES,
      regimes: groupBy(v2, regimeKey, regimeRows), strength: groupBy(v2, strengthKey, [...STRENGTHS, 'none']) } };
}
