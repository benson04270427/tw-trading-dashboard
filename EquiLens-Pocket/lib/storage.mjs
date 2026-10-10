import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL = process.env.MOBILE_DATA_DIR || path.join(ROOT, '.local');
fs.mkdirSync(LOCAL, { recursive: true });
export function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(LOCAL, name), 'utf8').replace(/^﻿/, '')); } catch { return fallback; } }
export function write(name, data) { const file = path.join(LOCAL, name), tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(tmp, file); }
