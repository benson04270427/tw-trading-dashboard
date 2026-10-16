// 當沖監控的大盤環境紀錄（第一步：只記錄，不影響分數、門檻與推播）。
// 上市股對照加權指數、上櫃股對照櫃買指數：每個訊號記下當下的指數漲跌、近 15 分鐘變化、相對日內均價的位置、
// 上市／上櫃漲跌家數與個股相對強弱；收盤檢討依「順風／中性／逆風」與「強於／弱於大盤」分組統計，累積足夠樣本後再決定是否改成濾網。
// 純計算模組：指數資料由 server.mjs 餵入（FinMind 快照的 001／101 每 10 秒；快照沒有指數時改用富果指數 1 分 K，每分鐘最多 1 次）。

export const INDEX_OF = { '上市': 'twse', '上櫃': 'tpex' };
export const INDEX_KEYS = ['twse', 'tpex'];
// window：近幾分鐘的變化；drop：近 window 分鐘跌幅達此值（%）即視為逆風；maxAgeSeconds：指數資料超過幾秒未更新視為過期
export const MARKET_RULES = Object.freeze({ window: 15, drop: -0.5, maxAgeSeconds: 120 });
export const REGIMES = ['tailwind', 'neutral', 'headwind'];
export const STRENGTHS = ['strong', 'weak'];

const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = (x, n = 2) => finite(x) ? Math.round(x * 10 ** n) / 10 ** n : null;

// 指數狀態 → 大盤環境。順風：高於日內均價且近 15 分鐘未下跌；逆風：低於均價且近 15 分鐘下跌，或近 15 分鐘跌幅達 0.5%；其餘中性。
// 資料不足（開盤未滿 15 分鐘、沒有指數、資料過期）回傳 null。
export function regimeOf(c) {
  if (!c || !finite(c.r15) || !finite(c.vsAvg)) return null;
  if (c.r15 <= MARKET_RULES.drop || (c.vsAvg < 0 && c.r15 < 0)) return 'headwind';
  if (c.vsAvg >= 0 && c.r15 >= 0) return 'tailwind';
  return 'neutral';
}
// 相對強弱：個股近 15 分鐘漲跌減所屬指數近 15 分鐘漲跌，> 0 為強於大盤
export const strengthOf = c => !c || !finite(c.rs15) ? null : c.rs15 > 0 ? 'strong' : 'weak';

