// 資料源共用工具：請求排隊與頻率限制、逾時與停止、錯誤類型、數字與日期轉換。
// 各資料源一律轉成衡析內部格式（沿用 FinMind 欄位名稱，方便評分、型態、熱浪等模組共用）：
//   日成交  { date, stock_id, open, max, min, close, Trading_Volume（股）, Trading_money, spread }
//   即時快照 { stock_id, date:'YYYY-MM-DD HH:MM:SS'（當地）, open, high, low, close, change_price, total_volume（顯示單位，台股為張）, total_amount, yesterday_volume, buy_price, sell_price }
//   一分 K  [HH:MM（起始時間）, 開, 高, 低, 收, 量（顯示單位）]
//   新聞    { date, stock_id, title, link, source }
//   估值    { date, PER, PBR, dividend_yield }；營收 { date, revenue_year, revenue_month | revenue_quarter, revenue }
import { UserError, t } from '../i18n.mjs';

// code：'auth'（金鑰無效或權限不足）、'quota'（額度或頻率限制）、'plan'（方案等級不足）——伺服器據此暫停自動請求
export class DataError extends UserError {
  constructor(message, params, { fatal = false, status = 400, code = '' } = {}) { super(message, params, status); this.fatal = fatal; this.code = code; }
}
export const stopped = () => new DataError('已停止更新', null, { fatal: true });
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(stopped());
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(stopped()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

// 每個資料源一條請求佇列：依序執行，兩次請求至少間隔 interval 毫秒
export function limiter(defaultInterval) {
  let tail = Promise.resolve(), last = 0;
  return async (fn, { signal, interval = defaultInterval } = {}) => {
    const previous = tail; let release; tail = new Promise(r => release = r);
    await previous;
    try {
      const wait = Math.max(0, last + interval - Date.now());
      if (wait) await sleep(wait, signal);
      if (signal?.aborted) throw stopped();
      last = Date.now();
      return await fn();
    } finally { release(); }
  };
}

// 取得 JSON（逾時、停止、HTTP 錯誤統一處理）；label 用於錯誤訊息
export async function fetchJSON(url, { headers = {}, signal, timeout = 30000, label = 'API', text = false } = {}) {
  let res;
  try { res = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
  catch { if (signal?.aborted) throw stopped(); throw new DataError('{label} 連線失敗或逾時', { label }); }
  const body = await (text ? res.text() : res.json().catch(() => null));
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}
export const httpError = (label, status, msg = '') => {
  if (status === 401 || status === 403) return new DataError('{label}：金鑰或方案權限不足', { label }, { fatal: status === 401, code: 'auth' });
  if (status === 429 || /limit|quota|credits/i.test(msg)) return new DataError('{label} 額度或頻率限制，稍後再試', { label }, { fatal: true, code: 'quota' });
  return new DataError('{label}：資料服務回應 {status}', { label, status });
};

export const num = v => { if (v == null || v === '' || v === '--' || v === '---') return null; const n = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null; };
// 民國日期 1151008 或 115/10/08 → 2026-10-08
export function rocDate(s) {
  const m = /^(\d{2,3})\/?(\d{2})\/?(\d{2})$/.exec(String(s || '').trim()); if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}
export const ymd = d => d.replace(/-/g, '');
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// from～to 之間的平日（不含假日資訊）
export function weekdays(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w > 0 && w < 6) out.push(d); } return out; }
export { t };
