// 自訂提醒：使用者對個股設定的價位、漲跌幅與量能條件。每次即時快照（或即時推播）比對一次，條件由「不成立」轉為「成立」時提醒。
// 單次提醒觸發後自動停用；重複提醒在條件回到不成立後重新上膛，並有 5 分鐘冷卻避免價格在門檻附近來回時連續提醒。
// 服務重新啟動時以規則上的 firedDate 判斷：今天已提醒過的規則，第一次比對時條件仍成立不會重發。
import crypto from 'node:crypto';
import { activeMarket } from './config.mjs';
import { t } from './i18n.mjs';
import { tickTime, sessionMinutes } from './radar.mjs';

export const RULE_KINDS = ['above', 'below', 'pct-up', 'pct-down', 'volume'];
export const MAX_RULES = 200;
const REPEAT_COOLDOWN = 5 * 60e3;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// 新增或修改規則：回傳正規化後的規則；格式錯誤時回傳 { error }
export function normalizeRule(input, prev = null, now = new Date()) {
  const b = input || {}, kind = b.kind ?? prev?.kind, value = num(b.value ?? prev?.value);
  if (!RULE_KINDS.includes(kind)) return { error: '提醒條件無效' };
  if (!(value > 0)) return { error: '請輸入大於 0 的數值' };
  if ((kind === 'pct-up' || kind === 'pct-down') && value > 30) return { error: '漲跌幅門檻需在 30% 以內' };
  if (kind === 'volume' && (value < 1 || value > 20)) return { error: '量比門檻需在 1 到 20 倍之間' };
  const note = String(b.note ?? prev?.note ?? '').trim().slice(0, 60);
  const repeat = typeof b.repeat === 'boolean' ? b.repeat : !!prev?.repeat;
  const active = typeof b.active === 'boolean' ? b.active : prev ? prev.active : true;
  const changed = prev && (prev.kind !== kind || prev.value !== value);
  return {
    id: prev?.id || crypto.randomUUID().slice(0, 12), stockId: prev?.stockId || String(b.stockId || ''), kind, value, repeat, note, active,
    createdAt: prev?.createdAt || now.toISOString(),
    // 條件改變或重新啟用時清除觸發紀錄，讓新條件今天可以提醒
    firedAt: changed || (active && prev && !prev.active) ? null : prev?.firedAt || null,
    firedDate: changed || (active && prev && !prev.active) ? null : prev?.firedDate || null,
    hits: prev?.hits || 0,
  };
}

// 規則的簡短說明（介面與提醒文字共用）
export function ruleLabel(r, lang) {
  const T = (s, p) => t(s, p, lang);
  return r.kind === 'above' ? T('價格 ≥ {v}', { v: r.value }) : r.kind === 'below' ? T('價格 ≤ {v}', { v: r.value })
    : r.kind === 'pct-up' ? T('漲幅 ≥ {v}%', { v: r.value }) : r.kind === 'pct-down' ? T('跌幅 ≥ {v}%', { v: r.value }) : T('預估量 ≥ {v} 倍昨量', { v: r.value });
}

export function createRuleState(date) { return { date, cond: new Map(), last: new Map() }; }

// 單一快照列在規則下的數值與是否成立
export function evalRule(r, row, p = activeMarket()) {
  const close = num(row.close), chg = num(row.change_price);
  if (!(close > 0) || chg == null) return null;
  const prev = close - chg, pct = prev > 0 ? chg / prev * 100 : null;
  if (r.kind === 'above') return { ok: close >= r.value, close, pct };
  if (r.kind === 'below') return { ok: close <= r.value, close, pct };
  if (pct == null) return null;
  if (r.kind === 'pct-up') return { ok: pct >= r.value - 1e-9, close, pct };
  if (r.kind === 'pct-down') return { ok: pct <= -r.value + 1e-9, close, pct };
  const elapsed = sessionMinutes(row.date, p), yv = num(row.yesterday_volume), tv = num(row.total_volume);
  if (elapsed < 15 || !(yv > 0) || !(tv > 0)) return null;
  const ratio = tv / (elapsed / p.length) / yv;
  return { ok: ratio >= r.value, close, pct, ratio };
}

// rows：快照或推播列；rules：全部規則（只比對啟用中的）；ctx：{ meta, watch: Set, market, lang }
// 回傳 { alerts, changed }：changed 為觸發後需要存檔的規則（觸發時間、次數、單次規則停用）
export function scanPriceAlerts(state, rows, rules, ctx) {
  const alerts = [], changed = [], p = ctx.market || activeMarket(), lang = ctx.lang;
  const byStock = new Map();
  for (const r of rules) if (r.active) { if (!byStock.has(r.stockId)) byStock.set(r.stockId, []); byStock.get(r.stockId).push(r); }
  if (!byStock.size) return { alerts, changed };
  for (const row of rows) {
    const list = byStock.get(row.stock_id); if (!list || String(row.date).slice(0, 10) !== state.date) continue;
    const t0 = tickTime(row.date);
    for (const r of list) {
      if (!r.active) continue;
      const v = evalRule(r, row, p); if (!v) continue;
      const was = state.cond.get(r.id); state.cond.set(r.id, v.ok);
      if (!v.ok || was === true) continue;
      if (was === undefined && r.firedDate === state.date) continue; // 重新啟動後：今天已提醒過
      if (r.repeat && t0 - (state.last.get(r.id) ?? -Infinity) < REPEAT_COOLDOWN) continue;
      state.last.set(r.id, t0);
      r.firedAt = new Date().toISOString(); r.firedDate = state.date; r.hits = (r.hits || 0) + 1;
      if (!r.repeat) r.active = false;
      changed.push(r);
      const name = ctx.meta.get(r.stockId)?.name || r.stockId, watch = ctx.watch.has(r.stockId);
      const now = r.kind === 'volume' ? t('預估量 {x} 倍昨量', { x: v.ratio.toFixed(1) }, lang) : r.kind.startsWith('pct') ? t('漲跌幅 {x}%', { x: (v.pct > 0 ? '+' : '') + v.pct.toFixed(2) }, lang) : t('現價 {x}', { x: v.close }, lang);
      alerts.push({
        type: 'custom', stockId: r.stockId, name, close: v.close, change: v.pct == null ? null : Math.round(v.pct * 100) / 100, t: String(row.date).slice(11, 19),
        watch, level: 'hi', rule: r.id, dir: r.kind === 'above' || r.kind === 'pct-up' ? 'up' : r.kind === 'volume' ? 'hot' : 'down',
        title: t('自訂提醒', null, lang), detail: `${ruleLabel(r, lang)} · ${now}${r.note ? ` · ${r.note}` : ''}${r.repeat ? '' : t('（單次提醒，已停用）', null, lang)}`,
      });
    }
  }
  return { alerts, changed };
}
