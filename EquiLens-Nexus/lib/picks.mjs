// 今日漲跌排行與每日精選（台股、美股）。純計算；資料由 server.mjs 準備：
// 收盤熱浪圖（全市場每檔收盤、漲跌、成交金額與前一日成交金額）、法人買賣超排行（台股，FinMind）、
// 研究名單的本機資料（法人近 5 日、營收、日 K → 訊號面板）、少數候選股的近兩日新聞。
// 精選是依固定規則加總的研究清單，不是買賣建議。
import { buildSignal } from './signal.mjs';
import { isNoise, cleanTitle, titleKey } from './newswatch.mjs';

export const PICKS_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
// 排行與精選的流動性門檻（成交金額、股價）
export const THRESHOLDS = { TW: { minMoney: 3e7, minPrice: 10, limit: 9.5 }, US: { minMoney: 2e7, minPrice: 3, limit: null } };

// 熱浪圖（收盤或盤中）→ 每檔一列
export function heatStocks(heat) {
  const out = [];
  for (const s of heat?.sectors || []) for (const x of s.stocks || []) out.push({ ...x, sector: x.sector || s.name, moneyChange: x.prevMoney > 0 ? r1((x.money / x.prevMoney - 1) * 100) : null });
  return out;
}
// 今日漲跌排行：成交金額與股價達門檻的普通股，各取前 n 名
export function movers(heat, { market = 'TW', n = 20, watch = new Set() } = {}) {
  const t = THRESHOLDS[market] || THRESHOLDS.US, rows = heatStocks(heat).filter(x => x.change != null && x.close >= t.minPrice && (x.money ?? 0) >= t.minMoney);
  const pick = x => ({ id: x.id, name: x.name, sector: x.sector, close: x.close, change: x.change, money: x.money, moneyChange: x.moneyChange, watch: watch.has(x.id) });
  return { date: heat?.date || null, asOf: heat?.asOf || null, eligible: rows.length, minMoney: t.minMoney, minPrice: t.minPrice,
    gainers: rows.filter(x => x.change > 0).sort((a, b) => b.change - a.change || b.money - a.money).slice(0, n).map(pick),
    losers: rows.filter(x => x.change < 0).sort((a, b) => a.change - b.change || b.money - a.money).slice(0, n).map(pick) };
}

// 法人買賣超排行（flows-DATE.json 的 rankings）→ 代號 → { foreign, trust }（張）
export function flowMap(flows) {
  const m = new Map();
  for (const r of flows?.rankings || []) {
    if (!['foreign', 'trust'].includes(r.investor)) continue;
    for (const [side, list] of [['buy', r.buy], ['sell', r.sell]]) (list || []).forEach((x, i) => { const o = m.get(x.id) || {}; o[r.investor] = x.netLots; o[r.investor + 'Rank'] = side === 'buy' ? i + 1 : -(i + 1); m.set(x.id, o); });
  }
  return m;
}

// 全市場法人買賣超（證交所 T86＋櫃買，每檔每類法人一列）→ 同 flowMap 格式（外資含外資自營商；上市、上櫃合併排名前 20）
export function flowMapFromRows(rows = [], n = 20) {
  const net = new Map();
  for (const r of rows) {
    const k = r.name === 'Foreign_Investor' || r.name === 'Foreign_Dealer_Self' ? 'foreign' : r.name === 'Investment_Trust' ? 'trust' : null; if (!k) continue;
    const o = net.get(r.stock_id) || { foreign: 0, trust: 0 }; o[k] += ((Number(r.buy) || 0) - (Number(r.sell) || 0)) / 1000; net.set(r.stock_id, o);
  }
  const m = new Map();
  for (const k of ['foreign', 'trust']) {
    const list = [...net].filter(([, o]) => o[k]);
    list.filter(([, o]) => o[k] > 0).sort((a, b) => b[1][k] - a[1][k]).slice(0, n).forEach(([id, o], i) => { const x = m.get(id) || {}; x[k] = Math.round(o[k]); x[k + 'Rank'] = i + 1; m.set(id, x); });
    list.filter(([, o]) => o[k] < 0).sort((a, b) => a[1][k] - b[1][k]).slice(0, n).forEach(([id, o], i) => { const x = m.get(id) || {}; x[k] = Math.round(o[k]); x[k + 'Rank'] = -(i + 1); m.set(id, x); });
  }
  return m;
}
// 新聞：去掉論壇與個股概覽頁、同一標題（不同來源轉載）只留一則，只保留標題提到這檔股票（代號或名稱）的新聞
const brief = name => String(name || '').replace(/\b(Inc\.?|Corporation|Corp\.?|Company|Co\.?|Holdings?|Group|Ltd\.?|plc|Common Stock|Class [A-Z]|Ordinary Shares|N\.V\.|S\.A\.)\b/gi, '').replace(/[-*]?KY$/i, '').replace(/[,.\s]+$/, '').trim();
export function relevantNews(list = [], id, name) {
  const words = [String(id), brief(name).split(/\s+/)[0]].filter(w => w && w.length >= 2), seen = new Set(), out = [];
  for (const n of list) {
    if (!n?.title || isNoise(n)) continue;
    const title = cleanTitle(n.title), key = titleKey(title); if (!key || seen.has(key)) continue;
    if (!words.some(w => title.toLowerCase().includes(w.toLowerCase()))) continue;
    seen.add(key); out.push({ title, link: n.link || '', source: n.source || (String(n.title).match(/\s[-–]\s([^-–]{1,24})$/)?.[1] ?? '') });
  }
  return out;
}
// 近 60 日收盤新高
export function newHigh(rows = [], n = 60) { const c = rows.map(r => Number(r.close)).filter(v => v > 0); if (c.length < n) return false; const last = c.at(-1); return last >= Math.max(...c.slice(-n)); }

