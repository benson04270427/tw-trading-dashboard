// 財報分析與估價河流圖（台股、美股）。純計算；資料由 server.mjs 取得：
//   台股：FinMind 綜合損益表、資產負債表、現金流量表（季，免費）與每日本益比／股價淨值比（TaiwanStockPER）
//   美股：SEC EDGAR companyfacts（需聯絡 email，12 季以上，含每股盈餘）；沒有時用 Nasdaq 財報（最近 4 季）
// 河流圖：把過去 5 年的本益比（或股價淨值比）分成 5 個倍數，乘上當時的每股盈餘（近四季）或每股淨值畫成通道。
export const FIN_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const DAY = 864e5;
const div = (a, b) => a == null || b == null || !b ? null : a / b;
const pct = (a, b) => { const v = div(a, b); return v == null ? null : r1(v * 100); };
const growth = (a, b) => a == null || b == null || b <= 0 ? null : r1((a / b - 1) * 100);

// 每季一列 → 加上利潤率、ROE（單季年化）、自由現金流、負債比、年增率
export function finish(quarters) {
  const list = [...quarters].filter(q => q.revenue != null || q.eps != null).sort((a, b) => a.date.localeCompare(b.date));
  const yearAgo = q => { const t = Date.parse(q.date) - 365 * DAY; return list.find(x => Math.abs(Date.parse(x.date) - t) <= 20 * DAY) || null; };
  return list.map((q, i) => {
    const prev = i > 0 ? list[i - 1] : null, ya = yearAgo(q), eqAvg = q.equity != null ? (prev?.equity != null ? (q.equity + prev.equity) / 2 : q.equity) : null;
    const fcf = q.cfo != null ? q.cfo + (q.capex ?? 0) : null;
    return {
      date: q.date, label: `${q.date.slice(2, 4)}/${q.date.slice(5, 7)}`, revenue: q.revenue ?? null, grossProfit: q.grossProfit ?? null, opIncome: q.opIncome ?? null, netIncome: q.netIncome ?? null, eps: r2(q.eps),
      grossMargin: pct(q.grossProfit, q.revenue), opMargin: pct(q.opIncome, q.revenue), netMargin: pct(q.netIncome, q.revenue),
      roe: eqAvg > 0 && q.netIncome != null ? r1(q.netIncome * 4 / eqAvg * 100) : null,
      cfo: q.cfo ?? null, capex: q.capex ?? null, fcf, debtRatio: pct(q.liabilities, q.assets),
      revYoY: growth(q.revenue, ya?.revenue), epsYoY: ya?.eps > 0 && q.eps != null ? r1((q.eps / ya.eps - 1) * 100) : null, filed: q.filed || null,
    };
  });
}

// ---- 台股（FinMind：每列 { date, type, value }）----
// 現金流量表是年初至今累計，換算成單季（Q1 原值，之後減去同年度前一季累計）
function ytdToQuarter(rows) {
  const by = new Map(); for (const r of rows) by.set(String(r.date).slice(0, 10), Number(r.value));
  const out = new Map();
  for (const [d, v] of [...by].sort()) { const m = Number(d.slice(5, 7)), prevD = m > 3 ? `${d.slice(0, 4)}-${String(m - 3).padStart(2, '0')}` : null, prev = prevD ? [...by].find(([k]) => k.startsWith(prevD)) : null; out.set(d, m <= 3 ? v : prev ? v - prev[1] : null); }
  return out;
}
export function twQuarters({ statements = [], balance = [], cashflow = [] }) {
  const q = new Map(), at = d => { const k = String(d).slice(0, 10); if (!q.has(k)) q.set(k, { date: k }); return q.get(k); };
  const pick = (rows, map) => { for (const r of rows) { const f = map[r.type]; if (f && Number.isFinite(Number(r.value))) { const o = at(r.date); if (o[f] == null) o[f] = Number(r.value); } } };
  pick(statements, { Revenue: 'revenue', GrossProfit: 'grossProfit', OperatingIncome: 'opIncome', EquityAttributableToOwnersOfParent: 'netIncome', EPS: 'eps' });
  pick(statements, { IncomeAfterTaxes: 'netIncome' });
  pick(balance, { TotalAssets: 'assets', Liabilities: 'liabilities', EquityAttributableToOwnersOfParent: 'equity' });
  pick(balance, { Equity: 'equity' });
  const cfo = ytdToQuarter(cashflow.filter(r => r.type === 'CashFlowsFromOperatingActivities' || r.type === 'NetCashInflowFromOperatingActivities').filter((r, i, a) => a.findIndex(x => x.date === r.date) === i));
  const capex = ytdToQuarter(cashflow.filter(r => r.type === 'PropertyAndPlantAndEquipment'));
  for (const [d, v] of cfo) if (q.has(d)) q.get(d).cfo = v;
  for (const [d, v] of capex) if (q.has(d)) q.get(d).capex = v;
  return finish([...q.values()]);
}

