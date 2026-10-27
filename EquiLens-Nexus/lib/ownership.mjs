// 籌碼結構：股價 × 千張大戶持股比率（集保股權分散表，每週）× 內部人持股比率（董監事持股餘額明細，每月）。
// 純計算；資料由 server.mjs 準備。
export const OWNERSHIP_VERSION = '1.0';
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const self = t => /本人$/.test(t);
const BOARD = /董事|監察人/;

// 一個月的董監事持股明細（[職稱, 姓名, 選任時, 目前持股, 設質, 關係人] 列）→ 本人持股合計
export function insiderTotals(rows) {
  if (!rows?.length) return null;
  let total = 0, board = 0;
  for (const x of rows) { if (!self(x[0])) continue; const s = Number(x[3]) || 0; total += s; if (BOARD.test(x[0])) board += s; }
  return { total, board };
}
const ymEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

// weeks：parseHolders 的結果（{ date, big1000, big400, people, shares }）；price：日 K（{ date, close }）；insiders：[{ ym, total, board }]
export function buildOwnership({ id, name, weeks = [], price = [], insiders = [] }) {
  const w = weeks.filter(x => x.big1000 != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!w.length) return { id, name, available: false, reason: '查無集保股權分散資料' };
  const from = w[0].date, px = price.filter(p => p.date >= from && p.close > 0).map(p => [p.date, r2(p.close)]);
  // 內部人持股比率：分母用該月月底前最近一週的集保總股數
  const sharesAt = d => { let s = null; for (const x of w) { if (x.date > d) break; if (x.shares > 0) s = x.shares; } return s ?? w.find(x => x.shares > 0)?.shares ?? null; };
  const ins = insiders.filter(x => x.total > 0).sort((a, b) => a.ym.localeCompare(b.ym)).map(x => { const date = ymEnd(x.ym), sh = sharesAt(date); return { ym: x.ym, date, pct: sh ? r2(x.total / sh * 100) : null, boardPct: sh ? r2(x.board / sh * 100) : null, shares: x.total }; }).filter(x => x.pct != null);
  const last = w.at(-1), back = n => w[Math.max(0, w.length - 1 - n)];
  const chg = (n, k = 'big1000') => w.length > n ? r2(last[k] - back(n)[k]) : null;
  const pc = n => w.length > n && back(n).people > 0 ? r2((last.people / back(n).people - 1) * 100) : null;
  const li = ins.at(-1), pi = ins.length > 1 ? ins.at(-2) : null;
  return {
    version: OWNERSHIP_VERSION, id, name, available: true, from, to: last.date,
    weeks: w.map(x => ({ date: x.date, big1000: x.big1000, big400: x.big400, people: x.people })),
    price: px, insiders: ins,
    latest: { date: last.date, big1000: last.big1000, big400: last.big400, people: last.people, chg4: chg(4), chg12: chg(12), people4: pc(4),
      insider: li ? { ym: li.ym, pct: li.pct, boardPct: li.boardPct, chg: pi ? r2(li.pct - pi.pct) : null } : null },
  };
}
