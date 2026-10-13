// 五檔錄製器：盤中把推播收到的每一次五檔變動（以及逐筆成交）寫進當日檔案，收盤後整理成每檔一個檔案，可匯出成 CSV。
// 錄製對象：即時推播本來就訂閱的股票（研究名單＋自選），加上「加錄」的股票——開盤前依近 20 日平均成交金額挑出最活躍的一批
// （只訂閱五檔，每檔 1 個訂閱），盤中在檢查點（第一根 5 分 K 走完起）把幾乎沒成交的換成突然爆量、大漲跌或整個族群轉強的股票。
// 只錄五檔的股票，逐筆成交在收盤後以 REST 補齊。
// 檔案：.local/books/YYYY-MM-DD/
//   part-N.ndjson.gz：盤中錄製（每次啟動一個新檔，定期 flush，當機也只遺失最後幾秒）
//   meta.json：錄製清單、加錄與換股紀錄、整理狀態
//   收盤整理後：<代號>.ndjson.gz（每檔一個），part 檔刪除
// 每行一筆：["b",代號,毫秒,[買價,買量,…],[賣價,賣量,…],試撮] 或 ["t",代號,毫秒,價,量,累計量,買一,賣一,序號,試撮]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

export const BOOK_DEFAULTS = { enabled: true, extra: 1000, keepDays: 20, swap: true };
export function normalizeBooks(s) {
  const x = { ...BOOK_DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  return { enabled: x.enabled !== false, extra: Math.max(0, Math.min(1900, Math.round(Number(x.extra) || 0))), keepDays: Math.max(1, Math.min(120, Math.round(Number(x.keepDays) || BOOK_DEFAULTS.keepDays))), swap: x.swap !== false };
}
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validId = id => typeof id === 'string' && /^[0-9A-Za-z]{1,12}$/.test(id);
// 換股檢查點（開盤後第幾分鐘）：第一根 5 分 K 走完，之後每 30 分鐘到收盤前 1 小時
export function checkpoints(p) { const out = [5]; for (let m = 30; m <= p.close - p.open - 60; m += 30) out.push(m); return out; }

/* ---------- 選股 ---------- */
// 時光機（全市場每分鐘畫格）→ 近 20 日平均成交金額、近 5 日各檢查點的平均累計成交金額
export function buildLiquidity(days, p) {
  const sum = new Map(), cnt = new Map(), cps = checkpoints(p), at = new Map(cps.map(m => [m, new Map()])), atN = new Map(cps.map(m => [m, 0]));
  const hm = m => { const x = p.open + m; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  days.slice(-20).forEach((d, di, all) => {
    const last = d.frames?.at(-1); if (!last?.a) return;
    const as = d.as || 1e6;
    d.ids.forEach((id, i) => { const a = last.a[i] * as; if (a > 0) { sum.set(id, (sum.get(id) || 0) + a); cnt.set(id, (cnt.get(id) || 0) + 1); } });
    if (di < all.length - 5) return;
    for (const m of cps) {
      const t = hm(m), f = [...d.frames].reverse().find(x => x.t <= t); if (!f?.a) continue;
      const map = at.get(m); atN.set(m, atN.get(m) + 1);
      d.ids.forEach((id, i) => { const a = f.a[i] * as; if (a > 0) map.set(id, (map.get(id) || 0) + a); });
    }
  });
  const avg = new Map([...sum].map(([id, s]) => [id, s / Math.max(1, Math.min(20, days.length))]));
  for (const m of cps) { const n = atN.get(m) || 1, map = at.get(m); for (const [id, s] of map) map.set(id, s / n); }
  return { days: Math.min(20, days.length), avg, at };
}
// 只留選股用得到的畫格（各檢查點當下與最後一個），避免 20 天的全部畫格同時佔用記憶體
export function reduceDay(d, p) {
  const fr = d?.frames || [], keep = new Set(fr.length ? [fr.length - 1] : []);
  for (const m of checkpoints(p)) { const x = p.open + m, t = String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); let j = -1; fr.forEach((f, i) => { if (f.t <= t) j = i; }); if (j >= 0) keep.add(j); }
  return { ids: d.ids, as: d.as, frames: [...keep].sort((a, b) => a - b).map(i => fr[i]) };
}
// 開盤前：平均成交金額最高、不在推播清單裡的 n 檔
export function pickExtras(liq, exclude, n, allowed = null) {
  return [...liq.avg].filter(([id]) => !exclude.has(id) && (!allowed || allowed.has(id))).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}
// 盤中檢查點換股：rows＝目前全市場快照（id → { amount 累計成交金額, change 漲跌幅% }），base＝近 5 日同時點平均累計成交金額
// 候選：不在錄製中、成交金額 ≥ 500 萬，且量比 ≥ 2 倍或漲跌幅 ≥ 3%；同產業 3 檔以上漲幅 ≥ 2% 的候選 → 整個產業成交金額 ≥ 200 萬的都加入。
// 名額不足時換掉加錄清單中成交最冷清（低於 100 萬）的股票。
export function swapExtras({ extras, exclude, rows, base, sectorOf = () => '', slots = 0, minAmount = 5e6, groupAmount = 2e6, deadAmount = 1e6 }) {
  const cur = new Set(extras), recorded = id => cur.has(id) || exclude.has(id);
  const ratio = id => { const b = base?.get(id) || 0, a = rows.get(id)?.amount || 0; return b > 0 ? a / b : a >= minAmount * 4 ? 9 : 0; };
  const hot = [...rows].filter(([id, r]) => !recorded(id) && r.amount >= minAmount && (ratio(id) >= 2 || Math.abs(r.change || 0) >= 3)).map(([id]) => id);
  const bySector = new Map();
  for (const [id, r] of rows) if ((r.change || 0) >= 2 && r.amount >= minAmount) { const s = sectorOf(id); if (s) bySector.set(s, (bySector.get(s) || 0) + 1); }
  const strong = new Set([...bySector].filter(([, n]) => n >= 3).map(([s]) => s));
  const group = strong.size ? [...rows].filter(([id, r]) => !recorded(id) && strong.has(sectorOf(id)) && r.amount >= groupAmount).map(([id]) => id) : [];
  const score = id => { const r = rows.get(id); return (strong.has(sectorOf(id)) ? 1e15 : 0) + Math.min(ratio(id), 50) * 1e12 + r.amount; };
  const want = [...new Set([...group, ...hot])].sort((a, b) => score(b) - score(a));
  const dead = extras.filter(id => (rows.get(id)?.amount || 0) < deadAmount).sort((a, b) => (rows.get(a)?.amount || 0) - (rows.get(b)?.amount || 0));
  const free = Math.max(0, slots - extras.length), take = want.slice(0, free + dead.length), dropped = dead.slice(0, Math.max(0, take.length - free));
  const drop = new Set(dropped);
  return { next: [...extras.filter(id => !drop.has(id)), ...take], added: take, dropped, sectors: [...strong] };
}

/* ---------- 錄製 ---------- */
const flat = levels => (levels || []).slice(0, 5).flatMap(l => [l.price, l.size]);
export function createBookRecorder({ dir, date, now = Date.now, flushMs = 10000 }) {
  const day = path.join(dir, date); fs.mkdirSync(day, { recursive: true });
  let n = 1; while (fs.existsSync(path.join(day, `part-${n}.ndjson.gz`))) n++;
  const gz = zlib.createGzip({ level: 6 }), out = fs.createWriteStream(path.join(day, `part-${n}.ndjson.gz`));
  gz.pipe(out);
  const last = new Map(); let books = 0, trades = 0, bytes = 0, closed = false, failed = '';
  out.on('error', e => { failed = e.message; closed = true; });
  const timer = setInterval(() => { if (!closed) gz.flush(zlib.constants.Z_SYNC_FLUSH); }, flushMs); timer.unref?.();
  const put = line => { if (closed) return; bytes += line.length + 1; gz.write(line + '\n'); };
  return {
    record(e) {
      if (!e?.id) return;
      if (e.kind === 'book' || (e.kind === 'agg' && e.book)) {
        const b = e.kind === 'book' ? e : e.book, bid = flat(b.bids), ask = flat(b.asks), sig = bid.join(',') + '|' + ask.join(',');
        if (last.get(e.id) === sig) return; // 內容沒變（例如聚合行情只更新了成交）不重複記錄
        last.set(e.id, sig); books++;
        put(JSON.stringify(['b', e.id, Math.round(e.time || now()), bid, ask, e.trial || b.trial ? 1 : 0]));
      } else if (e.kind === 'trade') {
        trades++;
        put(JSON.stringify(['t', e.id, Math.round(e.time || now()), e.price, e.size, e.volume ?? null, e.bid ?? null, e.ask ?? null, e.serial ?? null, e.trial ? 1 : 0]));
      }
    },
    get stats() { return { books, trades, bytes, stocks: last.size, error: failed }; },
    close() { if (closed) return Promise.resolve(); closed = true; clearInterval(timer); return new Promise(r => { out.on('close', r); out.on('error', r); gz.end(); }); },
  };
}
export const metaPath = (dir, date) => path.join(dir, date, 'meta.json');
export function readMeta(dir, date) { try { return JSON.parse(fs.readFileSync(metaPath(dir, date), 'utf8')); } catch { return null; } }
export function writeMeta(dir, date, meta) { fs.mkdirSync(path.join(dir, date), { recursive: true }); fs.writeFileSync(metaPath(dir, date), JSON.stringify(meta)); }

// 讀取 gzip 逐行（中斷的 part 檔也讀得到中斷前的內容）
async function* gzLines(file) {
  const src = fs.createReadStream(file).pipe(zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH }));
  const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
  try { for await (const l of rl) if (l) yield l; } catch { /* 檔尾不完整 */ }
}
const idOf = line => { const i = line.indexOf('"', 6); return line.slice(6, i); }; // ["b","3406",…

