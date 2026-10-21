// 低估選股（台股，全市場）：以本益比、股價淨值比、殖利率、估算 ROE 與月營收成長，找出相對同業便宜、
// 但獲利與營收沒有轉壞的公司。純計算；資料由 providers/twse.mjs 的 screenInputs 取得（證交所與櫃買開放資料，免金鑰）。
export const SCREEN_VERSION = '1.0';
const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); if (!s || s === '-' || s === '--' || s === 'N/A') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const COMMON = /^[1-9]\d{3}$/;
// 欄位名稱在不同版本的開放資料略有差異：依序找第一個存在的欄位，或以規則比對欄位名稱
const field = (r, names, re) => { for (const n of names) if (r[n] !== undefined) return r[n]; if (re) { const k = Object.keys(r).find(k => re.test(k)); if (k) return r[k]; } return undefined; };
const median = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// 策略：權重（便宜、品質、成長、收益）與門檻
export const STRATEGIES = {
  value: { name: '低估價值', desc: '本益比與淨值比低於同業、ROE 不差、營收沒有明顯衰退', weights: { cheap: 50, quality: 25, growth: 15, income: 10 }, rules: { maxPE: 25, minROE: 8, minCumYoY: -15 } },
  garp: { name: '成長合理價', desc: '營收成長快、本益比相對成長率不貴（PEG ≤ 1.2）', weights: { cheap: 35, quality: 20, growth: 45, income: 0 }, rules: { minCumYoY: 15, maxPEG: 1.2, minROE: 10 } },
  income: { name: '高殖利率', desc: '殖利率 5% 以上、獲利能力穩定、營收沒有明顯衰退', weights: { cheap: 15, quality: 25, growth: 10, income: 50 }, rules: { minYield: 5, minROE: 8, minCumYoY: -10 } },
};
export const DEFAULTS = { strategy: 'value', minTurnover: 1e7, limit: 60 };

// ---- 開放資料 → 每檔一列 ----
export function mergeInputs(raw) {
  const out = new Map(), get = id => { if (!out.has(id)) out.set(id, { id }); return out.get(id); };
  for (const u of raw.universe || []) if (COMMON.test(u.id)) Object.assign(get(u.id), { name: u.name, sector: u.sector, market: u.market });
  const val = (r, code, pe, pb, y) => { const id = String(field(r, code) ?? '').trim(); if (!out.has(id)) return; Object.assign(get(id), { pe: num(field(r, pe)), pb: num(field(r, pb)), yield: num(field(r, y)), valDate: String(field(r, ['Date']) ?? '') }); };
  for (const r of raw.valTw || []) val(r, ['Code'], ['PEratio'], ['PBratio'], ['DividendYield']);
  for (const r of raw.valTp || []) val(r, ['SecuritiesCompanyCode'], ['PriceEarningRatio'], ['PriceBookRatio'], ['YieldRatio']);
  for (const r of [...(raw.revTw || []), ...(raw.revTp || [])]) {
    const id = String(r['公司代號'] ?? '').trim(); if (!out.has(id)) continue;
    const cur = num(field(r, ['營業收入-當月營收'])), last = num(field(r, ['營業收入-去年當月營收'])), cum = num(field(r, ['累計營業收入-當月累計營收'])), cumLast = num(field(r, ['累計營業收入-去年累計營收']));
    const yoy = last > 0 && cur != null ? (cur / last - 1) * 100 : num(field(r, ['營業收入-去年同月增減(%)'], /去年同月增減/));
    const cumYoY = cumLast > 0 && cum != null ? (cum / cumLast - 1) * 100 : num(field(r, ['累計營業收入-前期比較增減(%)'], /前期比較增減/));
    const ym = String(r['資料年月'] ?? ''), y = Number(ym.slice(0, -2)) + 1911, m = Number(ym.slice(-2));
    Object.assign(get(id), { revYoY: r1(yoy), revCumYoY: r1(cumYoY), revMonth: y > 1911 && m ? `${y}-${String(m).padStart(2, '0')}` : null });
  }
  for (const r of raw.priceTw || []) { const id = String(field(r, ['Code']) ?? '').trim(); if (out.has(id)) Object.assign(get(id), { close: num(field(r, ['ClosingPrice'])), turnover: num(field(r, ['TradeValue'])) }); }
  for (const r of raw.priceTp || []) { const id = String(field(r, ['SecuritiesCompanyCode']) ?? '').trim(); if (out.has(id)) Object.assign(get(id), { close: num(field(r, ['Close', 'ClosingPrice'])), turnover: num(field(r, ['TransactionAmount', 'TradeValue'], /Amount$/)) }); }
  return [...out.values()].filter(r => r.name);
}

// 百分位（0～100）：較小值的比例（同值算一半）
function pctOf(sorted, v) { if (v == null || !sorted.length) return null; let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++; return (lo + (eq - lo) / 2) / sorted.length * 100; }
const sortedOf = (rows, k) => rows.map(r => r[k]).filter(v => v != null).sort((a, b) => a - b);

