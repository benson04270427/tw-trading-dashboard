// 型態分區：用最近約 90 個交易日的日 K，把每一檔分到所有符合的技術型態（一檔可同時屬於多個型態）。
// 型態分成支撐壓力、趨勢線、常見型態、反轉型態、整理與延續、價格路徑、諧波比例七組，每個型態標示偏多、偏空或中性，以及反轉、延續、整理等性質。
// 轉折點用 zigzag：價格自前一個轉折反向超過門檻（依近 14 日 ATR 調整，4%～12%）才算新的高點或低點；只用收盤當天以前的資料。
// 純計算；型態是常見的技術分析分類，不是買賣建議。
export const SHAPES_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// 型態清單：id、名稱、組別、偏向（bull 偏多／bear 偏空／neutral 中性）、性質、小圖示（0～40 × 0～12 的折線）
export const SHAPE_GROUPS = [['level', '支撐壓力'], ['trend', '趨勢線'], ['common', '常見型態'], ['reversal', '反轉型態'], ['continuation', '整理與延續'], ['path', '價格路徑'], ['harmonic', '諧波比例']];
export const SHAPES = [
  ['resistance', '水平壓力', 'level', 'neutral', '壓力', '0,3 40,3 M0,10 8,6 14,4 20,8 28,4 34,9 40,7'],
  ['support', '水平支撐', 'level', 'neutral', '支撐', '0,9 40,9 M0,2 8,6 14,8 20,4 28,8 34,3 40,5'],
  ['trendUp', '上升趨勢線', 'trend', 'bull', '延續', '0,11 40,2'],
  ['trendDown', '下降趨勢線', 'trend', 'bear', '延續', '0,2 40,11'],
  ['doubleBottom', 'W 底・雙底', 'common', 'bull', '反轉', '0,1 10,11 20,4 30,11 40,1'],
  ['doubleTop', 'M 頂・雙頂', 'common', 'bear', '反轉', '0,11 10,1 20,8 30,1 40,11'],
  ['symTriangle', '對稱三角收斂', 'common', 'neutral', '整理', '0,1 8,11 16,3 24,9 32,5 40,7'],
  ['ascTriangle', '上升三角・水平壓力', 'common', 'bull', '延續', '0,11 8,2 16,8 24,2 32,5 40,2'],
  ['descTriangle', '下降三角・水平支撐', 'common', 'bear', '延續', '0,1 8,10 16,4 24,10 32,7 40,10'],
  ['box', '箱型・水平整理', 'common', 'neutral', '整理', '0,10 8,2 16,10 24,2 32,10 40,2'],
  ['ihs', '頭肩底', 'reversal', 'bull', '反轉', '0,2 7,7 13,4 20,11 27,4 33,7 40,1'],
  ['hs', '頭肩頂', 'reversal', 'bear', '反轉', '0,10 7,5 13,8 20,1 27,8 33,5 40,11'],
  ['tripleBottom', '三重底', 'reversal', 'bull', '反轉', '0,1 7,11 14,3 20,11 27,3 33,11 40,1'],
  ['tripleTop', '三重頂', 'reversal', 'bear', '反轉', '0,11 7,1 14,9 20,1 27,9 33,1 40,11'],
  ['fallingWedge', '下降楔形', 'continuation', 'bull', '反轉', '0,1 8,9 16,4 24,10 32,7 40,10'],
  ['risingWedge', '上升楔形', 'continuation', 'bear', '反轉', '0,11 8,4 16,7 24,2 32,4 40,2'],
  ['broadening', '擴散三角・喇叭口', 'continuation', 'neutral', '整理', '0,6 8,4 16,8 24,2 32,11 40,0'],
  ['channelUp', '上升通道', 'continuation', 'bull', '延續', '0,11 8,6 16,8 24,3 32,5 40,0'],
  ['channelDown', '下降通道', 'continuation', 'bear', '延續', '0,1 8,6 16,4 24,9 32,7 40,12'],
  ['bullFlag', '多頭旗形', 'continuation', 'bull', '延續', '0,11 8,1 16,4 24,2 32,5 40,3'],
  ['bearFlag', '空頭旗形', 'continuation', 'bear', '延續', '0,1 8,11 16,8 24,10 32,7 40,9'],
  ['vUp', 'V 型反轉向上', 'path', 'bull', '反轉', '0,1 20,11 40,1'],
  ['vDown', '倒 V 反轉向下', 'path', 'bear', '反轉', '0,11 20,1 40,11'],
  ['roundBottom', '圓弧底', 'path', 'bull', '反轉', '0,1 6,6 12,9 20,10 28,9 34,6 40,1'],
  ['roundTop', '圓弧頂', 'path', 'bear', '反轉', '0,11 6,6 12,3 20,2 28,3 34,6 40,11'],
  ['cupHandle', '杯柄・向上路徑', 'path', 'bull', '延續', '0,2 6,8 14,11 22,8 28,2 33,5 40,0'],
  ['invCupHandle', '倒杯柄・向下路徑', 'path', 'bear', '延續', '0,10 6,4 14,1 22,4 28,10 33,7 40,12'],
  ['retest', '突破後回踩', 'path', 'bull', '延續', '0,10 8,7 14,9 20,3 26,6 32,5 40,1'],
  ['pullback', '跌破後反抽', 'path', 'bear', '延續', '0,2 8,5 14,3 20,9 26,6 32,7 40,11'],
  ['stairsUp', '高低點階梯上升', 'path', 'bull', '延續', '0,11 6,7 10,9 18,4 22,6 30,1 34,3 40,0'],
  ['stairsDown', '高低點階梯下降', 'path', 'bear', '延續', '0,1 6,5 10,3 18,8 22,6 30,11 34,9 40,12'],
  ['gartleyBull', '加特利 Gartley・多', 'harmonic', 'bull', '反轉', '0,11 10,1 18,7 28,3 40,9'],
  ['gartleyBear', '加特利 Gartley・空', 'harmonic', 'bear', '反轉', '0,1 10,11 18,5 28,9 40,3'],
  ['batBull', '蝙蝠 Bat・多', 'harmonic', 'bull', '反轉', '0,11 10,1 18,6 28,3 40,10'],
  ['batBear', '蝙蝠 Bat・空', 'harmonic', 'bear', '反轉', '0,1 10,11 18,6 28,9 40,2'],
  ['butterflyBull', '蝴蝶 Butterfly・多', 'harmonic', 'bull', '反轉', '0,9 10,1 18,7 28,3 40,12'],
  ['butterflyBear', '蝴蝶 Butterfly・空', 'harmonic', 'bear', '反轉', '0,3 10,11 18,5 28,9 40,0'],
  ['crabBull', '螃蟹 Crab・多', 'harmonic', 'bull', '反轉', '0,8 10,1 18,6 28,2 40,12'],
  ['crabBear', '螃蟹 Crab・空', 'harmonic', 'bear', '反轉', '0,4 10,11 18,6 28,10 40,0'],
].map(([id, name, group, bias, kind, icon]) => ({ id, name, group, bias, kind, icon }));
export const BIAS = { bull: '偏多', bear: '偏空', neutral: '中性' };

