import { activeMarket } from './config.mjs';
import { bucketEnd, hhmm } from './markets.mjs';
import { framePrice } from './replay.mjs';
// 籌碼深度：券商分點（TaiwanStockTradingDailyReport，Sponsor）、股權分散表（TaiwanStockHoldingSharesPer）；個股 K 線：日 K、分 K（TaiwanStockKBar／時光機畫格）。
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = v => Math.round(v * 100) / 100;

/* ---------- 券商分點 ---------- */
// rows：同一股票同一日、每個分點每個價位一列；buy/sell 單位為股。券商代號大小寫不同代表不同分點。
export function aggregateBrokers(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = String(r.securities_trader_id || ''); if (!id) continue;
    const b = map.get(id) || { id, name: String(r.securities_trader || id), buy: 0, sell: 0, buyAmt: 0, sellAmt: 0 };
    const p = num(r.price), buy = num(r.buy), sell = num(r.sell);
    b.buy += buy; b.sell += sell; b.buyAmt += buy * p; b.sellAmt += sell * p;
    map.set(id, b);
  }
  return [...map.values()].map(b => ({ ...b, net: b.buy - b.sell, avgBuy: b.buy ? r2(b.buyAmt / b.buy) : null, avgSell: b.sell ? r2(b.sellAmt / b.sell) : null }));
}
// days：[{ date, brokers }]，日期由舊到新。回傳最新一日排行、隔日沖分點、連續買賣超與主力集中度。
export function brokerAnalysis(days, { top = 10 } = {}) {
  if (!days.length) return null;
  const last = days.at(-1), prevDay = days.at(-2);
  const volume = last.brokers.reduce((a, b) => a + b.buy, 0);
  const byNet = [...last.brokers].sort((a, b) => b.net - a.net);
  const buy = byNet.filter(b => b.net > 0).slice(0, top), sell = byNet.filter(b => b.net < 0).reverse().slice(0, top);
  const netOf = (day, id) => day?.brokers.find(b => b.id === id)?.net ?? 0;
  // 隔日沖：前一日大買（≥ 當日成交 0.5% 且 ≥ 50 張），今日反手賣出前一日買量 60% 以上。
  const dayTraders = prevDay ? prevDay.brokers.filter(b => b.net >= Math.max(50000, volume * 0.005) && netOf(last, b.id) <= -0.6 * b.net)
    .map(b => ({ id: b.id, name: b.name, prevNet: b.net, net: netOf(last, b.id) })).sort((a, b) => b.prevNet - a.prevNet).slice(0, 8) : [];
  const flagged = new Set(dayTraders.map(b => b.id));
  const streak = id => { let n = 0, dir = Math.sign(netOf(last, id)); if (!dir) return 0; for (let i = days.length - 1; i >= 0; i--) { if (Math.sign(netOf(days[i], id)) === dir) n++; else break; } return n * dir; };
  const deco = b => ({ id: b.id, name: b.name, net: b.net, buy: b.buy, sell: b.sell, avgBuy: b.avgBuy, avgSell: b.avgSell, streak: streak(b.id), dayTrader: flagged.has(b.id),
    cumNet: days.reduce((a, d) => a + netOf(d, b.id), 0) });
  // 主力集中度 =（前 15 大買超 − 前 15 大賣超）÷ 當日成交量
  const buy15 = byNet.slice(0, 15).reduce((a, b) => a + Math.max(0, b.net), 0), sell15 = byNet.slice(-15).reduce((a, b) => a + Math.max(0, -b.net), 0);
  return {
    date: last.date, dates: days.map(d => d.date), brokerCount: last.brokers.length, volume,
    concentration: volume ? r2((buy15 - sell15) / volume * 100) : null,
    buy: buy.map(deco), sell: sell.map(deco), dayTraders,
  };
}

/* ---------- 股權分散表 ---------- */
// 分級字串例：'1-999'、'400,001-600,000'、'more than 1,000,001'、'total'、'差異數調整（說明4）'。單位為股。
function levelLower(level) {
  const s = String(level).replace(/,/g, '');
  if (/total/i.test(s) || /差異/.test(s)) return null;
  const m = /(\d+)/.exec(s); return m ? Number(m[1]) : null;
}
// 同一股票同一日的各分級列 → 千張大戶、400 張以上、50 張以下比例與股東人數
export function holderLevels(list) {
  let big1000 = 0, big400 = 0, small = 0, people = 0, peopleBig = 0;
  const total = list.find(r => /total/i.test(r.HoldingSharesLevel));
  for (const r of list) {
    const lo = levelLower(r.HoldingSharesLevel); if (lo == null) continue;
    const pct = num(r.percent);
    if (lo >= 1000001) { big1000 += pct; peopleBig += num(r.people); }
    if (lo >= 400001) big400 += pct;
    if (lo < 50001) small += pct;
    people += num(r.people);
  }
  return { big1000: r2(big1000), big400: r2(big400), small: r2(small), people: total ? num(total.people) : people, peopleBig };
}
export function parseHolders(rows) {
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, ...holderLevels(list) }));
}
export function holderSignal(series) {
  if (series.length < 2) return null;
  const last = series.at(-1), w1 = series.at(-2), w4 = series[Math.max(0, series.length - 5)];
  const d1 = r2(last.big1000 - w1.big1000), d4 = r2(last.big1000 - w4.big1000), dp = w4.people ? r2((last.people / w4.people - 1) * 100) : null;
  const tone = d4 >= 0.5 && (dp == null || dp <= 0) ? '籌碼集中' : d4 <= -0.5 && (dp == null || dp >= 0) ? '籌碼渙散' : '大致持平';
  return { d1, d4, peopleChange4w: dp, tone };
}

