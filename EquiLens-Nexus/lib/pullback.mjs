// 回檔買點（強勢股回測支撐）：參考 2025 美國投資錦標賽股票組冠軍 Martin Luk 公開分享的「回調買入法」，
// 把日線能判斷的部分寫成規則：① 強勢股 ② 上漲後進入整理 ③ 回到均線、前高、缺口、AVWAP 匯聚的支撐區。
// 分鐘線的進場訊號（突破前一根 K 高點）在日線回測中以「隔天突破今天高點」近似。
// 純計算，日 K 由 server.mjs 準備（{ date, open, max, min, close, Trading_Volume }，日期由舊到新）。

export const PULLBACK_VERSION = '1.0';

export const PB_DEFAULTS = {
  minRet: 0.30,      // 近 1／3／6 個月任一漲幅門檻
  topPct: 0.30,      // 漲幅排名前 30%
  lookbacks: [21, 63, 126],
  highWin: 40,       // 整理區高點：近 40 日最高點
  minBase: 3,        // 高點後至少整理 3 天
  maxDepth: 0.25,    // 自高點回檔不超過 25%
  minDepth: 0.03,    // 至少回檔 3%（不是一路噴出）
  contract: 0.9,     // 近 5 日平均振幅 ≤ 高點前後 10 日的 90%
  zoneSpan: 0.03,    // 支撐價位彼此差距 3% 以內算匯聚
  nearPct: 0.03,     // 收盤在支撐區上緣 3% 以內
  minLevels: 2,      // 至少 2 個支撐價位匯聚
  maxStopPct: 0.08,  // 停損距離超過 8% 不列入「接近買點」
};
export const PB_COST = { TW: 0.00585, US: 0.001 };
export const PB_MIN_VOL = { TW: 500000, US: 500000 }; // 近 20 日平均成交量（股）

const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const r3 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
const pct = v => v == null ? null : Math.round(v * 1000) / 10;

export function ema(values, n) {
  const k = 2 / (n + 1), out = new Array(values.length).fill(null);
  let e = null;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (!(v > 0)) { out[i] = e; continue; } e = e == null ? v : v * k + e * (1 - k); out[i] = i >= Math.min(n - 1, values.length - 1) ? e : null; }
  return out;
}

// 指標一次算好；之後逐日判斷只查陣列
export function prepare(rows) {
  const b = rows.filter(r => r.close > 0).map(r => ({ date: r.date, o: +r.open || +r.close, h: +r.max || +r.close, l: +r.min || +r.close, c: +r.close, v: +r.Trading_Volume || 0 }));
  const c = b.map(x => x.c);
  const rng = b.map((x, i) => i ? Math.max(x.h, b[i - 1].c) - Math.min(x.l, b[i - 1].c) : x.h - x.l);
  return { b, e9: ema(c, 9), e21: ema(c, 21), e50: ema(c, 50), rng };
}

