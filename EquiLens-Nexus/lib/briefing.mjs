// 首頁「盤前焦點新聞」與「本周大事紀」：鉅亨網頭條、Forex Factory 經濟行事曆、Nasdaq 財報行事曆（皆為公開、免金鑰的 JSON）。
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, read, write } from './storage.mjs';

const TW = 8 * 3600e3, DAY = 864e5;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EquiLens-Nexus', Accept: 'application/json' };
export const SOURCES = {
  news: { title: '鉅亨網 頭條新聞', url: 'https://news.cnyes.com/news/cat/headline' },
  macro: { title: 'Forex Factory 經濟行事曆', url: 'https://www.forexfactory.com/calendar' },
  earnings: { title: 'Nasdaq 財報行事曆', url: 'https://www.nasdaq.com/market-activity/earnings' },
};

/* ---------- 台北時間工具（UTC+8，無日光節約） ---------- */
export const twDate = ms => new Date(ms + TW).toISOString().slice(0, 10);
const twMs = (date, hh = 0, mm = 0) => Date.parse(`${date}T00:00:00Z`) - TW + (hh * 60 + mm) * 60e3;
const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isWeekend = date => [0, 6].includes(weekday(date));
function stepWeekday(date, dir) { let d = addDays(date, dir); while (isWeekend(d)) d = addDays(d, dir); return d; }

// 目標交易日 T：台股收盤（13:30）後即切換到下一個平日；週末順延到週一。
// 視窗 = T 的前一個平日 13:30 → T 06:00（美股收盤後）。offset=1 為上一期。未排除國定假日。
export function newsWindow(now = Date.now(), offset = 0) {
  let target = twDate(now);
  if (now >= twMs(target, 13, 30)) target = addDays(target, 1);
  while (isWeekend(target)) target = addDays(target, 1);
  for (let i = 0; i < offset; i++) target = stepWeekday(target, -1);
  const prev = stepWeekday(target, -1), start = twMs(prev, 13, 30), end = twMs(target, 6);
  return { target, prev, start, end, inProgress: now < end };
}

// 本周 = 台北時間週一～週日；週日 12:00（美東週日 00:00，Forex Factory 換周）後改看下一周。
export function weekRange(now = Date.now()) {
  const today = twDate(now), wd = weekday(today);
  let monday = addDays(today, wd === 0 ? -6 : 1 - wd);
  if (wd === 0 && now >= twMs(today, 12)) monday = addDays(today, 1);
  return { start: monday, end: addDays(monday, 6), days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)) };
}

