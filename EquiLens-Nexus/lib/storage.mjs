import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL = process.env.EQUITY_DATA_DIR || path.join(ROOT, '.local');
fs.mkdirSync(path.join(LOCAL, 'stocks'), { recursive: true });
export function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(LOCAL, name), 'utf8').replace(/^﻿/, '')); } catch { return fallback; } }
export function write(name, data) { const file = path.join(LOCAL, name), tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data), 'utf8'); fs.renameSync(tmp, file); }
// 個股資料檔名就是股票代號（各市場格式不同，例如 2330、AAPL、BRK.B、7203、005930）
export const STOCK_FILE = /^([A-Za-z0-9][A-Za-z0-9.&\-]{0,15})\.json$/;
export const safeSymbol = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9.&\-]{0,15}$/.test(id) && !id.includes('..');
export function readStocks(ids = null) {
  const allowed = ids ? new Set(ids) : null, raw = {};
  for (const file of fs.readdirSync(path.join(LOCAL, 'stocks'))) { const id = STOCK_FILE.exec(file)?.[1]; if (id && (!allowed || allowed.has(id))) raw[id] = read(`stocks/${file}`, {}); }
  return raw;
}
