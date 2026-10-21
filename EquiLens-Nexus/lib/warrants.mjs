// 權證追蹤（台股，只看認購權證；純計算模組，資料取得在 server.mjs 與 providers/twse.mjs）：
// 1. 權證標的對照（FinMind TaiwanStockInfoWithWarrantSummary）：權證代號 → 標的股、類型、上市日、最後交易日、行使比例、履約價。
//    同一個代號到期後會重新發給其他標的，所以以「日期落在上市日～最後交易日」決定當天對應哪一檔。
// 2. 認購權證行情（證交所 MI_INDEX type=0999、櫃買 tpex_warrant_daily_quts，免金鑰）：名稱、收盤、成交單位數與金額；
//    依標的彙總當日認購權證成交金額，作為「占該標的權證成交」的分母。
// 3. 分點的權證進出（FinMind 依券商代碼查權證分點）：依標的彙總該分點買賣認購權證的金額，標出單日大買與連續買進。
//    發行券商總公司（含自營部造市與避險）的自家權證進出不列入。

export const WARRANT_DEFAULTS = Object.freeze({ warrants: true, warrantAmount: 5e6, warrantPct: 10, warrantDays: 3 });
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const day = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const roc = s => { const m = /^(\d{2,3})(\d{2})(\d{2})$/.exec(String(s || '').trim()); return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : ''; };
export const WARRANT_ID = /^[0-9][0-9A-Z]{5}$/;

// 行使比例統一為「每 1 單位權證可換的標的股數」：部分來源以每千單位表示（例如 65 代表 0.065）
export function normalizeRatio(v) { const n = num(v); if (!(n > 0)) return null; return n > 5 ? Math.round(n / 1000 * 1e6) / 1e6 : n; }

// 對照表 → { 權證代號: [[標的, 類型 C／P, 上市日, 最後交易日, 行使比例, 履約價], …] }；最後交易日早於 keepFrom 的不保留
export function warrantMaster(rows, { keepFrom = '' } = {}) {
  const out = {};
  for (const r of rows || []) {
    const id = String(r.stock_id || '').trim(), target = String(r.target_stock_id || '').trim(), from = day(r.date), to = day(r.end_date);
    if (!WARRANT_ID.test(id) || !target || !to || (keepFrom && to < keepFrom)) continue;
    const kind = /購/.test(r.type || '') ? 'C' : /售/.test(r.type || '') ? 'P' : null; if (!kind) continue;
    const strike = num(r.fulfillment_price);
    (out[id] ||= []).push([target, kind, from, to, normalizeRatio(r.exercise_ratio), strike > 0 ? strike : null]);
  }
  return out;
}
// 某日某權證代號對應的條目（不在任何區間內時為 null）
export function warrantOn(master, id, date) {
  const e = (master?.[id] || []).find(x => (!x[2] || x[2] <= date) && x[3] >= date);
  return e ? { id, target: e[0], kind: e[1], from: e[2], to: e[3], ratio: e[4], strike: e[5] } : null;
}

