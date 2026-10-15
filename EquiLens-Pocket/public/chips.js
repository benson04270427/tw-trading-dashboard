// 衡析 Pocket：籌碼分頁的「分點追蹤」與「大戶排行」（台股 FinMind Sponsor）。資料與設定都在電腦上的 Nexus，手機可查看、查詢與調整追蹤分點。
import { esc, branchRulesForm, chipwatchHTML, branchChips, branchSearchHTML, holderRankHTML } from './insight-ui.js';
import { t } from './i18n.js';

let C = null; // { api, toast, draw, S }
const W = { info: null, rank: null, scope: 'mine', found: null, q: '', loading: false, hloading: false, error: '' };
export function initChips(ctx) { C = ctx; }
const redraw = () => { if (C.S.tab === 'flows' && C.S.flows.view !== 'inst') C.draw(); };
export async function loadChips(force = false) {
  try {
    if (C.S.flows.view === 'brokers' && (!W.info || force)) W.info = await C.api('api/chipwatch');
    if (C.S.flows.view === 'holders' && (!W.rank || force)) W.rank = await C.api('api/holders/rank?scope=' + W.scope);
    W.error = '';
  } catch (e) { if (!e.silent) W.error = e.message; }
}

export function brokersView() {
  const i = W.info;
  if (!i) return W.error ? `<div class="notice err">${esc(W.error)}</div>` : '<div class="empty"><span class="spinner"></span> 讀取中…</div>';
  if (!i.capable) return '<div class="notice">分點追蹤需要 FinMind Sponsor 方案。</div>';
  const s = i.settings;
  return `<section class="card"><div class="card-h"><h2>🏦 追蹤分點<small>最多 ${i.maxBranches} 個</small></h2></div><div class="card-b ix-cw-set">${branchChips(s)}
    <form class="ix-cw-search" data-cw-search><input name="q" value="${esc(W.q)}" placeholder="搜尋分點名稱或代號" maxlength="30" aria-label="搜尋券商分點"><button type="submit">搜尋</button></form>
    ${W.found ? branchSearchHTML(W.found, s) : ''}
    <div class="ix-cw-opts"><label class="checkbox"><input type="checkbox" data-cw-opt="auto" ${s.auto ? 'checked' : ''}> 平日 18:30 後自動查詢並推播</label>
${branchRulesForm(s)}</div></div></section>
    ${W.error ? `<div class="notice err">${esc(W.error)}</div>` : ''}${i.error && !i.busy ? `<div class="notice warn">${esc(i.error)}</div>` : ''}
    <section class="card"><div class="card-h"><h2>盤後進出</h2>${i.dates?.length ? `<select class="sel" data-cw-date aria-label="紀錄日期">${i.dates.slice().reverse().map(d => `<option ${d === i.report?.date ? 'selected' : ''}>${d}</option>`).join('')}</select>` : ''}</div>
    <div class="card-b"><button class="btn block primary" style="margin-bottom:12px" data-cw="query" ${W.loading || i.busy || !s.branches.length ? 'disabled' : ''}>${W.loading || i.busy ? '<span class="spinner"></span> 查詢中…' : '⟳ 立即查詢最新交易日'}</button>${chipwatchHTML(i)}</div></section>`;
}
export function holdersView() {
  const r = W.rank;
  if (!r) return W.error ? `<div class="notice err">${esc(W.error)}</div>` : '<div class="empty"><span class="spinner"></span> 讀取中…</div>';
  if (!r.capable) return '<div class="notice">大戶排行需要 FinMind Sponsor 方案。</div>';
  return `<div class="seg" style="margin-bottom:10px">${[['mine', '自選＋研究'], ['market', '全市場']].map(([v, l]) => `<button class="${W.scope === v ? 'on' : ''}" data-hr-scope="${v}">${l}</button>`).join('')}</div>
    ${r.error ? `<div class="notice warn">${esc(r.error)}</div>` : ''}
    <section class="card"><div class="card-h"><h2>🐋 千張大戶集中度</h2></div><div class="card-b">${holderRankHTML(r.rank, { limit: W.scope === 'market' ? 40 : 200 })}
    <button class="btn block" data-hr="query" ${W.hloading || r.busy ? 'disabled' : ''} style="margin-top:10px">${W.hloading || r.busy ? '<span class="spinner"></span> 更新中…' : '⟳ 檢查新的一週'}</button></div></section>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !C || C.S.tab !== 'flows') return; const ds = b.dataset;
  const save = async patch => { W.info = { ...W.info, ...(await C.api('api/chipwatch/settings', patch)) }; redraw(); };
  try {
    if (ds.cwAdd) { await save({ branches: [...W.info.settings.branches, { id: ds.cwAdd, name: ds.name }] }); return C.toast(t('已追蹤 {name}', { name: ds.name })); }
    if (ds.cwDel) { await save({ branches: W.info.settings.branches.filter(x => x.id !== ds.cwDel) }); return C.toast('已移除追蹤分點'); }
    if (ds.cw === 'query') { W.loading = true; W.error = ''; redraw(); try { W.info = await C.api('api/chipwatch/query', {}); C.toast('分點追蹤已更新'); } catch (err) { if (!err.silent) W.error = err.message; } finally { W.loading = false; redraw(); } return; }
    if (ds.hrScope) { W.scope = ds.hrScope; W.rank = null; redraw(); await loadChips(); return redraw(); }
    if (ds.hr === 'query') { W.hloading = true; redraw(); try { await C.api('api/holders/rank/query', {}); W.rank = await C.api('api/holders/rank?scope=' + W.scope); C.toast('大戶資料已更新'); } catch (err) { if (!err.silent) C.toast(err.message); } finally { W.hloading = false; redraw(); } return; }
  } catch (err) { if (!err.silent) C.toast(err.message); }
});
document.addEventListener('submit', async e => {
  const f = e.target; if (!C || !('cwSearch' in f.dataset)) return; e.preventDefault();
  W.q = f.elements.q.value.trim(); if (!W.q) return;
  try { W.found = (await C.api('api/chipwatch/branches?q=' + encodeURIComponent(W.q))).branches; } catch (err) { if (!err.silent) C.toast(err.message); }
  redraw();
});
document.addEventListener('change', async e => {
  const el = e.target; if (!C || C.S.tab !== 'flows') return;
  try {
    if (el.dataset.cwOpt) { W.info = { ...W.info, ...(await C.api('api/chipwatch/settings', { [el.dataset.cwOpt]: el.type === 'checkbox' ? el.checked : Number(el.value) })) }; C.toast('設定已儲存'); redraw(); }
    if ('cwDate' in el.dataset) { W.info = await C.api('api/chipwatch?date=' + el.value); redraw(); }
  } catch (err) { if (!err.silent) C.toast(err.message); }
});