// ---- 美股（SEC companyfacts）----
// 期間型數字（損益、現金流）：約 3 個月的直接採用；6／9／12 個月（年初至今或全年）減去同起始日、少一季的數字補出單季
const span = x => (Date.parse(x.end) - Date.parse(x.start)) / DAY;
function durationQuarters(list) {
  // 同一期間：數字取最新申報（更正、重編後），公布日取最早申報（第一次公布的時間）
  // 偶爾有申報把數字標錯單位（差上千倍），最新申報和其他申報的中位數差 20 倍以上時改用其他申報中最新的一筆
  const latest = new Map(), first = new Map(), byKey = new Map(); for (const x of list) { if (!x.start || !x.end || !Number.isFinite(x.val)) continue; const k = x.start + x.end; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x); if (x.filed && (!first.has(k) || String(x.filed) < first.get(k))) first.set(k, String(x.filed)); }
  for (const [k, xs] of byKey) latest.set(k, pickFact(xs));
  const known = x => first.get(x.start + x.end) || x.filed;
  const all = [...latest.values()].sort((a, b) => span(a) - span(b)), q = new Map();
  for (const x of all) { const d = span(x); if (d >= 80 && d <= 100 && !q.has(x.end)) q.set(x.end, { end: x.end, val: x.val, filed: known(x) }); }
  for (const x of all) {
    const d = span(x); if (d <= 100 || d > 380 || q.has(x.end)) continue;
    const prev = all.find(y => y.start === x.start && y.end < x.end && (Date.parse(x.end) - Date.parse(y.end)) / DAY >= 80 && (Date.parse(x.end) - Date.parse(y.end)) / DAY <= 100);
    if (prev) { q.set(x.end, { end: x.end, val: x.val - prev.val, filed: known(x), src: x }); continue; }
    if (d >= 350) { const inside = [...q.values()].filter(y => y.end > x.start && y.end < x.end); if (inside.length === 3) q.set(x.end, { end: x.end, val: x.val - inside.reduce((s, y) => s + y.val, 0), filed: known(x), src: x }); }
  }
  // 推算的單季和前後幾季差距離譜（例如全年數字標錯單位，算出 -15 億）就不採用
  for (const [k, v] of q) { if (!v.src) continue; const others = [...q.values()].filter(y => !y.src && y.val !== 0 && Math.abs(Date.parse(y.end) - Date.parse(k)) < 400 * DAY).map(y => Math.abs(y.val)); if (others.length >= 2) { const m = others.sort((a, b) => a - b)[Math.floor(others.length / 2)]; if (Math.abs(v.val) > m * 20 || (Math.abs(v.src.val) < m / 20 && v.src.val !== 0)) q.delete(k); } }
  return q;
}
function pickFact(xs) {
  const s = [...xs].sort((a, b) => String(b.filed).localeCompare(String(a.filed))), top = s[0]; if (s.length < 2 || !top.val) return top;
  const rest = s.slice(1).map(x => Math.abs(x.val)).filter(v => v > 0).sort((a, b) => a - b); if (!rest.length) return top;
  const m = rest[Math.floor(rest.length / 2)], r = Math.abs(top.val) / m;
  return r > 20 || r < 0.05 ? s.slice(1).find(x => { const q = Math.abs(x.val) / m; return q <= 20 && q >= 0.05; }) || top : top;
}
function instants(list) { const m = new Map(); for (const x of list) { if (!x.end || x.start || !Number.isFinite(x.val)) continue; if (!m.has(x.end) || String(x.filed) > String(m.get(x.end).filed)) m.set(x.end, { end: x.end, val: x.val, filed: x.filed }); } return m; }
const CONCEPTS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'ifrs:Revenue'],
  grossProfit: ['GrossProfit', 'ifrs:GrossProfit'], opIncome: ['OperatingIncomeLoss', 'ifrs:ProfitLossFromOperatingActivities'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss', 'ifrs:ProfitLossAttributableToOwnersOfParent', 'ifrs:ProfitLoss'], eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic', 'ifrs:DilutedEarningsLossPerShare'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'ifrs:CashFlowsFromUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'ifrs:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
};
const INSTANT = { assets: ['Assets', 'ifrs:Assets'], liabilities: ['Liabilities', 'ifrs:Liabilities'], equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs:EquityAttributableToOwnersOfParent'], le: ['LiabilitiesAndStockholdersEquity', 'ifrs:EquityAndLiabilities'] };
// 只用財報（10-Q、10-K、20-F、40-F、6-K 與更正版）；股東會委託書（DEF 14A）的薪酬對照表常以百萬元列淨利，會混進錯的數字
const REPORT_FORM = /^(10-Q|10-K|20-F|40-F|6-K|8-K)/;
function factList(facts, tag) {
  const [tax, name] = tag.startsWith('ifrs:') ? ['ifrs-full', tag.slice(5)] : ['us-gaap', tag], units = facts?.facts?.[tax]?.[name]?.units; if (!units) return [];
  return (units.USD || units['USD/shares'] || Object.values(units)[0] || []).filter(x => !x.form || REPORT_FORM.test(x.form));
}
// 合併同一概念的多個標籤：資料越新的標籤優先，缺的季度由其他標籤補
function merged(facts, tags, fn) {
  const sets = tags.map(t => fn(factList(facts, t))).filter(m => m.size).sort((a, b) => Math.max(...[...b.keys()].map(Date.parse)) - Math.max(...[...a.keys()].map(Date.parse)));
  const out = new Map(); for (const m of sets) for (const [k, v] of m) if (![...out.keys()].some(e => Math.abs(Date.parse(e) - Date.parse(k)) <= 5 * DAY)) out.set(k, v);
  return out;
}
export function secQuarters(facts) {
  const cols = {}; for (const [k, tags] of Object.entries(CONCEPTS)) cols[k] = merged(facts, tags, durationQuarters);
  const inst = {}; for (const [k, tags] of Object.entries(INSTANT)) inst[k] = merged(facts, tags, instants);
  const base = cols.revenue.size ? cols.revenue : cols.eps, near = (m, d) => { for (const [k, v] of m) if (Math.abs(Date.parse(k) - Date.parse(d)) <= 5 * DAY) return v; return null; };
  // 推算出來的單季 EPS（全年或年初累計減前期）可能混到分割前後不同口徑，改用「單季淨利 ÷ 同一期間的股數（淨利 ÷ EPS）」
  const niAll = new Map(); for (const t of CONCEPTS.netIncome) for (const x of factList(facts, t)) { if (!x.start || !Number.isFinite(x.val)) continue; const k = x.start + x.end; if (!niAll.has(k)) niAll.set(k, []); niAll.get(k).push(x); }
  const niFacts = new Map([...niAll].map(([k, xs]) => [k, pickFact(xs)]));
  const rows = [...base.keys()].map(d => {
    const o = { date: d }; for (const k of Object.keys(CONCEPTS)) { const v = near(cols[k], d); o[k] = v?.val ?? null; if (k === 'eps' && v) o.filed = v.filed; }
    const ev = near(cols.eps, d), ni = niFacts.get(ev?.src ? ev.src.start + ev.src.end : '');
    if (ev?.src && ni && ev.src.val && o.netIncome != null && ni.val / ev.src.val > 0) o.eps = o.netIncome / (ni.val / ev.src.val);
    if (o.capex != null) o.capex = -Math.abs(o.capex);
    o.assets = near(inst.assets, d)?.val ?? null; o.equity = near(inst.equity, d)?.val ?? null;
    o.liabilities = near(inst.liabilities, d)?.val ?? (near(inst.le, d)?.val != null && o.equity != null ? near(inst.le, d).val - o.equity : null);
    o.filed = o.filed || near(cols.revenue, d)?.filed || null; return o;
  });
  return finish(splitAdjust(rows));
}
// 股票分割：舊財報的 EPS 沒有依之後的分割調整（股價是調整後的），以「淨利 ÷ EPS」推算的股數突然倍增來判斷分割比例，回溯調整更早的 EPS
const SPLITS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50];
export function splitAdjust(rows) {
  const list = [...rows].sort((a, b) => a.date.localeCompare(b.date)), sh = list.map(x => x.eps && x.netIncome && x.eps * x.netIncome > 0 ? x.netIncome / x.eps : null);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  // 由新到舊：每一季的股數和較新幾季（已調整）的中位數比較，差距接近某個分割倍數就換算成最新口徑（同一年度內可能新舊口徑交錯）
  const recent = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (sh[i] == null) continue;
    const ref = recent.length ? med(recent.slice(-3)) : sh[i], r = ref / sh[i];
    const k = Math.abs(r - 1) < 0.5 ? 1 : SPLITS.find(k => Math.abs(r / k - 1) < 0.15);
    if (!k) continue;
    recent.push(sh[i] * k);
    if (k > 1 && list[i].eps != null) list[i] = { ...list[i], eps: list[i].eps / k, split: k };
  }
  return list;
}
// ---- 美股（Nasdaq 財報，最近 4 季；金額單位為千美元）----
export function nasdaqQuarters(data) {
  const hdr = data?.incomeStatementTable?.headers; if (!hdr) return [];
  const cols = Object.keys(hdr).filter(k => k !== 'value1'), dates = cols.map(k => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(hdr[k] || ''); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; });
  const val = s => { const t = String(s ?? '').replace(/[$,\s]/g, ''), neg = /^\(.*\)$/.test(t) || t.startsWith('-'), n = Number(t.replace(/[()-]/g, '')); return t && Number.isFinite(n) ? (neg ? -n : n) * 1000 : null; };
  const get = (table, label) => (data?.[table]?.rows || []).find(r => r.value1 === label);
  const map = { revenue: ['incomeStatementTable', 'Total Revenue'], grossProfit: ['incomeStatementTable', 'Gross Profit'], opIncome: ['incomeStatementTable', 'Operating Income'], netIncome: ['incomeStatementTable', 'Net Income'], assets: ['balanceSheetTable', 'Total Assets'], liabilities: ['balanceSheetTable', 'Total Liabilities'], equity: ['balanceSheetTable', 'Total Equity'], cfo: ['cashFlowTable', 'Net Cash Flow-Operating'], capex: ['cashFlowTable', 'Capital Expenditures'] };
  return finish(dates.map((d, i) => { if (!d) return null; const o = { date: d }; for (const [k, [t, l]] of Object.entries(map)) o[k] = val(get(t, l)?.[cols[i]]); return o; }).filter(Boolean));
}