export function returnsAt(p, i, lookbacks = PB_DEFAULTS.lookbacks) {
  return lookbacks.map(n => i >= n && p.b[i - n].c > 0 ? p.b[i].c / p.b[i - n].c - 1 : null);
}
const avgVol = (p, i, n = 20) => { const s = p.b.slice(Math.max(0, i - n + 1), i + 1); return s.length ? s.reduce((a, x) => a + x.v, 0) / s.length : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// 第 i 天的完整判斷。rank：{ r: [三個期間漲幅的百分位 0–1] }（由橫斷面算好傳入）
export function analyzeAt(p, i, { rank = null, opt = PB_DEFAULTS, minVol = 0 } = {}) {
  const { b, e9, e21, e50, rng } = p, x = b[i];
  if (!x || i < 60 || e21[i] == null) return null;
  const rets = returnsAt(p, i, opt.lookbacks), vol = avgVol(p, i);
  const hits = rets.map((r, k) => r != null && r >= opt.minRet && (!rank || (rank[k] != null && rank[k] >= 1 - opt.topPct)));
  const strong = hits.some(Boolean) && vol >= minVol;
  const out = { date: x.date, close: x.c, rets, vol, strong, stage: strong ? 'strong' : null, reasons: [] };
  if (!strong) return out;

  // ② 整理：近 highWin 日最高點之後
  let h = i; for (let k = Math.max(0, i - opt.highWin + 1); k <= i; k++) if (b[k].h >= b[h].h) h = k;
  const H = b[h].h, since = i - h;
  out.high = { date: b[h].date, price: H, days: since };
  if (since < opt.minBase) { out.reasons.push('剛創高，還沒進入整理'); return out; }
  let lowIdx = h + 1; for (let k = h + 1; k <= i; k++) if (b[k].l < b[lowIdx].l) lowIdx = k;
  const depth = (H - b[lowIdx].l) / H;
  // 高點後的轉折低點（左右各 2 根較高）
  const piv = []; for (let k = h + 1; k <= i - 1; k++) { const L = b[k].l; if (L <= Math.min(...b.slice(Math.max(h, k - 2), k).map(y => y.l), Infinity) && L <= Math.min(...b.slice(k + 1, Math.min(i, k + 2) + 1).map(y => y.l), Infinity)) piv.push(k); }
  const higherLows = piv.length < 2 ? b[i].l >= b[lowIdx].l : b[piv.at(-1)].l >= b[piv.at(-2)].l;
  const pre = mean(rng.slice(Math.max(0, h - 5), Math.min(i, h + 5) + 1)), recent = mean(rng.slice(i - 4, i + 1));
  const contracting = pre > 0 && recent <= pre * opt.contract;
  // 站穩：9 日在 21 日之上、收盤守住 21 日（容許 1%）；回測支撐時跌到 9 日下方是正常的
  const slope9 = e9[i] >= e9[i - 3] * 0.995, slope21 = e21[i] >= e21[i - 5] * 0.997;
  const above = e9[i] >= e21[i] && x.c >= e21[i] * 0.99;
  Object.assign(out, { depth: r3(depth), higherLows, contracting, contraction: pre > 0 ? r2(recent / pre) : null, above, slope9, slope21 });
  if (depth > opt.maxDepth) out.reasons.push('回檔超過 25%，結構已破壞');
  if (depth < opt.minDepth) out.reasons.push('回檔不到 3%，還在噴出');
  if (!higherLows) out.reasons.push('回檔低點沒有墊高');
  if (!contracting) out.reasons.push('波動還沒收斂');
  if (!above) out.reasons.push('收盤跌破 21 日 EMA，或 9 日 EMA 還在 21 日之下');
  if (!(slope9 && slope21)) out.reasons.push('9、21 日 EMA 沒有走平或向上');
  if (out.reasons.length) return out;
  out.stage = 'base';

  // ③ 支撐匯聚
  const levels = [{ key: 'ema9', price: e9[i] }, { key: 'ema21', price: e21[i] }];
  if (e50[i] != null) levels.push({ key: 'ema50', price: e50[i] });
  // AVWAP：從整理區高點那天起算
  let pv = 0, vv = 0; for (let k = h; k <= i; k++) { const tp = (b[k].h + b[k].l + b[k].c) / 3; pv += tp * b[k].v; vv += b[k].v; }
  if (vv > 0) levels.push({ key: 'avwap', price: pv / vv });
  // 前高：上漲前 120 日內、在高點之前的轉折高點，價位低於現價
  for (let k = Math.max(2, i - 120); k < h - 2; k++) { const y = b[k]; if (y.h >= b[k - 1].h && y.h >= b[k - 2].h && y.h >= b[k + 1].h && y.h >= b[k + 2].h && y.h < x.c && y.h > x.c * 0.88) levels.push({ key: 'priorHigh', price: y.h, date: y.date }); }
  // 未補缺口：近 60 日向上跳空，之後沒有回補（缺口上緣＝跳空那天的低點）
  for (let k = Math.max(1, i - 60); k <= i; k++) if (b[k].l > b[k - 1].h) { let filled = false; for (let m = k + 1; m <= i; m++) if (b[m].l <= b[k - 1].h) { filled = true; break; } if (!filled && b[k].l < x.c && b[k].l > x.c * 0.88) levels.push({ key: 'gap', price: b[k].l, date: b[k].date, bottom: b[k - 1].h }); }
  const below = levels.filter(l => l.price <= x.c * 1.01 && l.price >= x.c * 0.88).sort((a, c) => a.price - c.price);
  let best = null;
  for (let s = 0; s < below.length; s++) { const grp = []; for (let e = s; e < below.length && below[e].price <= below[s].price * (1 + opt.zoneSpan); e++) grp.push(below[e]); const kinds = new Set(grp.map(g => g.key === 'priorHigh' || g.key === 'gap' ? g.key : g.key)); if (!best || kinds.size > best.kinds || (kinds.size === best.kinds && grp.at(-1).price > best.top)) best = { kinds: kinds.size, lo: grp[0].price, top: grp.at(-1).price, levels: grp }; }
  out.levels = levels.map(l => ({ ...l, price: r2(l.price) }));
  if (!best || best.kinds < opt.minLevels) { out.reasons.push('支撐價位沒有匯聚'); return out; }
  out.zone = { lo: r2(best.lo), top: r2(best.top), keys: [...new Set(best.levels.map(l => l.key))] };
  const dist = (x.c - best.top) / x.c;
  out.distance = pct(dist);
  if (dist > opt.nearPct) { out.reasons.push('離支撐區還有一段距離'); return out; }
  if (x.l < best.lo * 0.99) { out.reasons.push('今天跌破支撐區'); return out; }
  // 第幾次回測：高點之後最低價碰到支撐區上緣的次數（連續幾天算一次）
  let touches = 0, inTouch = false; for (let k = h + 1; k <= i; k++) { const t = b[k].l <= best.top * 1.005; if (t && !inTouch) touches++; inTouch = t; }
  out.retest = Math.max(1, touches);
  // 交易計畫：觸發價＝今天高點（隔天突破才進場）；停損＝今天低點與支撐區下緣較低者再低 0.3%
  const trigger = x.h, stop = Math.min(x.l, best.lo) * 0.997, R = trigger - stop;
  out.plan = { trigger: r2(trigger), stop: r2(stop), stopPct: pct(R / trigger), r: r2(R), t3: r2(trigger + 3 * R), t5: r2(trigger + 5 * R) };
  if (R / trigger > opt.maxStopPct) { out.reasons.push('停損距離超過 8%，風險太大'); return out; }
  out.stage = 'near';
  return out;
}

// 橫斷面：同一天各檔三個期間漲幅的百分位
export function rankMaps(preps, lookbacks = PB_DEFAULTS.lookbacks) {
  const byDate = new Map();
  for (const [id, p] of preps) p.b.forEach((x, i) => { const r = returnsAt(p, i, lookbacks); if (!byDate.has(x.date)) byDate.set(x.date, []); byDate.get(x.date).push([id, r]); });
  const out = new Map(); // `${id}|${date}` → [pct...]
  for (const [date, list] of byDate) {
    for (let k = 0; k < lookbacks.length; k++) {
      const vals = list.map(([, r]) => r[k]).filter(v => v != null).sort((a, c) => a - c);
      for (const [id, r] of list) { const key = id + '|' + date; if (!out.has(key)) out.set(key, [null, null, null]); if (r[k] != null && vals.length >= 5) { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] <= r[k]) lo = m + 1; else hi = m; } out.get(key)[k] = (lo - 1) / Math.max(1, vals.length - 1); } }
    }
  }
  return out;
}