/* ---------- K 線：列格式一律為 [時間或日期, 開, 高, 低, 收, 量（顯示單位；台股為張）] ---------- */
// 一分 K（FinMind 以起始時間標示，09:00 代表 09:00–09:01）；date 有給時只留該日
export function kbarRows(rows, date) {
  return rows.filter(r => r.minute && Number(r.close) > 0 && (!date || !r.date || String(r.date).slice(0, 10) === date)).map(r => [String(r.minute).slice(0, 5), num(r.open), num(r.high), num(r.low), num(r.close), num(r.volume)]);
}
const mins = t => { const [a, b] = String(t).split(':').map(Number); return a * 60 + b; };
// 時光機畫格 → 一分 K（以結束時間標示）：開盤取前一畫格收盤、第一根用當日開盤價，高低為近似值；
// 量取累計成交量差額，舊紀錄沒有成交量時以成交金額差額 ÷ 價格 ÷ 交易單位估算。tick：最新快照，併入進行中的那一分鐘。
export function replayMinuteBars(day, id, { open = null, tick = null, market = activeMarket() } = {}) {
  const i = day?.ids?.indexOf(id) ?? -1, rows = [], as = day?.as || 1e6, est = (da, c) => Math.max(0, Math.round(da * as / c / market.lot));
  let last = null, cv = null, ca = 0;
  if (i >= 0) for (const f of day.frames) {
    const c = framePrice(day, f, i); if (!(c > 0)) continue;
    const a = f.a[i], v = f.v ? f.v[i] : null;
    const vol = !rows.length ? v ?? est(a, c) : v != null && cv != null ? Math.max(0, v - cv) : est(a - ca, c);
    const o = last ?? (open > 0 ? open : c);
    rows.push([f.t, o, Math.max(o, c), Math.min(o, c), c, vol]);
    last = c; cv = v; ca = a;
  }
  if (tick?.close > 0) {
    const c = tick.close, end = rows.at(-1);
    const vol = cv != null && tick.volume != null ? Math.max(0, tick.volume - cv) : est((tick.amount || 0) / as - ca, c);
    if (!end) { const o = open > 0 ? open : c; rows.push([tick.t, o, Math.max(o, c, tick.high || 0), Math.min(o, c, tick.low || c), c, tick.volume ?? 0]); }
    else if (tick.t > end[0]) rows.push([tick.t, end[4], Math.max(end[4], c), Math.min(end[4], c), c, vol]);
    else if (tick.t === end[0]) { end[2] = Math.max(end[2], c); end[3] = Math.min(end[3], c); end[4] = c; }
  }
  return rows;
}
// 一分 K → 五分 K（以結束時間標示，例如台股 09:05…13:30；收盤集合競價併入最後一根，有午休的市場各時段分開計算）。
// start：資料以起始時間標示（FinMind、Fugle、Twelve Data 等分 K）
export function fiveMinBars(rows, { start = false, market = activeMarket(), size = 5 } = {}) {
  const out = [], map = new Map();
  for (const r of rows) {
    const k = hhmm(bucketEnd(market, mins(r[0]) + (start ? 1 : 0), size)), x = map.get(k);
    if (!x) { const bar = [k, r[1], r[2], r[3], r[4], r[5]]; map.set(k, bar); out.push(bar); }
    else { x[2] = Math.max(x[2], r[2]); x[3] = Math.min(x[3], r[3]); x[4] = r[4]; x[5] += r[5]; }
  }
  return out;
}
// 日成交（成交量為股數）→ 日 K（量換成顯示單位，台股為張）
export function dailyKRows(list, market = activeMarket()) {
  return list.filter(r => num(r.close) > 0).map(r => [String(r.date).slice(0, 10), num(r.open) || num(r.close), num(r.max) || num(r.close), num(r.min) || num(r.close), num(r.close), Math.round(num(r.Trading_Volume) / market.lot)]);
}
// 時光機當日畫格 → 當日日 K（盤後尚未取得日成交資料時使用，高低為近似值）
export function replayDayBar(day, id, market = activeMarket()) {
  const b = replayMinuteBars(day, id, { market }); if (!b.length) return null;
  return [day.date, b[0][1], Math.max(...b.map(x => x[2])), Math.min(...b.map(x => x[3])), b.at(-1)[4], b.reduce((s, x) => s + x[5], 0)];
}