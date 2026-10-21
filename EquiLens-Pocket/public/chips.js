// 衡析 Pocket：籌碼分頁的「分點追蹤」與「大戶排行」（台股 FinMind Sponsor）。資料與設定都在電腦上的 Nexus，手機可查看、查詢與調整追蹤分點。
import { esc, branchRulesForm, chipwatchHTML, cwDateHTML, branchChips, branchSearchHTML, holderRankHTML } from './insight-ui.js';
import { t } from './i18n.js';

let C = null; // { api, toast, draw, S }
// date：正在檢視的紀錄日期（空白＝最新）；picking：展開「其他日期」的日期欄位
const W = { info: null, rank: null, scope: 'mine', found: null, q: '', loading: false, hloading: false, error: '', date: '', picking: false, pickDate: '' };
export function initChips(ctx) { C = ctx; }
const redraw = () => { if (C.S.tab === 'flows' && C.S.flows.view !== 'inst') C.draw(); };
export async function loadChips(force = false) {
  try {
    if (C.S.flows.view === 'brokers' && (!W.info || force)) { await loadInfo(W.date); if (W.info?.busy) poll(); }
    if (C.S.flows.view === 'holders' && (!W.rank || force)) W.rank = await C.api('api/holders/rank?scope=' + W.scope);
    W.error = '';
  } catch (e) { if (!e.silent) W.error = e.message; }
}
async function loadInfo(date) { W.date = date || ''; W.error = ''; W.info = await C.api('api/chipwatch' + (W.date ? '?date=' + W.date : '')); }
// 查詢在 Nexus 背景執行：每 3 秒取一次進度，完成後顯示該日紀錄或原因
const sleep = ms => new Promise(r => setTimeout(r, ms));
let polling = false;
async function poll() {
  if (polling) return; polling = true;
  try {
    while (W.info?.busy) { await sleep(3000); if (C.S.tab !== 'flows' || C.S.flows.view !== 'brokers') return; W.info = await C.api('api/chipwatch?date=' + (W.info.query?.date || W.date)); redraw(); }
    W.date = W.info?.date || W.date;
    if (W.loading && !W.info?.error && W.info?.report) C.toast('分點追蹤已更新'); // 失敗或尚未公布的原因由 info.error 顯示
  } catch (e) { if (!e.silent) W.error = e.message; } finally { polling = false; W.loading = false; redraw(); }
}
async function startQuery(date) {
  W.loading = true; W.error = ''; W.picking = false; redraw();
  try { W.info = await C.api('api/chipwatch/query', date ? { date } : {}); W.date = W.info.date || date || ''; redraw(); await poll(); }
  catch (err) { if (!err.silent) W.error = err.message; W.loading = false; redraw(); }
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
    <section class="card"><div class="card-h"><h2>盤後進出</h2>${cwDateHTML(i, { ...W, cls: 'sel' })}</div>
    <div class="card-b"><button class="btn block primary" style="margin-bottom:12px" data-cw="query" ${W.loading || i.busy || !s.branches.length ? 'disabled' : ''}>${W.loading || i.busy ? '<span class="spinner"></span> 查詢中…' : '⟳ 查詢最新交易日'}</button>${chipwatchHTML(i)}</div></section>`;
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
  // 儲存設定只更新設定，不改變正在檢視的日期
  const save = async patch => { const r = await C.api('api/chipwatch/settings', patch); W.info = { ...W.info, settings: r.settings }; redraw(); };
  try {
    if (ds.cwAdd) { await save({ branches: [...W.info.settings.branches, { id: ds.cwAdd, name: ds.name }] }); return C.toast(t('已追蹤 {name}', { name: ds.name })); }
    if (ds.cwDel) { await save({ branches: W.info.settings.branches.filter(x => x.id !== ds.cwDel) }); return C.toast('已移除追蹤分點'); }
    if (ds.cw === 'query') return startQuery('');
    if (ds.cw === 'requery') return startQuery(ds.date);
    if (ds.cw === 'pick') { const d = document.querySelector('[data-cw-pick]')?.value; if (!d) return C.toast('請選擇日期'); W.pickDate = d; if (W.info?.dates?.includes(d)) { W.picking = false; await loadInfo(d); return redraw(); } return startQuery(d); }
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
    if (el.dataset.cwOpt) { const r = await C.api('api/chipwatch/settings', { [el.dataset.cwOpt]: el.type === 'checkbox' ? el.checked : Number(el.value) }); W.info = { ...W.info, settings: r.settings }; C.toast('設定已儲存'); redraw(); }
    if ('cwDate' in el.dataset) { if (el.value === '__pick') { W.picking = true; W.pickDate = W.info?.date || ''; return redraw(); } W.picking = false; await loadInfo(el.value); redraw(); }
    if ('cwPick' in el.dataset) W.pickDate = el.value;
  } catch (err) { if (!err.silent) C.toast(err.message); }
});
