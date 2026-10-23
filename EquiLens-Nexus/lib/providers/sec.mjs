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
// companyfacts → 季營收列。
// 取約 3 個月（80～100 天）的數值為單季；10-K 只報全年時，以全年（350～380 天）扣掉同一年度內的三個單季補出最後一季。
// 公司常換營收標籤（例如 2025 年起改用 IncludingAssessedTax），因此合併所有標籤：資料越新的標籤優先，缺的季度由其他標籤補。
// 季別以期末日期（往前 15 天）所在的日曆季計，與財報年度無關（例如 6 月結帳的公司，12 月底結束的季度算 Q4）。
const DAY = 864e5, span = x => (Date.parse(x.end) - Date.parse(x.start)) / DAY;
export function parseFacts(facts, id) {
  const tags = [];
  for (const [tax, tag] of TAGS) {
    const units = facts?.facts?.[tax]?.[tag]?.units; if (!units) continue;
    const list = (units.USD || Object.values(units)[0] || []).filter(x => x.start && x.end && Number.isFinite(x.val));
    if (list.length) tags.push({ list, last: list.reduce((m, x) => x.end > m ? x.end : m, '') });
  }
  tags.sort((a, b) => b.last.localeCompare(a.last)); // 穩定排序：同樣新時依 TAGS 順序
  const quarters = new Map(), annuals = new Map();
  for (const { list } of tags) {
    const q = new Map(), a = new Map(); // 同一標籤內同一期間以最新申報為準（更正後的數字）
    for (const x of list) { const d = span(x), m = d >= 80 && d <= 100 ? q : d >= 350 && d <= 380 ? a : null; if (!m) continue; const k = x.end; if (!m.has(k) || String(x.filed) > String(m.get(k).filed)) m.set(k, x); }
    for (const [k, x] of q) if (!quarters.has(k)) quarters.set(k, x);
    for (const [k, x] of a) if (!annuals.has(k)) annuals.set(k, x);
  }
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 5 * DAY;
  for (const a of annuals.values()) {
    if ([...quarters.keys()].some(e => near(e, a.end))) continue;
    const inside = [...quarters.values()].filter(x => Date.parse(x.start) >= Date.parse(a.start) - 5 * DAY && x.end < a.end);
    if (inside.length === 3) quarters.set(a.end, { start: inside.reduce((m, x) => x.end > m ? x.end : m, ''), end: a.end, val: a.val - inside.reduce((s, x) => s + x.val, 0), filed: a.filed });
  }
  const out = new Map();
  for (const x of quarters.values()) {
    const d = new Date(Date.parse(x.end) - 15 * DAY), y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1, k = `${y}-${q}`;
    if (!out.has(k) || x.end > out.get(k).date) out.set(k, { date: x.end, stock_id: id, revenue_year: y, revenue_quarter: q, revenue: x.val, create_time: x.filed || x.end });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 完整 companyfacts（財報分析用）；查不到代號時回 null
export async function companyFacts(id, ctx) { const cik = await cikOf(id, ctx); return cik ? get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, ctx) : null; }

export default {
  id: 'sec', name: 'SEC EDGAR（美國證管會）', site: 'https://www.sec.gov/edgar', docs: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', markets: ['US'],
  key: 'required', keyEnv: 'SEC_CONTACT_EMAIL', interval: 300,
  caps: { revenue: 'quarterly' },
  validate: async key => { const k = String(key || '').trim(); if (!EMAIL.test(k)) throw new DataError('{label}：請在金鑰欄位填入聯絡 email', { label: LABEL }); if (!(await get('https://www.sec.gov/files/company_tickers.json', { key: k }))) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: 404 }); return { plan: 'free', tier: 'free' }; },
  revenue: async (id, from, to, ctx) => {
    const cik = await cikOf(id, ctx); if (!cik) return [];
    return parseFacts(await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, ctx), id).filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  },
};
