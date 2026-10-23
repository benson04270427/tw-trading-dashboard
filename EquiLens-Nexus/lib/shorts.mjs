// 借券賣出與放空（台股、美股）＋同業比較。純計算；資料由 server.mjs 取得：
//   台股：FinMind 信用額度總量管制餘額（TaiwanDailyShortSaleBalances：借券賣出餘額、融券餘額，股數），日 K 成交量
//   美股：Nasdaq 放空股數（每月兩次結算，含平均日成交量與回補天數）
export const SHORT_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const n = v => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : null; };
const usDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const chgPct = (a, b) => a == null || !(b > 0) ? null : r1((a / b - 1) * 100);

// 台股：rows＝FinMind 每日一列；price＝日 K（Trading_Volume 為股數）。單位換算成張
export function buildTwShorts({ id, name, rows = [], price = [] }) {
  const list = rows.map(r => ({ date: String(r.date).slice(0, 10), sbl: n(r.SBLShortSalesCurrentDayBalance), sblSell: n(r.SBLShortSalesShortSales), sblReturn: n(r.SBLShortSalesReturns), margin: n(r.MarginShortSalesCurrentDayBalance), sblQuota: n(r.SBLShortSalesQuota) })).filter(x => x.sbl != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return { id, name, market: 'TW', available: false, reason: '這檔股票沒有借券賣出資料。' };
  const vol = new Map(price.map(r => [String(r.date).slice(0, 10), n(r.Trading_Volume)])), last = list.at(-1), ago = k => list[Math.max(0, list.length - 1 - k)];
  const vols = price.slice(-20).map(r => n(r.Trading_Volume)).filter(v => v > 0), avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const lots = v => v == null ? null : Math.round(v / 1000);
  return { version: SHORT_VERSION, id, name, market: 'TW', available: true, date: last.date,
    sbl: lots(last.sbl), margin: lots(last.margin), total: lots(last.sbl + (last.margin || 0)), sblChange5: chgPct(last.sbl, ago(5).sbl), sblChange20: chgPct(last.sbl, ago(20).sbl),
    sblSell5: lots(list.slice(-5).reduce((s, x) => s + (x.sblSell || 0), 0)), sblReturn5: lots(list.slice(-5).reduce((s, x) => s + (x.sblReturn || 0), 0)),
    daysToCover: avgVol ? r1((last.sbl + (last.margin || 0)) / avgVol) : null, avgVolLots: lots(avgVol),
    sellRatio: vol.get(last.date) > 0 && last.sblSell != null ? r1(last.sblSell / vol.get(last.date) * 100) : null,
    series: list.slice(-120).map(x => [x.date, lots(x.sbl), lots(x.margin), lots(x.sblSell)]) };
}
// 美股：Nasdaq short-interest
export function buildUsShorts({ id, name, data, shares = null }) {
  const rows = (data?.shortInterestTable?.rows || []).map(r => ({ date: usDate(r.settlementDate), interest: n(r.interest), avgVol: n(r.avgDailyShareVolume), dtc: r2(n(r.daysToCover)) })).filter(x => x.date && x.interest != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { id, name, market: 'US', available: false, reason: '這檔股票沒有放空股數資料。' };
  const last = rows.at(-1), prev = rows.at(-2), m3 = rows.at(-7) || rows[0];
  return { version: SHORT_VERSION, id, name, market: 'US', available: true, date: last.date, interest: last.interest, daysToCover: last.dtc, avgVol: last.avgVol,
    change: chgPct(last.interest, prev?.interest), change3m: chgPct(last.interest, m3.interest), floatPct: shares > 0 ? r2(last.interest / shares * 100) : null,
    series: rows.slice(-24).map(x => [x.date, x.interest, x.dtc]) };
}

// ---- 同業比較 ----
// 台股：同一 AI 供應鏈段（有的話）或同產業；rows＝低估選股的全市場資料（本益比、股價淨值比、殖利率、營收），heat＝當日漲跌
export function twPeers({ id, value = [], heat = [], chainOf = new Map(), chains = {}, max = 15 }) {
  const me = value.find(r => r.id === id), seg = chainOf.get(id), hv = new Map(heat.map(h => [h.id, h]));
  let ids = seg ? chains[seg] : me?.sector ? value.filter(r => r.sector === me.sector).map(r => r.id) : [];
  const vm = new Map(value.map(r => [r.id, r]));
  const rows = [...new Set(ids)].map(x => vm.get(x)).filter(Boolean).map(r => { const h = hv.get(r.id); return { id: r.id, name: r.name, close: h?.close ?? r.close ?? null, change: h?.change ?? null, money: h?.money ?? r.turnover ?? null, pe: r.pe || null, pb: r.pb || null, yield: r.yield ?? null, revYoY: r.revYoY ?? null, revMoM: r.revMoM ?? null, revCumYoY: r.revCumYoY ?? null, self: r.id === id }; });
  rows.sort((a, b) => Number(b.self) - Number(a.self) || (b.money ?? 0) - (a.money ?? 0));
  const out = rows.slice(0, max);
  return finishPeers({ id, group: seg || me?.sector || '', kind: seg ? 'chain' : 'sector', rows: out, cols: ['pe', 'pb', 'yield', 'revYoY', 'revCumYoY', 'change'] });
}
// 美股：同 Nasdaq 產業、成交金額前段的公司；fund＝Map(id → Finnhub 基本面)
export function usPeers({ id, heat = [], fund = new Map(), max = 15 }) {
  const me = heat.find(h => h.id === id); if (!me) return { id, available: false, reason: '找不到這檔股票的產業資料。' };
  const same = heat.filter(h => h.sector === me.sector && (h.id === id || fund.has(h.id))).sort((a, b) => Number(b.id === id) - Number(a.id === id) || (b.money ?? 0) - (a.money ?? 0)).slice(0, max);
  const rows = same.map(h => { const f = fund.get(h.id) || {}; return { id: h.id, name: h.name, close: h.close, change: h.change, money: h.money, pe: r1(f.pe) || null, revYoY: r1(f.revGrowth), epsYoY: r1(f.epsGrowth), offHigh: f.high52 > 0 && h.close ? r1((h.close / f.high52 - 1) * 100) : null, mcap: f.mcap ?? null, self: h.id === id }; });
  return finishPeers({ id, group: me.sector, kind: 'sector', rows, cols: ['pe', 'revYoY', 'epsYoY', 'offHigh', 'change'] });
}
// 每欄的中位數與這檔的排名（本益比、股價淨值比越低排越前，其餘越高越前）
function finishPeers({ id, group, kind, rows, cols }) {
  if (rows.length < 2) return { id, available: false, reason: '同業資料不足。' };
  const med = {}, rank = {}, me = rows.find(r => r.self);
  for (const k of cols) {
    const vals = rows.map(r => r[k]).filter(v => v != null && (!['pe', 'pb'].includes(k) || v > 0)).sort((a, b) => a - b);
    med[k] = vals.length ? r2(vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
    const v = me?.[k]; if (v == null || (['pe', 'pb'].includes(k) && !(v > 0))) { rank[k] = null; continue; }
    const better = ['pe', 'pb'].includes(k) ? vals.filter(x => x < v).length : vals.filter(x => x > v).length; rank[k] = { rank: better + 1, of: vals.length };
  }
  return { version: SHORT_VERSION, id, available: true, group, kind, cols, rows, median: med, rank };
}
