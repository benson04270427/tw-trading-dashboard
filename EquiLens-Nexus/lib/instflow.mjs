// 法人資金板塊（台股）：以近 21 個交易日的全市場三大法人買賣超 × 當日收盤價，算出
// ① 板塊（研究族群或產業別）法人資金流與四象限（漲潮／輪動／觀望／退潮）、「錢流去哪」、跟平常比與買賣換邊；
// ② 個股異常爆買／爆賣（今天法人淨額 ÷ 近 20 日平均單日淨額絕對值）；
// ③ 法人近 20 日買進均價（成本）與現價乖離、外資／投信連續買賣超天數。
// 這個檔案只有純函式與每日資料的精簡格式；取資料與存檔在 server.mjs。
export const IF_VERSION = '1.0';
export const IF_RULES = {
  days: 21,            // 取近 21 個交易日：今天 + 前 20 日作為「平常」
  base: 20,            // 平常 = 前 20 個交易日
  minBaseDays: 10,     // 前面不足 10 日時不計算倍數
  abnormalRatio: 3,    // 個股異常：今天法人淨額 ≥ 平常單日淨額絕對值的 3 倍
  abnormalMin: 1e8,    // 且金額 ≥ 1 億元
  abnormalTop: 15,
  sectorSpikeRatio: 2.5, // 板塊跟平常比：今天淨額 ≥ 平常單日淨額絕對值的 2.5 倍
  sectorSpikeMin: 5e8,   // 且 ≥ 5 億元
  flipToday: 5e8,      // 買賣換邊：今天 ≥ 5 億元，前 4 日合計反方向 ≥ 10 億元
  flipPrior: 10e8,
  costDays: 20,        // 法人成本：近 20 個交易日（含今天）買進股數加權的收盤價
};
export const STATES = { surge: '漲潮', rotate: '輪動', wait: '觀望', ebb: '退潮' };

const WHO = { f: [0, 1], t: [2, 3], d: [4, 5] }; // 每檔每日陣列：[外資買, 外資賣, 投信買, 投信賣, 自營買, 自營賣, 收盤, 成交金額, 漲跌幅%]
const CLOSE = 6, MONEY = 7, CHG = 8;
const num = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
const yi = v => v == null ? null : r2(v / 1e8); // 元 → 億元

// FinMind 法人格式（證交所開放資料也轉成這個格式）＋全市場單日行情 → 精簡日檔 { version, date, s: { 代號: [...] } }
// 外資含 Foreign_Investor 與 Foreign_Dealer_Self；自營商為 Dealer_self＋Dealer_Hedging（或合併列 Dealer）
export function compactDay(date, instRows = [], priceRows = []) {
  const price = new Map();
  for (const r of priceRows) {
    if (r.date && String(r.date).slice(0, 10) !== date) continue;
    const close = num(r.close); if (!(close > 0)) continue;
    const spread = num(r.spread), prev = spread == null ? null : close - spread;
    price.set(String(r.stock_id), [close, num(r.Trading_money) ?? 0, prev > 0 ? r2((close / prev - 1) * 100) : null]);
  }
  const s = {};
  for (const r of instRows) {
    if (r.date && String(r.date).slice(0, 10) !== date) continue;
    const id = String(r.stock_id), p = price.get(id); if (!p) continue;
    const slot = { Foreign_Investor: 0, Foreign_Dealer_Self: 0, Investment_Trust: 2, Dealer_self: 4, Dealer_Hedging: 4, Dealer: 4 }[r.name];
    if (slot === undefined) continue;
    const a = s[id] || (s[id] = [0, 0, 0, 0, 0, 0, ...p]);
    a[slot] += num(r.buy) ?? 0; a[slot + 1] += num(r.sell) ?? 0;
  }
  return { version: IF_VERSION, date, s };
}
export const validDay = d => !!d && typeof d.date === 'string' && d.s && Object.keys(d.s).length > 0;