// ---- 基本工具 ----
export function atrPct(p, n = 14) {
  const k = p.slice(-n - 1); if (k.length < 2) return null; const tr = [];
  for (let i = 1; i < k.length; i++) tr.push(Math.max(k[i].max - k[i].min, Math.abs(k[i].max - k[i - 1].close), Math.abs(k[i].min - k[i - 1].close)));
  return mean(tr) / k.at(-1).close * 100;
}
// zigzag：回傳交替的轉折 [{ i, v, t: 'H'|'L' }]；最後一段尚未確認的極值也列入（confirmed: false）
export function zigzag(p, th) {
  const out = []; if (p.length < 3) return out;
  let dir = 0, hiI = 0, loI = 0, hi = p[0].max, lo = p[0].min;
  for (let i = 1; i < p.length; i++) {
    const b = p[i];
    if (dir >= 0) { if (b.max > hi) { hi = b.max; hiI = i; } if (dir === 0 && b.min < lo) { lo = b.min; loI = i; } }
    if (dir <= 0) { if (b.min < lo) { lo = b.min; loI = i; } if (dir === 0 && b.max > hi) { hi = b.max; hiI = i; } }
    if (dir === 0) {
      if (hi / lo - 1 >= th) { if (hiI > loI) { out.push({ i: loI, v: lo, t: 'L' }); dir = 1; lo = Infinity; } else { out.push({ i: hiI, v: hi, t: 'H' }); dir = -1; hi = -Infinity; } }
      continue;
    }
    if (dir === 1 && b.min <= hi * (1 - th)) { out.push({ i: hiI, v: hi, t: 'H' }); dir = -1; lo = b.min; loI = i; }
    else if (dir === -1 && b.max >= lo * (1 + th)) { out.push({ i: loI, v: lo, t: 'L' }); dir = 1; hi = b.max; hiI = i; }
  }
  if (dir === 1) out.push({ i: hiI, v: hi, t: 'H', open: true }); else if (dir === -1) out.push({ i: loI, v: lo, t: 'L', open: true });
  return out;
}
export function fitLine(pts) {
  const x = mean(pts.map(q => q.i)), y = mean(pts.map(q => q.v)), den = pts.reduce((s, q) => s + (q.i - x) ** 2, 0), slope = den ? pts.reduce((s, q) => s + (q.i - x) * (q.v - y), 0) / den : 0;
  const at = i => y + slope * (i - x), err = Math.sqrt(mean(pts.map(q => ((q.v - at(q.i)) / q.v) ** 2)) || 0);
  return { slope, at, err };
}
const near = (a, b, tol) => Math.abs(a - b) / Math.min(a, b) <= tol;
const between = (v, a, b) => v >= a && v <= b;
// 二次曲線擬合（圓弧）：回傳 a、頂點位置（0～1）與 R²
function quad(vals) {
  const n = vals.length, xs = vals.map((_, i) => i / (n - 1)); let S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  for (let i = 0; i < n; i++) { const x = xs[i], y = vals[i]; for (let k = 0; k < 5; k++) S[k] += x ** k; for (let k = 0; k < 3; k++) T[k] += y * x ** k; }
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (!D) return null; const col = k => M.map((r, j) => r.map((v, c) => c === k ? T[j] : v)), c0 = det(col(0)) / D, c1 = det(col(1)) / D, c2 = det(col(2)) / D;
  const my = mean(vals), ssT = vals.reduce((s, y) => s + (y - my) ** 2, 0), ssR = vals.reduce((s, y, i) => s + (y - (c0 + c1 * xs[i] + c2 * xs[i] ** 2)) ** 2, 0);
  return { a: c2, vertex: c2 ? -c1 / (2 * c2) : null, r2: ssT ? 1 - ssR / ssT : 0 };
}