// 今日掃描：stocks = [{ id, name, sector, rows }]
export function scanPullback(stocks, { market = 'TW', opt = PB_DEFAULTS, account = null, riskPct = 0.005 } = {}) {
  const preps = new Map(stocks.map(s => [s.id, prepare(s.rows || [])]).filter(([, p]) => p.b.length >= 61));
  const ranks = rankMaps(preps, opt.lookbacks), minVol = PB_MIN_VOL[market] || 0;
  const rows = [], groupCount = new Map();
  for (const s of stocks) {
    const p = preps.get(s.id); if (!p) continue;
    const i = p.b.length - 1, a = analyzeAt(p, i, { rank: ranks.get(s.id + '|' + p.b[i].date), opt, minVol });
    if (!a?.strong) continue;
    rows.push({ id: s.id, name: s.name || s.id, sector: s.sector || '', ...a, rets: a.rets.map(pct) });
    if (s.sector) groupCount.set(s.sector, (groupCount.get(s.sector) || 0) + 1);
  }
  const asOf = rows.map(r => r.date).sort().at(-1) || null;
  for (const r of rows) {
    r.peers = groupCount.get(r.sector) || 0; r.groupStrong = r.peers >= 2; r.stale = asOf && r.date < asOf;
    if (r.plan && account > 0) { const risk = account * riskPct, sh = Math.floor(risk / r.plan.r); r.plan.shares = sh; r.plan.lots = market === 'TW' ? Math.floor(sh / 1000) : null; r.plan.cost = Math.round(sh * r.plan.trigger); r.plan.weight = pct(sh * r.plan.trigger / account); }
  }
  const order = { near: 0, base: 1, strong: 2 };
  rows.sort((a, c) => order[a.stage] - order[c.stage] || (c.groupStrong - a.groupStrong) || (Math.max(...c.rets.filter(v => v != null), 0) - Math.max(...a.rets.filter(v => v != null), 0)));
  const groups = [...groupCount.entries()].filter(([, n]) => n >= 2).sort((a, c) => c[1] - a[1]).map(([name, n]) => ({ name, n }));
  return { version: PULLBACK_VERSION, market, asOf, scanned: preps.size, counts: { near: rows.filter(r => r.stage === 'near').length, base: rows.filter(r => r.stage === 'base').length, strong: rows.length }, groups, rows };
}

