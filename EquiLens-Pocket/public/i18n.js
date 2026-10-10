// 介面多語系（電腦版與手機版共用）：繁體中文原文就是字典的 key，其他語言載入 /locales/<lang>.json。
// 1) t(text, params)：程式內明確翻譯（確認框、桌面通知、畫布文字）
// 2) 自動翻譯畫面：監看 DOM，把含中文的文字節點與 placeholder／title／aria-label 依字典換成目前語言；
//    含數字等變動部分的句子以樣板比對（字典 key 中的 {0}、{n} 代表任意文字，例如「已完成 {n} 檔更新」）。
//    標上 translate="no" 的區塊（例如使用者自訂的族群名稱）不翻譯。找不到翻譯時保留原文。
const CJK = /[㐀-鿿豈-﫿]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SPLIT = /(\s+[·｜|]\s+)/;
let lang = 'zh-TW', dict = null, exact = new Map(), patterns = [], cache = new Map(), observer = null;
export const missing = new Set(); // 開發用：畫面上找不到翻譯的中文

export const getLanguage = () => lang;
export function t(text, params) {
  let s = (dict && dict[text]) || text;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
  return s;
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile() {
  exact = new Map(); patterns = []; cache = new Map();
  for (const [k, v] of Object.entries(dict || {})) {
    if (typeof v !== 'string' || !v) continue;
    if (!/\{\w+\}/.test(k)) { exact.set(k, v); continue; }
    const names = [], parts = k.split(/(\{\w+\})/);
    const re = new RegExp('^' + parts.map(p => { const m = /^\{(\w+)\}$/.exec(p); if (m) { names.push(m[1]); return '(.*?)'; } return escRe(p); }).join('') + '$', 's');
    const lits = parts.filter(p => p && !/^\{\w+\}$/.test(p)), anchor = [...lits].sort((a, b) => b.length - a.length)[0] || '';
    if (anchor.trim()) patterns.push({ re, names, out: v, anchor, size: lits.join('').length });
  }
  patterns.sort((a, b) => b.size - a.size || b.names.length - a.names.length); // 字面較長（較具體）的樣板優先
}
function lookup(s) {
  const hit = exact.get(s); if (hit != null) return hit;
  for (const p of patterns) {
    if (!s.includes(p.anchor)) continue;
    const m = p.re.exec(s); if (!m) continue;
    return p.out.replace(/\{(\w+)\}/g, (x, k) => { const i = p.names.indexOf(k); if (i < 0) return x; const v = m[i + 1]; return CJK.test(v) ? (translateText(v.trim()) ?? v) : v; });
  }
  return null;
}
// 中文數量單位：其他語言改為 B（十億）／K（千），例如「1,234.5 億」→「123.45B」、「12 萬」→「120K」
const num = n => Number(String(n).replace(/,/g, '').replace('−', '-'));
const short = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '');
const units = s => s.replace(/([+\-−]?\d[\d,]*(?:\.\d+)?)\s?億(?:元)?/g, (m, n) => `${short(num(n) / 10)}B`).replace(/([+\-−]?\d[\d,]*(?:\.\d+)?)\s?萬(?![億])/g, (m, n) => `${short(num(n) * 10)}K`);
// 全形標點換成半形（其他語言）
const PUNCT = s => s.replace(/，/g, ', ').replace(/；/g, '; ').replace(/：/g, ': ').replace(/（/g, ' (').replace(/）/g, ')').replace(/、/g, ', ').replace(/。/g, '.');
// 翻譯一段畫面文字；無法翻譯時回傳 null（保留原文）
export function translateText(text) {
  if (!dict || !text || !CJK.test(text)) return null;
  const s = text.replace(/\s+/g, ' ').trim();
  if (cache.has(s)) return cache.get(s);
  let out = lookup(s);
  if (out != null) out = units(out);
  else { const u = units(s); if (u !== s) out = CJK.test(u) ? (lookup(u) ?? null) : u; }
  if (out == null) { // 前後的標點（例如「· 前值 55.4」「（4 週」）：只翻中間的文字
    const m = /^([\s·•｜|/、，,;；:：（(—–\-]*)(.*?)([\s·•｜|/、，,;；:：）)—–\-。]*)$/s.exec(s);
    if (m && (m[1] || m[3]) && CJK.test(m[2])) { const core = lookup(m[2]); if (core != null) out = units(PUNCT(m[1]) + core + PUNCT(m[3])); }
  }
  if (out == null && SPLIT.test(s)) { // 「A · B · C」分段翻譯
    const segs = s.split(SPLIT); let ok = false;
    out = segs.map(x => { if (!CJK.test(x) || SPLIT.test(x)) return x; const y = x.trim(), u = units(y), r = lookup(y) ?? (u !== y ? (CJK.test(u) ? lookup(u) : u) : null); if (r != null) { ok = true; return units(r); } return x; }).join('');
    if (!ok) out = null;
  }
  if (out == null) missing.add(s);
  if (cache.size > 20000) cache.clear();
  cache.set(s, out); return out;
}
// 畫布、確認框等非 DOM 文字：翻得到就用譯文
export const tx = text => translateText(text) ?? text;