// ---- 各型態判斷：回傳 null 或 { score 0～100, note, level? } ----
function detectors(ctx) {
  const { p, z, c, n, th } = ctx, H = z.filter(q => q.t === 'H'), L = z.filter(q => q.t === 'L'), recent = k => n - 1 - k;
  const hi = (a, b) => Math.max(...p.slice(a, b + 1).map(x => x.max)), lo = (a, b) => Math.min(...p.slice(a, b + 1).map(x => x.min));
  const out = {};
  // 水平支撐／壓力：至少兩個轉折在 2% 內，且目前價距離 10% 以內
  const cluster = (list, side) => { let best = null; for (const a of list) { const g = list.filter(b => near(a.v, b.v, 0.02)); if (g.length < 2) continue; const lv = mean(g.map(x => x.v)), d = side === 'H' ? (lv - c) / c : (c - lv) / c; if (d < 0 || d > 0.1) continue; if (!best || g.length > best.n || (g.length === best.n && d < best.d)) best = { n: g.length, lv, d }; } return best; };
  const rs = cluster(H.filter(q => !q.open), 'H'); if (rs) out.resistance = { score: clamp(40 + rs.n * 15 - rs.d * 200, 30, 95), note: `壓力 ${r2(rs.lv)}（${rs.n} 次）`, level: r2(rs.lv) };
  const sp = cluster(L.filter(q => !q.open), 'L'); if (sp) out.support = { score: clamp(40 + sp.n * 15 - sp.d * 200, 30, 95), note: `支撐 ${r2(sp.lv)}（${sp.n} 次）`, level: r2(sp.lv) };
  // 趨勢線：最近 2～3 個低點（高點）依序墊高（降低），跨 15 根以上，期間收盤沒有明顯跌破（突破）
  const trendLine = (list, up) => {
    for (const k of [3, 2]) {
      const q = list.filter(x => !x.open).slice(-k); if (q.length < k) continue;
      if (!q.every((x, j) => !j || (up ? x.v > q[j - 1].v : x.v < q[j - 1].v)) || q.at(-1).i - q[0].i < 15) continue;
      const f = fitLine(q), now = f.at(n - 1), d = up ? (c - now) / now : (now - c) / now;
      if (d < -0.01 || d > 0.12 || Math.abs(f.slope) / now * 100 < 0.05) continue;
      const broken = p.slice(q[0].i).some((b, j) => up ? b.close < f.at(q[0].i + j) * 0.97 : b.close > f.at(q[0].i + j) * 1.03); if (broken) continue;
      return { score: clamp(55 + k * 8 - f.err * 300 - d * 150, 30, 95), note: `${up ? '趨勢線支撐' : '趨勢線壓力'} ${r2(now)}`, level: r2(now) };
    }
    return null;
  };
  out.trendUp = trendLine(L, true); out.trendDown = trendLine(H, false);
  const last = (k) => z.slice(-k);
  // W 底／M 頂：L H L（H L H），兩個底（頂）差 4% 以內，中間反彈（回檔）6% 以上，第二個底（頂）在最近 30 根內
  const dbl = bull => {
    for (const off of [0, 1]) {
      const s = z.slice(-3 - off, z.length - off); if (s.length < 3) continue; const [a, m, b] = s;
      if (bull ? !(a.t === 'L' && m.t === 'H' && b.t === 'L') : !(a.t === 'H' && m.t === 'L' && b.t === 'H')) continue;
      if (!near(a.v, b.v, 0.04) || b.i < recent(30) || b.i - a.i < 10) continue;
      const pre = z[z.indexOf(a) - 1]; if (!pre || (bull ? pre.v < m.v * 1.02 : pre.v > m.v * 0.98)) continue; // 反轉要有前段趨勢：底之前從頸線以上跌下來（頂之前從頸線以下漲上去）
      const depth = bull ? m.v / Math.min(a.v, b.v) - 1 : 1 - m.v / Math.max(a.v, b.v); if (depth < 0.06) continue;
      if (bull ? c < b.v : c > b.v) continue;
      const brk = bull ? c > m.v : c < m.v;
      return { score: clamp(55 + depth * 150 + (brk ? 15 : 0) - Math.abs(a.v / b.v - 1) * 300, 30, 98), note: `${bull ? '頸線' : '頸線'} ${r2(m.v)}${brk ? (bull ? '，已突破' : '，已跌破') : ''}`, level: r2(m.v) };
    }
    return null;
  };
  out.doubleBottom = dbl(true); out.doubleTop = dbl(false);
  // 頭肩底／頭肩頂：L H L H L，頭比兩肩低（高）3% 以上，兩肩差 6% 以內，右肩在最近 30 根內
  const hs = bull => {
    for (const off of [0, 1]) {
      const s = z.slice(-5 - off, z.length - off); if (s.length < 5) continue; const [l1, h1, hd, h2, l3] = s;
      if (bull ? !(l1.t === 'L' && hd.t === 'L' && l3.t === 'L') : !(l1.t === 'H' && hd.t === 'H' && l3.t === 'H')) continue;
      if (l3.i < recent(30)) continue;
      const deeper = bull ? hd.v < Math.min(l1.v, l3.v) * 0.97 : hd.v > Math.max(l1.v, l3.v) * 1.03; if (!deeper || !near(l1.v, l3.v, 0.06) || !near(h1.v, h2.v, 0.08)) continue;
      const pre = z[z.indexOf(l1) - 1]; if (!pre || (bull ? pre.v < Math.max(h1.v, h2.v) : pre.v > Math.min(h1.v, h2.v))) continue;
      const neck = fitLine([h1, h2]).at(n - 1); if (bull ? c < l3.v : c > l3.v) continue;
      const brk = bull ? c > neck : c < neck;
      return { score: clamp(60 + (brk ? 15 : 0) - Math.abs(l1.v / l3.v - 1) * 200, 30, 98), note: `頸線 ${r2(neck)}${brk ? (bull ? '，已突破' : '，已跌破') : ''}`, level: r2(neck) };
    }
    return null;
  };
  out.ihs = hs(true); out.hs = hs(false);
  // 三重底／三重頂：三個低點（高點）在 4% 內
  const triple = bull => {
    for (const off of [0, 1]) {
      const s = z.slice(-5 - off, z.length - off); if (s.length < 5) continue; const [a, x, b, y, d] = s;
      if (bull ? !(a.t === 'L' && b.t === 'L' && d.t === 'L') : !(a.t === 'H' && b.t === 'H' && d.t === 'H')) continue;
      const lv = [a.v, b.v, d.v]; if (Math.max(...lv) / Math.min(...lv) - 1 > 0.04 || d.i < recent(30) || !near(x.v, y.v, 0.08)) continue;
      const pre = z[z.indexOf(a) - 1]; if (!pre || (bull ? pre.v < Math.max(x.v, y.v) : pre.v > Math.min(x.v, y.v))) continue;
      if (bull ? c < d.v : c > d.v) continue; const neck = bull ? Math.max(x.v, y.v) : Math.min(x.v, y.v);
      return { score: clamp(65 - (Math.max(...lv) / Math.min(...lv) - 1) * 300, 35, 95), note: `頸線 ${r2(neck)}`, level: r2(neck) };
    }
    return null;
  };
  out.tripleBottom = triple(true); out.tripleTop = triple(false);
  // 三角、楔形、通道、箱型：最近 60 根內至少 5 個轉折（高低點各 2 個以上）、跨 20 根以上，比較上緣與下緣斜率（每根 % 數）
  const win = z.filter(q => q.i >= recent(60)), hs2 = win.filter(q => q.t === 'H').slice(-3), ls2 = win.filter(q => q.t === 'L').slice(-3);
  if (hs2.length >= 2 && ls2.length >= 2 && hs2.length + ls2.length >= 5 && n - 1 - Math.min(hs2[0].i, ls2[0].i) >= 20) {
    const fh = fitLine(hs2), fl = fitLine(ls2), start = Math.min(hs2[0].i, ls2[0].i), ref = mean([...hs2, ...ls2].map(q => q.v));
    const sh = fh.slope / ref * 100, sl = fl.slope / ref * 100, flat = 0.06, w0 = fh.at(start) - fl.at(start), w1 = fh.at(n - 1) - fl.at(n - 1);
    const top = fh.at(n - 1), bot = fl.at(n - 1), inside = c <= top * 1.03 && c >= bot * 0.97, fitErr = (fh.err + fl.err) * 100;
    const base = clamp(70 - fitErr * 4 + Math.min(hs2.length + ls2.length - 4, 2) * 5, 30, 95), note = `上緣 ${r2(top)}／下緣 ${r2(bot)}`;
    const put = (id, extra = 0) => { if (inside && w1 > 0) out[id] = { score: clamp(base + extra, 30, 95), note, level: r2(top), low: r2(bot) }; };
    const conv = w1 < w0 * 0.75, par = w1 > w0 * 0.75 && w1 < w0 * 1.33, exp = w1 > w0 * 1.33;
    if (sh < -flat && sl > flat && conv) put('symTriangle');
    else if (Math.abs(sh) <= flat && sl > flat && conv) put('ascTriangle');
    else if (Math.abs(sl) <= flat && sh < -flat && conv) put('descTriangle');
    else if (Math.abs(sh) <= flat && Math.abs(sl) <= flat && between(top / bot - 1, 0.05, 0.3)) put('box');
    else if (sh > flat && sl < -flat && exp) put('broadening');
    else if (sh < -flat && sl < -flat && conv && sh < sl) put('fallingWedge');
    else if (sh > flat && sl > flat && conv && sl > sh) put('risingWedge');
    else if (sh > flat && sl > flat && par) put('channelUp');
    else if (sh < -flat && sl < -flat && par) put('channelDown');
  }
  // 旗形：最近 40 根內 15 根以內漲（跌）15% 以上的旗竿，之後 4～20 根整理，回檔（反彈）不超過旗竿一半
  const flag = bull => {
    const from = Math.max(0, n - 40);
    for (let e = n - 5; e >= Math.max(from + 5, n - 22); e--) {
      const peak = bull ? p[e].max : p[e].min, s0 = Math.max(from, e - 15), base = bull ? lo(s0, e) : hi(s0, e), pole = bull ? peak / base - 1 : 1 - peak / base;
      if (pole < 0.15) continue; const after = p.slice(e + 1); if (after.length < 4) continue;
      if (bull ? after.some(b => b.max > peak * 1.01) : after.some(b => b.min < peak * 0.99)) continue;
      const ext = bull ? Math.min(...after.map(b => b.min)) : Math.max(...after.map(b => b.max)), retr = bull ? (peak - ext) / (peak - base) : (ext - peak) / (base - peak);
      if (retr > 0.5 || retr < 0.08) continue;
      return { score: clamp(55 + pole * 120 - retr * 40, 30, 95), note: `旗竿 ${r1(pole * 100)}%，回${bull ? '檔' : '彈'} ${r1(retr * 100)}%`, level: r2(peak) };
    }
    return null;
  };
  out.bullFlag = flag(true); out.bearFlag = flag(false);
  // V 型：最近 30 根內的最低（最高）點，之前 20 根跌（漲）15% 以上，之後收復 60% 以上
  const vee = bull => {
    const s = Math.max(0, n - 30); let m = s; for (let i = s; i < n - 2; i++) if (bull ? p[i].min < p[m].min : p[i].max > p[m].max) m = i;
    if (m > n - 3) return null; const pre = Math.max(0, m - 20), ext = bull ? hi(pre, m) : lo(pre, m), v = bull ? p[m].min : p[m].max;
    const move = bull ? ext / v - 1 : 1 - ext / v, back = bull ? (c - v) / (ext - v) : (v - c) / (v - ext);
    if (move < 0.15 || back < 0.6) return null;
    return { score: clamp(50 + move * 100 + back * 20, 30, 98), note: `${bull ? '跌' : '漲'} ${r1(move * 100)}% 後收復 ${r1(Math.min(back, 1.5) * 100)}%`, level: r2(v) };
  };
  out.vUp = vee(true); out.vDown = vee(false);
  // 圓弧：最近 90 根收盤的二次曲線，開口向上（下）、頂點在中段、擬合度 0.6 以上、深度 8% 以上
  const k60 = p.slice(-90).map(b => b.close);
  if (k60.length >= 50) {
    const q = quad(k60), depth = Math.max(...k60) / Math.min(...k60) - 1;
    if (q && q.r2 >= 0.6 && depth >= 0.08 && between(q.vertex, 0.25, 0.75)) {
      if (q.a > 0 && c > Math.min(...k60) * 1.05) out.roundBottom = { score: clamp(q.r2 * 100, 30, 95), note: `擬合度 ${r1(q.r2 * 100)}%，深度 ${r1(depth * 100)}%`, level: r2(Math.min(...k60)) };
      if (q.a < 0 && c < Math.max(...k60) * 0.95) out.roundTop = { score: clamp(q.r2 * 100, 30, 95), note: `擬合度 ${r1(q.r2 * 100)}%，高度 ${r1(depth * 100)}%`, level: r2(Math.max(...k60)) };
    }
  }
  // 杯柄：左杯緣、杯底、右杯緣（差 5% 內，深度 12%～45%），右杯緣在最近 3～20 根，之後的柄回檔不超過杯深 1/3
  const cup = bull => {
    for (let rr = n - 3; rr >= n - 20 && rr > 30; rr--) {
      const rv = bull ? p[rr].max : p[rr].min, after = p.slice(rr + 1);
      if (bull ? after.some(b => b.max > rv) : after.some(b => b.min < rv)) continue;
      const val = i => bull ? p[i].max : p[i].min; let lr = -1;
      for (let i = Math.max(0, rr - 80); i <= rr - 20; i++) if (near(val(i), rv, 0.05) && (lr < 0 || (bull ? val(i) > val(lr) : val(i) < val(lr)))) lr = i;
      if (lr < 0) continue; const btm = bull ? lo(lr, rr) : hi(lr, rr), lv = bull ? p[lr].max : p[lr].min, depth = bull ? 1 - btm / Math.min(lv, rv) : btm / Math.max(lv, rv) - 1;
      if (!between(depth, 0.12, 0.45)) continue; if (bull ? hi(lr + 1, rr - 1) > Math.max(lv, rv) * 1.02 : lo(lr + 1, rr - 1) < Math.min(lv, rv) * 0.98) continue;
      const ext = bull ? Math.min(...after.map(b => b.min)) : Math.max(...after.map(b => b.max)), handle = bull ? (rv - ext) / (rv - btm) : (ext - rv) / (btm - rv);
      if (!between(handle, 0.03, 0.34)) continue;
      return { score: clamp(60 + (1 - Math.abs(lv / rv - 1) * 20) * 10 - handle * 30, 30, 95), note: `杯深 ${r1(depth * 100)}%，柄回${bull ? '檔' : '彈'} ${r1(handle * 100)}%，杯緣 ${r2(rv)}`, level: r2(rv) };
    }
    return null;
  };
  out.cupHandle = cup(true); out.invCupHandle = cup(false);
  // 突破後回踩／跌破後反抽：前段（倒數 80～25 根）的高（低）點被收盤突破（跌破）2% 以上，之後拉開 5% 以上，目前回到該價位 ±3% 附近
  const retest = bull => {
    if (n < 60) return null; const a = Math.max(0, n - 80), lvl = bull ? hi(a, n - 25) : lo(a, n - 25);
    const b = p.findIndex((x, i) => i > n - 25 && (bull ? x.close > lvl * 1.02 : x.close < lvl * 0.98)); if (b < 0 || b > n - 3) return null;
    const ext = bull ? hi(b, n - 1) : lo(b, n - 1); if (bull ? ext < lvl * 1.05 : ext > lvl * 0.95) return null;
    if (!between(c / lvl, 0.97, 1.04) || (bull ? c > ext * 0.97 : c < ext * 1.03)) return null;
    return { score: clamp(70 - Math.abs(c / lvl - 1) * 500, 30, 95), note: `${bull ? '回測突破位' : '反抽跌破位'} ${r2(lvl)}`, level: r2(lvl) };
  };
  out.retest = retest(true); out.pullback = retest(false);
  // 階梯：最近 3 個高點與 3 個低點都依序墊高（降低）
  const stairs = up => {
    const hh = H.slice(-3), ll = L.slice(-3); if (hh.length < 2 || ll.length < 2) return null;
    const ok = l => l.every((x, j) => !j || (up ? x.v > l[j - 1].v : x.v < l[j - 1].v));
    if (!ok(hh) || !ok(ll) || Math.max(hh.at(-1).i, ll.at(-1).i) < recent(25)) return null;
    return { score: clamp(50 + (hh.length + ll.length - 4) * 10 + 10, 30, 90), note: `${hh.length} 個高點、${ll.length} 個低點依序${up ? '墊高' : '降低'}` };
  };
  out.stairsUp = stairs(true); out.stairsDown = stairs(false);
  // 諧波 XABCD：最後 5 個轉折，D 在最近 10 根內；比例容許誤差見各型
  const X5 = z.slice(-5);
  if (X5.length === 5 && X5[4].i >= recent(10)) {
    const [X, A, B, C, D] = X5, bull = D.t === 'L', xa = Math.abs(A.v - X.v), ab = Math.abs(B.v - A.v), bc = Math.abs(C.v - B.v), cd = Math.abs(D.v - C.v), ad = Math.abs(A.v - D.v);
    const R = { ab: ab / xa, bc: bc / ab, cd: cd / bc, ad: ad / xa }, inR = (v, a, b) => v >= a && v <= b;
    const defs = { gartley: [[0.57, 0.67], [0.382, 0.886], [1.13, 1.618], [0.74, 0.83]], bat: [[0.382, 0.5], [0.382, 0.886], [1.618, 2.618], [0.85, 0.92]], butterfly: [[0.74, 0.83], [0.382, 0.886], [1.618, 2.24], [1.27, 1.618]], crab: [[0.382, 0.618], [0.382, 0.886], [2.24, 3.618], [1.55, 1.68]] };
    for (const [k, [rab, rbc, rcd, rad]] of Object.entries(defs)) {
      if (inR(R.ab, ...rab) && inR(R.bc, ...rbc) && inR(R.cd, ...rcd) && inR(R.ad, ...rad)) out[k + (bull ? 'Bull' : 'Bear')] = { score: 70, note: `AB/XA ${r2(R.ab)}、AD/XA ${r2(R.ad)}，D 點 ${r2(D.v)}`, level: r2(D.v) };
    }
  }
  return out;
}

