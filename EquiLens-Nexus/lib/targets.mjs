// 目標價：台股取鉅亨網「外資評等」頁（FactSet 共識目標價與外資券商評等，網頁表格，非正式 API），
// 美股取 Nasdaq 分析師目標價（共識平均／最高／最低、買進／持有／賣出家數、每月共識紀錄）。皆免金鑰。
import { DataError, fetchJSON } from './providers/common.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const num = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

// 鉅亨網外資評等表格 → [{ date, broker, rating, change, eps, epsYear, target }]（新到舊）
export function parseCnyesRatings(html) {
  const s = String(html || ''), i = s.indexOf('財測EPS'); if (i < 0) return [];
  const end = s.indexOf('</table>', i), body = s.slice(i, end > 0 ? end : undefined), out = [];
  for (const [, tr] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => strip(m[1]));
    if (td.length < 7 || !/^\d{8}$/.test(td[0])) continue;
    const eps = /^([\d.\-]+)\s*\((\d{4})\)/.exec(td[5]);
    out.push({ date: `${td[0].slice(0, 4)}-${td[0].slice(4, 6)}-${td[0].slice(6, 8)}`, broker: td[1] || '—', rating: td[4] || null, change: td[3] && td[3] !== '--' ? td[3] : null, eps: eps ? Number(eps[1]) : null, epsYear: eps ? Number(eps[2]) : null, target: num(td[6]) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
// 摘要：近 120 天內每個來源的最新目標價取平均、最高、最低；最新一筆為「最新目標價」
export function summarize(history, price, today = new Date().toISOString().slice(0, 10)) {
  const withT = history.filter(h => h.target), cut = new Date(Date.parse(today + 'T00:00:00Z') - 120 * 864e5).toISOString().slice(0, 10);
  // 每個來源只取最新一筆（FactSet 本身就是共識，不重複計入舊的共識值）
  const latestBy = new Map(); for (const h of withT.filter(h => h.date >= cut)) if (!latestBy.has(h.broker)) latestBy.set(h.broker, h);
  const recent = [...latestBy.values()], use = recent.length ? recent : withT.slice(0, 1);
  if (!use.length) return null;
  const ts = use.map(h => h.target), mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  return { mean: r2(mean), high: Math.max(...ts), low: Math.min(...ts), count: use.length, latest: withT[0], upside: price ? r2((mean / price - 1) * 100) : null, stale: !recent.length };
}

export async function twTargets(id, { signal } = {}) {
  const r = await fetchJSON(`https://www.cnyes.com/twstock/foreignrating.aspx?code=${encodeURIComponent(id)}`, { headers: UA, signal, label: '鉅亨網', timeout: 20000, text: true });
  if (!r.ok) throw new DataError('鉅亨網：資料服務回應 {status}', { status: r.status });
  return { source: '鉅亨網（FactSet 共識、外資券商）', history: parseCnyesRatings(r.body) };
}
// Nasdaq 分析師目標價 → 共識與每月紀錄
export function parseNasdaqTargets(data) {
  const c = data?.consensusOverview; if (!c) return null;
  const history = (data.historicalConsensus || []).map(h => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(h?.z?.date || ''); return m ? { date: `${m[3]}-${m[1]}-${m[2]}`, broker: '分析師共識', rating: h.z.consensus || null, buy: h.z.buy, hold: h.z.hold, sell: h.z.sell, price: num(h.y), target: null } : null; }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  return { mean: num(c.priceTarget), high: num(c.highPriceTarget), low: num(c.lowPriceTarget), ratings: { buy: c.buy ?? 0, hold: c.hold ?? 0, sell: c.sell ?? 0 }, history };
}
export async function usTargets(id, { signal } = {}) {
  const r = await fetchJSON(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(id)}/targetprice`, { headers: { ...UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' }, signal, label: 'Nasdaq', timeout: 20000 });
  if (!r.ok) throw new DataError('Nasdaq：資料服務回應 {status}', { status: r.status });
  return { source: 'Nasdaq（分析師共識）', ...parseNasdaqTargets(r.body?.data) };
}
// ---- 各家券商目標價：Google 新聞近 60 天標題（例如「高盛上調台積電目標價至3300元」）----
// 標題同時只出現一家券商、且只有一個落在合理範圍（目前股價的 0.5～3 倍）的價格時才採用；每家只留最新一筆。
export const BROKERS_TW = [
  ['高盛', /高盛/], ['摩根士丹利', /大摩|摩根士丹利|摩根史坦利/], ['摩根大通', /小摩|摩根大通/], ['美銀證券', /美銀|美林/], ['花旗', /花旗/], ['麥格理', /麥格理/],
  ['瑞銀', /瑞銀/], ['野村', /野村/], ['匯豐', /匯豐/], ['里昂', /里昂/], ['巴克萊', /巴克萊/], ['德意志', /德意志|德銀/], ['傑富瑞', /傑富瑞/], ['伯恩斯坦', /伯恩斯坦/],
  ['瑞穗', /瑞穗/], ['大和', /大和(證券|資本|總研)/], ['統一投顧', /統一(投顧|證券|證)/], ['元大投顧', /元大(投顧|證券|證)/], ['凱基投顧', /凱基/], ['國泰證券', /國泰(證券|證期|投顧)/],
  ['富邦投顧', /富邦(投顧|證券)/], ['群益投顧', /群益/], ['永豐投顧', /永豐(投顧|證券)/], ['兆豐投顧', /兆豐(投顧|證券)/], ['新光證券', /新光(證券|投顧)/], ['康和證券', /康和/],
  ['玉山證券', /玉山(證券|投顧)/], ['國票證券', /國票/], ['第一金投顧', /第一金(證券|投顧)/], ['華南投顧', /華南(投顧|永昌)/], ['中信投顧', /中信(證券|投顧)/], ['台新投顧', /台新(證券|投顧)/], ['宏遠投顧', /宏遠(證券|投顧)/], ['福邦證券', /福邦/],
];
export const BROKERS_US = [
  ['Goldman Sachs', /Goldman/i], ['Morgan Stanley', /Morgan Stanley/i], ['J.P. Morgan', /J\.?P\.? ?Morgan|JPMorgan/i], ['Bank of America', /Bank of America|BofA/i], ['Citi', /\bCiti(group)?\b/i], ['UBS', /\bUBS\b/],
  ['Barclays', /Barclays/i], ['Deutsche Bank', /Deutsche/i], ['Jefferies', /Jefferies/i], ['Bernstein', /Bernstein/i], ['Wells Fargo', /Wells Fargo/i], ['Evercore ISI', /Evercore/i], ['Mizuho', /Mizuho/i],
  ['Needham', /Needham/i], ['Piper Sandler', /Piper/i], ['Wedbush', /Wedbush/i], ['Oppenheimer', /Oppenheimer/i], ['KeyBanc', /KeyBanc/i], ['Raymond James', /Raymond James/i], ['TD Cowen', /Cowen/i],
  ['Truist', /Truist/i], ['Rosenblatt', /Rosenblatt/i], ['Cantor Fitzgerald', /Cantor/i], ['Loop Capital', /Loop Capital/i], ['Melius', /Melius/i], ['HSBC', /HSBC/], ['Macquarie', /Macquarie/i],
  ['Stifel', /Stifel/i], ['BMO', /\bBMO\b/], ['RBC', /\bRBC\b/], ['Baird', /Baird/i], ['Susquehanna', /Susquehanna/i], ['Benchmark', /Benchmark/i], ['Guggenheim', /Guggenheim/i], ['D.A. Davidson', /Davidson/i], ['Nomura', /Nomura/i], ['Bernstein', /Bernstein/i],
];
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
export function parseRss(xml) {
  const out = [];
  for (const [, item] of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = n => unxml((new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`).exec(item) || [])[1]);
    const d = new Date(tag('pubDate')); if (!Number.isFinite(d.getTime())) continue;
    const title = tag('title'), source = tag('source'), clean = source && title.endsWith(' - ' + source) ? title.slice(0, -(source.length + 3)) : title.replace(/\s+-\s+[^-]{1,30}$/, '');
    out.push({ date: d.toISOString().slice(0, 10), title: clean.trim(), link: tag('link'), source });
  }
  return out;
}
// 標題中的目標價：台股「目標價…3,300元」、「喊4410元」、「3100→3300」；美股「price target to $250」、「PT $250」
export function targetFromTitle(title, { market = 'TW', price = null } = {}) {
  const t = String(title || ''), ok = v => v > 0 && (!price || (v >= price * 0.5 && v <= price * 3));
  let c = [];
  if (market === 'US') {
    const to = /to \$(\d[\d,]*(?:\.\d+)?)/i.exec(t); if (to) c = [Number(to[1].replace(/,/g, ''))];
    else c = [...t.matchAll(/\$(\d[\d,]*(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));
  } else {
    const arrow = /(\d[\d,]*)\s*(?:→|->|➡|至|升至|調升至|上調至|調高至)\s*(\d[\d,]*(?:\.\d+)?)\s*元?/.exec(t);
    if (arrow) c = [Number(arrow[2].replace(/,/g, ''))];
    else c = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*元/g)].map(m => Number(m[1].replace(/,/g, '')));
  }
  const v = [...new Set(c.filter(ok))];
  return v.length === 1 ? v[0] : null;
}
export function brokerTargets(items, { market = 'TW', name = '', id = '', price = null, today, days = 90 } = {}) {
  const list = market === 'US' ? BROKERS_US : BROKERS_TW, cut = new Date(Date.parse(today + 'T00:00:00Z') - days * 864e5).toISOString().slice(0, 10), best = new Map();
  const about = t => market === 'US' ? new RegExp(`\\b${id}\\b`, 'i').test(t) || (name && t.toLowerCase().includes(name.split(/\s+/)[0].toLowerCase())) : (name && t.includes(name)) || t.includes(id);
  const kw = market === 'US' ? /price target|target price|\bPT\b/i : /目標價/;
  for (const it of [...items].sort((a, b) => b.date.localeCompare(a.date))) {
    if (it.date < cut || !kw.test(it.title) || !about(it.title)) continue;
    const hits = list.filter(([, re]) => re.test(it.title)); if (hits.length !== 1) continue;
    const target = targetFromTitle(it.title, { market, price }); if (!target) continue;
    const broker = hits[0][0]; if (!best.has(broker)) best.set(broker, { broker, target, date: it.date, title: it.title, link: it.link, source: it.source });
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date));
}
export async function newsTargets({ market, id, name, signal }) {
  const q = market === 'US' ? `${id} price target when:60d` : `${name || id} 目標價 when:60d`, loc = market === 'US' ? 'hl=en-US&gl=US&ceid=US%3Aen' : 'hl=zh-TW&gl=TW&ceid=TW%3Azh-Hant';
  const r = await fetchJSON(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`, { headers: UA, signal, label: 'Google 新聞', timeout: 20000, text: true });
  if (!r.ok) throw new DataError('Google 新聞：資料服務回應 {status}', { status: r.status });
  return parseRss(r.body);
}

// 組成畫面資料：price＝目前價格，closes＝近一年 [[date, close]]，brokers＝各家券商最新目標價（新聞）
// 平均／最高／最低：台股＝各家券商＋FactSet 共識（近 90 天各取最新）；美股＝Nasdaq 分析師共識（沒有時用各家券商）
export function buildTargets({ id, name, market, raw, brokers = [], price, closes = [], today }) {
  const up = v => v && price ? r2((v / price - 1) * 100) : null;
  const list = brokers.map(b => ({ ...b, upside: up(b.target) }));
  if (market === 'US') {
    const ok = raw?.mean, ts = list.map(b => b.target);
    if (!ok && !ts.length) return { id, name, available: false, source: raw?.source };
    const mean = ok ? raw.mean : r2(ts.reduce((a, b) => a + b, 0) / ts.length);
    return { id, name, market, available: true, source: raw?.source || 'Google 新聞', price, mean, high: ok ? raw.high : Math.max(...ts), low: ok ? raw.low : Math.min(...ts), upside: up(mean), ratings: raw?.ratings || null, count: ok ? (raw.ratings.buy || 0) + (raw.ratings.hold || 0) + (raw.ratings.sell || 0) : ts.length, brokers: list, history: (raw?.history || []).slice(0, 12), closes };
  }
  const fs = (raw?.history || []).filter(h => h.target), cut = new Date(Date.parse(today + 'T00:00:00Z') - 90 * 864e5).toISOString().slice(0, 10);
  const factset = fs[0] && fs[0].date >= cut ? { broker: 'FactSet 共識', target: fs[0].target, date: fs[0].date, rating: fs[0].rating, consensus: true, upside: up(fs[0].target) } : null;
  const all = [...list, ...(factset ? [factset] : [])];
  if (!all.length) { const s = raw ? summarize(raw.history, price, today) : null; if (!s) return { id, name, available: false, source: raw?.source }; return { id, name, market, available: true, source: raw.source, price, ...s, brokers: [], history: raw.history.slice(0, 10), closes }; }
  const ts = all.map(b => b.target), mean = r2(ts.reduce((a, b) => a + b, 0) / ts.length);
  return { id, name, market, available: true, source: 'Google 新聞（各家券商）、鉅亨網（FactSet 共識）', price, mean, high: Math.max(...ts), low: Math.min(...ts), upside: up(mean), count: all.length, brokers: all.sort((a, b) => b.date.localeCompare(a.date)), history: (raw?.history || []).slice(0, 10).map(h => ({ ...h, upside: up(h.target) })), closes };
}
