// 鉅亨網台股新聞（台股，免金鑰）：鉅亨網網站本身使用的新聞清單介面（非正式公開 API，格式可能變動）。
// 新聞推播每分鐘取最新 50 則，附個股代號（stock／market 欄位或標題中的「(2330)」）的文章轉成 FinMind 新聞格式，與 FinMind 並用；
// FinMind 新聞約每 2 小時才更新一批，鉅亨網幾分鐘內就有新文章。格式無法辨識時丟出錯誤，由呼叫端記錄、不影響 FinMind。
import { DataError, fetchJSON } from './common.mjs';

const LIST = 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=50&page=1';
const CODE = /^[1-9]\d{3}$/;
const tpe = sec => new Date(sec * 1000 + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

export function parseCnyes(body) {
  const list = body?.items?.data;
  if (!Array.isArray(list)) throw new DataError('鉅亨網新聞格式無法辨識');
  const out = [];
  for (const x of list) {
    if (!x?.newsId || !x.title || !(Number(x.publishAt) > 0)) continue;
    const ids = new Set();
    for (const s of x.stock || []) if (CODE.test(String(s))) ids.add(String(s));
    for (const m of x.market || []) { const c = String(m?.code ?? ''); if (CODE.test(c) && (!m.symbol || /^TW/.test(m.symbol))) ids.add(c); }
    for (const [, c] of String(x.title).matchAll(/[（(]([1-9]\d{3})[)）]/g)) ids.add(c);
    for (const id of ids) out.push({ date: tpe(Number(x.publishAt)), stock_id: id, title: String(x.title).trim(), link: `https://news.cnyes.com/news/id/${x.newsId}`, source: '鉅亨網' });
  }
  return out;
}
export async function cnyesNews({ signal } = {}) {
  const r = await fetchJSON(LIST, { signal, label: '鉅亨網', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (EquiLens news watch)' } });
  if (!r.ok) throw new DataError('鉅亨網新聞：資料服務回應 {status}', { status: r.status });
  return parseCnyes(r.body);
}
