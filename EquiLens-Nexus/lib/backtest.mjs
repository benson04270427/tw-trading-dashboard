// 策略回測：把訊號面板、價值區／升溫區、每日精選的規則套到歷史資料，算平均報酬、勝率與最大回撤。純計算。
//   訊號策略：研究名單每檔的本機日 K（約 1～2 年），ATR 追蹤線翻多時以收盤買進（只做多），
//             跌破停損（進場價 − 1.5 倍 ATR）或追蹤線翻空時賣出。
//   入選策略：每天保存的價值區、升溫區、每日精選名單，以當天收盤買進、持有固定交易日數後賣出；
//             價格取自每天保存的收盤熱浪圖，紀錄從開始保存的那天起累積。
// 組合報酬：每天把資金平均分配給當天持有中的部位（沒有部位時持有現金），算出每日報酬再連乘，最大回撤由這條權益曲線計算。
// 不含手續費、稅與滑價；過去績效不代表未來。
import { toBars, supertrend, atr, DEFAULTS } from './signal.mjs';

export const BACKTEST_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;

// 單檔訊號交易：回傳 [{ id, entryDate, exitDate, entry, exit, ret, reason, path }]
export function signalTrades(id, rows, o = DEFAULTS) {
  const bars = toBars(rows); if (bars.length < 60) return [];
  const st = supertrend(bars, o.stPeriod, o.stMult), a = atr(bars, o.atrPeriod), out = [];
  let pos = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      pos.path.push([b.date, b.close]);
      if (b.low <= pos.stop) { const px = Math.min(b.open, pos.stop); pos.path[pos.path.length - 1] = [b.date, px]; out.push(close(pos, b.date, px, 'stop')); pos = null; continue; }
      if (st.dir[i] === -1 && st.dir[i - 1] === 1) { out.push(close(pos, b.date, b.close, 'flip')); pos = null; continue; }
    }
    if (!pos && st.dir[i] === 1 && st.dir[i - 1] === -1 && a[i] != null) pos = { id, entryDate: b.date, entry: b.close, stop: b.close - o.stopAtr * a[i], path: [[b.date, b.close]] };
  }
  if (pos) out.push({ ...close(pos, bars.at(-1).date, bars.at(-1).close, 'open'), open: true });
  return out;
}
const close = (p, date, px, reason) => ({ id: p.id, entryDate: p.entryDate, exitDate: date, entry: r2(p.entry), exit: r2(px), ret: r2((px / p.entry - 1) * 100), days: p.path.length - 1, reason, path: p.path });

// 入選名單的交易：entries＝[{ id, date, close }]，prices＝Map(date → Map(id → close))，持有 hold 個交易日
export function holdTrades(entries, prices, hold = 20) {
  const dates = [...prices.keys()].sort(), at = new Map(dates.map((d, i) => [d, i])), out = [];
  for (const e of entries) {
    const i = at.get(e.date); if (i == null) continue;
    const entry = e.close ?? prices.get(e.date)?.get(e.id); if (!(entry > 0)) continue;
    const path = [[e.date, entry]]; let j = i;
    while (j < dates.length - 1 && path.length <= hold) { j++; const c = prices.get(dates[j])?.get(e.id); if (c > 0) path.push([dates[j], c]); }
    if (path.length < 2) continue;
    const last = path.at(-1), done = path.length > hold;
    out.push({ id: e.id, name: e.name, entryDate: e.date, exitDate: last[0], entry: r2(entry), exit: r2(last[1]), ret: r2((last[1] / entry - 1) * 100), days: path.length - 1, reason: done ? 'hold' : 'open', open: !done, path });
  }
  return out;
}
// 組合權益曲線：每天平均分配給持有中的部位
export function equity(trades, calendar = null) {
  const daily = new Map();
  for (const t of trades) for (let k = 1; k < t.path.length; k++) { const [d, c] = t.path[k], p = t.path[k - 1][1]; if (!(p > 0)) continue; const x = daily.get(d) || []; x.push(c / p - 1); daily.set(d, x); }
  const dates = calendar || [...new Set([...daily.keys(), ...trades.map(t => t.entryDate)])].sort();
  let eq = 1, peak = 1, mdd = 0, active = 0; const curve = [];
  for (const d of dates) { const x = daily.get(d); if (x?.length) { eq *= 1 + x.reduce((a, b) => a + b, 0) / x.length; active++; } peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); curve.push([d, r2((eq - 1) * 100)]); }
  return { total: r2((eq - 1) * 100), mdd: r2(mdd * 100), activeDays: active, days: dates.length, curve };
}
export function stats(trades) {
  const done = trades.filter(t => !t.open), r = done.map(t => t.ret).sort((a, b) => a - b);
  if (!r.length) return { trades: 0, open: trades.length - done.length };
  const win = r.filter(v => v > 0), loss = r.filter(v => v <= 0), sum = a => a.reduce((x, y) => x + y, 0);
  return { trades: r.length, open: trades.length - done.length, winRate: r1(win.length / r.length * 100), avg: r2(sum(r) / r.length), median: r2(r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2),
    best: r.at(-1), worst: r[0], avgWin: win.length ? r2(sum(win) / win.length) : null, avgLoss: loss.length ? r2(sum(loss) / loss.length) : null,
    profitFactor: loss.length && sum(loss) < 0 ? r2(sum(win) / -sum(loss)) : null, avgDays: r1(sum(done.map(t => t.days)) / done.length) };
}
// 區間內指數報酬（比較基準）
export function benchmark(index = [], from, to) {
  const s = index.filter(x => x[0] >= from && x[0] <= to); return s.length >= 2 ? r2((s.at(-1)[1] / s[0][1] - 1) * 100) : null;
}
// 一個策略的完整結果（曲線每 2 個點取 1 個以縮小資料量）
export function report({ key, name, trades, index = [], calendar = null, minTrades = 20 }) {
  const eq = equity(trades, calendar), from = eq.curve[0]?.[0], to = eq.curve.at(-1)?.[0], s = stats(trades);
  const thin = eq.curve.length > 300 ? eq.curve.filter((_, i) => i % 2 === 0 || i === eq.curve.length - 1) : eq.curve;
  const bm = from ? index.filter(x => x[0] >= from && x[0] <= to) : [], base = bm[0]?.[1];
  return { key, name, ...s, total: eq.total, mdd: eq.mdd, exposure: eq.days ? r1(eq.activeDays / eq.days * 100) : null, from, to, benchmark: benchmark(index, from, to), enough: s.trades >= minTrades,
    curve: thin, bench: base ? bm.filter((_, i) => bm.length <= 300 || i % 2 === 0).map(x => [x[0], r2((x[1] / base - 1) * 100)]) : [],
    recent: [...trades].sort((a, b) => b.entryDate.localeCompare(a.entryDate)).slice(0, 12).map(({ path, ...t }) => t) };
}
