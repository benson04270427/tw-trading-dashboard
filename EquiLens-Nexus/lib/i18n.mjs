// 多語系：以繁體中文原文當作 key（gettext 方式），其他語言的翻譯放在 public/locales/<lang>.json，
// 參數以 {name} 標記。伺服器依本機設定的語言翻譯（錯誤訊息、推播、雷達事件文字）；前端共用同一份字典（public/i18n.js）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './storage.mjs';
import { language } from './config.mjs';

const dicts = new Map();
export function dictionary(lang) {
  if (lang === 'zh-TW') return null;
  if (!dicts.has(lang)) { try { dicts.set(lang, JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.json`), 'utf8'))); } catch { dicts.set(lang, {}); } }
  return dicts.get(lang);
}
export function t(text, params, lang = language()) {
  const d = dictionary(lang);
  let s = (d && d[text]) || text;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
  return s;
}
// 可以直接顯示給使用者的錯誤（訊息已依語言翻譯）；其他未預期的錯誤只顯示通用訊息
export class UserError extends Error {
  constructor(message, params, status = 400) { super(t(message, params)); this.expose = true; this.status = status; }
}
export const fail = (message, params, status) => { throw new UserError(message, params, status); };
export const isUserError = e => !!e?.expose;
