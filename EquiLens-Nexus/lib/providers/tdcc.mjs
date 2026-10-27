// 集保結算所「集保戶股權分散表查詢」（https://www.tdcc.com.tw/portal/zh/smWeb/qryStock）：免費、免金鑰，可查近一年每週資料。
// 一次請求＝一檔一週；頁面有 SYNCHRONIZER_TOKEN（綁 session cookie，每次回應換新的）。
// 輸出沿用 FinMind TaiwanStockHoldingSharesPer 的欄位，交給 insight.mjs 的 holderLevels／parseHolders。
import { DataError, sleep } from './common.mjs';

const URL_ = 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const strip = s => String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const iso = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

// 頁面 → { token, dates:['YYYY-MM-DD'…]（新到舊） }
export function parseTdccForm(html) {
  const token = /name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]+)"/.exec(html)?.[1] || /value="([^"]+)"[^>]*name="SYNCHRONIZER_TOKEN"/.exec(html)?.[1] || null;
  const sel = /<select[^>]*name="scaDate"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] || '';
  const dates = [...sel.matchAll(/<option[^>]*value="(\d{8})"/g)].map(m => iso(m[1]));
  return { token, dates: [...new Set(dates)] };
}

// 查詢結果 → FinMind 格式的列（15 個級距＋合計列 HoldingSharesLevel:'total'）；查無資料回傳 []
export function parseTdccTable(html, date) {
  const rows = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1]));
    if (td.length !== 5 || !/^\d+$/.test(td[0])) continue;
    const n = v => Number(v.replace(/,/g, '')) || 0;
    const total = /合\s*計/.test(td[1]);
    if (!total && !/\d/.test(td[1])) continue; // 「差異數調整」等非級距列
    rows.push({ date, HoldingSharesLevel: total ? 'total' : td[1], people: n(td[2]), unit: n(td[3]), percent: n(td[4]) });
  }
  return rows.some(r => r.HoldingSharesLevel !== 'total') ? rows : [];
}

// 一個查詢工作階段：保留 cookie 與 token
export function tdccSession({ interval = 400, timeout = 20000 } = {}) {
  const jar = new Map(); let token = null, last = 0, dates = null;
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = res => { for (const c of res.headers.getSetCookie?.() || []) { const m = /^([^=;]+)=([^;]*)/.exec(c); if (m) jar.set(m[1], m[2]); } };
  const call = async (init = {}) => {
    const wait = last + interval - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
    let res; try { res = await fetch(URL_, { ...init, headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9', referer: URL_, ...(jar.size ? { cookie: cookie() } : {}), ...init.headers }, signal: AbortSignal.timeout(timeout), redirect: 'manual' }); }
    catch { throw new DataError('{label} 連線失敗或逾時', { label: '集保結算所' }); }
    keep(res); if (!res.ok) throw new DataError('{label}：資料服務回應 {status}', { label: '集保結算所', status: res.status });
    const html = await res.text(), f = parseTdccForm(html); if (f.token) token = f.token; if (f.dates.length) dates = f.dates;
    return html;
  };
  return {
    async dates() { if (!dates) await call(); if (!dates?.length) throw new DataError('{label}：讀不到可查詢的週別', { label: '集保結算所' }); return dates; },
    async week(id, date) {
      if (!token) await call();
      const body = new URLSearchParams({ SYNCHRONIZER_TOKEN: token || '', SYNCHRONIZER_URI: '/portal/zh/smWeb/qryStock', method: 'submit', firDate: (dates?.[0] || date).replace(/-/g, ''), scaDate: date.replace(/-/g, ''), sqlMethod: 'StockNo', stockNo: id, stockName: '' });
      const html = await call({ method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      const rows = parseTdccTable(html, date);
      if (rows.length || /查無/.test(html)) return rows;
      token = null; throw new DataError('{label}：回應格式不符，稍後再試', { label: '集保結算所' }); // token 失效或改版：不記成「無資料」
    },
  };
}
