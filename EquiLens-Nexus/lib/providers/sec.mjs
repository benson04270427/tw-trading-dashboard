// 美國證管會 SEC EDGAR（美股，免費、免註冊；需填聯絡 email）：季營收（XBRL 財報數字，來自 10-Q／10-K，外國企業的 20-F／6-K 用 IFRS 營收）。
// SEC 規定請求要附「名稱＋聯絡 email」的 User-Agent（沒有 email 會被擋），且每秒不超過 10 次請求；這裡每次間隔 0.3 秒。
// 因此「金鑰」欄位填的是使用者自己的聯絡 email，只送到 sec.gov。
import { DataError, fetchJSON, limiter } from './common.mjs';

const LABEL = 'SEC EDGAR';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const headers = key => ({ 'User-Agent': `EquiLens research dashboard ${key}`, Accept: 'application/json' });
const queue = limiter(300);
const get = (url, ctx) => queue(async () => {
  if (!EMAIL.test(String(ctx.key || '').trim())) throw new DataError('{label}：請在金鑰欄位填入聯絡 email', { label: LABEL }, { fatal: true, code: 'auth' });
  const r = await fetchJSON(url, { headers: headers(String(ctx.key).trim()), signal: ctx.signal, label: LABEL, timeout: 60000 });
  if (r.status === 404) return null;
  if (r.status === 403 || r.status === 429) throw new DataError('{label} 額度或頻率限制，稍後再試', { label: LABEL }, { code: 'quota' });
  if (!r.ok) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
  return r.body;
}, ctx);

let tickers = { at: 0, map: null };
async function cikOf(id, ctx) {
  if (!tickers.map || Date.now() - tickers.at > 864e5) {
    const b = await get('https://www.sec.gov/files/company_tickers.json', ctx), map = new Map();
    for (const x of Object.values(b || {})) map.set(String(x.ticker).toUpperCase().replace('-', '.'), String(x.cik_str).padStart(10, '0'));
    tickers = { at: Date.now(), map };
  }
  return tickers.map.get(id.toUpperCase()) || tickers.map.get(id.toUpperCase().replace('.', '-')) || null;
}
// 營收標籤（依序嘗試，取資料最新的一個）
const TAGS = [['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'], ['us-gaap', 'Revenues'], ['us-gaap', 'SalesRevenueNet'], ['us-gaap', 'RevenueFromContractWithCustomerIncludingAssessedTax'], ['ifrs-full', 'Revenue']];
// companyfacts → 季營收列：只取 SEC 已對齊日曆季的 3 個月數值（frame＝CY2026Q2），不足時以年度數值扣掉前三季補出第 4 季
export function parseFacts(facts, id) {
  let best = null;
  for (const [tax, tag] of TAGS) {
    const units = facts?.facts?.[tax]?.[tag]?.units; if (!units) continue;
    const list = units.USD || Object.values(units)[0] || [], last = list.reduce((m, x) => x.end > m ? x.end : m, '');
    if (!best || last > best.last) best = { list, last };
  }
  if (!best) return [];
  const q = new Map(), annual = new Map();
  for (const x of best.list) {
    const m = /^CY(\d{4})Q([1-4])$/.exec(x.frame || ''); if (m) { q.set(`${m[1]}-${m[2]}`, { y: +m[1], q: +m[2], val: x.val, end: x.end, filed: x.filed }); continue; }
    const a = /^CY(\d{4})$/.exec(x.frame || ''); if (a) annual.set(+a[1], x);
  }
  for (const [y, a] of annual) { const k = `${y}-4`; if (!q.has(k) && [1, 2, 3].every(n => q.has(`${y}-${n}`))) q.set(k, { y, q: 4, val: a.val - [1, 2, 3].reduce((s, n) => s + q.get(`${y}-${n}`).val, 0), end: a.end, filed: a.filed }); }
  return [...q.values()].filter(r => Number.isFinite(r.val)).sort((a, b) => a.y * 4 + a.q - b.y * 4 - b.q).map(r => ({ date: r.end, stock_id: id, revenue_year: r.y, revenue_quarter: r.q, revenue: r.val, create_time: r.filed || r.end }));
}

export default {
  id: 'sec', name: 'SEC EDGAR（美國證管會）', site: 'https://www.sec.gov/edgar', docs: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', markets: ['US'],
  key: 'required', keyEnv: 'SEC_CONTACT_EMAIL', interval: 300,
  caps: { revenue: 'quarterly' },
  validate: async key => { const k = String(key || '').trim(); if (!EMAIL.test(k)) throw new DataError('{label}：請在金鑰欄位填入聯絡 email', { label: LABEL }); if (!(await get('https://www.sec.gov/files/company_tickers.json', { key: k }))) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: 404 }); return { plan: 'free', tier: 'free' }; },
  revenue: async (id, from, to, ctx) => {
    const cik = await cikOf(id, ctx); if (!cik) return [];
    return parseFacts(await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, ctx), id).filter(r => !to || r.date <= to);
  },
};
