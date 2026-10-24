// 逆勢布局（台股、美股）：和風控水位相反的另一種看法——市場越恐慌、跌得越深，分數越高、建議持股越高（「別人恐懼時貪婪」）。
// 和風控水位並排顯示，兩個都是研究參考，不是買賣建議。純計算；資料由 server.mjs 準備：
//   CNN 恐懼與貪婪指數（全球散戶情緒，免金鑰）、風控水位已算好的指標百分位、總經大地圖保存的指數日線。
export const CONTRA_VERSION = '1.0';
const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pctOf = (arr, v) => { if (!arr.length || v == null) return null; let b = 0, e = 0; for (const x of arr) { if (x < v) b++; else if (x === v) e++; } return (b + e / 2) / arr.length * 100; };
const avg = list => { const v = list.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// 指標：fear 0～100，越高代表越恐慌（越適合逆勢布局）
export const CONTRA_FACTORS = [
  { key: 'global', name: '全球散戶', weight: 25, desc: 'CNN 恐懼與貪婪指數（0 極度恐懼～100 極度貪婪）的反向：散戶越恐懼，分數越高' },
  { key: 'foreign', name: '外資情緒', weight: 20, desc: { TW: '外資台指期淨部位與近 20 日現貨買賣超在過去一年的位置（越偏空、賣超越多，分數越高）', US: '高收益債利差在過去一年的位置（利差越大代表資金越恐慌，分數越高）' } },
  { key: 'panic', name: '恐慌指標', weight: 20, desc: { TW: '小台指散戶多空比在過去一年的位置的反向（散戶越偏空，分數越高）', US: 'VIX 與 VIX 期限結構在過去一年的位置（越高越恐慌）' } },
  { key: 'position', name: '位階降溫', weight: 15, desc: '指數在近一年區間的位置的反向（離高點越遠，分數越高）' },
  { key: 'drop', name: '短線跌深', weight: 20, desc: '指數近 5 個交易日報酬在過去一年的位置的反向（跌得越急，分數越高）' },
];
export const CONTRA_LEVELS = [[25, '極度樂觀', 'high'], [40, '偏樂觀', 'highish'], [60, '中性', 'mid'], [75, '偏恐慌', 'lowish'], [101, '極度恐慌', 'low']];
// 逆勢持股建議：分數越高持股越高（20%～90%，以 10% 為單位）
export const contraExposure = s => s == null ? null : clamp(Math.round(s / 10) * 10, 20, 90);

// CNN 恐懼與貪婪 JSON → { score, rating, date, prev1w, prev1m, history: [[date, score]] }
export function parseFearGreed(j) {
  const f = j?.fear_and_greed; if (!f || !Number.isFinite(Number(f.score))) return null;
  const hist = (j.fear_and_greed_historical?.data || []).map(p => [new Date(p.x).toISOString().slice(0, 10), r1(p.y)]).filter(p => p[1] != null);
  return { score: r1(Number(f.score)), rating: f.rating || null, date: String(f.timestamp || '').slice(0, 10), prev1d: r1(f.previous_close), prev1w: r1(f.previous_1_week), prev1m: r1(f.previous_1_month), history: hist.slice(-260) };
}
// 指數日線 → 位階（近 250 日百分位）與近 5 日報酬百分位
export function indexFear(closes = []) {
  const c = closes.filter(x => x[1] > 0); if (c.length < 260) return { position: null, drop: null, ret5: null };
  const w = c.slice(-250).map(x => x[1]), last = w.at(-1), pos = pctOf(w, last);
  const rets = []; for (let i = c.length - 250; i < c.length; i++) rets.push(c[i][1] / c[i - 5][1] - 1);
  const r5 = rets.at(-1);
  return { position: r1(100 - pos), drop: r1(100 - pctOf(rets, r5)), ret5: r1(r5 * 100), indexPos: r1(pos) };
}
// 主函式：market、fg（parseFearGreed）、risk（風控水位最新結果，含各指標 pct）、closes（指數日線）
export function buildContrarian({ market, fg = null, risk = null, closes = [] }) {
  const f = new Map((risk?.factors || []).map(x => [x.key, x])), p = k => f.get(k)?.pct ?? null, ix = indexFear(closes);
  const val = {
    global: fg?.score != null ? 100 - fg.score : null,
    foreign: market === 'US' ? p('credit') : avg([p('foreignFut') != null ? 100 - p('foreignFut') : null, p('foreignSpot') != null ? 100 - p('foreignSpot') : null]),
    panic: market === 'US' ? avg([p('vix'), p('term')]) : (p('retail') != null ? 100 - p('retail') : null),
    position: ix.position, drop: ix.drop,
  };
  const factors = CONTRA_FACTORS.map(x => ({ key: x.key, name: x.name, weight: x.weight, desc: typeof x.desc === 'string' ? x.desc : x.desc[market] || x.desc.TW, fear: r1(val[x.key]) }));
  const used = factors.filter(x => x.fear != null), w = used.reduce((a, x) => a + x.weight, 0);
  const score = w ? r1(used.reduce((a, x) => a + x.fear * x.weight, 0) / w) : null, lv = score == null ? null : CONTRA_LEVELS.find(([m]) => score < m);
  return { version: CONTRA_VERSION, market, available: score != null, score, exposure: contraExposure(score), label: lv?.[1] ?? null, tone: lv?.[2] ?? null,
    coverage: Math.round(w / CONTRA_FACTORS.reduce((a, x) => a + x.weight, 0) * 100), factors, fearGreed: fg ? { score: fg.score, rating: fg.rating, date: fg.date, prev1d: fg.prev1d, prev1w: fg.prev1w, prev1m: fg.prev1m } : null,
    ret5: ix.ret5, riskExposure: risk?.exposure ?? null, date: risk?.date || closes.at(-1)?.[0] || null };
}