// 證交所每日收盤行情（type=0999：認購權證，不含牛證）→ { 代號: [名稱, 收盤, 成交單位數, 成交金額] }
export function parseTwseWarrants(body) {
  const out = {};
  for (const t of body?.tables || []) {
    const f = t.fields || [], i = k => f.indexOf(k), id = i('證券代號'), nm = i('證券名稱'), vol = i('成交股數'), val = i('成交金額'), close = i('收盤價');
    if (id < 0 || val < 0 || !Array.isArray(t.data)) continue;
    for (const r of t.data) {
      const code = String(r[id] || '').trim(); if (!WARRANT_ID.test(code)) continue;
      const name = String(r[nm] || '').trim(); if (/牛|熊/.test(name)) continue;
      out[code] = [name, num(r[close]) || null, num(r[vol]) || 0, num(r[val]) || 0];
    }
  }
  return out;
}
// 櫃買權證收盤行情（只有最新一個交易日）→ { date, q: { 代號: [名稱, 收盤, 成交單位數, 成交金額, 標的] } }，只留認購權證
export function parseTpexWarrants(list) {
  const q = {}; let date = '';
  for (const r of Array.isArray(list) ? list : []) {
    const code = String(r.Code || '').trim(), name = String(r.Name || '').trim();
    if (!WARRANT_ID.test(code) || !/購/.test(name) || /牛|熊/.test(name)) continue;
    date ||= roc(r.Date);
    q[code] = [name, num(r.Close) || null, num(r['TradeVol.']) || 0, num(r.TradeValue) || 0, String(r.UnderlyingStockCode || '').trim() || null];
  }
  return { date, q };
}
// 依標的彙總當日認購權證成交金額：{ 標的: 成交金額 }
export function turnoverByTarget(quotes, master, date) {
  const out = {};
  for (const [id, v] of Object.entries(quotes || {})) {
    const target = warrantOn(master, id, date)?.target || v[4]; if (!target || !(v[3] > 0)) continue;
    out[target] = (out[target] || 0) + v[3];
  }
  return out;
}

// 權證名稱 → 發行商簡稱：名稱為「標的簡稱＋發行商＋代碼＋購／售＋序號」，例如「友達台新6A購01」→ 台新
export function issuerOf(name, targetName = '') {
  const s = String(name || ''), i = s.search(/[0-9A-Z]/); if (i <= 0) return '';
  const head = s.slice(0, i);
  for (const n of [targetName, String(targetName || '').replace(/-KY$|-創$|\*/g, '')]) if (n && head.startsWith(n) && head.length > n.length) return head.slice(n.length);
  return head.slice(-2);
}
// 分點是否為發行券商的總公司（總公司代號包含自營部的造市與避險）：分點名稱與發行商簡稱相同
export const issuerBranch = (branchName, issuer) => !!issuer && String(branchName || '').replace(/證券$|自營.*$/, '') === issuer;

// 連續淨買超天數（含今日）與這段期間的累計淨買金額；history 為之前各日的 { 標的: 淨買金額 }（由舊到新）
function streakOf(history, id, todayAmt) {
  if (!(todayAmt > 0)) return { days: 0, sum: 0 };
  let days = 1, sum = todayAmt;
  for (let i = history.length - 1; i >= 0; i--) { const v = history[i]?.[id] || 0; if (v > 0) { days++; sum += v; } else break; }
  return { days, sum };
}

