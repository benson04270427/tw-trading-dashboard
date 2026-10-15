// 籌碼追蹤（台股 FinMind Sponsor）：
// 1. 分點追蹤：使用者指定要追的券商分點，每個交易日盤後以「依券商代碼查分點」一次取回該分點當天所有股票進出，
//    整理成買超／賣超排行，標出自選與研究名單股票、連續買賣天數。兩種提醒：
//    單日主導＝淨買超占當日成交量達門檻且淨買超金額達門檻；多日吃貨＝最近 N 個交易日累計淨買超占集保總股數達門檻。
// 2. 大戶集中度排行：每週股權分散表（全市場單日一次取回），比較千張大戶比例的 1 週／4 週變化與股東人數變化，
//    排出籌碼集中與渙散的股票（自選＋研究名單，或全市場普通股）。
import { holderLevels } from './insight.mjs';
import { t } from './i18n.mjs';

export const CHIP_DEFAULTS = { branches: [], auto: true, dayPct: 10, minAmount: 1e7, accumPct: 0.3, accumDays: 5, holdersPush: true };
export const MAX_BRANCHES = 20;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = v => Math.round(v * 100) / 100;

export function normalizeChipwatch(v = {}) {
  const x = v || {}, seen = new Set();
  const branches = (Array.isArray(x.branches) ? x.branches : []).filter(b => b && /^\w{1,10}$/.test(String(b.id)) && !seen.has(String(b.id)) && seen.add(String(b.id)))
    .slice(0, MAX_BRANCHES).map(b => ({ id: String(b.id), name: String(b.name || b.id).slice(0, 40) }));
  const pick = (k, lo, hi, round = false) => { const n = Number(x[k]); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, round ? Math.round(n) : n)) : CHIP_DEFAULTS[k]; };
  return { branches, auto: x.auto !== false, dayPct: pick('dayPct', 1, 50), minAmount: pick('minAmount', 0, 1e9, true), accumPct: pick('accumPct', 0.05, 5), accumDays: pick('accumDays', 2, 20, true), holdersPush: x.holdersPush !== false };
}

