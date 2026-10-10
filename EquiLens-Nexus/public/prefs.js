// 介面與使用偏好（存在這台電腦的瀏覽器）：主題、字型大小、霓虹效果、動畫、彈窗提示、桌面通知、預設頁面。
const KEY = 'nexus.prefs';
export const DEFAULTS = { theme: 'dark', font: 15, glow: 'full', motion: true, toast: true, toastSec: 5.5, start: 'home' };
export const START_PAGES = [['home', '今日焦點'], ['heatmap', '資金熱浪'], ['live', '盤中雷達'], ['overview', '研究總覽'], ['watchlist', '自選追蹤']];
let prefs = load();
function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
export const getPrefs = () => prefs;
export function setPrefs(patch) { prefs = { ...prefs, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { } applyPrefs(); return prefs; }
const systemLight = () => matchMedia('(prefers-color-scheme: light)').matches;
export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === 'system' ? (systemLight() ? 'light' : 'dark') : prefs.theme;
  root.dataset.glow = prefs.glow; root.dataset.motion = prefs.motion ? 'on' : 'off';
  root.style.fontSize = `${prefs.font}px`;
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (prefs.theme === 'system') applyPrefs(); });
applyPrefs();

const notifyOn = () => { try { return localStorage.getItem('nexus.notify') === '1' && Notification.permission === 'granted'; } catch { return false; } };
export function prefsPanel(esc) {
  const p = prefs, seg = (key, opts) => `<div class="segmented" role="group">${opts.map(([v, l]) => `<button type="button" data-pref="${key}" data-value="${v}" class="${String(p[key]) === String(v) ? 'selected' : ''}" aria-pressed="${String(p[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  const row = (title, desc, ctl) => `<div class="pref-row"><div><b>${title}</b><small>${desc}</small></div><div class="pref-ctl">${ctl}</div></div>`;
  return `<section class="panel contentpad prefs"><h2>介面與使用偏好 <span class="tag cyan">只存在這台電腦的瀏覽器</span></h2><p>變更立即生效。字型大小會同時放大表格與面板文字；熱浪圖維持深色底以保留色階辨識度。</p>
  ${row('主題', '深色霓虹適合長時間盯盤；淺色適合白天或明亮環境。', seg('theme', [['dark', '深色霓虹'], ['light', '淺色'], ['system', '跟隨系統']]))}
  ${row('字型大小', '整體介面文字大小。', seg('font', [[13, '小'], [15, '標準'], [17, '大'], [19, '特大']]))}
  ${row('霓虹效果', '柔和模式會關閉發光與掃描線，閱讀更舒適。', seg('glow', [['full', '完整'], ['soft', '柔和']]))}
  ${row('動畫效果', '關閉後頁面切換與載入不播放動畫。', seg('motion', [[true, '開啟'], [false, '關閉']]))}
  ${row('彈窗提示', '右下角的操作結果與錯誤提示。', `${seg('toast', [[true, '顯示'], [false, '不顯示']])}${seg('toastSec', [[3, '3 秒'], [5.5, '5.5 秒'], [8, '8 秒']])}`)}
  ${row('桌面通知', '盤中雷達異動與 AI 日報以 Windows 通知提醒（需瀏覽器允許）。', `<button type="button" data-live="notify">${notifyOn() ? '🔔 已開啟（點此關閉）' : '🔕 開啟桌面通知'}</button>`)}
  ${row('開啟時的頁面', '每次開啟衡析 Nexus 先顯示的頁面。', `<select data-pref-select="start">${START_PAGES.map(([v, l]) => `<option value="${v}" ${p.start === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
  <div class="form-actions"><button type="button" data-pref-reset>恢復預設</button></div></section>`;
}
