// 籌碼追蹤頁：分點追蹤（指定券商分點每日盤後進出）＋大戶集中度排行（每週股權分散表）。台股 FinMind Sponsor。
import { esc, branchRulesForm, fmt, chipwatchHTML, cwDateHTML, branchChips, branchSearchHTML, holderRankHTML } from './insight-ui.js';
import { t } from './i18n.js';
let C = null; // { api, toast, page }（股票按鈕由 live.js 的 data-alert-stock 處理）
// date：正在檢視的紀錄日期（空白＝最新）；picking：展開「其他日期」的日期欄位
const W = { info: null, rank: null, scope: 'mine', found: null, q: '', loading: false, hloading: false, error: '', date: '', picking: false, pickDate: '' };
export function initChipwatch(ctx) { C = ctx; }
const repaint = () => { if (C.page() !== 'chips') return; const pc = document.getElementById('pagecontent'); if (pc) { const y = window.scrollY; pc.innerHTML = chipPage(); window.scrollTo(0, y); } };

export async function enterChips() {
  try { const [info, rank] = await Promise.all([C.api('chipwatch' + (W.date ? '?date=' + W.date : '')), C.api('holders/rank?scope=' + W.scope)]); W.info = info; W.rank = rank; W.error = ''; } catch (e) { W.error = e.message; }
  repaint(); if (W.info?.busy) poll();
}
async function loadInfo(date) { W.date = date || ''; W.error = ''; W.info = await C.api('chipwatch' + (W.date ? '?date=' + W.date : '')); }
// 查詢在伺服器背景執行：每 3 秒取一次進度，完成後顯示該日紀錄或原因
const sleep = ms => new Promise(r => setTimeout(r, ms));
let polling = false;
async function poll() {
  if (polling) return; polling = true;
  try {
    while (W.info?.busy) { await sleep(3000); if (C.page() !== 'chips') return; W.info = await C.api('chipwatch?date=' + (W.info.query?.date || W.date)); repaint(); }
    W.date = W.info?.date || W.date;
    if (W.loading && !W.info?.error && W.info?.report) C.toast('分點追蹤已更新'); // 失敗或尚未公布的原因由 info.error 顯示
  } catch (e) { W.error = e.message; } finally { polling = false; W.loading = false; repaint(); }
}
async function startQuery(date) {
  W.loading = true; W.error = ''; W.picking = false; repaint();
  try { W.info = await C.api('chipwatch/query', date ? { date } : {}); W.date = W.info.date || date || ''; repaint(); await poll(); }
  catch (err) { W.error = err.message; W.loading = false; repaint(); }
}
async function loadRank() { W.rank = await C.api('holders/rank?scope=' + W.scope); }