/* ---------- 收盤整理 ---------- */
// part 檔＋補抓的逐筆成交 → 每檔一個檔案（依時間排序、成交以序號去重），刪除 part 檔
export async function compactDay(dir, date, { extraTrades = new Map() } = {}) {
  const day = path.join(dir, date), tmp = path.join(day, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  const parts = fs.readdirSync(day).filter(f => /^part-\d+\.ndjson\.gz$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
  const buf = new Map(); let held = 0;
  const spill = () => { for (const [id, ls] of buf) fs.appendFileSync(path.join(tmp, id), ls.join('\n') + '\n'); buf.clear(); held = 0; };
  const push = (id, l) => { if (!validId(id)) return; if (!buf.has(id)) buf.set(id, []); buf.get(id).push(l); held += l.length; if (held > 64e6) spill(); };
  for (const f of parts) for await (const l of gzLines(path.join(day, f))) push(idOf(l), l);
  for (const [id, list] of extraTrades) for (const e of list) push(id, JSON.stringify(['t', id, Math.round(e.time), e.price, e.size, e.volume ?? null, e.bid ?? null, e.ask ?? null, e.serial ?? null, e.trial ? 1 : 0]));
  spill();
  const stocks = {};
  for (const id of fs.readdirSync(tmp)) {
    const seen = new Set(), rows = [];
    for (const l of fs.readFileSync(path.join(tmp, id), 'utf8').split('\n')) {
      if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
      if (r[0] === 't') { const k = r[8] != null ? 's' + r[8] : l; if (seen.has(k)) continue; seen.add(k); }
      rows.push(r);
    }
    rows.sort((a, b) => a[2] - b[2]); // 同一時間保留收到的順序
    fs.writeFileSync(path.join(day, `${id}.ndjson.gz`), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
    stocks[id] = { books: rows.filter(r => r[0] === 'b').length, trades: rows.filter(r => r[0] === 't').length, from: rows[0]?.[2] ?? null, to: rows.at(-1)?.[2] ?? null };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of parts) fs.rmSync(path.join(day, f), { force: true });
  return stocks;
}
export function listBookDays(dir) { try { return fs.readdirSync(dir).filter(validDate).sort(); } catch { return []; } }
export function pruneDays(dir, keep) { for (const d of listBookDays(dir).slice(0, -keep)) fs.rmSync(path.join(dir, d), { recursive: true, force: true }); }

/* ---------- 匯出 ---------- */
// 某檔某日 → CSV：每次五檔變動與每筆成交一列，成交列附上當下的五檔
export async function readStock(dir, date, id) {
  if (!validDate(date) || !validId(id)) return null;
  const day = path.join(dir, date), file = path.join(day, `${id}.ndjson.gz`), rows = [];
  if (fs.existsSync(file)) { for await (const l of gzLines(file)) { try { rows.push(JSON.parse(l)); } catch { } } return rows; }
  // 尚未整理（盤中或收盤整理前）：從 part 檔篩出
  if (!fs.existsSync(day)) return null;
  const pre1 = `["b","${id}",`, pre2 = `["t","${id}",`;
  for (const f of fs.readdirSync(day).filter(f => /^part-\d+\.ndjson\.gz$/.test(f))) for await (const l of gzLines(path.join(day, f))) if (l.startsWith(pre1) || l.startsWith(pre2)) { try { rows.push(JSON.parse(l)); } catch { } }
  rows.sort((a, b) => a[2] - b[2]);
  return rows.length ? rows : null;
}
export function toCSV(rows, { tz = 'Asia/Taipei' } = {}) {
  const time = ms => { const d = new Date(ms); return d.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false }) + '.' + String(d.getUTCMilliseconds()).padStart(3, '0'); };
  const head = ['時間', '類型', '成交價', '成交量(張)', '累計量(張)', '內外盤', ...[1, 2, 3, 4, 5].flatMap(i => [`委買${i}價`, `委買${i}量`]), ...[1, 2, 3, 4, 5].flatMap(i => [`委賣${i}價`, `委賣${i}量`]), '試撮'];
  let bid = [], ask = [];
  const lv = a => Array.from({ length: 10 }, (_, i) => a[i] ?? '');
  const lines = rows.map(r => {
    if (r[0] === 'b') { bid = r[3] || []; ask = r[4] || []; return [time(r[2]), '五檔', '', '', '', '', ...lv(bid), ...lv(ask), r[5] ? '試撮' : ''].join(','); }
    const [, , t, price, size, volume, b, a, , trial] = r;
    const side = a > 0 && price >= a ? '外盤' : b > 0 && price <= b ? '內盤' : '';
    return [time(t), '成交', price, size, volume ?? '', side, ...lv(bid), ...lv(ask), trial ? '試撮' : ''].join(',');
  });
  return '﻿' + head.join(',') + '\n' + lines.join('\n') + '\n';
}
