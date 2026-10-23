// 持股損益與健檢。純計算；持股（成本、股數、停損、停利）由使用者輸入，存在本機 .local/portfolio.json（美股在 .local-us/）。
// 健檢：損益與權重、產業集中度、近一年相對大盤強弱、實際持股比例對照風控水溫建議、弱勢持股的同產業替代候選、停損／停利提醒。
// 只做計算與提醒，不連接券商、不下單；不是買賣建議。
export const PORTFOLIO_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// 使用者輸入 → 正規化（無效的列略過）
export function normalizeHoldings(list = []) {
  const out = [], seen = new Set();
  for (const h of Array.isArray(list) ? list : []) {
    const id = String(h?.id || '').trim().toUpperCase(), shares = num(h?.shares), cost = num(h?.cost);
    if (!/^[0-9A-Z][0-9A-Z.\-]{0,9}$/.test(id) || !(shares > 0) || !(cost > 0) || seen.has(id)) continue;
    seen.add(id);
    const stop = num(h.stop), target = num(h.target);
    out.push({ id, shares, cost, stop: stop > 0 ? stop : null, target: target > 0 ? target : null, note: String(h.note || '').slice(0, 60), since: /^\d{4}-\d{2}-\d{2}$/.test(h.since || '') ? h.since : null });
  }
  return out.slice(0, 100);
}
export function normalizePortfolio(doc = {}) { const cash = num(doc.cash); return { holdings: normalizeHoldings(doc.holdings), cash: cash >= 0 ? cash : null }; }

