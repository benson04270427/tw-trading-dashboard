// 盤後籌碼整理圖卡的數據彙整：指數、三大法人、市場寬度、台指期與選擇權、散戶籌碼、融資融券、期貨市場、類股強弱。
// 每日約 11 次 FinMind 請求（快照 1、融資融券 1、期貨行情 7、小台／微台法人 2），結果存於 .local/card-日期.json。
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
export const FUTURES = [['TX', '台指期'], ['TE', '電子期'], ['TF', '金融期'], ['XIF', '非金電'], ['GTF', '櫃買期']];

// 近月合約（排除價差組合），一般交易時段
export function nearMonth(rows, date) {
  const list = rows.filter(r => r.date === date && r.trading_session === 'position' && !String(r.contract_date).includes('/') && num(r.close) > 0);
  return list.sort((a, b) => String(a.contract_date).localeCompare(String(b.contract_date)))[0] || null;
}
export function totalOI(rows, date) { return rows.filter(r => r.date === date && r.trading_session === 'position' && !String(r.contract_date).includes('/')).reduce((a, r) => a + (num(r.open_interest) || 0), 0); }
// 法人淨未平倉（口）＝ Σ（多方未平倉 − 空方未平倉）
export function institutionNet(rows, date) {
  const list = rows.filter(r => r.date === date); if (!list.length) return null;
  return list.reduce((a, r) => a + (num(r.long_open_interest_balance_volume) || 0) - (num(r.short_open_interest_balance_volume) || 0), 0);
}
// 散戶淨部位 ＝ −法人淨部位；散戶多空比 ＝ 散戶淨部位 ÷ 全市場未平倉
export function retailPosition(instRows, dailyRows, date) {
  const dates = [...new Set(instRows.map(r => r.date))].filter(d => d <= date).sort(), prev = dates.filter(d => d < date).at(-1);
  const inst = institutionNet(instRows, date); if (inst == null) return null;
  const net = -inst, oi = totalOI(dailyRows, date), before = prev ? institutionNet(instRows, prev) : null;
  return { net, change: before == null ? null : net - -before, oi: oi || null, ratio: oi ? r2(net / oi * 100) : null };
}
export function marginSummary(rows, date) {
  const dates = [...new Set(rows.map(r => r.date))].filter(d => d <= date).sort(), d = dates.at(-1); if (!d) return null;
  const pick = name => rows.find(r => r.date === d && r.name === name);
  const money = pick('MarginPurchaseMoney'), short = pick('ShortSale');
  return { date: d, marginMoney: money ? r2(num(money.TodayBalance) / 1e8) : null, marginChange: money ? r2((num(money.TodayBalance) - num(money.YesBalance)) / 1e8) : null,
    shortLots: short ? num(short.TodayBalance) : null, shortChange: short ? num(short.TodayBalance) - num(short.YesBalance) : null };
}
export function indexRow(r) { if (!r) return null; const close = num(r.close), chg = num(r.change_price); return { close, change: chg, pct: close && chg != null ? r2(chg / (close - chg) * 100) : null, amount: num(r.total_amount), time: String(r.date).slice(11, 16) }; }
export function putCallRatio(options) {
  let call = 0, put = 0; for (const c of options?.contracts || []) for (const s of c.strikes || []) { call += num(s.call) || 0; put += num(s.put) || 0; }
  return call ? r2(put / call * 100) : null;
}
export function sectorRanks(heat, n = 5) {
  const list = (heat?.sectors || []).filter(s => s.change != null && s.share >= 0.3).map(s => ({ name: s.name, change: s.change, share: s.share, up: s.up, down: s.down, money: s.money }));
  return { strong: [...list].sort((a, b) => b.change - a.change).slice(0, n), weak: [...list].sort((a, b) => a.change - b.change).slice(0, n) };
}

export function assembleCard({ date, index, heat, flows, margin, futures, retail, report }) {
  const fopt = p => flows?.options?.positions?.find(x => x.investor === '外資' && x.side === p);
  return {
    date, builtAt: new Date().toISOString(),
    index: index || null,
    market: heat ? { money: heat.total.money, moneyChange: heat.total.moneyChange, up: heat.total.up, down: heat.total.down, flat: heat.total.flat, limitUp: heat.total.limitUp, limitDown: heat.total.limitDown, change: heat.total.change, live: !!heat.live } : null,
    institutions: flows?.summary?.available ? { foreign: r2(flows.summary.foreign / 1e8), trust: r2(flows.summary.trust / 1e8), dealer: r2(flows.summary.dealer / 1e8), total: r2(flows.summary.total / 1e8) } : null,
    futuresFlow: flows?.futures?.available ? { net: flows.futures.net, netChange: flows.futures.netChange, callNet: fopt('買權')?.net ?? null, putNet: fopt('賣權')?.net ?? null } : null,
    retail: retail || null, pcr: putCallRatio(flows?.options), margin: margin || null,
    futures: futures || [], sectors: sectorRanks(heat),
    points: report ? { headline: report.headline, highlights: report.card?.highlights?.length ? report.card.highlights : (report.sections || []).flatMap(s => s.points.slice(0, 2)).slice(0, 8), watch: report.card?.watch?.length ? report.card.watch : (report.tomorrow || []).slice(0, 8) } : null,
  };
}
