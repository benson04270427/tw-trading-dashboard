// 訊號面板（台股、美股，日線）：ATR 追蹤線（SuperTrend）翻多／翻空當作買賣訊號，
// 加上日／週／月三個週期的趨勢共振、ADX 趨勢強度、波動狀態、量能流向，整理成信心分數與交易計畫
// （進場價、停損 1.5 倍 ATR、停利 1.5R／2.5R／4R、追蹤停損），可依設定的資金與每筆風險換算建議張數。
// 純計算；日 K 取自研究名單的本機資料，盤中以即時快照暫代今天的 K 棒（標示為暫定）。
import { roundTick } from './markets.mjs';

export const SIGNAL_VERSION = '1.0';
export const DEFAULTS = { stPeriod: 10, stMult: 3, atrPeriod: 14, stopAtr: 1.5, targets: [1.5, 2.5, 4], adxPeriod: 14, freshBars: 5 };
const num = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const day = d => String(d || '').slice(0, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 日 K → [{ date, open, high, low, close, volume }]（依日期排序，同日以後者為準）
export function toBars(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const c = num(r.close); if (!(c > 0)) continue;
    const h = num(r.max ?? r.high) ?? c, l = num(r.min ?? r.low) ?? c;
    m.set(day(r.date), { date: day(r.date), open: num(r.open) ?? c, high: Math.max(h, c), low: Math.min(l, c), close: c, volume: num(r.Trading_Volume ?? r.volume) ?? 0 });
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
// 日 K 合併成週 K（週一為一週開始）或月 K
export function resample(bars, unit) {
  const key = d => {
    if (unit === 'month') return d.slice(0, 7);
    const t = Date.parse(d + 'T00:00:00Z'), w = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - w * 864e5).toISOString().slice(0, 10);
  };
  const out = new Map();
  for (const b of bars) {
    const k = key(b.date), o = out.get(k);
    if (!o) out.set(k, { ...b }); else { o.high = Math.max(o.high, b.high); o.low = Math.min(o.low, b.low); o.close = b.close; o.volume += b.volume; o.date = b.date; }
  }
  return [...out.values()];
}

// 真實波幅與 Wilder 平均（前 n 根取簡單平均）
const trueRange = bars => bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low);
function wilder(values, n) {
  const out = new Array(values.length).fill(null); let s = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < n) { s += values[i]; if (i === n - 1) out[i] = s / n; continue; }
    out[i] = (out[i - 1] * (n - 1) + values[i]) / n;
  }
  return out;
}
export const atr = (bars, n = 14) => wilder(trueRange(bars), n);

// SuperTrend：中價 ± 倍數 × ATR，價格收破另一側時翻轉；回傳每根的方向（1 多、-1 空）與追蹤線
export function supertrend(bars, period = 10, mult = 3) {
  const a = atr(bars, period), dir = new Array(bars.length).fill(null), line = new Array(bars.length).fill(null);
  let up = null, dn = null, d = 1;
  for (let i = 0; i < bars.length; i++) {
    if (a[i] == null) continue;
    const mid = (bars[i].high + bars[i].low) / 2, bu = mid - mult * a[i], bd = mid + mult * a[i], pc = i ? bars[i - 1].close : bars[i].close;
    const nu = up == null || bu > up || pc < up ? bu : up, nd = dn == null || bd < dn || pc > dn ? bd : dn;
    if (up != null) { if (d === -1 && bars[i].close > dn) d = 1; else if (d === 1 && bars[i].close < up) d = -1; }
    else d = bars[i].close >= mid ? 1 : -1;
    up = nu; dn = nd; dir[i] = d; line[i] = d === 1 ? up : dn;
  }
  return { dir, line, atr: a };
}