// ---- 評分 ----
export function screen(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, st = STRATEGIES[o.strategy] || STRATEGIES.value;
  // 基本條件：有獲利（本益比 > 0）、有淨值比、成交金額達門檻（沒有行情資料時不檢查）
  const hasPrice = rows.some(r => r.turnover != null);
  const base = rows.filter(r => r.pe > 0 && r.pb > 0 && (!hasPrice || (r.turnover ?? 0) >= o.minTurnover)).map(r => ({ ...r, roe: r2(r.pb / r.pe * 100), peg: r.revCumYoY > 0 ? r2(r.pe / r.revCumYoY) : null }));
  // 估值與同產業比較（同業少於 6 檔時改與全市場比較），成長、品質、收益與全市場比較
  const bySector = new Map(); for (const r of base) { if (!bySector.has(r.sector)) bySector.set(r.sector, []); bySector.get(r.sector).push(r); }
  const all = { pe: sortedOf(base, 'pe'), pb: sortedOf(base, 'pb'), roe: sortedOf(base, 'roe'), yoy: sortedOf(base, 'revYoY'), cum: sortedOf(base, 'revCumYoY'), yld: sortedOf(base, 'yield') };
  const peers = new Map([...bySector].map(([k, list]) => [k, list.length >= 6 ? { pe: sortedOf(list, 'pe'), pb: sortedOf(list, 'pb'), n: list.length, medPE: r1(median(list.map(r => r.pe))), medPB: r2(median(list.map(r => r.pb))) } : null]));
  const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const scored = base.map(r => {
    const p = peers.get(r.sector), ref = p || all;
    const pePct = pctOf(ref.pe, r.pe), pbPct = pctOf(ref.pb, r.pb);
    const s = { cheap: avg([100 - pePct, 100 - pbPct]), quality: pctOf(all.roe, r.roe), growth: avg([pctOf(all.yoy, r.revYoY), pctOf(all.cum, r.revCumYoY)]), income: r.yield != null ? pctOf(all.yld, r.yield) : 0 };
    const w = Object.entries(st.weights).filter(([k, v]) => v && s[k] != null), tw = w.reduce((a, [, v]) => a + v, 0);
    const score = tw ? r1(w.reduce((a, [k, v]) => a + s[k] * v, 0) / tw) : null;
    return { ...r, score, scores: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r1(v)])), pePct: r1(pePct), peerPE: p?.medPE ?? r1(median(all.pe)), peerPB: p?.medPB ?? r2(median(all.pb)), peerN: p?.n ?? base.length, peerScope: p ? 'sector' : 'market' };
  });
  const R = st.rules, pass = r => (R.maxPE == null || r.pe <= R.maxPE) && (R.minROE == null || (r.roe ?? -1e9) >= R.minROE) && (R.minCumYoY == null || (r.revCumYoY ?? -1e9) >= R.minCumYoY) && (R.maxPEG == null || (r.peg != null && r.peg <= R.maxPEG)) && (R.minYield == null || (r.yield ?? 0) >= R.minYield);
  const picked = scored.filter(r => r.score != null && pass(r)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { strategy: o.strategy, name: st.name, desc: st.desc, rules: R, weights: st.weights, universe: rows.length, eligible: base.length, matched: picked.length,
    rows: picked.slice(0, o.limit).map(r => ({ ...r, reasons: reasons(r), warnings: warnings(r) })) };
}
export function reasons(r) {
  const out = [];
  if (r.pe != null && r.peerPE) { const d = (1 - r.pe / r.peerPE) * 100; if (d >= 10) out.push(`本益比 ${r1(r.pe)}，比${r.peerScope === 'sector' ? '同業' : '市場'}中位數低 ${Math.round(d)}%`); }
  if (r.pb != null && r.peerPB && r.pb < r.peerPB * 0.8) out.push(`淨值比 ${r2(r.pb)}（${r.peerScope === 'sector' ? '同業' : '市場'} ${r.peerPB}）`);
  if (r.roe >= 12) out.push(`估算 ROE ${r1(r.roe)}%`);
  if (r.revCumYoY >= 10) out.push(`今年累計營收年增 ${r1(r.revCumYoY)}%`);
  else if (r.revYoY >= 15) out.push(`單月營收年增 ${r1(r.revYoY)}%`);
  if (r.yield >= 5) out.push(`殖利率 ${r2(r.yield)}%`);
  if (r.peg != null && r.peg <= 1) out.push(`PEG ${r.peg}`);
  return out;
}
export function warnings(r) {
  const out = [];
  if (r.revYoY != null && r.revYoY <= -20) out.push(`最新單月營收年減 ${Math.abs(r1(r.revYoY))}%`);
  if (r.pe < 6) out.push('本益比偏低，留意是否為一次性獲利');
  if (r.yield >= 10) out.push('殖利率異常高，可能含一次性配息');
  if (r.turnover != null && r.turnover < 3e7) out.push('成交量偏小');
  return out;
}
