// 內部人持股與交易（台股、美股）。純計算；資料由 server.mjs 取得：
//   台股：證交所／櫃買開放資料「董監事持股餘額明細」（每月，全市場）與「內部人持股轉讓事前申報」（每日，全市場），免金鑰。
//         每月明細存一份到本機，才能算出逐月增減；申報轉讓每天累積保存 180 天。
//   美股：Nasdaq 內部人交易（資料來自 SEC Form 4，每檔 1 個請求）。
import { rocDate } from './providers/common.mjs';

export const INSIDER_VERSION = '1.0';
const n = v => { const x = Number(String(v ?? '').replace(/[$,\s()]/g, '')); return Number.isFinite(x) ? x : null; };
// 欄位名稱在證交所與櫃買略有不同（例如「選任時持股 」多一個空白、「申報人身分」／「申請人身分」）
const f = (r, ...keys) => { for (const k of keys) { if (r[k] != null) return r[k]; const hit = Object.keys(r).find(x => x.trim() === k); if (hit) return r[hit]; } return null; };
const usDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };

// 董監事持股餘額明細 → { ym: 'YYYY-MM', data: { id: [[職稱, 姓名, 選任時持股, 目前持股, 設質股數, 關係人持股]] } }
export function parseTwHoldings(rows = []) {
  const data = {}; let ym = null;
  for (const r of rows) {
    const id = String(f(r, '公司代號') || '').trim(); if (!/^\d{4,6}[A-Z]?$/.test(id)) continue;
    const y = String(f(r, '資料年月') || ''); if (/^\d{4,5}$/.test(y)) ym = `${Number(y.slice(0, -2)) + 1911}-${y.slice(-2)}`;
    (data[id] ||= []).push([String(f(r, '職稱') || '').trim(), String(f(r, '姓名') || '').trim(), n(f(r, '選任時持股')), n(f(r, '目前持股')) ?? 0, n(f(r, '設質股數')) ?? 0, n(f(r, '內部人關係人目前持股合計')) ?? 0]);
  }
  return { ym, data };
}
// 內部人持股轉讓事前申報 → [{ date, id, company, role, person, method, shares, held, after, period }]
export function parseTwTransfers(rows = []) {
  return rows.map(r => {
    const id = String(f(r, '公司代號', 'SecuritiesCompanyCode') || '').trim(); if (!id) return null;
    return { date: rocDate(f(r, '出表日期', 'Date')), id, company: String(f(r, '公司名稱', 'CompanyName') || '').trim(), role: String(f(r, '申報人身分', '申請人身分') || '').trim(), person: String(f(r, '姓名') || '').trim(),
      method: String(f(r, '預定轉讓方式及股數-轉讓方式') || '').trim(), shares: n(f(r, '預定轉讓總股數-自有持股')) ?? n(f(r, '預定轉讓方式及股數-轉讓股數')) ?? 0,
      held: n(f(r, '目前持有股數-自有持股')), after: n(f(r, '預定轉讓後持股-自有持股')), period: String(f(r, '有效轉讓期間') || '').trim() };
  }).filter(x => x && x.date && x.shares > 0);
}
// 合併保存的申報（同日同公司同人只留一筆），保留 days 天
export function mergeTransfers(old = [], add = [], today, days = 180) {
  const cut = new Date(Date.parse(today + 'T00:00:00Z') - days * 864e5).toISOString().slice(0, 10), m = new Map();
  for (const x of [...old, ...add]) if (x.date >= cut) m.set(`${x.date}|${x.id}|${x.person}|${x.shares}`, x);
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
const self = t => /本人$/.test(t);
const group = t => /董事長|董事|監察人/.test(t) ? 'board' : /大股東/.test(t) ? 'major' : 'manager';
// 單檔：本月明細、上月明細（可沒有）、申報轉讓 → 摘要與逐人變化
export function buildTwInsiders({ id, name, cur, prev = null, curYm, prevYm = null, transfers = [], price = null }) {
  if (!cur?.length) return { id, name, market: 'TW', available: false, reason: '這檔股票沒有董監事持股資料。' };
  const pm = new Map((prev || []).map(x => [x[0] + '|' + x[1], x])), people = cur.filter(x => self(x[0])).map(x => {
    const p = pm.get(x[0] + '|' + x[1]);
    return { title: x[0], name: x[1], group: group(x[0]), elected: x[2], shares: x[3], pledged: x[4], related: x[5], change: p ? x[3] - p[3] : null, sinceElected: x[2] != null ? x[3] - x[2] : null };
  }).sort((a, b) => b.shares - a.shares);
  const sum = (list, k) => list.reduce((s, x) => s + (x[k] || 0), 0), board = people.filter(x => x.group === 'board');
  const changed = prev ? people.filter(x => x.change) : [], tr = transfers.filter(x => x.id === id);
  const lots = v => v == null ? null : Math.round(v / 1000);
  return { version: INSIDER_VERSION, id, name, market: 'TW', available: true, ym: curYm, prevYm, price,
    board: { shares: sum(board, 'shares'), pledged: sum(board, 'pledged'), pledgeRatio: sum(board, 'shares') > 0 ? Math.round(sum(board, 'pledged') / sum(board, 'shares') * 1000) / 10 : null, change: prev ? sum(board, 'change') : null, sinceElected: sum(board.filter(x => x.elected != null), 'sinceElected') },
    total: { shares: sum(people, 'shares'), change: prev ? sum(people, 'change') : null },
    changed: changed.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 20).map(x => ({ ...x, changeLots: lots(x.change) })),
    people: people.slice(0, 30).map(x => ({ ...x, lots: lots(x.shares) })), transfers: tr.slice(0, 20), transferShares: tr.reduce((s, x) => s + x.shares, 0) };
}
// 美股：Nasdaq 內部人交易
export function parseUsInsiders(data) {
  const pick = (table, label) => (data?.[table]?.rows || []).find(r => r.insiderTrade === label) || {};
  const cnt = k => ({ m3: n(pick('numberOfTrades', k).months3), m12: n(pick('numberOfTrades', k).months12) }), sh = k => ({ m3: n(pick('numberOfSharesTraded', k).months3) ?? null, m12: n(pick('numberOfSharesTraded', k).months12) ?? null });
  const net = pick('numberOfSharesTraded', 'Net Activity'), signed = s => { const t = String(s ?? '').trim(); const v = n(t); return v == null ? null : /^\(.*\)$/.test(t) || t.startsWith('-') ? -Math.abs(v) : v; };
  const trades = (data?.transactionTable?.table?.rows || []).map(r => ({ date: usDate(r.lastDate), insider: r.insider, relation: r.relation, type: r.transactionType, own: r.ownType, shares: n(r.sharesTraded), price: n(r.lastPrice) || null, held: n(r.sharesHeld) })).filter(x => x.date);
  return { buys: cnt('Number of Open Market Buys'), sells: cnt('Number of Sells'), bought: sh('Number of Shares Bought'), sold: sh('Number of Shares Sold'), net: { m3: signed(net.months3), m12: signed(net.months12) }, trades };
}
export function buildUsInsiders({ id, name, parsed, price = null }) {
  if (!parsed || (!parsed.trades.length && parsed.buys.m12 == null)) return { id, name, market: 'US', available: false, reason: '這檔股票沒有內部人交易資料。' };
  const open = parsed.trades.filter(x => /^(Buy|Sell)$/i.test(x.type || ''));
  return { version: INSIDER_VERSION, id, name, market: 'US', available: true, price, ...parsed, openMarket: { buys: open.filter(x => /buy/i.test(x.type)).length, sells: open.filter(x => /sell/i.test(x.type)).length }, trades: parsed.trades.slice(0, 25) };
}
