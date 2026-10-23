// 風控水位（美股）：恐慌指數、VIX 期限結構、高收益債利差、10 年期殖利率、美元、市場廣度與 S&P 500 趨勢，
// 各與自己過去一年比較（百分位），加權成 0～100 的風險分數，換算成建議持股水位（與台股版同一套等級與換算）。
// 資料全部免金鑰：聖路易聯準銀行 FRED（5 個序列）、Cboe（VIX、VIX3M 歷史）、Nasdaq（RSP、SPY 日 K），每次更新 9 個請求。
import { assemble, series, change, at, trendSeries } from './riskgauge.mjs';
import { fetchJSON } from './providers/common.mjs';
import { parseHistorical } from './providers/nasdaq.mjs';

const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;

// 指標定義（欄位同台股版；show：plain＝不加正負號）
export const US_FACTORS = [
  { key: 'vix', name: 'VIX 恐慌指數', weight: 20, dir: 1, unit: '', show: 'plain', group: '恐慌情緒', desc: 'S&P 500 選擇權隱含波動率。越高代表市場越恐慌、避險需求越大' },
  { key: 'term', name: 'VIX 期限結構', weight: 10, dir: 1, unit: '%', show: 'plain', group: '恐慌情緒', desc: 'VIX ÷ 三個月 VIX（VIX3M）。平時低於 100%；超過 100%（逆價差）代表短期恐慌高於長期，常出現在急跌時' },
  { key: 'credit', name: '高收益債利差', weight: 20, dir: 1, unit: '%', show: 'plain', group: '信用與利率', desc: '美國高收益債與公債的殖利率差（ICE BofA）。利差擴大代表信用風險升高、資金撤離風險資產' },
  { key: 'rates', name: '10 年期殖利率（20 日）', weight: 10, dir: 1, unit: 'bp', group: '信用與利率', desc: '10 年期公債殖利率 20 個交易日的變化（基點）。殖利率急升會壓抑股票評價' },
  { key: 'dollar', name: '美元指數（20 日）', weight: 10, dir: 1, unit: '%', group: '信用與利率', desc: '聯準會廣義美元指數 20 期變化率。美元急升常伴隨全球資金緊縮' },
  { key: 'breadth', name: '市場廣度（20 日）', weight: 10, dir: -1, unit: '%', group: '大盤', desc: '等權重 S&P 500（RSP）相對市值加權（SPY）的 20 日表現差。越低代表漲勢集中在少數大型股、多數股票走弱' },
  { key: 'trend', name: '大盤趨勢', weight: 20, dir: -1, unit: '%', group: '大盤', rule: true, desc: 'S&P 500 與 60 日均線的乖離，以及 20 日均線是否在 60 日均線之上' },
];

// FRED CSV（observation_date,ID；缺值為空白或「.」）→ [[date, value]]
export function parseFred(csv) {
  const m = new Map();
  for (const line of String(csv || '').trim().split(/\r?\n/).slice(1)) { const [d, v] = line.split(','); const n = Number(v); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v && v !== '.' && Number.isFinite(n)) m.set(d, n); }
  return series(m);
}
// Cboe 歷史 CSV（DATE,OPEN,HIGH,LOW,CLOSE；日期 MM/DD/YYYY）→ [[date, close]]
export function parseCboe(csv) {
  const m = new Map(), lines = String(csv || '').trim().split(/\r?\n/), head = (lines[0] || '').toUpperCase().split(','), ci = Math.max(head.indexOf('CLOSE'), 1);
  for (const line of lines.slice(1)) {
    const c = line.split(','), x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(c[0]?.trim() || ''), n = Number(c[ci]);
    if (x && Number.isFinite(n) && n > 0) m.set(`${x[3]}-${x[1].padStart(2, '0')}-${x[2].padStart(2, '0')}`, n);
  }
  return series(m);
}
// 兩個序列同日相除（×100）
export function ratio(a, b) { const mb = new Map(b); return series(new Map(a.filter(([d]) => mb.get(d) > 0).map(([d, v]) => [d, r2(v / mb.get(d) * 100)]))); }
// 殖利率 n 期變化（基點）
export function bpChange(list, n = 20) { const out = []; for (let i = n; i < list.length; i++) out.push([list[i][0], Math.round((list[i][1] - list[i - n][1]) * 100)]); return out; }
// 相對表現：a、b 各自 n 期報酬率的差（百分點）
export function relative(a, b, n = 20) { const ca = new Map(change(a, n)); return series(new Map(change(b, n).filter(([d]) => ca.has(d)).map(([d, v]) => [d, r2(ca.get(d) - v)]))); }

export function buildRiskUS(raw, { days = 120, now = new Date().toISOString() } = {}) {
  const index = raw.spx || [];
  const s = { vix: raw.vix || [], term: ratio(raw.vixCboe || [], raw.vix3m || []), credit: raw.hy || [], rates: bpChange(raw.dgs10 || []), dollar: change(raw.usd || [], 20), breadth: relative(raw.rsp || [], raw.spy || []), trend: trendSeries(index) };
  // 評分日：S&P 500 或 VIX 最新的交易日
  const dates = [...new Set([...index.map(x => x[0]), ...s.vix.map(x => x[0])])].sort();
  return assemble(s, dates, index, raw, { days, now, defs: US_FACTORS, market: 'US', indexName: 'S&P 500' });
}

// ---- 資料取得（9 個請求，免金鑰） ----
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'text/csv,application/json,*/*' };
const NASDAQ = { ...UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const minus = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
export const US_RISK_TASKS = date => {
  const start = minus(date, 430), fred = id => ['fred', `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`];
  const cboe = id => ['cboe', `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`];
  const etf = id => ['nasdaq', `https://api.nasdaq.com/api/quote/${id}/historical?assetclass=etf&fromdate=${start}&todate=${date}&limit=9999`, id];
  return [['spx', ...fred('SP500')], ['vix', ...fred('VIXCLS')], ['hy', ...fred('BAMLH0A0HYM2')], ['dgs10', ...fred('DGS10')], ['usd', ...fred('DTWEXBGS')],
    ['vixCboe', ...cboe('VIX')], ['vix3m', ...cboe('VIX3M')], ['rsp', ...etf('RSP')], ['spy', ...etf('SPY')]];
};
const LABEL = { fred: 'FRED', cboe: 'Cboe', nasdaq: 'Nasdaq' };
export async function fetchRiskInputsUS(date, { signal, onProgress = () => {}, fetcher = fetchJSON } = {}) {
  const raw = { errors: {} }, tasks = US_RISK_TASKS(date), cut = minus(date, 430);
  for (const [i, [key, kind, url, sym]] of tasks.entries()) {
    onProgress(i, tasks.length, key);
    try {
      const r = await fetcher(url, { headers: kind === 'nasdaq' ? NASDAQ : UA, signal, timeout: 40000, label: LABEL[kind], text: kind !== 'nasdaq' });
      if (!r.ok) throw new Error(`${LABEL[kind]}：資料服務回應 ${r.status}`);
      raw[key] = kind === 'fred' ? parseFred(r.body) : kind === 'cboe' ? parseCboe(r.body).filter(([d]) => d >= cut) : parseHistorical(r.body?.data, sym).map(x => [x.date, x.close]);
      if (!raw[key].length) throw new Error(`${LABEL[kind]}：沒有資料`);
    } catch (e) { raw[key] = []; raw.errors[key] = e.message; }
  }
  return raw;
}