// 回測：每檔同時最多一筆。第 i 天收盤判定「接近買點」→ 第 i+1 天突破第 i 天高點進場（開盤跳空就用開盤價）。
// 出場：跌破停損（跳空用開盤價）；到 3R 先賣一半；剩下收盤跌破 9 日 EMA 出場；最多抱 40 天。
// 進場當天又碰到停損，保守當作停損。每筆以 1R 計，報酬換算成 R 並扣交易成本。
export function backtestPullback(stocks, { market = 'TW', opt = PB_DEFAULTS, from = null, maxHold = 40, partialR = 3, partialPct = 0.5 } = {}) {
  const preps = new Map(stocks.map(s => [s.id, prepare(s.rows || [])]).filter(([, p]) => p.b.length >= 120));
  const ranks = rankMaps(preps, opt.lookbacks), minVol = PB_MIN_VOL[market] || 0, cost = PB_COST[market] ?? 0.003;
  // 市場寬度：當天收盤在 50 日 EMA 之上的比例（簡單的大盤強弱）
  const breadth = new Map(); for (const p of preps.values()) p.b.forEach((x, i) => { if (p.e50[i] == null || i < 50) return; const w = breadth.get(x.date) || [0, 0]; w[1]++; if (x.c > p.e50[i]) w[0]++; breadth.set(x.date, w); });
  const trades = [], signals = { strong: 0, base: 0, near: 0 };
  for (const [id, p] of preps) {
    const { b, e9 } = p; let busyUntil = -1;
    for (let i = 60; i < b.length - 1; i++) {
      if (from && b[i].date < from) continue;
      const a = analyzeAt(p, i, { rank: ranks.get(id + '|' + b[i].date), opt, minVol });
      if (!a?.strong) continue; signals.strong++; if (a.stage === 'base' || a.stage === 'near') signals.base++;
      if (a.stage !== 'near') continue; signals.near++;
      if (i <= busyUntil) continue;
      const j = i + 1, trig = a.plan.trigger, stop = a.plan.stop;
      if (!(b[j].h > trig)) continue;
      const entry = Math.max(b[j].o, trig), R = entry - stop; if (!(R > 0)) continue;
      let legs = [], left = 1, exitIdx = null, why = '';
      if (b[j].l <= stop) { legs.push([1, stop]); exitIdx = j; why = 'stop'; }
      for (let k = j + 1; k < b.length && exitIdx == null; k++) {
        const y = b[k];
        if (y.l <= stop) { legs.push([left, Math.min(y.o, stop)]); left = 0; exitIdx = k; why = 'stop'; break; }
        if (left === 1 && y.h >= entry + partialR * R) { legs.push([partialPct, Math.max(y.o, entry + partialR * R)]); left -= partialPct; }
        if (y.c < e9[k]) { legs.push([left, y.c]); left = 0; exitIdx = k; why = 'ema9'; break; }
        if (k - j >= maxHold) { legs.push([left, y.c]); left = 0; exitIdx = k; why = 'time'; break; }
      }
      if (exitIdx == null) continue; // 還在持有，不計
      const gross = legs.reduce((s, [w, px]) => s + w * (px - entry), 0), rMul = (gross - entry * cost) / R;
      const w = breadth.get(b[i].date), br = w && w[1] >= 10 ? w[0] / w[1] : null;
      trades.push({ id, signal: b[i].date, entry: b[j].date, exit: b[exitIdx].date, days: exitIdx - j, entryPx: r2(entry), stopPct: pct(R / entry), r: r2(rMul), ret: pct(gross / entry - cost), why, partial: legs.length > 1, breadth: br == null ? null : r2(br), retest: a.retest });
      busyUntil = exitIdx;
    }
  }
  trades.sort((a, c) => a.exit.localeCompare(c.exit));
  return { version: PULLBACK_VERSION, market, stocks: preps.size, from: trades[0]?.entry || null, to: trades.at(-1)?.exit || null, cost, signals, summary: summarize(trades), byYear: groupBy(trades, t => t.entry.slice(0, 4)), byBreadth: groupBy(trades, t => t.breadth == null ? 'na' : t.breadth >= 0.6 ? 'strong' : t.breadth >= 0.4 ? 'mid' : 'weak'), byRetest: groupBy(trades, t => t.retest <= 1 ? 'first' : 'later'), trades: trades.slice(-200).reverse() };
}