// 單檔單日：某身分（f／t／d／all）淨股數與以當日收盤估算的淨額（元）
export function netOf(a, who = 'all') {
  if (!a) return null;
  const keys = who === 'all' ? ['f', 't', 'd'] : [who];
  let shares = 0; for (const k of keys) { const [b, s] = WHO[k]; shares += a[b] - a[s]; }
  return { shares, value: shares * a[CLOSE] };
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// 連續買（正）或賣（負）超天數；流入加速 = 今天與昨天同方向且金額更大
export function streak(days, id, who) {
  let n = 0, dir = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = netOf(days[i].s[id], who)?.shares;
    if (v == null) break;
    const sg = Math.sign(v); if (!sg) break;
    if (!dir) dir = sg; if (sg !== dir) break; n++;
  }
  const t = netOf(days.at(-1)?.s[id], who)?.value, y = days.length > 1 ? netOf(days.at(-2).s[id], who)?.value : null;
  return { days: n * dir, accel: n >= 2 && t != null && y != null && Math.abs(t) > Math.abs(y) };
}

// 法人近 N 日買進均價：Σ(買進股數 × 當日收盤) ÷ Σ買進股數；乖離 = 現價 ÷ 均價 − 1
export function costOf(days, id, who, n = IF_RULES.costDays) {
  let shares = 0, value = 0;
  for (const d of days.slice(-n)) {
    const a = d.s[id]; if (!a) continue;
    const keys = who === 'all' ? ['f', 't', 'd'] : [who];
    for (const k of keys) { const b = a[WHO[k][0]]; shares += b; value += b * a[CLOSE]; }
  }
  const close = days.at(-1)?.s[id]?.[CLOSE] ?? null;
  if (!(shares > 0) || close == null) return { avg: null, deviation: null };
  const avg = value / shares;
  return { avg: r2(avg), deviation: r2((close / avg - 1) * 100) };
}

// 個股法人摘要（任何一檔）：今天淨額、平常倍數、成本與乖離、連續天數
export function stockFlow(days, id, meta = {}, rules = IF_RULES) {
  const last = days.at(-1), a = last?.s[id];
  if (!a) return null;
  const prev = days.slice(0, -1).slice(-rules.base).map(d => netOf(d.s[id], 'all')?.value).filter(v => v != null);
  const today = netOf(a, 'all').value, base = prev.length >= rules.minBaseDays ? mean(prev.map(Math.abs)) : null;
  return {
    id, name: meta.name || id, close: a[CLOSE], change: a[CHG],
    net: yi(today), foreign: yi(netOf(a, 'f').value), trust: yi(netOf(a, 't').value), dealer: yi(netOf(a, 'd').value),
    ratio: base > 0 ? r2(Math.abs(today) / base) : null,
    cost: { all: costOf(days, id, 'all', rules.costDays), foreign: costOf(days, id, 'f', rules.costDays), trust: costOf(days, id, 't', rules.costDays) },
    streak: { foreign: streak(days, id, 'f'), trust: streak(days, id, 't') },
  };
}

