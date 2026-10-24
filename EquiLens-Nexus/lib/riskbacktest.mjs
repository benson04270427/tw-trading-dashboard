// 風控配方回測：用同一份長期歷史資料，比較不同的指標權重（配方）換算成建議持股後的績效與訊號命中率。
// 評分方式與風控水位相同（各指標與過去 250 個交易日比較的百分位，趨勢用乖離規則），只換權重。
// 純計算；資料由 server.mjs 準備（台股 FinMind、美股 FRED／Cboe／Nasdaq，與風控水位同一組來源、期間拉長）。
import { scoreAt, exposure, at, LEVELS } from './riskgauge.mjs';

export const RISK_BT_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// 配方：權重沒列到的指標為 0。source 說明配方的出處或想法。
export const RECIPES = {
  TW: [
    { key: 'current', name: '目前權重', source: '衡析現行設定', weights: { retail: 20, margin: 15, foreignFut: 20, foreignSpot: 15, fx: 10, trend: 20 } },
    { key: 'equal', name: '等權重', source: 'CNN 恐懼與貪婪指數的做法：每個指標一樣重', weights: { retail: 1, margin: 1, foreignFut: 1, foreignSpot: 1, fx: 1, trend: 1 } },
    { key: 'trendLed', name: '趨勢為主', source: '均線擇時（Faber）：趨勢 50%，其餘平分', weights: { retail: 10, margin: 10, foreignFut: 10, foreignSpot: 10, fx: 10, trend: 50 } },
    { key: 'trendOnly', name: '只看趨勢', source: '單純均線擇時，作為對照', weights: { trend: 1 } },
    { key: 'foreign', name: '外資主導', source: '外資風險胃納對台股月報酬較有解釋力（政大碩論 2011）', weights: { foreignFut: 35, foreignSpot: 35, trend: 30 } },
    { key: 'retail', name: '散戶反指標', source: '小台散戶多空比、融資增減當反指標', weights: { retail: 40, margin: 30, trend: 30 } },
    { key: 'noTrend', name: '只看籌碼', source: '拿掉趨勢，只用籌碼與匯率', weights: { retail: 20, margin: 15, foreignFut: 20, foreignSpot: 15, fx: 10 } },
    { key: 'smooth', name: '目前權重＋平滑', source: '目前權重，分數取近 5 日平均，減少持股建議來回跳動', weights: { retail: 20, margin: 15, foreignFut: 20, foreignSpot: 15, fx: 10, trend: 20 }, smooth: 5 },
  ],
  US: [
    { key: 'current', name: '目前權重', source: '衡析現行設定', weights: { vix: 20, term: 10, credit: 20, rates: 10, dollar: 10, breadth: 10, trend: 20 } },
    { key: 'equal', name: '等權重', source: 'CNN 恐懼與貪婪指數的做法：每個指標一樣重', weights: { vix: 1, term: 1, credit: 1, rates: 1, dollar: 1, breadth: 1, trend: 1 } },
    { key: 'cnn', name: 'CNN 式', source: 'CNN 七指標中可取得的五項：動能、廣度、VIX、垃圾債利差、期限結構，等權', weights: { trend: 1, breadth: 1, vix: 1, credit: 1, term: 1 } },
    { key: 'trendLed', name: '趨勢為主', source: '均線擇時（Faber）：趨勢 50%，其餘平分', weights: { vix: 50 / 6, term: 50 / 6, credit: 50 / 6, rates: 50 / 6, dollar: 50 / 6, breadth: 50 / 6, trend: 50 } },
    { key: 'trendOnly', name: '只看趨勢', source: '單純均線擇時，作為對照', weights: { trend: 1 } },
    { key: 'macro', name: '信用與波動', source: '信用利差與 VIX 為主的風險偏好指標（常見的 risk-on／risk-off 做法）', weights: { credit: 35, vix: 25, term: 20, trend: 20 } },
    { key: 'noTrend', name: '不含趨勢', source: '拿掉趨勢，只用情緒與總經指標', weights: { vix: 20, term: 10, credit: 20, rates: 10, dollar: 10, breadth: 10 } },
    { key: 'smooth', name: '目前權重＋平滑', source: '目前權重，分數取近 5 日平均，減少持股建議來回跳動', weights: { vix: 20, term: 10, credit: 20, rates: 10, dollar: 10, breadth: 10, trend: 20 }, smooth: 5 },
    { key: 'contra', name: '情緒反向＋趨勢', source: '恐慌時加碼（CNN 指數回測：中度恐懼後 21 日勝率約 7 成）：情緒指標反向使用，趨勢照常', weights: { vix: 20, term: 10, credit: 20, rates: 10, dollar: 10, breadth: 10, trend: 20 }, invert: ['vix', 'term', 'credit', 'rates', 'dollar', 'breadth'] },
  ],
};