export function summarize(trades) {
  if (!trades.length) return { n: 0 };
  const rs = trades.map(t => t.r), wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0);
  let cum = 0, peak = 0, mdd = 0; for (const r of rs) { cum += r; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); }
  const gw = wins.reduce((a, x) => a + x, 0), gl = -losses.reduce((a, x) => a + x, 0);
  const sorted = [...rs].sort((a, c) => a - c);
  return { n: trades.length, winRate: pct(wins.length / rs.length), avgR: r2(cum / rs.length), totalR: r2(cum), avgWinR: r2(wins.length ? gw / wins.length : null), avgLossR: r2(losses.length ? -gl / losses.length : null), pf: gl > 0 ? r2(gw / gl) : null, maxDDR: r2(mdd), medianR: r2(sorted[Math.floor(sorted.length / 2)]), hit3R: pct(trades.filter(t => t.partial).length / trades.length), avgDays: r2(mean(trades.map(t => t.days))), avgStopPct: r2(mean(trades.map(t => t.stopPct))), avgRet: r2(mean(trades.map(t => t.ret))) };
}
function groupBy(trades, f) { const m = new Map(); for (const t of trades) { const k = f(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return [...m.entries()].sort((a, c) => String(a[0]).localeCompare(String(c[0]))).map(([key, list]) => ({ key, ...summarize(list) })); }