// days：日期由舊到新的精簡日檔（最後一天為分析日）；meta：Map(代號 → { name, sector })；
// sectorsOf(id) → 板塊名稱陣列（研究族群可一檔多族群；產業別一檔一個；空陣列表示不列入板塊）；focus：要算成本的代號（自選＋研究名單）
export function analyzeFlows(days, { meta = new Map(), sectorsOf = () => [], focus = [], rules = IF_RULES } = {}) {
  days = days.filter(validDay).sort((x, y) => x.date.localeCompare(y.date)).slice(-rules.days);
  const last = days.at(-1);
  if (!last) return null;
  const prevDays = days.slice(0, -1).slice(-rules.base), last5 = days.slice(-5), prior4 = days.slice(-5, -1);
  const info = id => meta.get(id) || {};

  // ① 板塊
  const sectors = new Map();
  const sec = name => sectors.get(name) || sectors.set(name, { name, members: new Set(), today: 0, flow5: 0, prior4: 0, daily: new Map() }).get(name);
  for (const d of days) for (const [id, a] of Object.entries(d.s)) {
    const names = sectorsOf(id); if (!names?.length) continue;
    const v = netOf(a, 'all').value;
    for (const n of names) {
      const s = sec(n); s.daily.set(d.date, (s.daily.get(d.date) || 0) + v);
      if (d === last) { s.members.add(id); s.today += v; }
      if (last5.includes(d)) s.flow5 += v;
      if (prior4.includes(d)) s.prior4 += v;
    }
  }
  const sectorList = [...sectors.values()].filter(s => s.members.size).map(s => {
    const prev = prevDays.map(d => s.daily.get(d.date) ?? 0), base = prev.length >= rules.minBaseDays ? mean(prev) : null, absBase = prev.length >= rules.minBaseDays ? mean(prev.map(Math.abs)) : null;
    const bias = base == null ? null : s.today - base;
    const state = bias == null ? null : s.flow5 > 0 ? (bias > 0 ? 'surge' : 'rotate') : (bias > 0 ? 'wait' : 'ebb');
    const top = [...s.members].map(id => ({ id, name: info(id).name || id, net: yi(netOf(last.s[id], 'all').value), change: last.s[id][CHG] })).sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
    return { name: s.name, count: s.members.size, today: yi(s.today), flow5: yi(s.flow5), prior4: yi(s.prior4), base: yi(base), bias: yi(bias), ratio: absBase > 0 ? r2(Math.abs(s.today) / absBase) : null, state, stocks: top.slice(0, 8) };
  }).sort((x, y) => Math.abs(y.flow5) - Math.abs(x.flow5));
  const counts = Object.fromEntries(Object.keys(STATES).map(k => [k, sectorList.filter(s => s.state === k).length]));
  const rank = (key, n = 3) => ({ buy: sectorList.filter(s => s[key] > 0).sort((x, y) => y[key] - x[key]).slice(0, n).map(s => ({ name: s.name, value: s[key] })), sell: sectorList.filter(s => s[key] < 0).sort((x, y) => x[key] - y[key]).slice(0, n).map(s => ({ name: s.name, value: s[key] })) });

  // 跟平常比、買賣換邊（金額門檻以元比較）
  const insights = [];
  for (const s of sectorList) {
    const today = s.today * 1e8, prior = s.prior4 * 1e8;
    if (s.ratio != null && s.ratio >= rules.sectorSpikeRatio && Math.abs(today) >= rules.sectorSpikeMin) insights.push({ type: 'spike', sector: s.name, today: s.today, ratio: s.ratio });
    if (prior4.length === 4 && Math.abs(today) >= rules.flipToday && Math.abs(prior) >= rules.flipPrior && Math.sign(today) !== Math.sign(prior)) insights.push({ type: 'flip', sector: s.name, today: s.today, prior4: s.prior4 });
  }
  insights.sort((x, y) => Math.abs(y.today) - Math.abs(x.today));

  // ② 個股異常（全市場普通股）
  const abnormal = { buy: [], sell: [] };
  for (const [id, a] of Object.entries(last.s)) {
    const v = netOf(a, 'all').value; if (Math.abs(v) < rules.abnormalMin) continue;
    const prev = prevDays.map(d => netOf(d.s[id], 'all')?.value).filter(x => x != null);
    if (prev.length < rules.minBaseDays) continue;
    const base = mean(prev.map(Math.abs)), ratio = base > 0 ? Math.abs(v) / base : Infinity;
    if (ratio < rules.abnormalRatio) continue;
    (v > 0 ? abnormal.buy : abnormal.sell).push({ id, name: info(id).name || id, net: yi(v), change: a[CHG], ratio: Number.isFinite(ratio) ? r2(ratio) : null });
  }
  abnormal.buy = abnormal.buy.sort((x, y) => y.net - x.net).slice(0, rules.abnormalTop);
  abnormal.sell = abnormal.sell.sort((x, y) => x.net - y.net).slice(0, rules.abnormalTop);

  // ③ 法人成本（自選＋研究名單＋異常個股）
  const costIds = [...new Set([...focus, ...abnormal.buy.map(x => x.id), ...abnormal.sell.map(x => x.id)])].filter(id => last.s[id]);
  const costs = costIds.map(id => ({ ...stockFlow(days, id, info(id), rules), focus: focus.includes(id) }));

  return {
    version: IF_VERSION, date: last.date, from: days[0].date, days: days.length, baseDays: prevDays.length,
    sectors: sectorList, counts, money: { today: rank('today'), five: rank('flow5') }, insights: insights.slice(0, 12),
    abnormal, costs, coverage: { stocks: Object.keys(last.s).length, sectored: Object.keys(last.s).filter(id => sectorsOf(id)?.length).length },
    rules: { ...rules },
  };
}