// ADX（Wilder）：趨勢強度，不分多空
export function adx(bars, n = 14) {
  const pdm = [0], mdm = [0];
  for (let i = 1; i < bars.length; i++) {
    const u = bars[i].high - bars[i - 1].high, d = bars[i - 1].low - bars[i].low;
    pdm.push(u > d && u > 0 ? u : 0); mdm.push(d > u && d > 0 ? d : 0);
  }
  const tr = wilder(trueRange(bars), n), p = wilder(pdm, n), m = wilder(mdm, n);
  const dx = bars.map((_, i) => { if (!tr[i]) return null; const pi = p[i] / tr[i] * 100, mi = m[i] / tr[i] * 100; return pi + mi ? Math.abs(pi - mi) / (pi + mi) * 100 : 0; });
  const first = dx.findIndex(v => v != null), out = new Array(bars.length).fill(null);
  if (first < 0) return out;
  const tail = wilder(dx.slice(first), n); tail.forEach((v, i) => { out[first + i] = v; });
  return out;
}

const ema = (values, n) => { const k = 2 / (n + 1); let e = null; return values.map(v => (e = e == null ? v : v * k + e * (1 - k))); };
// 單一週期的趨勢：收盤在 n 期指數均線之上且均線上揚為多，反之為空，其餘為中性
export function trendOf(bars, n = 20) {
  if (bars.length < n + 3) return null;
  const e = ema(bars.map(b => b.close), n), last = bars.at(-1).close, now = e.at(-1), before = e.at(-4);
  return last > now && now > before ? 1 : last < now && now < before ? -1 : 0;
}

// 近 n 日量能流向：上漲日成交量占比（%）
export function volumeFlow(bars, n = 20) {
  let up = 0, dn = 0;
  for (let i = Math.max(1, bars.length - n); i < bars.length; i++) { const c = bars[i].close - bars[i - 1].close; if (c > 0) up += bars[i].volume; else if (c < 0) dn += bars[i].volume; }
  if (!(up + dn)) return null;
  const share = up / (up + dn) * 100;
  return { up: r1(share), label: share >= 55 ? '多方主導' : share <= 45 ? '空方主導' : '多空均衡', pct: Math.round(share >= 50 ? share : 100 - share), tone: share >= 55 ? 1 : share <= 45 ? -1 : 0 };
}

// 從訊號那根往後追蹤：停損、停利 1～3 是否觸及（同一根同時觸及停損與停利時，保守以停損計）
export function track(bars, i, dir, stop, tps) {
  let hit = 0, stopped = null;
  for (let j = i + 1; j < bars.length; j++) {
    const b = bars[j], adverse = dir > 0 ? b.low <= stop : b.high >= stop;
    if (adverse && !hit) { stopped = b.date; break; }
    while (hit < tps.length && (dir > 0 ? b.high >= tps[hit] : b.low <= tps[hit])) hit++;
  }
  return { hit, stopped };
}

// 建議部位：每筆可承受虧損 ÷ 每股風險，台股換算成張（不足一張時列出零股），並以總資金為上限
export function sizing({ capital, riskPct } = {}, entry, risk, lot = 1) {
  if (!(capital > 0) || !(riskPct > 0) || !(risk > 0) || !(entry > 0)) return null;
  const budget = capital * riskPct / 100, shares = Math.floor(Math.min(budget / risk, capital / entry));
  const lots = lot > 1 ? Math.floor(shares / lot) : null, oneLot = risk * lot;
  return { budget: Math.round(budget), shares, lots, odd: lot > 1 ? shares - lots * lot : null, risk: Math.round(shares * risk), oneLotRisk: Math.round(oneLot), over: lot > 1 && oneLot > budget, lot };
}

