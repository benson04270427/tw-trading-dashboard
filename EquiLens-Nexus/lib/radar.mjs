// 盤中異動雷達：每次即時快照比對，產生爆量、急拉急殺、漲跌停（有漲跌幅限制的市場）、型態進場與跌破防守提醒。
// 交易時段、漲跌停價、成交量單位依市場設定（markets.mjs）；提醒文字依介面語言產生。
// 只讀快照欄位：close、change_price、total_volume（張）、total_amount（元）、yesterday_volume（張）、date（成交時間）。
import { activeMarket } from './config.mjs';
import { limitPrices as marketLimits, elapsedTrading } from './markets.mjs';
import { t } from './i18n.mjs';

export const RADAR_DEFAULTS = {
  enabled: true, scope: 'research',
  volume: { on: true, ratio: 2, minAmount: 1e8 },
  surge: { on: true, pct: 2, minutes: 1, cooldown: 30 },
  limit: { on: true },
  pattern: { on: true },
  stop: { on: true },
};
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function normalizeRadar(input = {}) {
  const d = RADAR_DEFAULTS, r = input || {};
  const pick = (v, lo, hi, fallback) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; };
  return {
    enabled: r.enabled !== false,
    scope: ['watch', 'research', 'all'].includes(r.scope) ? r.scope : d.scope,
    volume: { on: r.volume?.on !== false, ratio: pick(r.volume?.ratio, 1.2, 10, d.volume.ratio), minAmount: pick(r.volume?.minAmount, 0, 5e10, d.volume.minAmount) },
    surge: { on: r.surge?.on !== false, pct: pick(r.surge?.pct, 0.5, 9, d.surge.pct), minutes: Math.round(pick(r.surge?.minutes, 1, 30, d.surge.minutes)), cooldown: Math.round(pick(r.surge?.cooldown, 5, 270, d.surge.cooldown)) },
    limit: { on: r.limit?.on !== false },
    pattern: { on: r.pattern?.on !== false },
    stop: { on: r.stop?.on !== false },
  };
}
export function validRadarInput(r) {
  return r && typeof r === 'object' && ['watch', 'research', 'all'].includes(r.scope)
    && ['volume', 'surge', 'limit', 'pattern', 'stop'].every(k => r[k] && typeof r[k].on === 'boolean');
}

// 快照時間 'YYYY-MM-DD HH:MM:SS(.ffffff)'（當地時間）→ 毫秒；只用於同一市場內比較先後與間隔，時區不影響結果
export const tickTime = s => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + 'Z');
// 開盤起算的交易分鐘數（扣除午休；台股為 0–270）
export function sessionMinutes(s, p = activeMarket()) { const m = /\s(\d{2}):(\d{2})/.exec(String(s)); return m ? elapsedTrading(p, Number(m[1]) * 60 + Number(m[2])) : 0; }
// 漲跌停價；沒有漲跌幅限制的市場回傳 null
export function limitPrices(prev, p = activeMarket()) { return marketLimits(p, prev); }

export function createRadarState(date) { return { date, hist: new Map(), fired: new Map(), atLimit: new Map(), last: new Map() }; }
// 服務重新啟動時，以今天已發出的提醒還原冷卻與漲跌停狀態，避免重複提醒。
const FIRE_KEY = { volume: 'vol', 'surge-up': 'up', 'surge-down': 'down', 'limit-up': 'lu', 'limit-down': 'ld', 'limit-up-open': 'luo', 'limit-down-open': 'ldo' };
export function seedRadarState(state, alerts) {
  for (const a of alerts) {
    if (!a.stockId || !a.t) continue;
    const t = tickTime(`${state.date} ${a.t}`), k = FIRE_KEY[a.type];
    if (k) state.fired.set(`${k}:${a.stockId}`, t);
    if (a.type === 'limit-up') state.atLimit.set(a.stockId, 'up'); else if (a.type === 'limit-down') state.atLimit.set(a.stockId, 'down');
    else if (a.type === 'limit-up-open' || a.type === 'limit-down-open') state.atLimit.set(a.stockId, null);
  }
  return state;
}