const fmtMoney = (v, market) => market === 'TW' ? `${r1(v / 1e8)} 億` : v >= 1e9 ? `$${r1(v / 1e9)}B` : `$${r1(v / 1e6)}M`;
const md = d => String(d || '').slice(5, 10).replace('-', '/');
// 單檔評分：每個加分項目附一句理由
export function scoreStock(f, { market = 'TW' } = {}) {
  const t = THRESHOLDS[market] || THRESHOLDS.US, reasons = [], warnings = []; let score = 0;
  const add = (v, text) => { score += v; if (text) reasons.push(text); };
  // 籌碼（台股）：當日外資／投信買超排行、研究名單的法人近 5 日
  if (f.flow) {
    const { foreign, trust, foreignRank, trustRank } = f.flow;
    if (trustRank > 0) add(12, `投信買超 ${Math.round(trust).toLocaleString()} 張（第 ${trustRank} 名）`);
    if (foreignRank > 0) add(12, `外資買超 ${Math.round(foreign).toLocaleString()} 張（第 ${foreignRank} 名）`);
    if (trustRank > 0 && foreignRank > 0) add(5, '外資、投信同步買超');
    if (trustRank < 0 && foreignRank < 0) { score -= 10; warnings.push('外資、投信同步賣超'); }
  }
  if (f.chips5 != null) { if (f.chips5 > 0) add(6, `法人近 5 日買超 ${Math.round(f.chips5).toLocaleString()} 張`); else if (f.chips5 < 0) { score -= 6; warnings.push(`法人近 5 日賣超 ${Math.round(-f.chips5).toLocaleString()} 張`); } }
  // 訊號面板
  const s = f.signal;
  if (s?.side === 'buy' && !s.stopped && s.age <= 3) add(18, `ATR 追蹤線翻多（${md(s.date)}）`);
  else if (s?.side === 'buy' && !s.stopped) add(6, '追蹤線偏多');
  else if (s?.side === 'sell' && s.age <= 3) { score -= 15; warnings.push(`ATR 追蹤線翻空（${md(s.date)}）`); }
  // 當日量價
  if (f.change >= 1.5 && (t.limit == null || f.change < t.limit)) add(8, `今日上漲 ${f.change}%，成交 ${fmtMoney(f.money, market)}`);
  if (t.limit != null && f.change >= t.limit) { add(4, `今日漲停（${f.change}%）`); warnings.push('漲停，追價風險高'); }
  if (f.moneyChange >= 50 && f.change > 0) add(6, `成交金額較前一日增加 ${Math.round(f.moneyChange)}%`);
  if (f.change <= -3) { score -= 8; warnings.push(`今日下跌 ${f.change}%`); }
  if (f.high60) add(8, '收盤創 60 日新高');
  // 營收
  if (f.revYoY >= 30) add(10, `營收年增 ${f.revYoY}%`); else if (f.revYoY >= 15) add(6, `營收年增 ${f.revYoY}%`);
  // 新聞（近兩日）
  if (f.news?.length) add(Math.min(12, 6 + (f.news.length - 1) * 2), `新聞：${f.news[0].title}`);
  // AI 供應鏈
  if (f.chain) add(5, `AI 供應鏈：${f.chain}`);
  return { score: Math.round(score), reasons, warnings };
}
// 精選：分數 ≥ 15 且至少兩個理由；同一供應鏈／產業最多 maxPer 檔（美股產業分類較粗，用 3）
export function choose(scored, n = 5, maxPer = 2) {
  const out = [], per = new Map();
  for (const x of [...scored].filter(x => x.score >= 15 && x.reasons.length >= 2).sort((a, b) => b.score - a.score || (b.money ?? 0) - (a.money ?? 0))) {
    const k = x.chain || x.sector || ''; if ((per.get(k) || 0) >= maxPer) continue;
    per.set(k, (per.get(k) || 0) + 1); out.push(x); if (out.length >= n) break;
  }
  return out;
}
// 候選池：研究名單、自選、AI 供應鏈（台股）、法人買超前段、當日成交金額大且上漲的股票
export function candidates({ heat, market = 'TW', research = new Set(), watch = new Set(), chain = new Map(), flows = new Map(), top = 60 } = {}) {
  const t = THRESHOLDS[market] || THRESHOLDS.US, rows = heatStocks(heat).filter(x => x.close >= t.minPrice && (x.money ?? 0) >= t.minMoney);
  const active = new Set([...rows].filter(x => x.change > 0).sort((a, b) => b.money - a.money).slice(0, top).map(x => x.id));
  return rows.filter(x => research.has(x.id) || watch.has(x.id) || chain.has(x.id) || (flows.get(x.id)?.foreignRank > 0) || (flows.get(x.id)?.trustRank > 0) || active.has(x.id));
}
// 研究名單的本機資料 → 訊號（只算有日 K 的股票）
export function signalOf(rows, p) { if (!rows?.length) return null; const s = buildSignal({ rows, p }); return s.available && s.signal ? { side: s.signal.side, age: s.signal.age, date: s.signal.date, stopped: !!s.signal.stopped } : null; }
