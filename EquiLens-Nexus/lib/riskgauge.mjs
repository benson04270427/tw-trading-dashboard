// 風控水位（台股）：以散戶情緒、外資資金流向、融資、匯率與大盤趨勢評估市場風險，換算成建議持股水位。
// 純計算（不讀寫檔案）；資料由 fetchRiskInputs 透過 FinMind 取得（免費等級即可，未設定金鑰時以匿名額度查詢），
// 每次更新 7 個請求，各取約 400 天，用來計算每個指標在過去一年中的相對位置（百分位）。
import { institutionNet, totalOI } from './market-card.mjs';

export const RISK_VERSION = '1.0';
const num = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// 指標：risk 越高代表市場風險越高。dir：+1 數值越高風險越高，-1 數值越低風險越高；rule：以規則換算（不用百分位）
export const FACTORS = [
  { key: 'retail', name: '散戶多空比', weight: 20, dir: 1, unit: '%', group: '散戶情緒', desc: '小台指散戶淨部位 ÷ 全市場未平倉。散戶越偏多，越常是短線過熱的反向訊號' },
  { key: 'margin', name: '融資增減（20 日）', weight: 15, dir: 1, unit: '%', group: '散戶情緒', desc: '上市櫃融資餘額 20 個交易日的變化率。融資快速增加代表散戶槓桿升高' },
  { key: 'foreignFut', name: '外資台指期淨部位', weight: 20, dir: -1, unit: '口', group: '外資動向', desc: '外資在台指期（大台）的多空未平倉淨口數。淨空單越大，代表外資避險或看空越強' },
  { key: 'foreignSpot', name: '外資現貨（20 日累計）', weight: 15, dir: -1, unit: '億', group: '外資動向', desc: '外資及陸資近 20 個交易日的上市櫃買賣超金額合計' },
  { key: 'fx', name: '新台幣匯率（20 日）', weight: 10, dir: 1, unit: '%', group: '外資動向', desc: '美元兌新台幣 20 日變化率。新台幣貶值（數值為正）常伴隨熱錢流出' },
  { key: 'trend', name: '大盤趨勢', weight: 20, dir: -1, unit: '%', group: '大盤', rule: true, desc: '加權指數與 60 日均線的乖離，以及 20 日均線是否在 60 日均線之上' },
];
// 風險分數 → 等級與建議持股水位（股票占可投資資金的比例，介於 20%～90%，以 10% 為單位）
export const LEVELS = [[25, '低風險', 'low'], [40, '偏低', 'lowish'], [60, '中性', 'mid'], [75, '偏高', 'highish'], [101, '高風險', 'high']];
export const level = risk => { const l = LEVELS.find(([max]) => risk < max) || LEVELS.at(-1); return { label: l[1], tone: l[2] }; };
export const exposure = risk => risk == null ? null : clamp(Math.round((100 - risk) / 10) * 10, 20, 90);

// 依日期排序的序列：[[date, value], ...]
export const series = map => [...map].filter(([, v]) => v != null && Number.isFinite(v)).sort((a, b) => a[0].localeCompare(b[0]));
// 某日（含）以前最近一筆，最多往前找 maxGap 筆交易日資料
export function at(list, date) { let lo = 0, hi = list.length - 1, found = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= date) { found = m; lo = m + 1; } else hi = m - 1; } return found; }
// 百分位：value 在 window 中小於它的比例（同值算一半），0～100
export function percentile(window, value) {
  if (!window.length || value == null) return null;
  let below = 0, equal = 0; for (const v of window) { if (v < value) below++; else if (v === value) equal++; }
  return (below + equal / 2) / window.length * 100;
}
const sma = (vals, n) => vals.length >= n ? vals.slice(-n).reduce((a, b) => a + b, 0) / n : null;

