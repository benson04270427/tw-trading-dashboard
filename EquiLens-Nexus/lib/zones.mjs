// 策略選股：價值區與升溫區（台股、美股），每天收盤後依固定規則篩出名單並存檔，
// 每檔股票可以回看「哪幾天入選哪一區、當天收盤價」。純計算；資料由 server.mjs 準備。
//
// 台股（範圍：AI 供應鏈＋研究名單＋自選）
//   產業價值區：有獲利、單月營收年增 ≥ 15% 且月增 > 0，本益比在同產業的較低一半（百分位 ≤ 50），且 PEG ≤ 1（今年累計營收年增計算）
//   產業升溫區：當日上漲 ≥ 3%（含漲停）、成交金額較前一日增加 ≥ 30% 或漲停，營收年增 > 0（有資料時）
// 美股（範圍：當日成交金額前 300 名＋研究名單＋自選；基本面來自 Finnhub）
//   美股價值區：有獲利、營收年增（近四季）≥ 15%，本益比在同產業候選中的較低三分之一（百分位 ≤ 35），股價距 52 週高點回檔 10%～35%
//   美股升溫區：當日上漲 ≥ 3%（或上漲 ≥ 2% 且成交金額增加 ≥ 50%），股價在 52 週高點 5% 以內，營收年增 > 0
export const ZONES_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
export const ZONE_NAMES = { TW: { value: '產業價值區', heat: '產業升溫區' }, US: { value: '美股價值區', heat: '美股升溫區' } };

// 同組內的百分位（0～100，較小值的比例）
function pctIn(list, v) { const s = list.filter(x => x != null).sort((a, b) => a - b); if (!s.length || v == null) return null; return s.filter(x => x < v).length / s.length * 100; }
const peerPct = (rows, key, minPeers = 6) => {
  const by = new Map(); for (const r of rows) { if (r[key] == null) continue; if (!by.has(r.sector)) by.set(r.sector, []); by.get(r.sector).push(r[key]); }
  const all = rows.map(r => r[key]).filter(v => v != null);
  return r => pctIn((by.get(r.sector)?.length || 0) >= minPeers ? by.get(r.sector) : all, r[key]);
};

// 台股：value＝低估選股的全市場資料列（含 pe、revYoY、revMoM…），heat＝熱浪圖每檔（change、money、moneyChange、close）
export function zonesTW({ value = [], heat = [], scope = new Set(), chain = new Map() }) {
  const hv = new Map(heat.map(x => [x.id, x])), pe = peerPct(value.filter(r => r.pe > 0), 'pe');
  const row = (r, h, extra = {}) => ({ id: r.id, name: r.name || h?.name || r.id, sector: r.sector || h?.sector || '', chain: chain.get(r.id) || null, close: h?.close ?? r.close ?? null, change: h?.change ?? null, money: h?.money ?? null, revMoM: r.revMoM ?? null, revYoY: r.revYoY ?? null, pe: r.pe ?? null, ...extra });
  const valueZone = value.filter(r => scope.has(r.id) && r.pe > 0 && r.revYoY >= 15 && r.revMoM > 0).map(r => { const p = pe(r), peg = r.revCumYoY > 0 ? r.pe / r.revCumYoY : null; return { r, p, peg }; })
    .filter(x => x.p != null && x.p <= 50 && (x.peg == null || x.peg <= 1))
    .map(x => row(x.r, hv.get(x.r.id), { pePct: r1(x.p), peg: x.peg == null ? null : Math.round(x.peg * 100) / 100 }));
  const vmap = new Map(value.map(r => [r.id, r]));
  const heatZone = heat.filter(h => scope.has(h.id) && h.change >= 3 && (h.money ?? 0) >= 3e7 && ((h.moneyChange ?? 0) >= 30 || h.change >= 9.5) && !((vmap.get(h.id)?.revYoY ?? 1) <= 0))
    .map(h => row(vmap.get(h.id) || { id: h.id, name: h.name, sector: h.sector }, h, { moneyChange: h.moneyChange ?? null }));
  const sort = (a, b) => (b.change ?? -99) - (a.change ?? -99) || a.id.localeCompare(b.id);
  return { value: valueZone.sort(sort), heat: heatZone.sort(sort) };
}
// 美股：heat＝熱浪圖每檔，fund＝Map(id → { pe, revGrowth, high52, low52 })
export function zonesUS({ heat = [], fund = new Map(), scope = null }) {
  // 52 週高低與股價明顯不在同一幣別或單位時（例如部分外國存託憑證），不使用 52 週資料
  const ok52 = r => r.high52 > 0 && r.close > 0 && r.high52 >= r.close * 0.9 && r.high52 <= r.close * 2.5 && (!(r.low52 > 0) || r.low52 <= r.close * 1.1);
  const rows = heat.filter(h => fund.has(h.id) && (!scope || scope.has(h.id))).map(h => { const r = { ...h, ...fund.get(h.id) }; if (!ok52(r)) { r.high52 = null; r.low52 = null; } return r; });
  const pe = peerPct(rows.filter(r => r.pe > 0), 'pe', 5);
  const row = (r, extra = {}) => ({ id: r.id, name: r.name || r.id, sector: r.sector || '', chain: null, close: r.close ?? null, change: r.change ?? null, money: r.money ?? null, revYoY: r1(r.revGrowth), pe: r1(r.pe), offHigh: r.high52 > 0 && r.close ? r1((r.close / r.high52 - 1) * 100) : null, ...extra });
  const valueZone = rows.filter(r => r.pe > 0 && r.revGrowth >= 15 && r.high52 > 0 && r.close <= r.high52 * 0.9 && r.close >= r.high52 * 0.65).map(r => ({ r, p: pe(r) })).filter(x => x.p != null && x.p <= 35).map(x => row(x.r, { pePct: r1(x.p) }));
  const heatZone = rows.filter(r => (r.change >= 3 || (r.change >= 2 && (r.moneyChange ?? 0) >= 50)) && r.high52 > 0 && r.close >= r.high52 * 0.95 && (r.revGrowth == null || r.revGrowth > 0)).map(r => row(r, { moneyChange: r.moneyChange ?? null }));
  const sort = (a, b) => (b.change ?? -99) - (a.change ?? -99) || a.id.localeCompare(b.id);
  return { value: valueZone.sort(sort), heat: heatZone.sort(sort) };
}
// 一檔股票的入選紀錄：files＝[{ date, zones: { value: [...], heat: [...] } }]
export function historyOf(id, files = []) {
  const out = [];
  for (const f of files) for (const z of ['value', 'heat']) { const x = (f.zones?.[z] || []).find(r => r.id === id); if (x) out.push({ date: f.date, zone: z, close: x.close, change: x.change }); }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.zone.localeCompare(b.zone));
}
