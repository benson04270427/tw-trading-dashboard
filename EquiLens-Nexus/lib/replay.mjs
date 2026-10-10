// 熱浪圖時光機：盤中每分鐘記錄一個全市場畫格（收盤價 × ps、累計成交金額 ÷ as、累計成交量），供回放、板塊輪動與盤中分 K。
// ps／as 依市場設定寫在表頭（台股 100 與 1e6；舊檔沒有這兩欄時沿用台股值）。
// 檔案：.local/replay/YYYY-MM-DD.ndjson（第一行為表頭），隔日壓縮為 .ndjson.gz，保留最近 KEEP_DAYS 個交易日。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LOCAL } from './storage.mjs';
import { normalizeSector } from './sectors.mjs';
import { activeMarket } from './config.mjs';
import { closeHM } from './markets.mjs';

export const KEEP_DAYS = 20;
const DIR = path.join(LOCAL, 'replay');
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const fileOf = (date, gz = false) => path.join(DIR, `${date}.ndjson${gz ? '.gz' : ''}`);

// 畫格數值換算：價格與成交金額（舊檔表頭沒有 ps／as）
export const framePrice = (day, f, i) => f.p[i] / (day.ps || 100);
export const frameAmount = (day, f, i) => f.a[i] * (day.as || 1e6);
export const prevPrice = (day, i) => day.prev[i] / (day.ps || 100);
export function encodeFrame(rows, ids, ps = 100, as = 1e6) {
  const byId = new Map(rows.map(r => [r.stock_id, r]));
  const p = [], a = [], v = [];
  for (const id of ids) { const r = byId.get(id); p.push(r && Number(r.close) > 0 ? Math.round(Number(r.close) * ps) : 0); a.push(r && Number(r.total_amount) > 0 ? Math.round(Number(r.total_amount) / as) : 0); v.push(r && Number(r.total_volume) > 0 ? Math.round(Number(r.total_volume)) : 0); }
  return { p, a, v };
}

const open = new Map(); // date → { ids, lastT, lastAt：最後一個畫格在檔案中的位元組位置 }
// rows：當日有成交的快照列；all：含尚未成交（日期仍是前一日）的全部快照列，只用來建立表頭——
// 股票清單要涵蓋全市場，否則開盤第一個畫格還沒成交的股票整天都不會被記錄；尚未成交者昨收＝快照收盤價。
// 收盤（例如台股 13:30）起收盤集合競價陸續揭示、快照時間停在收盤那一分鐘，同一分鐘的較新快照會覆寫最後一個畫格，確保記到最終收盤價。
export function recordFrame(date, t, rows, universeIds, { all = rows, market = activeMarket() } = {}) {
  if (!validDate(date) || !/^\d{2}:\d{2}$/.test(t)) return false;
  fs.mkdirSync(DIR, { recursive: true });
  let day = open.get(date);
  if (!day) {
    const file = fileOf(date);
    if (fs.existsSync(file)) { const text = fs.readFileSync(file, 'utf8'), lines = text.trim().split('\n'), head = JSON.parse(lines[0]); day = { ids: head.ids, ps: head.ps || 100, as: head.as || 1e6, lastT: lines.length > 1 ? JSON.parse(lines.at(-1)).t : '', lastAt: lines.length > 1 ? Buffer.byteLength(text.trimEnd()) - Buffer.byteLength(lines.at(-1)) : null }; }
    else {
      const byId = new Map(all.filter(r => universeIds.has(r.stock_id)).map(r => [r.stock_id, r]));
      for (const r of rows) if (universeIds.has(r.stock_id)) byId.set(r.stock_id, r);
      const ids = [...byId.keys()].sort();
      if (!rows.some(r => universeIds.has(r.stock_id))) return false;
      const prev = ids.map(id => {
        const r = byId.get(id), c = Number(r.close), ch = Number(r.change_price);
        if (String(r.date).slice(0, 10) !== date) return c > 0 ? Math.round(c * market.priceScale) : 0;
        return c > 0 && Number.isFinite(ch) ? Math.round((c - ch) * market.priceScale) : 0;
      });
      fs.writeFileSync(file, JSON.stringify({ v: 2, date, ids, prev, ps: market.priceScale, as: market.amountScale }) + '\n');
      day = { ids, ps: market.priceScale, as: market.amountScale, lastT: '', lastAt: null };
    }
    open.clear(); open.set(date, day);
  }
  const file = fileOf(date);
  if (t < day.lastT || (t === day.lastT && (t < closeHM(market) || day.lastAt == null))) return false;
  if (t === day.lastT) fs.truncateSync(file, day.lastAt); else day.lastAt = fs.statSync(file).size;
  fs.appendFileSync(file, JSON.stringify({ t, ...encodeFrame(rows, day.ids, day.ps, day.as) }) + '\n');
  day.lastT = t; cache.delete(date);
  return true;
}