// 一檔的型態：bars＝依日期排序的 { date, open, max, min, close, Trading_Volume }
export function classify(bars, { minBars = 60 } = {}) {
  const p = bars.filter(b => b.close > 0 && b.max > 0 && b.min > 0).slice(-120); if (p.length < minBars) return { matches: [], reason: '資料不足' };
  const ap = atrPct(p), th = clamp((ap || 3) * 2 / 100, 0.04, 0.12), z = zigzag(p, th), c = p.at(-1).close, n = p.length;
  const found = detectors({ p, z, c, n, th }), meta = new Map(SHAPES.map(s => [s.id, s]));
  const matches = Object.entries(found).filter(([, v]) => v).map(([id, v]) => ({ id, name: meta.get(id).name, group: meta.get(id).group, bias: meta.get(id).bias, kind: meta.get(id).kind, score: Math.round(v.score), note: v.note, level: v.level ?? null, low: v.low ?? null }));
  const bull = matches.filter(m => m.bias === 'bull').reduce((s, m) => s + m.score, 0), bear = matches.filter(m => m.bias === 'bear').reduce((s, m) => s + m.score, 0);
  return { matches: matches.sort((a, b) => b.score - a.score), atr: r2(ap), threshold: r1(th * 100), pivots: z.length, lean: bull > bear * 1.2 ? 'bull' : bear > bull * 1.2 ? 'bear' : 'neutral' };
}