// ---- 原始資料 → 每日數值 ----
// 散戶多空比（%）：−法人淨未平倉 ÷ 全市場未平倉（一般交易時段，排除價差組合）
export function retailSeries(instRows = [], dailyRows = []) {
  const dates = [...new Set(instRows.map(r => r.date))].sort(), m = new Map();
  for (const d of dates) { const inst = institutionNet(instRows, d), oi = totalOI(dailyRows, d); if (inst != null && oi > 0) m.set(d, r2(-inst / oi * 100)); }
  return series(m);
}
// 外資台指期淨未平倉（口）
export function foreignFutSeries(rows = []) {
  const m = new Map();
  for (const r of rows) { if (r.institutional_investors !== '外資' && r.institutional_investors !== '外資及陸資') continue; const l = num(r.long_open_interest_balance_volume), s = num(r.short_open_interest_balance_volume); if (l != null && s != null) m.set(r.date, l - s); }
  return series(m);
}
// 外資現貨買賣超（億元／日），再取 20 日累計
export function foreignSpotSeries(rows = []) {
  const m = new Map();
  for (const r of rows) { if (!['Foreign_Investor', 'Foreign_Dealer_Self'].includes(r.name)) continue; const b = num(r.buy), s = num(r.sell); if (b == null || s == null) continue; m.set(r.date, (m.get(r.date) || 0) + (b - s) / 1e8); }
  return rolling(series(m), 20, w => w.reduce((a, b) => a + b, 0));
}
// 融資金額（億元），再取 20 日變化率
export function marginSeries(rows = []) {
  const m = new Map();
  for (const r of rows) if (r.name === 'MarginPurchaseMoney') { const v = num(r.TodayBalance); if (v > 0) m.set(r.date, v / 1e8); }
  return change(series(m), 20);
}
// 美元兌新台幣（即期買入），再取 20 日變化率
export function fxSeries(rows = []) {
  const m = new Map();
  for (const r of rows) { const v = num(r.spot_buy) > 0 ? num(r.spot_buy) : num(r.cash_buy); if (v > 0) m.set(r.date, v); }
  return change(series(m), 20);
}
export function indexSeries(rows = []) { const m = new Map(); for (const r of rows) { const c = num(r.close); if (c > 0) m.set(r.date, c); } return series(m); }
export function rolling(list, n, fn) { const out = []; for (let i = n - 1; i < list.length; i++) out.push([list[i][0], r2(fn(list.slice(i - n + 1, i + 1).map(x => x[1])))]); return out; }
export function change(list, n) { const out = []; for (let i = n; i < list.length; i++) out.push([list[i][0], r2((list[i][1] / list[i - n][1] - 1) * 100)]); return out; }
// 大盤趨勢：與 60 日均線的乖離（%）與 20／60 日均線排列
export function trendSeries(index) {
  const out = [], closes = index.map(x => x[1]);
  for (let i = 59; i < index.length; i++) { const w = closes.slice(0, i + 1), m20 = sma(w, 20), m60 = sma(w, 60); out.push([index[i][0], { dev: r2((closes[i] / m60 - 1) * 100), up: m20 >= m60, ma20: r1(m20), ma60: r1(m60) }]); }
  return out;
}
// 趨勢風險：乖離 +10% → 10，0% → 50，−10% → 90；20 日均線在 60 日均線之下再加 10
export const trendRisk = t => t ? clamp(50 - t.dev * 4 + (t.up ? 0 : 10)) : null;