// 每個指數保存當天每分鐘最後一個值（快照每 10 秒、或富果 1 分 K 的收盤）。日內均價＝每分鐘收盤的平均（指數沒有成交量加權均價，以時間加權代替）
export function createMarketTracker({ date = null, open = 540, offset = 8 * 3600e3 } = {}) {
  const X = new Map();
  const minuteOf = ms => Math.floor((ms + offset) / 60000) % 1440, dayOf = ms => new Date(ms + offset).toISOString().slice(0, 10);
  const get = key => { let x = X.get(key); if (!x) X.set(key, x = { ref: null, price: null, at: 0, minutes: new Map(), minuteAt: new Map(), breadth: null, source: null }); return x; };
  const accept = (key, at) => INDEX_KEYS.includes(key) && finite(at) && at > 0 && (!date || dayOf(at) === date) && minuteOf(at) >= open;
  function latest(x, price, at, source) { if (at >= x.at) { x.price = price; x.at = at; x.source = source; } }
  return {
    // 快照的一筆指數：at（毫秒）、price、ref（昨收）
    sample(key, { at, price, ref, source = 'snapshot' } = {}) {
      if (!accept(key, at) || !(price > 0)) return false;
      const x = get(key), m = minuteOf(at);
      if (ref > 0) x.ref = ref;
      if (at >= (x.minuteAt.get(m) ?? 0)) { x.minutes.set(m, price); x.minuteAt.set(m, at); }
      latest(x, price, at, source); return true;
    },
    // 富果指數報價＋當日 1 分 K：minutes＝[[分鐘, 收盤], …]（分鐘＝當地時間 0–1439）
    series(key, { ref, price, at, minutes = [], source = 'fugle' } = {}) {
      if (!INDEX_KEYS.includes(key)) return false;
      const x = get(key); let n = 0;
      for (const [m, c] of minutes) if (finite(m) && m >= open && m < 1440 && c > 0) { x.minutes.set(m, c); n++; }
      if (ref > 0) x.ref = ref;
      if (accept(key, at) && price > 0) latest(x, price, at, source);
      return n > 0;
    },
    // 上市／上櫃漲跌家數（全市場快照才有意義）
    breadth(key, { up, down, at } = {}) { if (INDEX_KEYS.includes(key) && finite(up) && finite(down) && finite(at)) get(key).breadth = { up, down, at }; },
    state(key, now) {
      const x = X.get(key); if (!x || !(x.price > 0)) return null;
      const cur = minuteOf(now), ms = [...x.minutes].filter(([m]) => m <= cur).sort((a, b) => a[0] - b[0]);
      const age = (now - x.at) / 1000, base = ms.filter(([m]) => m <= cur - MARKET_RULES.window && m >= cur - MARKET_RULES.window - 2).at(-1)?.[1]; // 15 分鐘前的值（容許缺 2 分鐘；指數缺資料不沿用更早的值）
      const avg = ms.length ? ms.reduce((a, [, c]) => a + c, 0) / ms.length : null, b = x.breadth && now - x.breadth.at <= MARKET_RULES.maxAgeSeconds * 1000 ? x.breadth : null;
      return { index: key, price: x.price, ref: x.ref, chg: x.ref > 0 ? round((x.price / x.ref - 1) * 100) : null, r15: base > 0 ? round((x.price / base - 1) * 100) : null,
        avg: round(avg, 2), vsAvg: avg > 0 ? round((x.price / avg - 1) * 100) : null, up: b?.up ?? null, down: b?.down ?? null,
        age: Math.max(0, Math.round(age)), stale: age > MARKET_RULES.maxAgeSeconds, minutes: ms.length, source: x.source };
    },
    // 最新指數距今毫秒數（沒有資料為 Infinity）；是否已有開盤（第一或第二分鐘）的資料
    age(key, now) { const x = X.get(key); return x?.at ? now - x.at : Infinity; },
    hasOpen(key) { const x = X.get(key); return !!x && [...x.minutes.keys()].some(m => m <= open + 1); },
  };
}

// 訊號當下的大盤紀錄（存進當沖訊號紀錄）：exchange＝'上市'／'上櫃'；stock：{ chg, r15 }＝個股漲跌幅與近 15 分鐘漲跌（%）。
// 沒有資料時只記錄原因：exchange（不是上市／上櫃）、noIndex（沒有指數資料）、stale（指數過期）、warmup（開盤未滿 15 分鐘）
export function marketRecord(tracker, exchange, stock, now) {
  const index = INDEX_OF[exchange] || null;
  if (!index) return { index: null, reason: 'exchange' };
  const s = tracker.state(index, now);
  if (!s) return { index, reason: 'noIndex' };
  if (s.stale) return { index, reason: 'stale', age: s.age };
  const rs = finite(stock?.chg) && finite(s.chg) ? round(stock.chg - s.chg) : null, rs15 = finite(stock?.r15) && finite(s.r15) ? round(stock.r15 - s.r15) : null;
  const out = { index, price: s.price, chg: s.chg, r15: s.r15, avg: s.avg, vsAvg: s.vsAvg, up: s.up, down: s.down, stock: { chg: round(stock?.chg), r15: round(stock?.r15) }, rs, rs15, source: s.source };
  if (!regimeOf(out)) out.reason = 'warmup';
  return out;
}

// 收盤檢討的分組鍵（沒有紀錄或資料不足為 none）
export const regimeKey = s => regimeOf(s?.market) || 'none';
export const strengthKey = s => strengthOf(s?.market) || 'none';