/* ---------- 分點追蹤 ---------- */
// rows：某分點某日的分點資料（每檔股票每個價位一列；buy/sell 單位為股）→ 每檔股票合計
export function aggregateTrader(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = String(r.stock_id || ''); if (!id) continue;
    const x = map.get(id) || { id, buy: 0, sell: 0, buyAmt: 0, sellAmt: 0 };
    const p = num(r.price), b = num(r.buy), s = num(r.sell);
    x.buy += b; x.sell += s; x.buyAmt += b * p; x.sellAmt += s * p; map.set(id, x);
  }
  return [...map.values()].map(x => ({ ...x, net: x.buy - x.sell, netAmt: Math.round(x.buyAmt - x.sellAmt), avgBuy: x.buy ? r2(x.buyAmt / x.buy) : null, avgSell: x.sell ? r2(x.sellAmt / x.sell) : null }));
}
// 某分點連續買（賣）超天數：history 為之前各日的 { 股票: 淨股數 }（由舊到新），today 為今日淨股數
export function streakOf(history, id, todayNet) {
  const dir = Math.sign(todayNet); if (!dir) return 0;
  let n = 1; for (let i = history.length - 1; i >= 0; i--) { if (Math.sign(history[i][id] || 0) === dir) n++; else break; }
  return n * dir;
}
// 單一分點的當日報告：買超、賣超前 top 名（依淨金額）、自選與研究名單中有進出的股票，以及達提醒條件的股票。
// volumes：{ 股票: 當日成交股數 }；shares：{ 股票: 集保總股數 }；history：之前各日的 { 股票: 淨股數 }（由舊到新，最近一筆是前一個交易日）
// 每檔附上 volPct（淨買賣超占當日成交量 %）、accumNet／accumPct（含今日最近 accumDays 日累計淨買賣超、占總股數 %）
export function branchDay(rows, { meta = new Map(), watch = new Set(), research = new Set(), history = [], top = 15, volumes = {}, shares = {}, settings = CHIP_DEFAULTS } = {}) {
  const cs = { ...CHIP_DEFAULTS, ...settings }, past = history.slice(-(cs.accumDays - 1));
  const list = aggregateTrader(rows).map(x => {
    const vol = volumes[x.id], sh = shares[x.id], accumNet = past.reduce((a, d) => a + (d[x.id] || 0), x.net);
    return { ...x, name: meta.get(x.id)?.name || x.id, watch: watch.has(x.id), research: research.has(x.id), streak: streakOf(history, x.id, x.buy - x.sell),
      volPct: vol > 0 ? r2(x.net / vol * 100) : null, accumNet, accumDays: past.length + 1, accumPct: sh > 0 ? Math.round(accumNet / sh * 1e4) / 100 : null };
  });
  const sorted = list.slice().sort((a, b) => b.netAmt - a.netAmt);
  const buy = sorted.filter(x => x.netAmt > 0).slice(0, top), sell = sorted.filter(x => x.netAmt < 0).reverse().slice(0, top);
  const mine = sorted.filter(x => (x.watch || x.research) && x.net !== 0);
  // 提醒條件（只看淨買超）：單日主導、多日吃貨（累計天數需達設定天數）
  const signals = sorted.filter(x => x.net > 0).map(x => ({ ...x, day: x.volPct != null && x.volPct >= cs.dayPct && x.netAmt >= cs.minAmount, accum: x.accumPct != null && x.accumDays >= cs.accumDays && x.accumPct >= cs.accumPct }))
    .filter(x => x.day || x.accum);
  const slim = x => ({ id: x.id, name: x.name, net: x.net, netAmt: x.netAmt, buy: x.buy, sell: x.sell, avgBuy: x.avgBuy, avgSell: x.avgSell, watch: x.watch, research: x.research, streak: x.streak, volPct: x.volPct, accumNet: x.accumNet, accumDays: x.accumDays, accumPct: x.accumPct, ...(x.day !== undefined ? { day: x.day, accum: x.accum } : {}) });
  return {
    count: list.length, buyAmt: Math.round(list.reduce((a, x) => a + x.buyAmt, 0)), sellAmt: Math.round(list.reduce((a, x) => a + x.sellAmt, 0)),
    buy: buy.map(slim), sell: sell.map(slim), mine: mine.map(slim), signals: signals.map(slim),
    nets: Object.fromEntries(list.filter(x => x.net).map(x => [x.id, x.net])), // 供之後計算連續天數與累計
  };
}
// 盤後提醒：每個分點一則，列出達「單日主導」或「多日吃貨」條件的股票（自選與研究名單優先）
export function brokerWatchAlerts(doc, { lot = 1000, lang } = {}) {
  const out = [], lots = v => Math.round(v / lot).toLocaleString('en-US'), yi = v => (v / 1e8).toFixed(v >= 1e9 ? 1 : 2);
  for (const b of doc.branches) {
    if (b.error || !b.count || !b.signals?.length) continue;
    const order = x => (x.watch ? 0 : x.research ? 1 : 2), list = b.signals.slice().sort((a, c) => order(a) - order(c) || c.netAmt - a.netAmt);
    const day = list.filter(x => x.day).slice(0, 5), accum = list.filter(x => x.accum).slice(0, 5);
    const mark = x => x.watch ? t('（自選）', null, lang) : x.research ? t('（研究）', null, lang) : '';
    const parts = [];
    if (day.length) parts.push(t('單日主導：{list}', { list: day.map(x => t('{name}{mark} +{lots} 張（占成交量 {pct}%、{amt} 億）', { name: x.name, mark: mark(x), lots: lots(x.net), pct: x.volPct, amt: yi(x.netAmt) }, lang)).join('、') }, lang));
    if (accum.length) parts.push(t('多日吃貨：{list}', { list: accum.map(x => t('{name}{mark} {days} 日 +{lots} 張（占股本 {pct}%）', { name: x.name, mark: mark(x), days: x.accumDays, lots: lots(x.accumNet), pct: x.accumPct }, lang)).join('、') }, lang));
    const mine = list.filter(x => x.watch || x.research);
    out.push({ type: 'broker', stockId: '', name: '', title: t('分點追蹤：{name}', { name: b.name }, lang), detail: `${doc.date} · ${parts.join(' · ')}`, level: mine.some(x => x.watch) ? 'hi' : 'mid', watch: mine.some(x => x.watch), date: doc.date, branch: b.id });
  }
  return out;
}