// 全部股票：stocks＝[{ id, name, sector, bars, close?, change? }] → 依型態分組
export function buildShapes(stocks, { asOf = null, scope = '' } = {}) {
  const per = [], by = new Map(SHAPES.map(s => [s.id, []]));
  for (const s of stocks) {
    const r = classify(s.bars || []); if (!r.matches.length) { per.push({ id: s.id, matched: 0 }); continue; }
    const last = s.bars.at(-1), prev = s.bars.at(-2), change = prev ? r2((last.close / prev.close - 1) * 100) : null;
    for (const m of r.matches) by.get(m.id).push({ id: s.id, name: s.name, sector: s.sector, close: r2(last.close), change, score: m.score, note: m.note, level: m.level, lean: r.lean, others: r.matches.filter(x => x.id !== m.id).map(x => x.id) });
    per.push({ id: s.id, matched: r.matches.length, lean: r.lean });
  }
  const shapes = SHAPES.map(s => ({ ...s, count: by.get(s.id).length, stocks: by.get(s.id).sort((a, b) => b.score - a.score) }));
  const tally = b => shapes.filter(s => s.bias === b).reduce((a, s) => a + s.count, 0);
  const leans = { bull: per.filter(x => x.lean === 'bull').length, bear: per.filter(x => x.lean === 'bear').length, neutral: per.filter(x => x.matched && x.lean === 'neutral').length };
  return { version: SHAPES_VERSION, asOf, scope, scanned: stocks.length, matched: per.filter(x => x.matched).length, groups: SHAPE_GROUPS.map(([id, name]) => ({ id, name })), shapes, totals: { bull: tally('bull'), bear: tally('bear'), neutral: tally('neutral') }, leans };
}