export function buildSignal({ id, name = '', rows = [], live = null, today, p, settings = {}, opts = {} } = {}) {
  const o = { ...DEFAULTS, ...opts }, list = toBars(rows);
  // 盤中：以即時快照暫代今天的 K 棒（收盤後由日 K 取代）
  let provisional = false;
  if (live && num(live.close) > 0 && day(live.date) === today && (!list.length || list.at(-1).date < today)) {
    const c = num(live.close), lot = p?.lot || 1;
    list.push({ date: today, open: num(live.open) ?? c, high: Math.max(num(live.high) ?? c, c), low: Math.min(num(live.low) ?? c, c), close: c, volume: (num(live.total_volume) ?? 0) * (lot > 1 ? lot : 1) });
    provisional = true;
  }
  if (list.length < Math.max(o.stPeriod, o.atrPeriod, o.adxPeriod * 2) + 5) return { id, name, available: false, reason: '日 K 不足，無法計算訊號' };
  const tick = v => { if (v == null || !Number.isFinite(v)) return null; if (!p) return r2(v); const hi = roundTick(p, v, true), lo = roundTick(p, v, false); return v - lo <= hi - v ? lo : hi; };
  const st = supertrend(list, o.stPeriod, o.stMult), a14 = atr(list, o.atrPeriod), ax = adx(list, o.adxPeriod), n = list.length - 1;
  const cur = list[n], dir = st.dir[n];
  // 歷次翻轉（訊號）
  const flips = []; for (let i = 1; i <= n; i++) if (st.dir[i] != null && st.dir[i - 1] != null && st.dir[i] !== st.dir[i - 1]) flips.push(i);
  const plan = i => {
    const d = st.dir[i], entry = list[i].close, R = o.stopAtr * (a14[i] ?? st.atr[i]);
    const stop = tick(entry - d * R), risk = Math.abs(entry - stop) || R, tps = o.targets.map(k => tick(entry + d * k * risk));
    return { i, dir: d, entry, stop, risk, tps };
  };
  // 歷史統計：過去每次訊號在下一次翻轉前是否先到 TP1
  const hist = flips.slice(0, -1).map((i, k) => { const pl = plan(i), end = flips[k + 1]; const tr = track(list.slice(0, end + 1), i, pl.dir, pl.stop, pl.tps); return tr.hit > 0 ? 'tp' : tr.stopped ? 'stop' : 'flat'; });
  const history = hist.length ? { trades: hist.length, tp1: hist.filter(x => x === 'tp').length, stopped: hist.filter(x => x === 'stop').length, rate: Math.round(hist.filter(x => x === 'tp').length / hist.length * 100) } : null;

  const last = flips.at(-1);
  let signal = null;
  if (last != null) {
    const pl = plan(last), tr = track(list, last, pl.dir, pl.stop, pl.tps), age = n - last, move = (cur.close - pl.entry) * pl.dir / pl.risk;
    const status = tr.stopped ? { kind: 'stopped', label: '已停損，等待新訊號' } : tr.hit >= pl.tps.length ? { kind: 'done', label: `已到 TP${pl.tps.length}，目標達成` } : tr.hit ? { kind: 'running', label: `已到 TP${tr.hit}，進行中` } : { kind: 'running', label: '進行中，尚未到 TP1' };
    const entryNow = tr.stopped ? { ok: false, label: '已停損，等待新訊號' } : tr.hit || move >= 0.75 ? { ok: false, label: '已遠離進場價，追價風險高' } : move <= -0.5 ? { ok: false, label: '接近停損，暫不進場' } : age <= o.freshBars ? { ok: true, label: '訊號有效，可評估進場' } : { ok: false, label: '訊號已久，等回測追蹤線' };
    signal = { side: pl.dir > 0 ? 'buy' : 'sell', label: pl.dir > 0 ? '買進' : '賣出', date: list[last].date, age, entry: pl.entry, stop: pl.stop, risk: r2(pl.risk), targets: pl.tps.map((v, k) => ({ price: v, r: o.targets[k], hit: tr.hit > k })), hit: tr.hit, stopped: tr.stopped, status, entryNow, moveR: r2(move) };
  }
  // 日／週／月趨勢共振
  // 均線：日 20（約一個月）、週 13（約一季）、月 6（半年）
  const frames = [['日', list, 20], ['週', resample(list, 'week'), 13], ['月', resample(list, 'month'), 6]].map(([label, b, len]) => ({ label, trend: trendOf(b, len) })).filter(f => f.trend != null);
  const bull = frames.filter(f => f.trend > 0).length, bear = frames.filter(f => f.trend < 0).length;
  const resonance = { frames, bull, bear, label: frames.length >= 2 && bull === frames.length ? '多方共振' : frames.length >= 2 && bear === frames.length ? '空方共振' : '無共振', tone: frames.length >= 2 && bull === frames.length ? 1 : frames.length >= 2 && bear === frames.length ? -1 : 0 };
  const weekly = frames.find(f => f.label === '週')?.trend ?? null, monthly = frames.find(f => f.label === '月')?.trend ?? null;
  // ADX、波動（ATR／價格在近 120 日的百分位）、量能
  const adxNow = r1(ax[n]), adxLabel = adxNow == null ? null : adxNow >= 30 ? '強' : adxNow >= 20 ? '中' : '弱';
  const regime = adxNow == null ? null : adxNow >= 30 ? '強勢趨勢' : adxNow >= 20 ? '趨勢中' : '盤整';
  const rel = list.map((b, i) => a14[i] != null ? a14[i] / b.close : null).slice(-120).filter(v => v != null);
  const relNow = a14[n] / cur.close, volPct = rel.length ? rel.filter(v => v < relNow).length / rel.length * 100 : null;
  const volatility = volPct == null ? null : { pct: Math.round(volPct), atrPct: r2(relNow * 100), label: volPct >= 80 ? '偏高' : volPct <= 20 ? '偏低' : '正常' };
  const flow = volumeFlow(list);
  // 信心分數（0～100）
  let confidence = null, align = null;
  if (signal) {
    const d = signal.side === 'buy' ? 1 : -1;
    align = weekly == null ? null : weekly === d ? 'with' : weekly === -d ? 'against' : 'neutral';
    let s = 40;
    if (weekly != null) s += weekly === d ? 15 : weekly === -d ? -15 : 0;
    if (monthly != null) s += monthly === d ? 10 : monthly === -d ? -10 : 0;
    if (adxNow != null) s += clamp((adxNow - 15) / 20, 0, 1) * 15;
    if (flow) s += clamp((flow.up - 50) * d / 25, -1, 1) * 10;
    if (volatility?.label === '偏高') s -= 5;
    s -= Math.min(10, signal.age);
    if (signal.stopped) s = Math.min(s, 20);
    confidence = Math.round(clamp(s, 0, 100));
  }
  const trail = tick(st.line[n]);
  const stance = dir > 0 ? { tone: 1, label: '偏多持有（跌破追蹤線就離場）' } : { tone: -1, label: '偏空，避開或減碼（站上追蹤線才轉多）' };
  // 以目前價格進場、停損仍設在訊號停損價時的建議部位（已停損或目標達成時不計算）
  const size = signal && !signal.stopped && signal.status.kind !== 'done' ? sizing(settings, cur.close, Math.abs(cur.close - signal.stop), p?.lot || 1) : null;
  // 小圖用：近 90 根 K 棒、追蹤線與訊號點
  const from = Math.max(0, n - 89);
  const chart = { bars: list.slice(from).map(b => [b.date, b.open, b.high, b.low, b.close]), line: st.line.slice(from).map((v, k) => v == null ? null : [r2(v), st.dir[from + k]]), flips: flips.filter(i => i >= from).map(i => [i - from, st.dir[i]]) };
  return { id, name, available: true, version: SIGNAL_VERSION, date: cur.date, provisional, price: cur.close, resonance, regime, adx: adxNow, adxLabel, volatility, flow, signal, align, confidence, trail, stance, size, history, settings: { capital: settings.capital || null, riskPct: settings.riskPct || null }, params: { stPeriod: o.stPeriod, stMult: o.stMult, stopAtr: o.stopAtr, targets: o.targets }, chart };
}

// 收盤後掃描：回傳「最新一根才出現」的新訊號（給自選股推播）
export function newSignal(sig) { return sig?.available && !sig.provisional && sig.signal && sig.signal.age === 0 ? sig.signal : null; }
export function normalizeSignalSettings(s = {}) {
  const capital = Number(s.capital), riskPct = Number(s.riskPct);
  return { capital: capital > 0 && capital <= 1e12 ? Math.round(capital) : null, riskPct: riskPct > 0 && riskPct <= 20 ? Math.round(riskPct * 100) / 100 : null, push: s.push !== false };
}
