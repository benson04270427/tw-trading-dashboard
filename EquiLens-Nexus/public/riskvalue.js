// 電腦版：風控水位頁與低估選股頁（畫面見 riskvalue-ui.js；股票名稱由 live.js 的 data-alert-stock 開啟個股視窗）
import { riskHTML, valueHTML, moversHTML, picksHTML } from './riskvalue-ui.js';
let C = null; // { api, toast, page, reload }
const R = { info: null, error: '' }, V = { info: null, error: '', strategy: 'value', minTurnover: 1e7, scope: 'ai' };
export function initRiskValue(ctx) { C = ctx; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function repaint() { const pc = document.getElementById('pagecontent'); if (!pc || !['risk', 'value'].includes(C.page())) return; const y = window.scrollY; pc.innerHTML = C.page() === 'risk' ? riskPage() : valuePage(); window.scrollTo(0, y); }
const errBox = e => e ? `<div class="notice err"><span>${String(e).replace(/[<>&]/g, '')}</span></div>` : '';

export function riskPage() { return `${errBox(R.error)}<section class="panel"><div class="contentpad rv-wrap">${riskHTML(R.info)}</div></section>`; }
export function valuePage() { return `${errBox(V.error)}<section class="panel"><div class="contentpad rv-wrap">${valueHTML(V.info, { limit: 60 })}</div></section>`; }

// 首頁：每日精選與今日漲跌排行
const H = { movers: null, picks: null, tab: 'gainers', error: '' };
export function homeRank() { return `<div class="home-rank" id="home-rank">${homeRankInner()}</div>`; }
const homeRankInner = () => `<section class="panel"><div class="panelhead"><h2><span class="idx">★</span>每日精選 5 檔</h2></div><div class="contentpad rv-wrap" id="home-picks">${picksHTML(H.picks)}</div></section>
  <section class="panel"><div class="panelhead"><h2><span class="idx">↕</span>今日漲跌排行</h2></div><div class="contentpad rv-wrap" id="home-movers">${moversHTML(H.movers, { tab: H.tab })}</div></section>`;
function repaintHome() { const el = document.getElementById('home-rank'); if (el && C.page() === 'home') el.innerHTML = homeRankInner(); }
export async function enterHome() { try { [H.movers, H.picks] = await Promise.all([C.api('movers'), C.api('picks')]); } catch (e) { H.error = e.message; } repaintHome(); if (H.picks?.busy) pollPicks(); }
let picksPolling = false;
async function pollPicks() { if (picksPolling) return; picksPolling = true; try { do { await sleep(3000); if (C.page() !== 'home') return; H.picks = await C.api('picks'); repaintHome(); } while (H.picks?.busy); } finally { picksPolling = false; } }
setInterval(async () => { if (C?.page() === 'home' && H.movers?.source === 'live' && !document.hidden) { try { H.movers = await C.api('movers'); repaintHome(); } catch { } } }, 60e3);

let riskPolling = false, valuePolling = false;
export async function enterRisk() { try { R.info = await C.api('risk'); R.error = ''; } catch (e) { R.error = e.message; } repaint(); if (R.info?.busy) pollRisk(); }
async function pollRisk() { if (riskPolling) return; riskPolling = true; try { do { await sleep(3000); if (C.page() !== 'risk') return; R.info = await C.api('risk'); repaint(); } while (R.info?.busy); if (R.info?.data?.available && !R.info.error) C.toast('風控水位已更新'); } catch (e) { R.error = e.message; repaint(); } finally { riskPolling = false; } }
const valueQuery = () => `value?strategy=${V.strategy}&minTurnover=${V.minTurnover}&scope=${V.scope}`;
export async function enterValue() { try { V.info = await C.api(valueQuery()); V.strategy = V.info.strategy; V.minTurnover = V.info.minTurnover; V.scope = V.info.scope || V.scope; V.error = ''; } catch (e) { V.error = e.message; } repaint(); if (V.info?.busy) pollValue(); }
async function pollValue() { if (valuePolling) return; valuePolling = true; try { do { await sleep(3000); if (C.page() !== 'value') return; V.info = await C.api(valueQuery()); repaint(); } while (V.info?.busy); if (V.info?.result && !V.info.error) C.toast('選股資料已更新'); } catch (e) { V.error = e.message; repaint(); } finally { valuePolling = false; } }

document.addEventListener('click', async e => {
  if (!C || !['risk', 'value', 'home'].includes(C.page())) return;
  const b = e.target.closest('[data-rv],[data-rv-strategy],[data-rv-scope],[data-rv-watch],[data-rv-mtab]'); if (!b) return;
  try {
    if (C.page() === 'home') {
      if (b.dataset.rvMtab) { H.tab = b.dataset.rvMtab; repaintHome(); return; }
      if (b.dataset.rvWatch) { const id = b.dataset.rvWatch, on = !b.classList.contains('on'); await C.api('watch/set', { id, on }); C.toast(on ? '已加入自選' : '已從自選移除'); C.reload?.(); return enterHome(); }
      if (b.dataset.rv === 'picks-query') { b.disabled = true; H.picks = await C.api('picks/query', {}); repaintHome(); return pollPicks(); }
      return;
    }
    if (b.dataset.rvScope) { V.scope = b.dataset.rvScope; V.info = await C.api(valueQuery()); repaint(); return; }
    if (b.dataset.rvStrategy) { V.strategy = b.dataset.rvStrategy; V.info = await C.api(valueQuery()); repaint(); return; }
    if (b.dataset.rvWatch) { const id = b.dataset.rvWatch, on = !b.classList.contains('on'); await C.api('watch/set', { id, on }); V.info = await C.api(valueQuery()); repaint(); C.toast(on ? '已加入自選' : '已從自選移除'); C.reload?.(); return; }
    const a = b.dataset.rv;
    if (a === 'risk-query') { b.disabled = true; R.info = await C.api('risk/query', {}); repaint(); pollRisk(); }
    if (a === 'risk-explain') { b.disabled = true; b.innerHTML = '<i class="spinner"></i>產生中…'; await C.api('risk/explain', {}); R.info = await C.api('risk'); repaint(); }
    if (a === 'value-query') { b.disabled = true; V.info = await C.api('value/query', {}); V.info = await C.api(valueQuery()); repaint(); pollValue(); }
  } catch (err) { C.toast(err.message); if (C.page() === 'risk') R.info = await C.api('risk').catch(() => R.info); repaint(); }
});
document.addEventListener('change', async e => {
  if (!C || C.page() !== 'value' || e.target.id !== 'rv-turnover') return;
  V.minTurnover = Number(e.target.value); try { V.info = await C.api(valueQuery()); } catch (err) { V.error = err.message; } repaint();
});
