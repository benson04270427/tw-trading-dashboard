// 衡析 Pocket：依螢幕形狀決定版面（一般手機、摺疊手機的封面與展開螢幕、平板、橫向手機）。
// phone：單頁（底部分頁列，個股從下方滑出）
// split：左右雙頁（左頁＝側邊分頁列＋清單，右頁＝走勢／個股）；展開的摺疊手機摺痕在中間，剛好一頁一邊
// stack：上下雙頁（上頁＝走勢，下頁＝清單＋底部分頁列）；直向展開或半摺立在桌上當看盤架
// 瀏覽器回報摺痕位置（Viewport Segments API，Android Chrome 138 起）時依摺痕分頁，否則依寬高判斷。
export const LAYOUT_PREFS = ['auto', 'split', 'stack', 'phone'];
export const RAIL = 72, MAIN_MIN = 340, PANE_MIN = 300, STACK_MIN_H = 640;
const SPLIT_MIN_W = RAIL + MAIN_MIN + PANE_MIN; // 712

// 純計算（測試用）：w、h 為 CSS 像素；segments 為瀏覽器回報的畫面區段（DOMRect 陣列，沒有摺痕時為 null）
// 回傳 { mode, left, top, gap, source }：left＝左頁寬（split）、top＝上頁高（stack）、gap＝摺痕寬度、source＝hinge／size／pref
export function decideLayout({ w, h, segments = null, pref = 'auto' }) {
  const phone = source => ({ mode: 'phone', left: 0, top: 0, gap: 0, source });
  // 依摺痕分頁時完全對齊摺痕（內容不跨過摺痕）；依寬高分頁時，左頁至少留給清單 340px、副頁至少 300px
  const split = (left = w / 2, gap = 0, source = 'size') => {
    if (source !== 'hinge') left = Math.min(Math.max(left, RAIL + MAIN_MIN), w - gap - PANE_MIN);
    return { mode: 'split', left: Math.round(left), top: 0, gap: Math.round(gap), source };
  };
  const stack = (top = h / 2, gap = 0, source = 'size') => {
    if (source !== 'hinge') top = Math.min(Math.max(top, 240), h - gap - 300);
    return { mode: 'stack', left: 0, top: Math.round(top), gap: Math.round(gap), source };
  };
  const canSplit = w >= SPLIT_MIN_W && h >= 360, canStack = h >= STACK_MIN_H && w >= 360;
  if (pref === 'phone') return phone('pref');
  // 摺痕：左右兩段＝直立的書本式摺痕；上下兩段＝桌上半摺（看盤架）
  const seg = Array.isArray(segments) && segments.length === 2 ? segments.slice().sort((a, b) => a.x - b.x || a.y - b.y) : null;
  const hinge = seg ? (seg[1].x > seg[0].x ? { kind: 'split', at: seg[0].x + seg[0].width, gap: seg[1].x - seg[0].x - seg[0].width, ok: seg[0].width >= 280 && seg[1].width >= 280 && h >= 360 }
    : { kind: 'stack', at: seg[0].y + seg[0].height, gap: seg[1].y - seg[0].y - seg[0].height, ok: seg[0].height >= 200 && seg[1].height >= 240 && w >= 360 }) : null;
  // 指定的版面放不下時改用自動判斷（source 註明原因）
  if (pref === 'split') return hinge?.kind === 'split' && hinge.ok ? split(hinge.at, hinge.gap, 'hinge') : canSplit ? split(w / 2, 0, 'pref') : { ...decideLayout({ w, h, segments }), source: 'narrow' };
  if (pref === 'stack') return hinge?.kind === 'stack' && hinge.ok ? stack(hinge.at, hinge.gap, 'hinge') : canStack ? stack(h / 2, 0, 'pref') : { ...decideLayout({ w, h, segments }), source: 'short' };
  if (hinge?.ok) return hinge.kind === 'split' ? split(hinge.at, hinge.gap, 'hinge') : stack(hinge.at, hinge.gap, 'hinge');
  if (w < 600) return phone('size');
  // 橫向或夠寬：左右雙頁；直向但不夠寬（例如摺疊手機直向展開）：上下雙頁
  if (canSplit && (w >= h || w >= SPLIT_MIN_W)) return split();
  if (canStack) return stack();
  return phone('size');
}

/* ---------- 瀏覽器端：套用到 <html data-layout data-pane> 與 CSS 變數 ---------- */
const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const read = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, write = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
let cur = { mode: 'phone', left: 0, top: 0, gap: 0, source: 'size', w: 0, h: 0 }, paneHidden = hasDOM && read('pocket.pane', 'on') === 'off';
const listeners = new Set();
export const layoutPref = () => { const p = hasDOM ? read('pocket.layout', 'auto') : 'auto'; return LAYOUT_PREFS.includes(p) ? p : 'auto'; };
export const layout = () => cur;
export const docked = () => cur.mode !== 'phone' && !paneHidden; // 右頁／上頁正在顯示
export const paneHiddenNow = () => cur.mode !== 'phone' && paneHidden;
export function onLayout(fn) { listeners.add(fn); }
export function setLayoutPref(p) { write('pocket.layout', LAYOUT_PREFS.includes(p) ? p : 'auto'); applyLayout(true); }
export function setPaneHidden(v) { if (paneHidden === !!v) return; paneHidden = !!v; write('pocket.pane', v ? 'off' : 'on'); applyLayout(true); }
function segments() { const s = hasDOM && window.viewport?.segments; return Array.isArray(s) && s.length > 1 ? [...s].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })) : null; }
let timer = null;
export function applyLayout(force = false) {
  if (!hasDOM) return cur;
  const w = window.innerWidth, h = window.innerHeight, next = { ...decideLayout({ w, h, segments: segments(), pref: layoutPref() }), w, h };
  const root = document.documentElement, prev = cur; cur = next;
  root.dataset.layout = next.mode; root.dataset.pane = docked() ? 'on' : 'off';
  root.style.setProperty('--left-w', next.left + 'px'); root.style.setProperty('--right-w', (w - next.left) + 'px');
  root.style.setProperty('--top-h', next.top + 'px'); root.style.setProperty('--gap', next.gap + 'px');
  const changed = force || prev.mode !== next.mode || prev.left !== next.left || prev.top !== next.top || prev.w !== w || prev.h !== h;
  if (changed) { clearTimeout(timer); timer = setTimeout(() => listeners.forEach(fn => { try { fn(cur, prev); } catch (e) { console.error(e); } }), force ? 0 : 120); }
  return cur;
}
if (hasDOM) {
  applyLayout();
  let raf = 0; const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => applyLayout()); };
  window.addEventListener('resize', kick); window.addEventListener('orientationchange', kick);
  for (const q of ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']) try { matchMedia(q).addEventListener('change', kick); } catch { }
  try { navigator.devicePosture?.addEventListener('change', kick); } catch { }
}