// ---- 估價河流圖 ----
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
// 倍數上限：超過視為獲利接近 0 的失真點
export const RIVER_CAP = { pe: 150, pb: 50 };
// points：[[date, close, base]]（base＝近四季 EPS 或每股淨值，> 0），每週取一點
export function buildRiver(points, { kind = 'pe', years = 5, asOf = null } = {}) {
  const all = points.filter(x => x[1] > 0 && x[2] > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (all.length < 120) return null;
  // 最近一點離最新收盤太久（近幾季虧損或財報缺漏），不能拿舊的倍數當現在的位置
  if (asOf && Date.parse(asOf) - Date.parse(all.at(-1)[0]) > 120 * DAY) return { kind, unusable: '近期獲利資料不足（近四季虧損或財報缺漏），無法畫河流圖', stale: all.at(-1)[0] };
  const cut = new Date(Date.parse(all.at(-1)[0]) - years * 365.25 * DAY).toISOString().slice(0, 10), inWin = all.filter(x => x[0] >= cut);
  // 獲利接近 0 時倍數會爆掉（例如 EPS 0.17、本益比上千倍），這些點不算進通道；剩下太少或倍數分散太大就不畫
  const cap = RIVER_CAP[kind] ?? Infinity, w = inWin.filter(x => x[1] / x[2] <= cap), dropped = inWin.length - w.length;
  const why = '獲利不穩定（曾虧損或獲利接近 0），歷史倍數失真，河流圖參考性低';
  if (w.length < 120 || dropped / inWin.length > 0.4) return { kind, unusable: why, dropped, total: inWin.length };
  if (Date.parse(w.at(-1)[0]) - Date.parse(w[0][0]) < 2 * 365 * DAY) return { kind, unusable: '可用的獲利歷史不到 2 年（之前虧損或剛上市），歷史倍數樣本太少，河流圖參考性低', dropped, total: inWin.length };
  if (Math.abs(w.at(-1)[1] / w.at(-1)[2]) > cap || w.at(-1)[0] !== inWin.at(-1)[0]) return { kind, unusable: why, dropped, total: inWin.length };
  const mult = w.map(x => x[1] / x[2]), levels = [0.1, 0.3, 0.5, 0.7, 0.9].map(k => q(mult, k)).map(v => v < 10 ? r1(v) : Math.round(v));
  const weekly = w.filter((x, i) => i === w.length - 1 || new Date(x[0] + 'T00:00:00Z').getUTCDay() === 5 || (w[i + 1] && Date.parse(w[i + 1][0]) - Date.parse(x[0]) > 3 * DAY));
  const last = w.at(-1), now = last[1] / last[2], rank = mult.filter(v => v < now).length / mult.length * 100;
  const zone = rank < 30 ? '偏低' : rank > 70 ? '偏高' : '合理', spread = levels[0] > 0 ? levels[4] / levels[0] : null;
  if (spread > 6) return { kind, unusable: '獲利起伏太大（景氣循環或曾接近虧損），歷史倍數高低相差超過 6 倍，河流圖參考性低', dropped, total: inWin.length, spread: r1(spread) };
  const warn = dropped / inWin.length > 0.1 || spread > 4 ? '獲利波動大，歷史倍數分散，河流圖僅供參考' : null;
  return { kind, warn, dropped, spread: r1(spread), years: r1((Date.parse(last[0]) - Date.parse(w[0][0])) / DAY / 365.25), levels, series: weekly.map(x => [x[0], r2(x[1]), r2(x[2]), ...levels.map(l => r2(x[2] * l))]),
    date: last[0], price: r2(last[1]), base: r2(last[2]), multiple: r1(now), percentile: r1(rank), zone, fair: r2(last[2] * levels[2]), cheap: r2(last[2] * levels[1]), rich: r2(last[2] * levels[3]) };
}
// 台股：TaiwanStockPER（PER、PBR）→ EPS＝收盤÷本益比、每股淨值＝收盤÷股價淨值比
export function twRiverPoints(perRows, closes, kind = 'pe') {
  const c = new Map(closes.map(x => [x[0], x[1]])), k = kind === 'pb' ? 'PBR' : 'PER';
  return perRows.map(r => { const d = String(r.date).slice(0, 10), px = c.get(d), m = Number(r[k]); return px > 0 && m > 0 ? [d, px, px / m] : null; }).filter(Boolean);
}
// 美股：每季 EPS（含申報日）→ 每個交易日當時已公布的近四季 EPS
export function usRiverPoints(quarters, closes) {
  const qs = quarters.filter(x => x.eps != null).map(x => ({ ...x, known: x.filed || new Date(Date.parse(x.date) + 45 * DAY).toISOString().slice(0, 10) })).sort((a, b) => a.date.localeCompare(b.date));
  return closes.map(([d, px]) => { const k = qs.filter(x => x.known <= d).slice(-4); if (k.length < 4 || Date.parse(k[3].date) - Date.parse(k[0].date) > 300 * DAY) return null; const ttm = k.reduce((s, x) => s + x.eps, 0); return ttm > 0 ? [d, px, ttm] : null; }).filter(Boolean);
}
// 畫面資料
export function buildFinancials({ id, name, market, quarters = [], source = '', note = '' }) {
  const list = quarters.slice(-12);
  if (!list.length) return { id, name, market, available: false, reason: '這檔股票沒有財報資料。' };
  const last = list.at(-1), ttm = list.slice(-4), sum = k => ttm.length === 4 && ttm.every(x => x[k] != null) ? ttm.reduce((s, x) => s + x[k], 0) : null;
  return { version: FIN_VERSION, id, name, market, available: true, source, note, quarters: list,
    summary: { date: last.date, epsTTM: r2(sum('eps')), revenueTTM: sum('revenue'), fcfTTM: sum('fcf'), grossMargin: last.grossMargin, opMargin: last.opMargin, roe: last.roe, debtRatio: last.debtRatio, revYoY: last.revYoY } };
}