export function listDays() {
  try { return [...new Set(fs.readdirSync(DIR).map(f => /^(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/.exec(f)?.[1]).filter(Boolean))].sort(); } catch { return []; }
}
const cache = new Map();
export function loadDay(date) {
  if (!validDate(date)) return null;
  if (cache.has(date)) return cache.get(date);
  let text = null;
  if (fs.existsSync(fileOf(date))) text = fs.readFileSync(fileOf(date), 'utf8');
  else if (fs.existsSync(fileOf(date, true))) text = zlib.gunzipSync(fs.readFileSync(fileOf(date, true))).toString('utf8');
  if (!text) return null;
  const lines = text.trim().split('\n'), head = JSON.parse(lines[0]);
  const day = { ...head, frames: lines.slice(1).map(l => JSON.parse(l)) };
  if (cache.size > 3) cache.delete(cache.keys().next().value);
  cache.set(date, day);
  return day;
}
// 切換市場後清除記憶體中的畫格（檔案已換成另一個市場的紀錄）
export function resetReplayCache() { open.clear(); cache.clear(); }
// 已結束的交易日壓縮，並刪除超過保留天數的紀錄。
export function compactReplay(today) {
  for (const date of listDays()) {
    if (date < today && fs.existsSync(fileOf(date))) { fs.writeFileSync(fileOf(date, true), zlib.gzipSync(fs.readFileSync(fileOf(date)))); fs.rmSync(fileOf(date)); open.delete(date); }
  }
  for (const date of listDays().slice(0, -KEEP_DAYS)) { fs.rmSync(fileOf(date), { force: true }); fs.rmSync(fileOf(date, true), { force: true }); cache.delete(date); }
}

// 回放摘要：股票基本資料、時間軸、全市場與各板塊累計成交金額（百萬元）序列。
export function replaySummary(day, universe) {
  const meta = new Map(universe.map(s => [s.id, s]));
  const stocks = day.ids.map((id, i) => { const m = meta.get(id); return { id, name: m?.name || id, sector: normalizeSector(m?.sector), market: m?.market || '', prev: prevPrice(day, i) }; });
  const sectorIdx = new Map(); stocks.forEach((s, i) => { if (!sectorIdx.has(s.sector)) sectorIdx.set(s.sector, []); sectorIdx.get(s.sector).push(i); });
  const total = day.frames.map(f => f.a.reduce((x, y) => x + y, 0));
  const sectors = [...sectorIdx].map(([name, idx]) => ({ name, a: day.frames.map(f => idx.reduce((x, i) => x + f.a[i], 0)), c: day.frames.map(f => { let w = 0, m = 0; for (const i of idx) { const p = framePrice(day, f, i), pv = stocks[i].prev; if (p > 0 && pv > 0 && f.a[i] > 0) { w += (p / pv - 1) * 100 * f.a[i]; m += f.a[i]; } } return m ? Math.round(w / m * 100) / 100 : null; }) }))
    .sort((x, y) => (y.a.at(-1) || 0) - (x.a.at(-1) || 0));
  return { date: day.date, ps: day.ps || 100, as: day.as || 1e6, times: day.frames.map(f => f.t), stocks, total, sectors };
}