/* ---------- 大戶集中度排行 ---------- */
// 全市場某日股權分散表 → { 股票: [千張大戶%, 400 張以上%, 50 張以下%, 股東人數, 集保總股數] }
export function holderMarketDay(rows, date) {
  const by = new Map();
  for (const r of rows) { if (date && r.date !== date) continue; const id = String(r.stock_id); if (!by.has(id)) by.set(id, []); by.get(id).push(r); }
  const out = {};
  for (const [id, list] of by) { const h = holderLevels(list); if (h.people > 0) out[id] = [h.big1000, h.big400, h.small, h.people, h.shares || 0]; }
  return out;
}
// days：{ latest, prev1, prev4 }，各為 { date, s: holderMarketDay(...) }；ids：要排名的股票（null＝全部普通股）
export function rankHolders(days, { ids = null, meta = new Map(), watch = new Set(), research = new Set(), minPeople = 0 } = {}) {
  const L = days.latest; if (!L?.s) return null;
  const P1 = days.prev1?.s || {}, P4 = days.prev4?.s || {};
  const pool = ids ? ids.filter(id => L.s[id]) : Object.keys(L.s).filter(id => /^[1-9]\d{3}$/.test(id) && (!meta.size || meta.has(id)));
  const rows = [];
  for (const id of pool) {
    const [b, b400, small, people] = L.s[id]; if (people < minPeople) continue;
    const p1 = P1[id], p4 = P4[id];
    const d1 = p1 ? r2(b - p1[0]) : null, d4 = p4 ? r2(b - p4[0]) : null, dp4 = p4?.[3] ? r2((people / p4[3] - 1) * 100) : null, dp1 = p1?.[3] ? r2((people / p1[3] - 1) * 100) : null;
    const tone = d4 == null ? '資料累積中' : d4 >= 0.5 && (dp4 == null || dp4 <= 0) ? '籌碼集中' : d4 <= -0.5 && (dp4 == null || dp4 >= 0) ? '籌碼渙散' : '大致持平';
    rows.push({ id, name: meta.get(id)?.name || id, big1000: b, big400: b400, small, people, d1, d4, dp1, dp4, tone, watch: watch.has(id), research: research.has(id) });
  }
  const key = x => x.d4 ?? x.d1 ?? -1e9;
  rows.sort((a, b) => key(b) - key(a));
  return { date: L.date, prev1: days.prev1?.date || null, prev4: days.prev4?.date || null, count: rows.length, rows };
}
export function holderRankAlert(rank, { lang, top = 5 } = {}) {
  if (!rank?.rows?.length) return null;
  const up = rank.rows.filter(x => x.tone === '籌碼集中').slice(0, top), down = rank.rows.filter(x => x.tone === '籌碼渙散').slice(-top).reverse();
  if (!up.length && !down.length) return null;
  const item = x => `${x.name} ${x.d4 > 0 ? '+' : ''}${x.d4}%`;
  const parts = [up.length ? t('集中：{list}', { list: up.map(item).join('、') }, lang) : '', down.length ? t('渙散：{list}', { list: down.map(item).join('、') }, lang) : ''].filter(Boolean);
  return { type: 'holders', stockId: '', name: '', title: t('千張大戶週報', null, lang), detail: `${rank.date} · ${parts.join(' · ')}${t('（4 週變化）', null, lang)}`, level: up.some(x => x.watch) ? 'hi' : 'mid', watch: up.some(x => x.watch), date: rank.date };
}
