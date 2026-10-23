// 證交所基本市況報導（MIS，台股，免金鑰）：研究名單、自選與提醒股票的盤中即時報價（約 5 秒更新），加上加權與櫃買指數。
// 一次查詢最多 40 檔；只提供逐檔查詢，因此盤中監控只涵蓋研究名單與自選股（全市場即時熱浪需要付費資料源）。
import { DataError, fetchJSON, sleep } from './common.mjs';

const LABEL = '證交所即時報價';
const URL_ = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Referer: 'https://mis.twse.com.tw/stock/index.jsp', Accept: 'application/json' };
const n = v => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
const firstOf = s => n(String(s || '').split('_')[0]);
const exOf = new Map(); // 代號 → tse／otc（查到一次就記住）
const INDEX = { t00: '001', o00: '101' };

// msgArray → 即時快照格式；量的單位為張，成交金額以「量 × 價」估算
export function parseMis(body) {
  const out = [];
  for (const x of body?.msgArray || []) {
    if (!x.c || !x.d) continue;
    const isIndex = x.c in INDEX, y = n(x.y);
    const close = n(x.z) ?? n(x.trade?.z) ?? n(x.pz) ?? firstOf(x.b) ?? firstOf(x.a) ?? y;
    if (!close) continue;
    if (!isIndex) exOf.set(x.c, x.ex);
    const vol = isIndex ? null : n(x.v) ?? 0, date = `${x.d.slice(0, 4)}-${x.d.slice(4, 6)}-${x.d.slice(6, 8)} ${x.t || x['%'] || '13:30:00'}`;
    out.push({ stock_id: isIndex ? INDEX[x.c] : x.c, date, open: n(x.o), high: n(x.h), low: n(x.l), close, change_price: y ? Math.round((close - y) * 1e4) / 1e4 : null, change_rate: y ? Math.round((close / y - 1) * 1e4) / 100 : null,
      total_volume: vol, total_amount: isIndex ? (n(x.m) ?? 0) * 1e6 : (vol ?? 0) * 1000 * close, yesterday_volume: null, buy_price: firstOf(x.b), sell_price: firstOf(x.a) });
  }
  return out;
}
const channels = ids => ids.flatMap(id => exOf.has(id) ? [`${exOf.get(id)}_${id}.tw`] : [`tse_${id}.tw`, `otc_${id}.tw`]);

export default {
  id: 'twsemis', name: '證交所即時報價（MIS）', site: 'https://mis.twse.com.tw', docs: 'https://mis.twse.com.tw/stock/index.jsp', markets: ['TW'],
  key: 'none', interval: 0,
  caps: { snapshot: 1 },
  snapshotMode: 'symbols',
  snapshotLimit: () => 600,
  snapshotEvery: n => n <= 120 ? 10e3 : n <= 300 ? 20e3 : 30e3,
  snapshot: async (ids, ctx) => {
    const list = [...new Set(ids.filter(id => /^[0-9A-Z]{4,6}$/.test(id)))], out = [];
    const batches = []; for (let i = 0; i < list.length; i += 40) batches.push(list.slice(i, i + 40));
    if (!batches.length) batches.push([]);
    for (const [i, b] of batches.entries()) {
      if (i) await sleep(700, ctx.signal);
      const ch = [...channels(b), ...(i === 0 ? ['tse_t00.tw', 'otc_o00.tw'] : [])].join('|');
      const r = await fetchJSON(`${URL_}?ex_ch=${encodeURIComponent(ch)}&json=1&delay=0&_=${Date.now()}`, { headers: HEADERS, signal: ctx.signal, label: LABEL, timeout: 15000 });
      if (!r.ok || r.body?.rtcode !== '0000') throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.body?.rtcode || r.status });
      out.push(...parseMis(r.body));
    }
    return out;
  },
};