let weekMemo = null;
function prune(pattern, keep) { try { fs.readdirSync(LOCAL).filter(f => pattern.test(f) && f.endsWith('.json')).sort().slice(0, -keep).forEach(f => fs.rmSync(path.join(LOCAL, f), { force: true })); } catch { } }
async function getJSON(url, signal) {
  const r = await fetch(url, { headers: UA, signal: signal || AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&(amp|lt|gt|quot|nbsp);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' })[k]).replace(/<[^>]*>/g, '').replace(/\s*\n\s*/g, ' ').trim();

/* ---------- 盤前焦點新聞 ---------- */
const SECTION_OF = {
  台股新聞: 'tw', 台股盤勢: 'tw', 台灣政經: 'tw', 興櫃: 'tw',
  美股雷達: 'us', 美股: 'us',
  國際政經: 'global', 歐亞股: 'global', 大陸政經: 'global', 港股: 'global', 陸股: 'global', A股: 'global',
  能源: 'commodity', 黃金: 'commodity', 外匯: 'commodity', 期貨: 'commodity', 債券: 'commodity', 原物料: 'commodity',
};
export const SECTIONS = { must: '必讀', tw: '台股', us: '美股', global: '國際', commodity: '原物料・匯率', other: '其他' };
const MUST = /盤前要聞|重點新聞摘要|美股盤後|美股收盤|〈美股|早安|盤前/;

export function mapNews(item) {
  const tw = new Set(), us = new Map();
  for (const m of item.market || []) {
    const [ex, code] = String(m.symbol || '').split(':');
    if (/^TW[SG]$/.test(ex) && /^\d{4}$/.test(code)) tw.add(code);
    else if (ex === 'USS' && code) us.set(code, m.name || code);
  }
  for (const s of item.stock || []) { if (/^\d{4}$/.test(s)) tw.add(s); else if (/^US-[A-Z.]+$/.test(s) && !us.has(s.slice(3))) us.set(s.slice(3), s.slice(3)); }
  const title = decode(item.title);
  return {
    id: item.newsId, title, summary: decode(item.summary).slice(0, 220), category: item.categoryName || '',
    section: SECTION_OF[item.categoryName] || 'other', must: MUST.test(title),
    time: item.publishAt * 1000, url: `https://news.cnyes.com/news/id/${Number(item.newsId)}`,
    tw: [...tw].slice(0, 8), us: [...us].slice(0, 6).map(([code, name]) => ({ code, name: /[一-鿿]/.test(name) && !/ETF/.test(name) ? name : code })),
  };
}

const newsMemo = new Map();
export async function focusNews({ now = Date.now(), offset = 0, refresh = false, fetcher = getJSON } = {}) {
  const w = newsWindow(now, offset), key = `brief-news-${w.target}.json`, cached = newsMemo.get(w.target) || read(key, null);
  const age = cached ? now - cached.fetchedAt : Infinity;
  const fresh = cached && (cached.complete || age < 5 * 60e3) && !(refresh && age > 60e3);
  if (fresh) return cached;
  try {
    const endAt = Math.floor(Math.min(w.end, now) / 1000), startAt = Math.floor(w.start / 1000), items = [];
    for (let page = 1; page <= 6; page++) {
      const r = await fetcher(`https://api.cnyes.com/media/api/v1/newslist/category/headline?page=${page}&limit=100&startAt=${startAt}&endAt=${endAt}`);
      items.push(...(r?.items?.data || []));
      if (page >= (r?.items?.last_page || 1)) break;
    }
    const seen = new Set(), list = items.filter(n => n?.newsId && n.title && !seen.has(n.newsId) && seen.add(n.newsId)).map(mapNews)
      .filter(n => n.time >= w.start && n.time <= w.end).sort((a, b) => b.must - a.must || b.time - a.time);
    const result = { window: w, items: list, fetchedAt: now, complete: !w.inProgress, source: SOURCES.news };
    newsMemo.set(w.target, result);
    if (result.complete && list.length) { write(key, result); prune(/^brief-news-/, 30); }
    return result;
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: '鉅亨網暫時無法連線，顯示上次取得的新聞' };
    return { window: w, items: [], fetchedAt: now, error: '鉅亨網暫時無法連線，請稍後重新整理', source: SOURCES.news };
  }
}

/* ---------- 本周大事紀：經濟數據 ---------- */
const COUNTRY = { USD: '美國', CNY: '中國', EUR: '歐元區', JPY: '日本' };
const ZH = [
  [/^Non-Farm Employment Change$/, '非農就業人數'], [/^ADP Non-Farm Employment Change$/, 'ADP 民間就業人數'], [/^Unemployment Rate$/, '失業率'],
  [/^Average Hourly Earnings m\/m$/, '平均時薪（月增）'], [/^Unemployment Claims$/, '初領失業救濟金人數'], [/^JOLTS Job Openings$/, 'JOLTS 職缺數'],
  [/^Core PCE Price Index m\/m$/, '核心 PCE 物價指數（月增）'], [/^PCE Price Index m\/m$/, 'PCE 物價指數（月增）'],
  [/^Core CPI m\/m$/, '核心 CPI（月增）'], [/^CPI m\/m$/, 'CPI（月增）'], [/^CPI y\/y$/, 'CPI（年增）'], [/^Core CPI y\/y$/, '核心 CPI（年增）'],
  [/^Core PPI m\/m$/, '核心 PPI（月增）'], [/^PPI m\/m$/, 'PPI（月增）'], [/^PPI y\/y$/, 'PPI（年增）'],
  [/^Advance GDP q\/q$/, 'GDP 初值（季增年率）'], [/^Prelim GDP q\/q$/, 'GDP 修正值（季增年率）'], [/^Final GDP q\/q$/, 'GDP 終值（季增年率）'],
  [/^(Advance|Prelim|Final) GDP Price Index q\/q$/, 'GDP 物價平減指數'], [/^GDP q\/q$/, 'GDP（季增）'], [/^GDP y\/y$/, 'GDP（年增）'],
  [/^ISM Manufacturing PMI$/, 'ISM 製造業 PMI'], [/^ISM Services PMI$/, 'ISM 服務業 PMI'], [/^ISM Manufacturing Prices$/, 'ISM 製造業物價'],
  [/^Flash Manufacturing PMI$/, '製造業 PMI 初值'], [/^Flash Services PMI$/, '服務業 PMI 初值'],
  [/^Final Manufacturing PMI$/, '製造業 PMI 終值'], [/^Final Services PMI$/, '服務業 PMI 終值'],
  [/^Manufacturing PMI$/, '官方製造業 PMI'], [/^Non-Manufacturing PMI$/, '官方非製造業 PMI'],
  [/^Caixin Manufacturing PMI$/, '財新製造業 PMI'], [/^Caixin Services PMI$/, '財新服務業 PMI'],
  [/^Retail Sales m\/m$/, '零售銷售（月增）'], [/^Core Retail Sales m\/m$/, '核心零售銷售（月增）'],
  [/^Durable Goods Orders m\/m$/, '耐久財訂單（月增）'], [/^Core Durable Goods Orders m\/m$/, '核心耐久財訂單（月增）'],
  [/^Industrial Production m\/m$/, '工業生產（月增）'], [/^Industrial Production y\/y$/, '工業生產（年增）'],
  [/^CB Consumer Confidence$/, '諮商會消費者信心指數'], [/^Prelim UoM Consumer Sentiment$/, '密大消費者信心初值'],
  [/^Revised UoM Consumer Sentiment$/, '密大消費者信心終值'], [/^Prelim UoM Inflation Expectations$/, '密大通膨預期初值'],
  [/^Revised UoM Inflation Expectations$/, '密大通膨預期終值'],
  [/^Empire State Manufacturing Index$/, '紐約州製造業指數'], [/^Philly Fed Manufacturing Index$/, '費城聯儲製造業指數'],
  [/^Pending Home Sales m\/m$/, '成屋待完成銷售（月增）'], [/^Existing Home Sales$/, '成屋銷售'], [/^New Home Sales$/, '新屋銷售'],
  [/^Building Permits$/, '營建許可'], [/^Housing Starts$/, '新屋開工'], [/^Trade Balance$/, '貿易收支'], [/^Crude Oil Inventories$/, 'EIA 原油庫存'],
  [/^Federal Funds Rate$/, 'Fed 利率決策'], [/^FOMC Statement$/, 'FOMC 聲明'], [/^FOMC Press Conference$/, 'FOMC 記者會'],
  [/^FOMC Meeting Minutes$/, 'FOMC 會議紀要'], [/^FOMC Economic Projections$/, 'FOMC 經濟預測'],
  [/^Fed Chair (.+) Speaks$/, 'Fed 主席 $1 談話'], [/^FOMC Member (.+) Speaks$/, 'Fed 官員 $1 談話'],
  [/^Main Refinancing Rate$/, 'ECB 主要再融資利率'], [/^Monetary Policy Statement$/, '貨幣政策聲明'], [/^ECB Press Conference$/, 'ECB 記者會'],
  [/^ECB President (.+) Speaks$/, 'ECB 總裁 $1 談話'], [/^BOJ Policy Rate$/, '日銀政策利率'], [/^BOJ Press Conference$/, '日銀記者會'],
  [/^BOJ Gov (.+) Speaks$/, '日銀總裁 $1 談話'], [/^Tankan Manufacturing Index$/, '短觀大型製造業指數'],
  [/^Core CPI Flash Estimate y\/y$/, '核心 CPI 快估（年增）'], [/^CPI Flash Estimate y\/y$/, 'CPI 快估（年增）'],
  [/^German Prelim CPI m\/m$/, '德國 CPI 初值（月增）'], [/^Tokyo Core CPI y\/y$/, '東京核心 CPI（年增）'],
  [/^Loan Prime Rate$|^1-y Loan Prime Rate$/, '一年期 LPR'], [/^New Loans$/, '新增人民幣貸款'],
];
export const zhTitle = t => { for (const [re, zh] of ZH) if (re.test(t)) return t.replace(re, zh); return null; };

export function mapMacro(list, range) {
  return (Array.isArray(list) ? list : []).filter(e => {
    if (!COUNTRY[e.country]) return false;
    return e.impact === 'High' || e.impact === 'Medium' || (e.impact === 'Holiday' && ['USD', 'CNY', 'JPY'].includes(e.country));
  }).map(e => {
    const time = Date.parse(e.date), holiday = e.impact === 'Holiday';
    return { type: 'macro', time, date: twDate(time), country: e.country, countryName: COUNTRY[e.country],
      impact: e.impact, holiday, title: holiday ? '金融市場休假' : zhTitle(e.title) || e.title, titleEn: e.title,
      forecast: e.forecast || '', previous: e.previous || '' };
  }).filter(e => Number.isFinite(e.time) && e.date >= range.start && e.date <= range.end).sort((a, b) => a.time - b.time);
}

/* ---------- 本周大事紀：科技財報 ---------- */
export const TECH = {
  AAPL: '蘋果', MSFT: '微軟', NVDA: '輝達', GOOGL: 'Alphabet', GOOG: 'Alphabet', AMZN: '亞馬遜', META: 'Meta', TSLA: '特斯拉', AVGO: '博通',
  AMD: '超微', TSM: '台積電 ADR', MU: '美光', ORCL: '甲骨文', INTC: '英特爾', QCOM: '高通', ASML: '艾司摩爾', ADBE: 'Adobe', CRM: 'Salesforce',
  NFLX: '網飛', ARM: '安謀', SMCI: '美超微', DELL: '戴爾', HPE: '慧與', HPQ: '惠普', MRVL: '邁威爾', AMAT: '應用材料', LRCX: '科林研發',
  KLAC: '科磊', TXN: '德州儀器', ADI: '亞德諾', NXPI: '恩智浦', ON: '安森美', MCHP: '微芯', IBM: 'IBM', CSCO: '思科', ANET: 'Arista',
  NOW: 'ServiceNow', PLTR: 'Palantir', SNOW: 'Snowflake', CRWD: 'CrowdStrike', PANW: 'Palo Alto', INTU: 'Intuit', CDNS: '益華電腦',
  SNPS: '新思科技', WDC: '威騰', STX: '希捷', SNDK: 'SanDisk', JBL: '捷普', CLS: 'Celestica', VRT: 'Vertiv', GLW: '康寧', APH: '安費諾',
  COHR: 'Coherent', TER: '泰瑞達', KEYS: '是德科技', UMC: '聯電 ADR', ASX: '日月光 ADR', SAP: 'SAP', SONY: '索尼', BABA: '阿里巴巴',
  BIDU: '百度', PDD: '拼多多', UBER: 'Uber', SHOP: 'Shopify', DDOG: 'Datadog', MDB: 'MongoDB', NET: 'Cloudflare', ZS: 'Zscaler',
  WDAY: 'Workday', ACN: '埃森哲',
};
// 非科技但常見的大型企業中文名（市值達門檻才會顯示）。
const OTHER_ZH = { JPM: '摩根大通', BAC: '美國銀行', WFC: '富國銀行', C: '花旗', GS: '高盛', MS: '摩根士丹利', WMT: '沃爾瑪', COST: '好市多',
  NKE: 'Nike', FDX: '聯邦快遞', UNH: '聯合健康', JNJ: '嬌生', LLY: '禮來', PG: '寶僑', KO: '可口可樂', PEP: '百事', XOM: '埃克森美孚', V: 'Visa', MA: '萬事達卡' };
const BIG_CAP = 100e9;
const TIMING = { 'time-pre-market': '盤前', 'time-after-hours': '盤後' }, ORDER = { 盤前: 0, 盤後: 1, 時間未定: 2 };
const money = v => { const n = Number(String(v || '').replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

export function mapEarnings(rows, date) {
  return (Array.isArray(rows) ? rows : []).map(r => ({ symbol: String(r.symbol || '').trim(), name: r.name, cap: money(r.marketCap), timing: TIMING[r.time] || '時間未定', eps: r.epsForecast || '' }))
    .filter(r => r.symbol && (TECH[r.symbol] || (r.cap || 0) >= BIG_CAP))
    .map(r => ({ type: 'earnings', date, ...r, zh: TECH[r.symbol] || OTHER_ZH[r.symbol] || null, tech: !!TECH[r.symbol] }))
    .sort((a, b) => ORDER[a.timing] - ORDER[b.timing] || b.tech - a.tech || (b.cap || 0) - (a.cap || 0));
}

export async function weekAgenda({ now = Date.now(), refresh = false, fetcher = getJSON } = {}) {
  const range = weekRange(now), key = `brief-week-${range.start}.json`, cached = weekMemo?.range.start === range.start ? weekMemo : read(key, null);
  const age = cached ? now - cached.fetchedAt : Infinity;
  // 成功資料 3 小時內沿用；手動重新整理至少間隔 10 分鐘；失敗後 5 分鐘內不重試（Forex Factory 對頻繁請求會封鎖）。
  if (cached && !(refresh && age > 10 * 60e3) && (cached.errors?.length ? age < 5 * 60e3 : age < 3 * 3600e3)) return cached;
  const errors = [];
  let macro = cached?.macro || [], earnings = cached?.earnings || [];
  try { macro = mapMacro(await fetcher('https://nfs.faireconomy.media/ff_calendar_thisweek.json'), range); }
  catch { errors.push('經濟行事曆（Forex Factory）暫時無法連線' + (cached ? '，顯示上次資料' : '')); }
  try {
    const all = [];
    for (const date of range.days.slice(0, 5)) {
      const r = await fetcher(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`);
      all.push(...mapEarnings(r?.data?.rows, date));
    }
    earnings = all;
  } catch { errors.push('財報行事曆（Nasdaq）暫時無法連線' + (cached ? '，顯示上次資料' : '')); }
  const result = { range, macro, earnings, fetchedAt: now, errors, sources: [SOURCES.macro, SOURCES.earnings] };
  weekMemo = result;
  if (!errors.length) { write(key, result); prune(/^brief-week-/, 8); }
  return result;
}