// ---- 評分 ----
// 每個指標在 date 的值與風險分數（與過去 lookback 筆比較，至少 minHistory 筆才評分）
function factorAt(f, list, date, { lookback = 250, minHistory = 40 } = {}) {
  const i = at(list, date); if (i < 0) return null;
  const [asOf, value] = list[i];
  if (f.rule) return { value: value.dev, asOf, risk: r1(trendRisk(value)), detail: value };
  const window = list.slice(Math.max(0, i - lookback), i + 1).map(x => x[1]);
  if (window.length < minHistory) return { value, asOf, risk: null, pct: null };
  const p = percentile(window, value);
  return { value, asOf, pct: r1(p), risk: r1(f.dir > 0 ? p : 100 - p) };
}
export function scoreAt(seriesMap, date, opt, defs = FACTORS) {
  const factors = defs.map(f => ({ ...f, ...(factorAt(f, seriesMap[f.key] || [], date, opt) || { value: null, risk: null }) }));
  const used = factors.filter(f => f.risk != null), w = used.reduce((a, f) => a + f.weight, 0);
  const risk = w ? r1(used.reduce((a, f) => a + f.risk * f.weight, 0) / w) : null;
  return { date, risk, exposure: exposure(risk), ...(risk == null ? { label: null, tone: null } : level(risk)), coverage: Math.round(w / defs.reduce((a, f) => a + f.weight, 0) * 100), factors };
}
// 完整結果：最新評分、近 days 個交易日的風險與指數走勢、與前一日／前一週比較
// 原始資料 → 各指標每日序列、指數、評分日（風控水位與配方回測共用）
export function twSeries(raw) {
  const index = indexSeries(raw.index);
  const s = { retail: retailSeries(raw.mtxInst, raw.mtxDaily), margin: marginSeries(raw.margin), foreignFut: foreignFutSeries(raw.txInst), foreignSpot: foreignSpotSeries(raw.spot), fx: fxSeries(raw.fx), trend: trendSeries(index) };
  // 以各指標最新日期中最晚者為評分日（期貨與匯率比融資早公布）
  const dates = [...new Set([...index.map(x => x[0]), ...s.retail.map(x => x[0])])].sort();
  return { s, index, dates };
}
export function buildRisk(raw, { days = 120, now = new Date().toISOString() } = {}) {
  const { s, index, dates } = twSeries(raw);
  return assemble(s, dates, index, raw, { days, now, defs: FACTORS, market: 'TW', indexName: '加權指數' });
}
// 共用：依評分日組成最新評分、近 days 日走勢與一日／一週變化（台股與美股共用）
export function assemble(s, dates, index, raw, { days = 120, now = new Date().toISOString(), defs = FACTORS, market = 'TW', indexName = '' } = {}) {
  if (!dates.length) return { version: RISK_VERSION, market, indexName, available: false, updatedAt: now, errors: raw.errors || {} };
  const latest = dates.at(-1), current = scoreAt(s, latest, undefined, defs);
  const hist = dates.slice(-days).map(d => { const x = scoreAt(s, d, undefined, defs), ix = index[at(index, d)]; return [d, x.risk, x.exposure, ix ? ix[1] : null]; });
  const prev = hist.length > 1 ? hist.at(-2)[1] : null, week = hist.length > 5 ? hist.at(-6)[1] : null;
  return { version: RISK_VERSION, market, indexName, available: current.risk != null, updatedAt: now, ...current, change1: prev == null || current.risk == null ? null : r1(current.risk - prev), change5: week == null || current.risk == null ? null : r1(current.risk - week),
    history: hist, summary: summarize(current), errors: raw.errors || {} };
}
// 文字說明：風險最高與最低的兩個指標
export function summarize(x) {
  const used = x.factors.filter(f => f.risk != null).sort((a, b) => b.risk - a.risk);
  if (!used.length) return [];
  const hot = used.filter(f => f.risk >= 65).slice(0, 2), cool = used.filter(f => f.risk <= 35).slice(-2).reverse();
  return [...hot.map(f => ({ tone: 'risk', key: f.key, name: f.name, risk: f.risk })), ...cool.map(f => ({ tone: 'calm', key: f.key, name: f.name, risk: f.risk }))];
}

// ---- 資料取得（FinMind，7 個請求） ----
const minus = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
export const RISK_TASKS = (date, days = 420) => { const start = minus(date, days); return [
  ['index', 'TaiwanStockPrice', { data_id: 'TAIEX', start_date: start, end_date: date }],
  ['mtxInst', 'TaiwanFuturesInstitutionalInvestors', { data_id: 'MTX', start_date: start, end_date: date }],
  ['mtxDaily', 'TaiwanFuturesDaily', { data_id: 'MTX', start_date: start, end_date: date }],
  ['txInst', 'TaiwanFuturesInstitutionalInvestors', { data_id: 'TX', start_date: start, end_date: date }],
  ['spot', 'TaiwanStockTotalInstitutionalInvestors', { start_date: start, end_date: date }],
  ['margin', 'TaiwanStockTotalMarginPurchaseShortSale', { start_date: start, end_date: date }],
  ['fx', 'TaiwanExchangeRate', { data_id: 'USD', start_date: start, end_date: date }],
]; };
// request(dataset, params, options) 同 FinMind 佇列；遇到額度或金鑰問題（fatal）時停止其餘請求
export async function fetchRiskInputs(date, request, options = {}, onProgress = () => {}, days = 420) {
  const raw = { errors: {} }, tasks = RISK_TASKS(date, days); let stop = null;
  for (const [i, [key, dataset, params]] of tasks.entries()) {
    onProgress(i, tasks.length, key);
    if (stop) { raw[key] = []; raw.errors[key] = stop; continue; }
    try { raw[key] = await request(dataset, params, options); } catch (e) { raw[key] = []; raw.errors[key] = e.message; if (e.fatal) stop = e.message; }
  }
  return raw;
}
// 給 AI 解讀用的精簡內容
export function riskContext(r) {
  return { 日期: r.date, 風險分數: r.risk, 等級: r.label, 建議持股: r.exposure + '%', 一日變化: r.change1, 一週變化: r.change5,
    指標: r.factors.map(f => ({ 名稱: f.name, 數值: f.value, 單位: f.unit, 一年百分位: f.pct ?? null, 風險: f.risk, 說明: f.desc })) };
}
