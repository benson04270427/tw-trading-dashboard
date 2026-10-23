// 股利與除權息（台股、美股）。純計算；資料由 server.mjs 取得：
//   台股：FinMind 股利政策（TaiwanStockDividend）、除權息結果（TaiwanStockDividendResult，含除權息前收盤），
//         證交所／櫃買「除權除息預告表」（全市場，免金鑰）
//   美股：Nasdaq 股利紀錄（每檔 1 個請求）
// 填息天數：除息日起，收盤價回到除息前一日收盤（台股以除權息結果的「除權息前收盤價」為準）所需的交易日數。
import { rocDate } from './providers/common.mjs';

export const DIV_VERSION = '1.0';
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const n = v => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : null; };
const usDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const iso = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : null;
const addDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);

// 台股股利政策 → 事件（新到舊）。現金＝盈餘＋公積配息（元／股），股票＝盈餘＋公積配股（元／股，每 10 元面額配 1 股）
export function twEvents(rows = []) {
  return rows.map(r => {
    const cash = (n(r.CashEarningsDistribution) || 0) + (n(r.CashStatutorySurplus) || 0), stock = (n(r.StockEarningsDistribution) || 0) + (n(r.StockStatutorySurplus) || 0);
    return { period: String(r.year || ''), cash: r2(cash) || 0, stock: r2(stock) || 0, exDate: iso(r.CashExDividendTradingDate) || iso(r.StockExDividendTradingDate), payDate: iso(r.CashDividendPaymentDate), announced: iso(r.AnnouncementDate) || iso(r.date) };
  }).filter(e => e.cash > 0 || e.stock > 0).sort((a, b) => String(b.exDate || b.announced).localeCompare(String(a.exDate || a.announced)));
}
// 美股 Nasdaq 股利紀錄 → 事件（新到舊）
export function usEvents(data) {
  return (data?.dividends?.rows || []).map(r => ({ period: r.type || 'Cash', cash: r2(n(r.amount)) || 0, stock: 0, exDate: usDate(r.exOrEffDate), payDate: usDate(r.paymentDate), recordDate: usDate(r.recordDate), announced: usDate(r.declarationDate) }))
    .filter(e => e.exDate && e.cash > 0).sort((a, b) => b.exDate.localeCompare(a.exDate));
}
// 填息：closes＝[[date, close]]（由舊到新）；before＝除息前一日收盤（台股可由除權息結果提供）
export function fillBack(closes, exDate, before = null) {
  const i = closes.findIndex(x => x[0] >= exDate); if (i < 0) return null;
  const ref = before ?? (i > 0 ? closes[i - 1][1] : null); if (!(ref > 0)) return null;
  for (let j = i; j < closes.length; j++) if (closes[j][1] >= ref) return { before: r2(ref), filled: true, days: j - i + 1, date: closes[j][0] };
  return { before: r2(ref), filled: false, days: closes.length - i };
}
// 單檔股利頁
export function buildDividends({ id, name, market, events = [], results = [], closes = [], price = null, today, shares = null, header = null }) {
  if (!events.length) return { id, name, market, available: false, reason: '這檔股票沒有配息紀錄。' };
  const res = new Map(results.map(r => [iso(r.date), n(r.before_price)]));
  const past = events.filter(e => e.exDate && e.exDate <= today), upcoming = events.filter(e => e.exDate && e.exDate > today).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const list = events.slice(0, 16).map(e => ({ ...e, fill: e.exDate && e.exDate <= today ? fillBack(closes, e.exDate, res.get(e.exDate) ?? null) : null }));
  const year = addDays(today, -365), ttm = r2(past.filter(e => e.exDate > year).reduce((s, e) => s + e.cash, 0));
  const byYear = new Map(); for (const e of past) { const y = e.exDate.slice(0, 4); byYear.set(y, r2((byYear.get(y) || 0) + e.cash)); }
  const filled = list.filter(e => e.fill?.filled);
  return { version: DIV_VERSION, id, name, market, available: true, price, ttmCash: ttm, yield: price > 0 ? r2(ttm / price * 100) : null,
    annual: header?.annual ?? null, headerYield: header?.yield ?? null, upcoming, events: list,
    years: [...byYear].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([y, cash]) => ({ year: y, cash })),
    avgFillDays: filled.length ? Math.round(filled.reduce((s, e) => s + e.fill.days, 0) / filled.length) : null, fillRate: list.filter(e => e.fill).length ? Math.round(filled.length / list.filter(e => e.fill).length * 100) : null,
    shares, income: shares > 0 ? { ttm: r2(ttm * shares), next: upcoming.length ? r2(upcoming[0].cash * shares) : null } : null };
}
// 證交所／櫃買除權除息預告表 → [{ id, name, date, type, cash, stockRatio }]
export function twExRights(twse = [], tpex = []) {
  const out = [];
  for (const r of twse) { const d = rocDate(r.Date), id = String(r.Code || '').trim(); if (d && id) out.push({ id, name: String(r.Name || '').trim(), date: d, type: String(r.Exdividend || '').trim(), cash: n(r.CashDividend) || null, stockRatio: n(r.StockDividendRatio) || null }); }
  for (const r of tpex) { const d = rocDate(r.ExRrightsExDividendDate || r.ExRightsExDividendDate), id = String(r.SecuritiesCompanyCode || '').trim(); if (d && id) out.push({ id, name: String(r.CompanyName || '').trim(), date: d, type: String(r.ExRrightsExDividend || r.ExRightsExDividend || '').replace(/^除/, '').trim(), cash: n(r.CashDividend) || null, stockRatio: n(r.StockDividendRatio) || null }); }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
// 行事曆：未來 days 天內的除權息（持股優先，其次自選）；perStock＝Map(id → 事件，補金額與發放日)
export function calendar({ today, days = 30, market = [], perStock = new Map(), holdings = [], watch = new Set(), names = new Map() }) {
  const end = addDays(today, days), held = new Map(holdings.map(h => [h.id, h])), seen = new Set(), out = [];
  const push = (id, x) => { const k = id + x.date; if (seen.has(k)) return; seen.add(k); const h = held.get(id), cash = x.cash ?? null; out.push({ id, name: x.name || names.get(id) || id, date: x.date, type: x.type || '息', cash, payDate: x.payDate || null, held: !!h, watch: watch.has(id), shares: h?.shares ?? null, income: h && cash ? r2(cash * h.shares) : null }); };
  for (const [id, evs] of perStock) for (const e of evs) if (e.exDate > today && e.exDate <= end) push(id, { date: e.exDate, cash: e.cash || null, payDate: e.payDate, type: e.stock > 0 ? (e.cash > 0 ? '權息' : '權') : '息' });
  for (const x of market) if (x.date >= today && x.date <= end && (held.has(x.id) || watch.has(x.id))) { const k = x.id + x.date; if (!seen.has(k)) push(x.id, x); }
  out.sort((a, b) => a.date.localeCompare(b.date) || Number(b.held) - Number(a.held));
  return { from: today, to: end, items: out, income: r2(out.reduce((s, x) => s + (x.income || 0), 0)) };
}