// 已由翻譯寫入的值：再次觸發監看時不重複處理（譯文仍含中文時，例如公司名稱，才不會反覆改寫形成迴圈）
const written = new WeakMap();
function translateNode(node) {
  const v = node.nodeValue; if (!v || !CJK.test(v) || written.get(node) === v) return;
  const out = translateText(v); if (out == null) return;
  const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0], next = lead + out + trail;
  written.set(node, next); if (next !== v) node.nodeValue = next;
}
function translateAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a); if (!v || !CJK.test(v)) continue;
    const seen = written.get(el); if (seen?.[a] === v) continue;
    const out = translateText(v); if (out == null) continue;
    written.set(el, { ...(seen || {}), [a]: out }); if (out !== v) el.setAttribute(a, out);
  }
}
const skip = el => el.nodeType === 1 && (el.getAttribute('translate') === 'no' || ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE'].includes(el.tagName));
export function translateTree(root) {
  if (!dict || !root) return;
  if (root.nodeType === 3) { if (!root.parentElement?.closest('[translate="no"]')) translateNode(root); return; }
  if (root.nodeType !== 1 || skip(root) || root.closest?.('[translate="no"]')) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n; while ((n = walker.nextNode())) { if (n.nodeType === 3) translateNode(n); else translateAttrs(n); }
}
function observe() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree);
      else if (m.type === 'characterData') { if (!m.target.parentElement?.closest('[translate="no"]')) translateNode(m.target); }
      else if (m.type === 'attributes' && m.target.nodeType === 1 && !m.target.closest('[translate="no"]')) translateAttrs(m.target);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (document.title && CJK.test(document.title)) document.title = tx(document.title);
}
// 直接指定字典（測試或伺服器端已讀好字典時）
export function useDictionary(next, d) { lang = next || 'zh-TW'; dict = lang === 'zh-TW' ? null : d || {}; compile(); }
// 切換語言：載入字典並翻譯目前畫面；之後的畫面更新自動翻譯
export async function setLanguage(next, base = '') {
  lang = next || 'zh-TW';
  try { document.documentElement.lang = lang; } catch { }
  if (lang === 'zh-TW') { dict = null; exact = new Map(); patterns = []; cache = new Map(); return; }
  try { const r = await fetch(`${base}/locales/${lang}.json`, { cache: 'no-cache' }); dict = r.ok ? await r.json() : {}; } catch { dict = {}; }
  compile();
  if (typeof document !== 'undefined') { observe(); translateTree(document.body); } // 伺服器端（手機版推播文字）只用字典
}
if (typeof window !== 'undefined') window.__i18nMissing = () => [...missing];