// 近一年相對強弱：個股報酬減大盤報酬（百分點）
export function relative(closes = [], index = [], days = 250) {
  const c = closes.slice(-days - 1); if (c.length < 60) return null;
  const from = c[0][0], s = c[0][1], e = c.at(-1)[1], ix = index.filter(x => x[0] >= from), ret = (e / s - 1) * 100;
  const iret = ix.length >= 2 ? (ix.at(-1)[1] / ix[0][1] - 1) * 100 : null, diff = iret == null ? null : ret - iret;
  return { from, ret: r1(ret), index: r1(iret), diff: r1(diff), label: diff == null ? null : diff >= 10 ? '領先' : diff <= -10 ? '落後' : '同步', tone: diff == null ? 0 : diff >= 10 ? 1 : diff <= -10 ? -1 : 0 };
}
// quotes：Map(id → { close, prev, name, sector, chain })；rs：Map(id → relative())；signals：Map(id → 'buy'|'sell')
// ideas：[{ id, name, sector, chain, from }]（價值區、升溫區、每日精選）
export function buildPortfolio({ market = 'TW', holdings = [], cash = null, capital = null, quotes = new Map(), rs = new Map(), signals = new Map(), risk = null, ideas = [], lot = 1 }) {
  const rows = holdings.map(h => {
    const q = quotes.get(h.id) || {}, px = q.close ?? null, value = px != null ? px * h.shares : null, costValue = h.cost * h.shares;
    const pnl = value != null ? value - costValue : null, day = px != null && q.prev > 0 ? (px - q.prev) * h.shares : null;
    return { ...h, name: q.name || h.id, sector: q.chain || q.sector || '未分類', chain: q.chain || null, close: px, change: q.prev > 0 && px != null ? r2((px / q.prev - 1) * 100) : null, value: r2(value), costValue: r2(costValue), pnl: r2(pnl), pnlPct: pnl != null ? r2(pnl / costValue * 100) : null, day: r2(day),
      lots: lot > 1 ? r2(h.shares / lot) : null, hitStop: h.stop != null && px != null && px <= h.stop, hitTarget: h.target != null && px != null && px >= h.target,
      toStop: h.stop != null && px ? r1((h.stop / px - 1) * 100) : null, toTarget: h.target != null && px ? r1((h.target / px - 1) * 100) : null, rs: rs.get(h.id) || null, signal: signals.get(h.id) || null };
  });
  const value = rows.reduce((s, r) => s + (r.value || 0), 0), cost = rows.reduce((s, r) => s + r.costValue, 0), pnl = rows.reduce((s, r) => s + (r.pnl || 0), 0), day = rows.reduce((s, r) => s + (r.day || 0), 0);
  for (const r of rows) r.weight = value > 0 && r.value != null ? r1(r.value / value * 100) : null;
  rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // 產業集中度
  const bySector = new Map(); for (const r of rows) bySector.set(r.sector, (bySector.get(r.sector) || 0) + (r.value || 0));
  const sectors = [...bySector].map(([name, v]) => ({ name, value: r2(v), weight: value > 0 ? r1(v / value * 100) : null })).sort((a, b) => b.value - a.value);
  const warnings = [];
  for (const r of rows) if (r.weight >= 25) warnings.push({ kind: 'stock', text: `${r.name} 占持股 ${r.weight}%（單一持股超過 25%）` });
  for (const s of sectors) if (s.weight >= 40 && rows.length > 1) warnings.push({ kind: 'sector', text: `${s.name} 占持股 ${s.weight}%（單一產業超過 40%）` });
  // 實際持股比例 vs 風控建議
  const total = cash != null ? value + cash : capital > 0 ? Math.max(capital, value) : null, actual = total > 0 ? r1(value / total * 100) : null, suggested = risk?.exposure ?? null;
  const exposure = { actual, suggested, risk: risk?.risk ?? null, label: risk?.label ?? null, diff: actual != null && suggested != null ? r1(actual - suggested) : null, basis: cash != null ? 'cash' : capital > 0 ? 'capital' : null };
  exposure.advice = exposure.diff == null ? null : exposure.diff > 10 ? '實際持股高於風控建議，可考慮降低部位或提高現金比重' : exposure.diff < -20 ? '實際持股明顯低於風控建議，市場風險不高時可依計畫分批布局' : '實際持股大致符合風控建議';
  // 弱勢持股 → 同產業／供應鏈的替代候選（不在持股中的價值區、升溫區、每日精選）
  const held = new Set(rows.map(r => r.id)), swaps = [];
  for (const r of rows) {
    const why = []; if (r.rs?.tone === -1) why.push(`近一年落後大盤 ${Math.abs(r.rs.diff)} 個百分點`); if (r.signal === 'sell') why.push('ATR 追蹤線偏空'); if (r.hitStop) why.push('跌破停損價'); else if (r.pnlPct != null && r.pnlPct <= -15) why.push(`虧損 ${Math.abs(r.pnlPct)}%`);
    if (!why.length) continue;
    const same = ideas.filter(x => !held.has(x.id) && ((r.chain && x.chain === r.chain) || (x.sector && x.sector === r.sector))), uniq = [...new Map(same.map(x => [x.id, x])).values()].slice(0, 3);
    swaps.push({ id: r.id, name: r.name, why, candidates: uniq });
  }
  return { version: PORTFOLIO_VERSION, market, count: rows.length, rows, totals: { value: r2(value), cost: r2(cost), pnl: r2(pnl), pnlPct: cost > 0 ? r2(pnl / cost * 100) : null, day: r2(day), dayPct: value - day > 0 ? r2(day / (value - day) * 100) : null, cash },
    sectors, warnings, exposure, swaps, alerts: rows.filter(r => r.hitStop || r.hitTarget).map(r => ({ id: r.id, name: r.name, kind: r.hitStop ? 'stop' : 'target', price: r.close, level: r.hitStop ? r.stop : r.target })) };
}
// 停損／停利提醒：同一檔同一種提醒每天只發一次
export function newAlerts(p, seen = {}, today) {
  const out = [], next = { ...seen };
  for (const a of p.alerts || []) { const k = `${a.id}:${a.kind}`; if (next[k] === today) continue; next[k] = today; out.push(a); }
  return { out, seen: next };
}
