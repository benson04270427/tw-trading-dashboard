// 全市場掃描紀錄（台股、只有證交所 MIS 逐檔報價時）：漲跌排行每輪掃描全市場普通股的結果存成一個畫格，
// 格式與時光機相同（ids、prev、ps、as、frames[{ t, p, a, v }]），讓研究名單以外的股票收盤後也能看當天走勢（約每 1.5–3 分鐘一點）。
// 檔案：.local/sweep/YYYY-MM-DD.json；只保留最近 KEEP 個交易日。
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL } from './storage.mjs';
import { encodeFrame } from './replay.mjs';

export const KEEP = 2;
const DIR = path.join(LOCAL, 'sweep');
const fileOf = date => path.join(DIR, `${date}.json`);
const valid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
let mem = null; // { date, day }

export function sweepDays() { try { return fs.readdirSync(DIR).map(f => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean).sort(); } catch { return []; } }
export function loadSweep(date) {
  if (!valid(date)) return null;
  if (mem?.date === date) return mem.day;
  try { const day = JSON.parse(fs.readFileSync(fileOf(date), 'utf8')); mem = { date, day }; return day; } catch { return null; }
}
// rows：當日快照（只收資料日期＝date 的列）；t：'HH:MM'（同一分鐘的新畫格覆寫舊的，確保收盤那一格是最終價）
export function recordSweep(date, t, rows, { ps = 100, as = 1e6 } = {}) {
  if (!valid(date) || !/^\d{2}:\d{2}$/.test(t)) return false;
  const today = rows.filter(r => String(r.date).slice(0, 10) === date && Number(r.close) > 0);
  if (!today.length) return false;
  let day = loadSweep(date);
  if (!day) {
    const ids = today.map(r => r.stock_id).sort(), byId = new Map(today.map(r => [r.stock_id, r]));
    const prev = ids.map(id => { const r = byId.get(id), c = Number(r.close), ch = Number(r.change_price); return c > 0 && Number.isFinite(ch) ? Math.round((c - ch) * ps) : 0; });
    day = { v: 1, date, ids, prev, ps, as, frames: [] };
  } else {
    // 新出現的股票（開盤後才有第一筆成交）加到清單尾端，舊畫格補 0
    const have = new Set(day.ids), add = today.filter(r => !have.has(r.stock_id));
    for (const r of add) { day.ids.push(r.stock_id); const c = Number(r.close), ch = Number(r.change_price); day.prev.push(c > 0 && Number.isFinite(ch) ? Math.round((c - ch) * day.ps) : 0); for (const f of day.frames) { f.p.push(0); f.a.push(0); f.v.push(0); } }
  }
  const frame = { t, ...encodeFrame(today, day.ids, day.ps, day.as) };
  const last = day.frames.at(-1);
  if (last && t < last.t) return false;
  if (last?.t === t) day.frames[day.frames.length - 1] = frame; else day.frames.push(frame);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(date), JSON.stringify(day));
  mem = { date, day };
  for (const d of sweepDays().slice(0, -KEEP)) fs.rmSync(fileOf(d), { force: true });
  return true;
}
