// 多語系字串擷取：從程式碼找出會顯示在畫面上的中文字串（字串、樣板字串、HTML 文字與 placeholder／title／aria-label），
// 轉成字典 key（樣板中的 ${…} 依序改為 {0}、{1}…；程式內 t('…', {name}) 的 key 原樣保留）。
// 用法：node tools/i18n-keys.mjs [--missing en]   列出全部 key，或列出指定語言字典缺少的 key
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CJK = /[㐀-鿿豈-﫿]/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 逐字掃描 JS：回傳字串與樣板字串的內容（樣板中的運算式以 \u0000 標記，巢狀樣板另外收錄）
export function literals(src) {
  const out = [];
  let i = 0, prev = '';
  const regexOK = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(prev);
  function readString(q) { let s = ''; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { s += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; } if (src[i] === '\n') break; s += src[i++]; } i++; return s; }
  function readTemplate() {
    let s = ''; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; readCode('}'); s += '\u0000'; continue; }
      s += src[i++];
    }
    i++; return s;
  }
  // 讀到對應的結束括號為止（處理巢狀字串與樣板）
  function readCode(end) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === end && depth === 0) { i++; prev = end; return; }
      if (c === '{' ) depth++; else if (c === '}') depth--;
      if (step()) continue;
      i++;
    }
  }
  function step() {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; return true; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; return true; }
    if (c === '"' || c === "'") { out.push({ text: readString(c), template: false }); prev = 'x'; return true; }
    if (c === '`') { out.push({ text: readTemplate(), template: true }); prev = 'x'; return true; }
    if (c === '/' && regexOK()) { i++; let cls = false; while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; } i++; while (/[a-z]/i.test(src[i] || '')) i++; prev = 'x'; return true; }
    if (!/\s/.test(c)) prev = (/[\w$]/.test(c) ? (prev.match(/[\w$]*$/)?.[0] || '') + c : c);
    return false;
  }
  while (i < src.length) { if (!step()) i++; }
  return out;
}

// 一段字串 → 畫面上的文字片段：依 HTML 標籤切開，取出屬性中的提示文字
export function segments(text) {
  const keys = [];
  const add = s => { let n = 0; const k = s.replace(/\u0000/g, () => `{${n++}}`).replace(/\s+/g, ' ').trim(); if (CJK.test(k)) keys.push(k); };
  const tagRe = /<[a-zA-Z/!][^<>]*>/g; let last = 0, m;
  while ((m = tagRe.exec(text))) {
    add(text.slice(last, m.index)); last = tagRe.lastIndex;
    for (const a of m[0].matchAll(/\b(?:placeholder|title|aria-label|alt|data-tip)="([^"]*)"/g)) add(a[1]);
  }
  add(text.slice(last));
  return keys;
}
// 文字片段若以「 · 」等分隔，各段也可能分開出現在畫面上
const SPLIT = /\s+[·｜|]\s+/;

export function keysOf(file) {
  const src = fs.readFileSync(file, 'utf8'), keys = new Set();
  if (file.endsWith('.html')) { for (const k of segments(src.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<meta[^>]*>/g, ''))) keys.add(k); return keys; }
  for (const lit of literals(src)) {
    if (!CJK.test(lit.text)) continue;
    for (const k of segments(lit.text)) { keys.add(k); if (SPLIT.test(k)) for (const p of k.split(SPLIT)) if (CJK.test(p)) keys.add(p.trim()); }
  }
  return keys;
}
export function sourceFiles() {
  const list = [];
  const walk = (dir, re) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f), st = fs.statSync(p); if (st.isDirectory()) walk(p, re); else if (re.test(f)) list.push(p); } };
  walk(path.join(ROOT, 'public'), /\.(js|html)$/); walk(path.join(ROOT, 'lib'), /\.mjs$/); list.push(path.join(ROOT, 'server.mjs'));
  const pocket = path.join(ROOT, '..', 'EquiLens-Pocket');
  if (fs.existsSync(pocket)) { walk(path.join(pocket, 'public'), /\.(js|html)$/); for (const f of fs.readdirSync(pocket)) if (/\.mjs$/.test(f)) list.push(path.join(pocket, f)); if (fs.existsSync(path.join(pocket, 'lib'))) walk(path.join(pocket, 'lib'), /\.mjs$/); }
  return list;
}
export function allKeys() { const keys = new Set(); for (const f of sourceFiles()) for (const k of keysOf(f)) keys.add(k); return [...keys].sort(); }
export function missing(lang) {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.json`), 'utf8'));
  return allKeys().filter(k => !(k in dict));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--missing');
  const list = i > 0 ? missing(process.argv[i + 1] || 'en') : allKeys();
  if (process.argv.includes('--json')) console.log(JSON.stringify(list, null, 1)); else console.log(list.join('\n'));
  console.error(`${list.length} keys`);
}