// 每天各指標的風險分數（與權重無關，只算一次）：[{ date, f: { key: risk } }]
export function factorRisks(s, dates, defs, { warmup = 250 } = {}) {
  const out = [];
  for (const d of dates.slice(warmup)) { const x = scoreAt(s, d, undefined, defs); out.push({ date: d, f: Object.fromEntries(x.factors.map(f => [f.key, f.risk])) }); }
  return out;
}
const combine = (f, w) => { let a = 0, b = 0; for (const [k, v] of Object.entries(w)) if (v > 0 && f[k] != null) { a += f[k] * v; b += v; } return b ? a / b : null; };

// 績效：每天收盤依當天分數決定持股，賺下一個交易日的指數報酬（沒持股的部分報酬 0）
function perf(daily) {
  let eq = 1, peak = 1, mdd = 0; const rets = [];
  for (const r of daily) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); rets.push(r); }
  const n = rets.length, years = n / 252, m = avg(rets), sd = Math.sqrt(avg(rets.map(r => (r - m) ** 2)) || 0);
  return { cagr: r2((eq ** (1 / years) - 1) * 100), mdd: r2(mdd * 100), vol: r2(sd * Math.sqrt(252) * 100), sharpe: sd ? r2(m / sd * Math.sqrt(252)) : null, total: r2((eq - 1) * 100) };
}
// 排名相關（Spearman）
function rankCorr(a, b) {
  const rank = v => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Array(v.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const ra = rank(a), rb = rank(b), ma = avg(ra), mb = avg(rb); let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

// 主函式：s／index／dates 來自 twSeries 或 usSeries；horizon＝訊號檢驗的天數（交易日）
export function backtestRecipes({ market, s, index, dates, defs, recipes = RECIPES[market], horizon = 20, warmup = 250 }) {
  const fr = factorRisks(s, dates, defs, { warmup });
  const px = d => { const i = at(index, d); return i < 0 ? null : index[i]; };
  // 對齊：評分日 → 指數位置
  const rows = fr.map(x => ({ ...x, i: at(index, x.date) })).filter(x => x.i >= 0);
  if (rows.length < 300) return { version: RISK_BT_VERSION, market, available: false, reason: '歷史資料不足（至少需要約 2 年）' };
  const close = index.map(x => x[1]), last = rows.at(-1).i;
  const next = i => i + 1 <= last ? close[i + 1] / close[i] - 1 : null;
  const fwd = i => i + horizon <= index.length - 1 ? close[i + horizon] / close[i] - 1 : null;
  const fwdDD = i => { if (i + horizon > index.length - 1) return null; let m = 0; for (let k = i + 1; k <= i + horizon; k++) m = Math.min(m, close[k] / close[i] - 1); return m; };
  const usable = rows.filter(x => next(x.i) != null);
  const bh = perf(usable.map(x => next(x.i)));
  const baseDown = avg(rows.filter(x => fwd(x.i) != null).map(x => fwd(x.i) < 0 ? 1 : 0));
  const results = recipes.map(rc => {
    const inv = new Set(rc.invert || []);
    let sc = rows.map(x => ({ ...x, score: combine(inv.size ? Object.fromEntries(Object.entries(x.f).map(([k, v]) => [k, v != null && inv.has(k) ? 100 - v : v])) : x.f, rc.weights) })).filter(x => x.score != null);
    if (rc.smooth > 1) sc = sc.map((x, k) => ({ ...x, score: avg(sc.slice(Math.max(0, k - rc.smooth + 1), k + 1).map(y => y.score)) }));
    const daily = sc.filter(x => next(x.i) != null).map(x => exposure(x.score) / 100 * next(x.i));
    const exAvg = avg(sc.map(x => exposure(x.score))), p = perf(daily);
    // 同樣平均持股、但固定不動的對照組：看「調整時機」有沒有加分
    const fixed = perf(usable.map(x => exAvg / 100 * next(x.i)));
    const withF = sc.filter(x => fwd(x.i) != null), hi = withF.filter(x => x.score >= 60), lo = withF.filter(x => x.score < 40);
    const buckets = LEVELS.map(([max, label], k) => { const min = k ? LEVELS[k - 1][0] : 0, b = withF.filter(x => x.score >= min && x.score < max); return { label, n: b.length, share: r1(b.length / withF.length * 100), avgRet: b.length ? r2(avg(b.map(x => fwd(x.i))) * 100) : null, upRate: b.length ? r1(avg(b.map(x => fwd(x.i) > 0 ? 1 : 0)) * 100) : null, avgDD: b.length ? r2(avg(b.map(x => fwdDD(x.i)).filter(v => v != null)) * 100) : null }; });
    return { key: rc.key, name: rc.name, source: rc.source, weights: rc.weights, smooth: rc.smooth || null, invert: rc.invert || null, ...p, avgExposure: r1(exAvg), fixed: { cagr: fixed.cagr, mdd: fixed.mdd, sharpe: fixed.sharpe }, timing: r2(p.sharpe - fixed.sharpe),
      // 命中率：高風險（≥60）之後 horizon 天下跌的比例；低風險（<40）之後上漲的比例
      hiHit: hi.length ? r1(avg(hi.map(x => fwd(x.i) < 0 ? 1 : 0)) * 100) : null, hiN: hi.length, loHit: lo.length ? r1(avg(lo.map(x => fwd(x.i) > 0 ? 1 : 0)) * 100) : null, loN: lo.length,
      ic: r2(rankCorr(withF.map(x => x.score), withF.map(x => fwd(x.i)))), changes: sc.reduce((a, x, k) => a + (k && exposure(x.score) !== exposure(sc[k - 1].score) ? 1 : 0), 0), buckets };
  });
  // 綜合排名：夏普值、調整時機的加分、命中率、相關係數（越負越好）各自排名後平均
  const rk = (key, dir) => { const v = results.map(r => r[key] ?? (dir > 0 ? -Infinity : Infinity)), sorted = [...v].sort((a, b) => dir > 0 ? b - a : a - b); return v.map(x => sorted.indexOf(x) + 1); };
  const ranks = [rk('sharpe', 1), rk('timing', 1), rk('hiHit', 1), rk('loHit', 1), rk('ic', -1), rk('mdd', 1)];
  results.forEach((r, i) => { r.rank = r1(avg(ranks.map(x => x[i]))); });
  const order = [...results].sort((a, b) => a.rank - b.rank).map(r => r.key);
  const first = rows[0].date, end = rows.at(-1).date;
  return { version: RISK_BT_VERSION, market, available: true, from: first, to: end, days: rows.length, years: r1((Date.parse(end) - Date.parse(first)) / 864e5 / 365.25), horizon,
    buyHold: bh, baseDown: r1(baseDown * 100), baseUp: r1((1 - baseDown) * 100), results, best: order[0], order,
    coverage: Object.fromEntries(defs.map(f => { const l = s[f.key] || []; return [f.key, l.length ? l[0][0] : null]; })) };
}
