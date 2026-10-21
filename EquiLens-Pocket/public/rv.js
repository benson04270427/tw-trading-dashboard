// 手機版：盤勢分頁的風控水位卡片（完整分析開在底部視窗）與型態分頁的「低估選股」（畫面見 riskvalue-ui.js）
import { riskHTML, valueHTML } from './riskvalue-ui.js';
let X = null; // { api, toast, draw, S, openSheet, $ }
const R = { info: null, error: '', sheet: false }, V = { info: null, error: '', strategy: 'value', minTurnover: 1e7 };
export function initRV(ctx) { X = ctx; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errLine = e => e ? `<div class="notice warn">${String(e).replace(/[<>&]/g, '')}</div>` : '';

export function riskCard() {
  if (R.info && !R.info.capable) return '';
  return `<section class="card"><div class="card-h"><h2>風控水位<small>${R.info?.data?.date || ''}</small></h2><button class="more" data-rv="risk-open">完整分析 ›</button></div><div class="card-b rv-wrap">${errLine(R.error)}${riskHTML(R.info, { compact: true })}</div></section>`;
}
export function valueView() { return `${errLine(V.error)}<div class="rv-wrap">${valueHTML(V.info, { limit: 40 })}</div>`; }
const sheetBody = () => `<div class="rv-wrap">${errLine(R.error)}${riskHTML(R.info)}</div>`;
function repaintSheet() { if (R.sheet && X.$('#sheet')?.classList.contains('open')) { const b = X.$('#sheet-body'), y = b.scrollTop; b.innerHTML = sheetBody(); b.scrollTop = y; } else R.sheet = false; }
const redraw = () => { if (R.sheet) repaintSheet(); X.draw(); };

export async function loadRisk() { try { R.info = await X.api('api/risk'); R.error = ''; } catch (e) { if (!e.silent) R.error = e.message; } if (R.info?.busy) pollRisk(); }
let rp = false, vp = false;
async function pollRisk() { if (rp) return; rp = true; try { do { await sleep(3000); R.info = await X.api('api/risk'); if (X.S.tab === 'home') redraw(); } while (R.info?.busy); } catch (e) { R.error = e.message; } finally { rp = false; if (X.S.tab === 'home') redraw(); } }
const vq = () => `api/value?strategy=${V.strategy}&minTurnover=${V.minTurnover}`;
export async function loadValue() { try { V.info = await X.api(vq()); V.strategy = V.info.strategy; V.minTurnover = V.info.minTurnover; V.error = ''; } catch (e) { if (!e.silent) V.error = e.message; } if (V.info?.busy) pollValue(); }
async function pollValue() { if (vp) return; vp = true; try { do { await sleep(3000); V.info = await X.api(vq()); if (X.S.tab === 'patterns') X.draw(); } while (V.info?.busy); } catch (e) { V.error = e.message; } finally { vp = false; if (X.S.tab === 'patterns') X.draw(); } }

document.addEventListener('click', async e => {
  if (!X) return;
  const b = e.target.closest('[data-rv],[data-rv-strategy],[data-rv-watch]'); if (!b) return;
  e.stopPropagation();
  try {
    if (b.dataset.rvStrategy) { V.strategy = b.dataset.rvStrategy; V.info = await X.api(vq()); X.draw(); return; }
    if (b.dataset.rvWatch) { const id = b.dataset.rvWatch, on = !b.classList.contains('on'); await X.api('api/watch', { id, on }); X.S.stocks = null; X.S.summary = null; V.info = await X.api(vq()); X.draw(); X.toast(on ? '已加入自選' : '已移除自選'); return; }
    const a = b.dataset.rv;
    if (a === 'risk-open') { R.sheet = true; X.openSheet('風控水位', sheetBody()); return; }
    if (a === 'risk-query') { b.disabled = true; R.info = await X.api('api/risk/query', {}); redraw(); pollRisk(); return; }
    if (a === 'risk-explain') { b.disabled = true; b.innerHTML = '<i class="spinner"></i>產生中…'; await X.api('api/risk/explain', {}); R.info = await X.api('api/risk'); redraw(); return; }
    if (a === 'value-query') { b.disabled = true; await X.api('api/value/query', {}); V.info = await X.api(vq()); X.draw(); pollValue(); return; }
  } catch (err) { if (!err.silent) X.toast(err.message); R.info = await X.api('api/risk').catch(() => R.info); redraw(); }
}, true);
document.addEventListener('change', async e => {
  if (!X || e.target.id !== 'rv-turnover') return;
  V.minTurnover = Number(e.target.value); try { V.info = await X.api(vq()); } catch (err) { V.error = err.message; } X.draw();
});