// ctx: { settings, meta: Map(id → {name, sector}), watch: Set, research: Set, plans: Map(id → [{key, name, entry, entryMax, stop}]), market?, lang? }
// 金額顯示：繁中以「億」，英文以百萬（M）
const money = (v, lang) => lang === 'en' ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e8).toFixed(1)} 億`;
export function scanRadar(state, rows, ctx) {
  const s = ctx.settings, out = [], p = ctx.market || activeMarket(), lang = ctx.lang;
  if (!s.enabled) return out;
  const T = (msg, params) => t(msg, params, lang), unit = p.unit?.[lang || 'zh-TW'] || T('股');
  const inScope = id => s.scope === 'all' || ctx.watch.has(id) || (s.scope === 'research' && ctx.research.has(id));
  for (const r of rows) {
    const id = r.stock_id, meta = ctx.meta.get(id);
    const close = num(r.close), chg = num(r.change_price);
    if (!meta || !(close > 0) || chg == null) continue;
    const t0 = tickTime(r.date), prev = close - chg, prevClose = state.last.get(id);
    state.last.set(id, close);
    const hist = state.hist.get(id) || []; hist.push([t0, close]);
    const keep = s.surge.minutes * 60e3; while (hist.length && hist[0][0] < t0 - keep) hist.shift(); // 只留最近 N 分鐘（以成交時間計）
    state.hist.set(id, hist);
    const scoped = inScope(id), plans = ctx.plans.get(id) || [];
    if (!scoped && !(s.pattern.on && plans.length)) continue;
    const watch = ctx.watch.has(id), base = { stockId: id, name: meta.name, close, change: prev > 0 ? Math.round(chg / prev * 1e4) / 100 : null, t: String(r.date).slice(11, 19), watch, level: watch ? 'hi' : 'mid' };
    const fire = (key, cooldownMin) => { const k = `${key}:${id}`, at = state.fired.get(k); if (at != null && (cooldownMin == null || t0 - at < cooldownMin * 60e3)) return false; state.fired.set(k, t0); return true; };
    const push = (type, title, detail) => out.push({ ...base, type, title: T(title), detail });
    if (scoped && s.volume.on) {
      // 爆量：依目前成交量推估全日量（以已交易分鐘占全日交易分鐘的比例），超過昨量（或平均量）倍數時提醒
      const elapsed = sessionMinutes(r.date, p), yv = num(r.yesterday_volume), tv = num(r.total_volume), amt = num(r.total_amount);
      if (elapsed >= 15 && yv > 0 && tv > 0 && amt >= s.volume.minAmount) {
        const ratio = tv / (elapsed / p.length) / yv;
        if (ratio >= s.volume.ratio && fire('vol')) push('volume', '爆量', T('預估全日量 {ratio} 倍昨量 · 已成交 {vol} {unit} · {amt}', { ratio: ratio.toFixed(1), vol: Math.round(tv).toLocaleString('en-US'), unit, amt: money(amt, lang) }));
      }
    }
    // 急拉／急殺：N 分鐘內的漲（跌）幅達門檻（含）。以昨收為基準，比較現價與這 N 分鐘內的最低（最高）價，
    // 也就是漲跌幅在 N 分鐘內拉高（壓低）幾個百分點；用區間高低點而非起訖兩點，視窗中段才發生的急拉也抓得到。
    if (scoped && s.surge.on && prev > 0 && hist.length > 1) {
      const win = hist.slice(0, -1).map(h => h[1]), lo = Math.min(...win), hi = Math.max(...win), m = s.surge.minutes;
      const up = (close - lo) / prev * 100, down = (close - hi) / prev * 100, pc = x => { const v = (x / prev - 1) * 100; return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`; };
      if (up >= s.surge.pct - 1e-9 && fire('up', s.surge.cooldown)) push('surge-up', '急拉', T('{m} 分鐘內漲幅 +{pct}%（{from} → {to}，漲跌幅 {a} → {b}）', { m, pct: up.toFixed(2), from: lo, to: close, a: pc(lo), b: pc(close) }));
      else if (down <= -s.surge.pct + 1e-9 && fire('down', s.surge.cooldown)) push('surge-down', '急殺', T('{m} 分鐘內跌幅 {pct}%（{from} → {to}，漲跌幅 {a} → {b}）', { m, pct: down.toFixed(2), from: hi, to: close, a: pc(hi), b: pc(close) }));
    }
    const lim = scoped && s.limit.on && prev > 0 ? limitPrices(prev, p) : null;
    if (lim) {
      const { up, down } = lim, was = state.atLimit.get(id) ?? null, now = close >= up ? 'up' : close <= down ? 'down' : null;
      if (now !== was) {
        if (now === 'up' && fire('lu', 10)) push('limit-up', was === null && state.fired.has(`luo:${id}`) ? '漲停再鎖' : '觸及漲停', T('漲停價 {price}', { price: up }));
        else if (now === 'down' && fire('ld', 10)) push('limit-down', '觸及跌停', T('跌停價 {price}', { price: down }));
        if (was === 'up' && now !== 'up' && fire('luo', 10)) push('limit-up-open', '漲停打開', T('漲停價 {price} → {close}', { price: up, close }));
        if (was === 'down' && now !== 'down' && fire('ldo', 10)) push('limit-down-open', '跌停打開', T('跌停價 {price} → {close}', { price: down, close }));
      }
      state.atLimit.set(id, now);
    }
    if (prevClose != null && prevClose !== close) {
      for (const pl of plans) {
        if (s.pattern.on && pl.entry > 0 && prevClose < pl.entry && close >= pl.entry && fire(`pe:${pl.key}`)) push('pattern-entry', '站上進場價', T('{name} 進場帶 {a}–{b}', { name: pl.name, a: pl.entry, b: pl.entryMax ?? pl.entry }));
        if (s.stop.on && scoped && pl.stop > 0 && prevClose > pl.stop && close <= pl.stop && fire(`ps:${pl.key}`)) push('stop', '跌破防守', T('{name} 結構防守 {price}', { name: pl.name, price: pl.stop }));
      }
    }
  }
  return out;
}