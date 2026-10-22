// 個股判讀卡（台股）：漲跌停狀態、撐壓位（前一交易日樞紐點）、三大法人近 20 日、融資，整理成幾句綜合判讀。
// 純計算；日 K 與法人取自研究名單的本機資料，盤中價格取自即時快照或推播，融資由 FinMind 取得（免費等級即可）。
import { limitPrices, roundTick } from './markets.mjs';

const num = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const day = d => String(d || '').slice(0, 10);

// 日 K：[{ date, open, high, low, close, amount }]，依日期排序、去除無效列
export function bars(rows = []) {
  const m = new Map();
  for (const r of rows) { const c = num(r.close); if (c > 0) m.set(day(r.date), { date: day(r.date), open: num(r.open), high: num(r.max ?? r.high), low: num(r.min ?? r.low), close: c, amount: num(r.Trading_money) }); }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
// 樞紐點：P＝（高＋低＋收）÷ 3，壓力＝2P − 低，支撐＝2P − 高（依跳動單位取整）
export function pivots(b, p) {
  if (!b || !(b.high > 0) || !(b.low > 0)) return null;
  const P = (b.high + b.low + b.close) / 3, tick = v => { if (!p) return r2(v); const hi = roundTick(p, v, true), lo = roundTick(p, v, false); return v - lo <= hi - v ? lo : hi; };
  return { from: b.date, pivot: tick(P), resistance: tick(2 * P - b.low), support: tick(2 * P - b.high) };
}
// 漲跌停狀態：鎖住（收在漲停價）、打開（曾觸及但沒收在漲停）
export function limitState(cur, prevClose, p) {
  const lim = p ? limitPrices(p, prevClose) : null; if (!lim || !cur) return null;
  const eq = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;
  if (eq(cur.close, lim.up)) return { kind: 'up-locked', label: '漲停鎖住', price: lim.up };
  if (eq(cur.high, lim.up)) return { kind: 'up-open', label: '漲停打開', price: lim.up };
  if (eq(cur.close, lim.down)) return { kind: 'down-locked', label: '跌停鎖住', price: lim.down };
  if (eq(cur.low, lim.down)) return { kind: 'down-open', label: '跌停打開', price: lim.down };
  return null;
}
// 三大法人近 n 日：每日淨買賣（億元，張數 × 當日收盤）與外資／投信／自營合計
const GROUP = { Foreign_Investor: 'foreign', Foreign_Dealer_Self: 'foreign', Investment_Trust: 'trust', Dealer: 'dealer', Dealer_self: 'dealer', Dealer_Hedging: 'dealer' };
export function institutions(rows = [], barList = [], n = 20) {
  const close = new Map(barList.map(b => [b.date, b.close])), days = new Map();
  for (const r of rows) {
    const g = GROUP[r.name]; if (!g) continue; const d = day(r.date);
    if (!days.has(d)) days.set(d, { foreign: 0, trust: 0, dealer: 0, hasDealer: false });
    const x = days.get(d), net = (num(r.buy) ?? 0) - (num(r.sell) ?? 0);
    if (r.name === 'Dealer') { x.dealer = net; x.hasDealer = true; } else if (!(g === 'dealer' && x.hasDealer)) x[g] += net;
  }
  const list = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-n).map(([date, x]) => {
    const c = close.get(date), amt = v => c ? r2(v * c / 1e8) : null;
    return { date, lots: Math.round((x.foreign + x.trust + x.dealer) / 1000), amount: amt(x.foreign + x.trust + x.dealer), foreign: amt(x.foreign), trust: amt(x.trust), dealer: amt(x.dealer) };
  });
  if (!list.length) return null;
  const sum = k => r1(list.reduce((s, x) => s + (x[k] ?? 0), 0)), buy = list.filter(x => x.lots > 0).length, sell = list.filter(x => x.lots < 0).length;
  let streak = 0; const sgn = Math.sign(list.at(-1).lots); for (let i = list.length - 1; i >= 0 && sgn && Math.sign(list[i].lots) === sgn; i--) streak++;
  const total = sum('amount'), tone = buy >= list.length * 0.7 && total > 0 ? 'add' : sell >= list.length * 0.7 && total < 0 ? 'cut' : total > 0 ? 'lean-buy' : total < 0 ? 'lean-sell' : 'flat';
  return { days: list.length, asOf: list.at(-1).date, buyDays: buy, sellDays: sell, streak: streak * sgn, total, foreign: sum('foreign'), trust: sum('trust'), dealer: sum('dealer'), tone, label: { add: '持續加碼', cut: '持續減碼', 'lean-buy': '偏多', 'lean-sell': '偏空', flat: '持平' }[tone], list };
}
// 融資（張）：FinMind TaiwanStockMarginPurchaseShortSale
export function margin(rows = []) {
  const list = rows.map(r => ({ date: day(r.date), bal: num(r.MarginPurchaseTodayBalance), limit: num(r.MarginPurchaseLimit) })).filter(r => r.bal != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const last = list.at(-1), prev = list.at(-2), p5 = list.length > 5 ? list.at(-6) : null;
  return { asOf: last.date, balance: last.bal, d1: prev ? last.bal - prev.bal : null, d5: p5 ? last.bal - p5.bal : null, usage: last.limit > 0 ? r1(last.bal / last.limit * 100) : null };
}

export function buildVerdict({ id, name, sector = '', groups = [], rows = [], inst = [], marginRows = [], live = null, today, p } = {}) {
  const list = bars(rows);
  // 目前價格：盤中用即時資料；沒有時用最後一根日 K
  let cur = null, session = 'close';
  if (live && num(live.close) > 0 && day(live.date) === today) { cur = { date: today, open: num(live.open), high: num(live.high), low: num(live.low), close: num(live.close), amount: num(live.total_amount) }; session = 'live'; }
  else if (list.length) cur = list.at(-1);
  if (!cur) return { id, name, available: false };
  const before = list.filter(b => b.date < cur.date), prevBar = before.at(-1) || null, prevClose = prevBar?.close ?? (live ? num(live.close) - num(live.change_price) : null);
  const change = prevClose ? r2(cur.close - prevClose) : null, pct = prevClose ? r2((cur.close / prevClose - 1) * 100) : null;
  const lim = limitState(cur, prevClose, p), lv = pivots(prevBar, p), ins = institutions(inst, list), mg = margin(marginRows);
  let pos = null;
  if (lv) { const span = lv.resistance - lv.support; pos = { pct: span > 0 ? Math.max(0, Math.min(100, (cur.close - lv.support) / span * 100)) : 50, toR: r1((lv.resistance / cur.close - 1) * 100), toS: r1((cur.close / lv.support - 1) * 100), above: cur.close > lv.resistance, below: cur.close < lv.support }; }
  // 綜合判讀
  const points = [];
  if (lim) points.push({ tone: lim.kind.startsWith('up') ? 'up' : 'down', text: `${session === 'live' ? '今日' : day(cur.date).slice(5).replace('-', '/') + ' '}${lim.label}` });
  if (pos) points.push(pos.above ? { tone: 'up', text: '現價已站上壓力位' } : pos.below ? { tone: 'down', text: '現價已跌破支撐位' } : pos.pct >= 70 ? { tone: 'flat', text: `接近壓力位（距壓力 ${pos.toR}%）` } : pos.pct <= 30 ? { tone: 'flat', text: `接近支撐位（距支撐 ${pos.toS}%）` } : { tone: 'flat', text: '在支撐與壓力之間整理' });
  if (ins) points.push({ tone: ins.total > 0 ? 'up' : ins.total < 0 ? 'down' : 'flat', text: ins.tone === 'add' ? `法人近 ${ins.days} 日持續加碼（買超 ${ins.buyDays} 天）` : ins.tone === 'cut' ? `法人近 ${ins.days} 日持續減碼（賣超 ${ins.sellDays} 天）` : `法人近 ${ins.days} 日${ins.total >= 0 ? '淨買' : '淨賣'} ${Math.abs(ins.total)} 億${Math.abs(ins.streak) >= 3 ? `，連 ${Math.abs(ins.streak)} 日${ins.streak > 0 ? '買' : '賣'}超` : ''}` });
  if (mg?.d5 != null && mg.balance > 0 && Math.abs(mg.d5) / mg.balance >= 0.05) points.push({ tone: 'flat', text: `融資 5 日${mg.d5 > 0 ? '增加' : '減少'} ${Math.round(Math.abs(mg.d5 / mg.balance) * 100)}%${mg.d5 > 0 && pct != null && pct < 0 ? '，留意散戶接刀' : mg.d5 < 0 && ins?.total > 0 ? '，籌碼由散戶流向法人' : ''}` });
  return { id, name, sector, tags: [...new Set([sector, ...groups].filter(Boolean))], available: true, date: cur.date, session, price: cur.close, change, pct, amount: cur.amount, limit: lim, levels: lv ? { ...lv, ...pos, appliesTo: cur.date } : null, institutions: ins, margin: mg, points };
}