// 單一分點某日的權證分點資料（每檔權證每個價位一列；buy／sell 為單位數）→ 依標的彙總認購權證進出與提醒條件
// master：對照表；quotes：當日行情（名稱用來判斷發行商）；turnover：{ 標的: 當日認購權證成交金額 }（沒有時只看金額）
export function branchWarrants(rows, { date, branchName = '', master = {}, quotes = {}, turnover = null, meta = new Map(), watch = new Set(), research = new Set(), history = [], settings = WARRANT_DEFAULTS, top = 10 } = {}) {
  const cs = { ...WARRANT_DEFAULTS, ...settings }, per = new Map(), skipped = { puts: 0, unknown: 0, issuer: 0 };
  for (const r of rows || []) {
    const id = String(r.stock_id || '').trim(); if (!id) continue;
    const x = per.get(id) || { id, buy: 0, sell: 0, buyAmt: 0, sellAmt: 0 }, p = num(r.price) || 0, b = num(r.buy) || 0, s = num(r.sell) || 0;
    x.buy += b; x.sell += s; x.buyAmt += b * p; x.sellAmt += s * p; per.set(id, x);
  }
  const targets = new Map();
  for (const w of per.values()) {
    const e = warrantOn(master, w.id, date);
    if (!e) { skipped.unknown++; continue; }
    if (e.kind !== 'C') { skipped.puts++; continue; }
    const name = quotes[w.id]?.[0] || '', issuer = issuerOf(name, meta.get(e.target)?.name);
    if (issuerBranch(branchName, issuer)) { skipped.issuer++; continue; }
    const g = targets.get(e.target) || { id: e.target, name: meta.get(e.target)?.name || e.target, buyAmt: 0, sellAmt: 0, list: [] };
    g.buyAmt += w.buyAmt; g.sellAmt += w.sellAmt;
    g.list.push({ id: w.id, name: name || w.id, issuer, net: w.buy - w.sell, netAmt: Math.round(w.buyAmt - w.sellAmt), avg: w.buy - w.sell > 0 ? (w.buy ? r2(w.buyAmt / w.buy) : null) : (w.sell ? r2(w.sellAmt / w.sell) : null), strike: e.strike, to: e.to });
    targets.set(e.target, g);
  }
  const list = [...targets.values()].map(g => {
    const netAmt = Math.round(g.buyAmt - g.sellAmt), tv = turnover?.[g.id], st = streakOf(history, g.id, netAmt);
    const share = turnover && tv > 0 && netAmt > 0 ? r2(netAmt / tv * 100) : null; // 只對淨買超計算占比
    const big = netAmt >= cs.warrantAmount && (share == null || share >= cs.warrantPct), run = st.days >= cs.warrantDays && st.sum >= cs.warrantAmount;
    return { id: g.id, name: g.name, netAmt, buyAmt: Math.round(g.buyAmt), sellAmt: Math.round(g.sellAmt), share, streak: st.days, streakAmt: Math.round(st.sum), count: g.list.length,
      warrants: g.list.sort((a, b) => b.netAmt - a.netAmt).slice(0, 3), watch: watch.has(g.id), research: research.has(g.id), big, run };
  }).sort((a, b) => b.netAmt - a.netAmt);
  const slim = ({ big, run, ...x }) => ({ ...x, ...(big ? { big } : {}), ...(run ? { run } : {}) });
  return {
    count: list.length, warrants: list.reduce((a, x) => a + x.count, 0), buyAmt: list.reduce((a, x) => a + x.buyAmt, 0), sellAmt: list.reduce((a, x) => a + x.sellAmt, 0),
    buy: list.filter(x => x.netAmt > 0).slice(0, top).map(slim), sell: list.filter(x => x.netAmt < 0).reverse().slice(0, 5).map(slim),
    mine: list.filter(x => (x.watch || x.research) && x.netAmt).map(slim), signals: list.filter(x => x.big || x.run).map(slim),
    nets: Object.fromEntries(list.filter(x => x.netAmt).map(x => [x.id, x.netAmt])), skipped, shareKnown: !!turnover,
  };
}

// 個股的認購權證清單：對照表（依標的查詢）＋當日行情 → 依成交金額排序
// 價內外＝標的收盤 ÷ 履約價 − 1；名目槓桿＝標的收盤 × 行使比例 ÷ 權證收盤（未考慮 Delta，只供比較）
export function stockWarrants(rows, { id, date, quotes = {}, close = null, targetName = '', limit = 40 } = {}) {
  const master = warrantMaster(rows, { keepFrom: date }), out = [];
  for (const wid of Object.keys(master)) {
    const e = warrantOn(master, wid, date); if (!e || e.kind !== 'C' || e.target !== id) continue;
    const q = quotes[wid] || null, wclose = q?.[1] || null;
    out.push({ id: wid, name: q?.[0] || wid, issuer: issuerOf(q?.[0], targetName), strike: e.strike, ratio: e.ratio, to: e.to, days: Math.round((Date.parse(e.to) - Date.parse(date)) / 864e5),
      moneyness: e.strike && close > 0 ? r2((close / e.strike - 1) * 100) : null, close: wclose, units: q?.[2] ?? null, value: q?.[3] ?? null,
      leverage: close > 0 && wclose > 0 && e.ratio ? r2(close * e.ratio / wclose) : null });
  }
  out.sort((a, b) => (b.value || 0) - (a.value || 0) || a.days - b.days);
  return { count: out.length, traded: out.filter(x => x.value > 0).length, turnover: out.reduce((a, x) => a + (x.value || 0), 0), list: out.slice(0, limit) };
}
