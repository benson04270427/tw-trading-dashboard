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
// 組成畫面資料：price＝目前價格，closes＝近一年 [[date, close]]
export function buildTargets({ id, name, market, raw, price, closes = [], today }) {
  if (!raw) return { id, name, available: false };
  if (market === 'US') {
    if (!raw.mean) return { id, name, available: false, source: raw.source };
    return { id, name, market, available: true, source: raw.source, price, mean: raw.mean, high: raw.high, low: raw.low, upside: price ? r2((raw.mean / price - 1) * 100) : null, ratings: raw.ratings, count: (raw.ratings.buy || 0) + (raw.ratings.hold || 0) + (raw.ratings.sell || 0), history: raw.history.slice(0, 12), closes };
  }
  const s = summarize(raw.history, price, today);
  if (!s) return { id, name, available: false, source: raw.source };
  return { id, name, market, available: true, source: raw.source, price, ...s, history: raw.history.slice(0, 15).map(h => ({ ...h, upside: h.target && price ? r2((h.target / price - 1) * 100) : null })), closes };
}
