// 電腦版：持股健檢頁、策略回測頁與型態分區頁（畫面見 research-ui.js；股票名稱由 live.js 的 data-alert-stock 開啟個股視窗）
import { portfolioHTML, backtestHTML, shapesHTML } from './research-ui.js';
let C = null; // { api, toast, page }
const P = { info: null, error: '' }, B = { info: null, error: '' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errBox = e => e ? `<div class="notice err"><span>${String(e).replace(/[<>&]/g, '')}</span></div>` : '';
export function initPortfolio(ctx) { C = ctx; }
export function portfolioPage() { return `${errBox(P.error)}<section class="panel"><div class="contentpad rv-wrap" id="pf-box">${portfolioHTML(P.info, { editable: true })}</div></section>`; }
export function backtestPage() { return `${errBox(B.error)}<section class="panel"><div class="contentpad rv-wrap" id="bt-box">${backtestHTML(B.info)}</div></section>`; }
function repaint(page, box, html) { if (C.page() !== page) return; const el = document.getElementById(box); if (el) el.innerHTML = html(); else { const pc = document.getElementById('pagecontent'); if (pc) pc.innerHTML = page === 'portfolio' ? portfolioPage() : page === 'shapes' ? shapesPage() : backtestPage(); } }
const paintP = () => repaint('portfolio', 'pf-box', () => portfolioHTML(P.info, { editable: true })), paintB = () => repaint('backtest', 'bt-box', () => backtestHTML(B.info));
export async function enterPortfolio() { try { P.info = await C.api('portfolio'); P.error = ''; } catch (e) { P.error = e.message; } paintP(); if (P.info?.calendarBusy) pollCalendar(); }
let calPolling = false;
async function pollCalendar() { if (calPolling) return; calPolling = true; try { do { await sleep(4000); if (C.page() !== 'portfolio') return; P.info = await C.api('portfolio'); paintP(); } while (P.info?.calendarBusy); } catch { } finally { calPolling = false; } }
export async function enterBacktest() { try { B.info = await C.api('backtest'); B.error = ''; } catch (e) { B.error = e.message; } paintB(); if (B.info?.busy) pollBacktest(); }
let btPolling = false;
async function pollBacktest() { if (btPolling) return; btPolling = true; try { do { await sleep(2500); if (C.page() !== 'backtest') return; B.info = await C.api('backtest'); paintB(); } while (B.info?.busy); } catch { } finally { btPolling = false; } }
// 送出整份持股（新增或更新一檔、刪除一檔、改現金）
async function save(holdings, cash = P.info?.totals?.cash ?? null) {
  P.info = await C.api('portfolio', { holdings: holdings.map(({ id, shares, cost, stop, target, note, since }) => ({ id, shares, cost, stop, target, note, since })), cash }); P.error = ''; paintP(); if (P.info?.calendarBusy) pollCalendar();
}
const current = () => (P.info?.rows || []).map(r => ({ id: r.id, shares: r.shares, cost: r.cost, stop: r.stop, target: r.target, note: r.note, since: r.since }));
document.addEventListener('submit', async e => {
  const f = e.target.closest?.('[data-pf-form],[data-pf-cash]'); if (!f || !C) return; e.preventDefault();
  const v = Object.fromEntries(new FormData(f)), btn = f.querySelector('button'); if (btn) btn.disabled = true;
  try {
    if (f.matches('[data-pf-cash]')) { await save(current(), v.cash === '' ? null : v.cash); C.toast('現金部位已儲存'); return; }
    const id = String(v.id || '').trim().toUpperCase(), list = current().filter(h => h.id !== id), old = current().find(h => h.id === id);
    list.push({ id, shares: v.shares, cost: v.cost, stop: v.stop || null, target: v.target || null, since: old?.since || new Date().toISOString().slice(0, 10) });
    await save(list); C.toast(old ? `已更新 ${id}` : `已加入 ${id}`);
  } catch (err) { C.toast(err.message); } finally { if (btn) btn.disabled = false; }
});
document.addEventListener('click', async e => {
  if (!C || !['portfolio', 'backtest'].includes(C.page())) return;
  const b = e.target.closest('[data-pf-del],[data-bt-run]'); if (!b) return;
  try {
    if (b.dataset.pfDel) { const id = b.dataset.pfDel; await save(current().filter(h => h.id !== id)); C.toast(`已移除 ${id}`); return; }
    if (b.hasAttribute('data-bt-run')) { b.disabled = true; const hold = Number(document.querySelector('[data-bt-hold]')?.value) || 20; B.info = await C.api('backtest/run', { hold }); paintB(); pollBacktest(); }
  } catch (err) { C.toast(err.message); }
});

// 型態分區：分組卡片 → 點開看個股（點股票開 K 線，由 live.js 的 data-alert-stock 處理）
const SH = { info: null, detail: null, bias: '', scope: 'tech', error: '' };
export function shapesPage() { return `${errBox(SH.error)}<section class="panel"><div class="contentpad rv-wrap" id="sh-box">${shapesHTML(SH.info, SH, SH.detail)}</div></section>`; }
const paintS = () => repaint('shapes', 'sh-box', () => shapesHTML(SH.info, SH, SH.detail));
export async function enterShapes() { try { SH.info = await C.api('shapes?scope=' + SH.scope); SH.error = ''; } catch (e) { SH.error = e.message; } paintS(); }
document.addEventListener('click', async e => {
  if (!C || C.page() !== 'shapes') return;
  const b = e.target.closest('[data-sh-open],[data-sh-back],[data-sh-bias],[data-sh-scope]'); if (!b) return;
  try {
    if (b.dataset.shOpen) { SH.detail = await C.api(`shapes?scope=${SH.scope}&shape=${encodeURIComponent(b.dataset.shOpen)}`); paintS(); window.scrollTo(0, 0); return; }
    if (b.hasAttribute('data-sh-back')) { SH.detail = null; return paintS(); }
    if (b.dataset.shBias != null) { SH.bias = b.dataset.shBias; return paintS(); }
    if (b.dataset.shScope) { SH.scope = b.dataset.shScope; SH.detail = null; SH.info = null; paintS(); return enterShapes(); }
  } catch (err) { C.toast(err.message); }
});