export function chipPage() {
  const i = W.info, r = W.rank;
  if (!i && !W.error) return '<div class="empty"><i class="spinner"></i>讀取中…</div>';
  const noBw = i && !i.capable; // 沒有 FinMind Sponsor：分點追蹤不能用，大戶排行（集保開放資料）照常
  const s = i?.settings || {};
  const bw = noBw ? `<div class="notice warn"><span>分點追蹤需要 FinMind Sponsor 方案（券商分點）；下方的大戶集中度排行使用集保結算所的免費資料，不受影響。</span><button data-page="settings">資料來源設定 →</button></div>` : `<section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>分點追蹤</h2><p>指定券商分點，每個交易日盤後整理它在全市場的進出 · 自選與研究名單股票特別標示 · 達門檻推播到手機</p></div>
    <div class="actions">${i ? cwDateHTML(i, W) : ''}<button class="primary" data-cw="query" ${W.loading || i?.busy || !s.branches?.length ? 'disabled' : ''}>${W.loading || i?.busy ? '<i class="spinner"></i>查詢中…' : '⟳ 查詢最新交易日'}</button></div></div>
    <div class="contentpad"><div class="ix-cw-set">${branchChips(s)}
      <form class="ix-cw-search" data-cw-search><input name="q" value="${esc(W.q)}" placeholder="搜尋券商分點名稱或代號，例如 凱基台北、9200" maxlength="30" aria-label="搜尋券商分點"><button type="submit">搜尋</button></form>
      ${W.found ? branchSearchHTML(W.found, s) : ''}
      <div class="ix-cw-opts"><label class="checkbox"><input type="checkbox" data-cw-opt="auto" ${s.auto ? 'checked' : ''}>平日 18:30 後自動查詢並推播</label>
${branchRulesForm(s)}<span class="fine">最多 ${i?.maxBranches || 20} 個分點 · 每個分點每日 1 次請求</span></div></div>
    ${W.error ? `<div class="notice err"><span>${esc(W.error)}</span></div>` : ''}${i?.error && !i.busy ? `<div class="notice warn"><span>${esc(i.error)}</span></div>` : ''}
    <div class="ix-cw-report">${chipwatchHTML(i)}</div></div></section>`;
  const h = `<section class="panel"><div class="panelhead"><div><h2><span class="idx">02</span>大戶集中度排行</h2><p>每週股權分散表：千張大戶持股比例 1 週／4 週變化，搭配股東人數判讀籌碼集中或渙散</p></div>
    <div class="actions"><div class="segmented">${[['mine', '自選＋研究名單'], ['market', '全市場']].map(([v, l]) => `<button class="${W.scope === v ? 'selected' : ''}" data-hr-scope="${v}">${l}</button>`).join('')}</div><button data-hr="query" ${W.hloading || r?.busy ? 'disabled' : ''}>${W.hloading || r?.busy ? '<i class="spinner"></i>更新中…' : '⟳ 更新'}</button></div></div>
    <div class="contentpad">${r?.error ? `<div class="notice warn"><span>${esc(r.error)}</span></div>` : ''}
    <label class="checkbox" style="margin-bottom:10px"><input type="checkbox" data-cw-opt="holdersPush" ${s.holdersPush ? 'checked' : ''}>每週新資料公布時，推播自選＋研究名單的集中／渙散摘要</label>
    ${holderRankHTML(r?.rank, { limit: W.scope === 'market' ? 60 : 200 })}</div></section>`;
  return bw + h;
}

// 儲存設定只更新設定，不改變正在檢視的日期
async function saveSettings(patch) { const r = await C.api('chipwatch/settings', patch); W.info = { ...W.info, settings: r.settings }; repaint(); }
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !C || C.page() !== 'chips') return; const ds = b.dataset;
  try {
    if (ds.cwAdd) { const list = [...(W.info?.settings?.branches || []), { id: ds.cwAdd, name: ds.name }]; await saveSettings({ branches: list }); return C.toast(t('已追蹤 {name}', { name: ds.name })); }
    if (ds.cwDel) { await saveSettings({ branches: (W.info?.settings?.branches || []).filter(x => x.id !== ds.cwDel) }); return C.toast('已移除追蹤分點'); }
    if (ds.cw === 'query') return startQuery('');
    if (ds.cw === 'requery') return startQuery(ds.date);
    if (ds.cw === 'pick') { const d = document.querySelector('[data-cw-pick]')?.value; if (!d) return C.toast('請選擇日期'); W.pickDate = d; if (W.info?.dates?.includes(d)) { W.picking = false; await loadInfo(d); return repaint(); } return startQuery(d); }
    if (ds.hrScope) { W.scope = ds.hrScope; await loadRank(); return repaint(); }
    if (ds.hr === 'query') { W.hloading = true; repaint(); try { await C.api('holders/rank/query', {}); await loadRank(); C.toast('大戶資料已更新'); } catch (err) { C.toast(err.message); } finally { W.hloading = false; repaint(); } return; }
  } catch (err) { C.toast(err.message); }
});
document.addEventListener('submit', async e => {
  const f = e.target; if (!C || !('cwSearch' in f.dataset)) return; e.preventDefault();
  W.q = f.elements.q.value.trim(); if (!W.q) return;
  try { W.found = (await C.api('chipwatch/branches?q=' + encodeURIComponent(W.q))).branches; } catch (err) { C.toast(err.message); }
  repaint(); document.querySelector('[data-cw-search] input')?.focus();
});
document.addEventListener('change', async e => {
  const el = e.target; if (!C || C.page() !== 'chips') return;
  try {
    if (el.dataset.cwOpt) { await saveSettings({ [el.dataset.cwOpt]: el.type === 'checkbox' ? el.checked : Number(el.value) }); C.toast('籌碼追蹤設定已儲存'); }
    if ('cwDate' in el.dataset) { if (el.value === '__pick') { W.picking = true; W.pickDate = W.info?.date || ''; return repaint(); } W.picking = false; await loadInfo(el.value); repaint(); }
    if ('cwPick' in el.dataset) W.pickDate = el.value;
  } catch (err) { C.toast(err.message); }
});
