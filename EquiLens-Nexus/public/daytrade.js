// 衡析 Nexus：當沖掃描面板（盤中雷達頁）— 即時推播狀態、當沖分數 Top N、排除統計、收盤後訊號檢討、當沖監控設定。
// 資料：/api/daytrade（每 3 秒）、/api/daytrade/review、/api/daytrade/settings。只有設定了支援即時推播的資料源（例如富果）才顯示。
import { esc, fmt, pct, cls } from './insight-ui.js';
import * as MK from './market.js';

let X = null; // { api, toast, repaint, isLive }
const D = { info: null, review: null, tab: 'scan', draft: null, error: '', at: 0 };
export function initDaytrade(ctx) { X = ctx; }
export const dtCapable = () => !!D.info?.capable;
export async function loadDaytrade() { try { D.info = await X.api('daytrade'); D.at = Date.now(); D.error = ''; if (!D.draft) D.draft = structuredClone(D.info.settings); } catch (e) { D.error = e.message; } }
async function loadReview() { try { D.review = await X.api('daytrade/review'); } catch (e) { D.error = e.message; } }
// 盤中且推播運作時每 3 秒更新；其餘時間 30 秒
setInterval(async () => {
  if (!X || document.hidden || !X.isLive()) return;
  const live = D.info?.feed?.active && MK.isOpen();
  if (!live && Date.now() - D.at < 30e3) return;
  await loadDaytrade(); if (D.tab === 'scan') X.repaint();
}, 3000);

const PLAN_NAMES = { basic: '基本', developer: '開發者', advanced: '進階' };
const FILTERS = { noDayTrade: '不可當沖', disposition: '處置', suspended: '暫停交易', spread: '價差過大', liquidity: '流動性不足', limitUp: '已漲停' };
const PARTS = [['volume', '量能', 35, 'var(--amber)'], ['structure', '結構', 30, 'var(--cyan)'], ['book', '五檔', 20, 'var(--violet)'], ['relative', '族群', 15, 'var(--magenta)']];
const SIG = { 'dt-breakout': '💥 爆量突破', 'dt-vwap': '📈 VWAP 延續', 'dt-bid': '🟢 買盤增強' };
const n0 = v => v == null ? '—' : fmt(v, 0), n1 = v => v == null ? '—' : fmt(v, 1), n2 = v => v == null ? '—' : fmt(v, 2);

function feedLine(d) {
  const f = d.feed, plan = PLAN_NAMES[d.plan] || d.plan || '—', lim = d.plans?.[d.plan]?.limit;
  if (!f.window) return '<span>非盤中 · 平日開盤前 10 分鐘自動連線並確認訂閱</span>';
  if (!f.connected) return `<span class="warn">${f.authFailed ? '金鑰無效或方案不支援（10 分鐘後重試）' : f.error ? `即時推播未連線：${esc(f.error === 'no-heartbeat' ? '連線逾時，重新連線中' : f.error)}` : '即時推播連線中…'}</span>`;
  const mode = f.mode === 'full' ? '完整模式：逐筆成交＋1 分 K＋五檔' : '精簡模式：聚合行情';
  const short = f.subscribed < f.expected ? ` <b class="warn">訂閱不足</b>` : '';
  return `<span>⚡ ${mode}</span><span>富果${plan}方案${lim ? `（上限 ${fmt(lim)}）` : ''}</span><span>訂閱 <b class="mono">${fmt(f.subscribed)}／${fmt(f.expected)}</b>${f.connections?.length > 1 ? `（${f.connections.length} 條連線）` : ''}${short}</span>${f.backfill?.busy ? `<span class="warn">斷線補資料中 ${f.backfill.done}／${f.backfill.total}</span>` : ''}${d.fallback ? '<span class="warn">訂閱數不足，今天改用精簡模式</span>' : ''}`;
}
function prepLine(d) {
  const p = d.prep, base = d.baselineDays == null ? '' : d.baselineDays >= 3 ? `<span>同時段均量：時光機 ${d.baselineDays} 天</span>` : `<span class="warn">時光機紀錄不足 3 天，同時段量以近 20 日均量推估</span>`;
  if (!p) return `<span>盤前資料（可當沖標的、處置股、參考價）於開盤前 30 分鐘取得</span>${base}`;
  return `<span>${p.eligible == null ? '<b class="warn">可當沖清單未取得</b>' : `可當沖 <b class="mono">${fmt(p.eligible)}</b> 檔`}</span><span>處置 <b class="mono">${p.disposition}</b></span><span>暫停交易 <b class="mono">${p.suspended}</b></span><span>暫停先賣後買 <b class="mono">${p.sellFirstOff}</b></span><span>參考價 <b class="mono">${fmt(p.ref)}</b> 檔</span>${p.errors?.length ? `<span class="warn" title="${esc(p.errors.join('\n'))}">部分盤前資料取得失敗</span>` : ''}${base}`;
}
function scoreBar(x) {
  return `<span class="dt-bar" title="${PARTS.map(([k, l, max]) => `${l} ${x.part?.[k] ?? 0}／${max}`).join(' · ')}">${PARTS.map(([k, , , c]) => `<i style="width:${(x.part?.[k] || 0)}%;background:${c}"></i>`).join('')}</span><b class="mono">${n1(x.score)}</b>`;
}
function row(x, i) {
  return `<tr data-kbar-row="${esc(x.id)}" class="${x.pending ? 'dim' : ''}"><td class="mono">${i + 1}</td><td><b>${esc(x.name)}</b> <small class="mono">${esc(x.id)}</small>${x.watch ? ' <em class="ix-badge acc">自選</em>' : ''}</td>
    <td class="mono ${cls(x.change)}">${n2(x.price)}<small> ${pct(x.change)}</small></td><td class="dt-score">${scoreBar(x)}</td>
    <td class="mono ${cls(x.vwapDist)}">${x.vwapDist == null ? '—' : pct(x.vwapDist)}</td><td class="mono ${x.rvol >= 2 ? 'up' : ''}">${n1(x.rvol)}</td><td class="mono ${x.r1 >= 2 ? 'up' : ''}">${n1(x.r1)}</td>
    <td class="mono ${cls(x.obi)}">${n2(x.obi)}</td><td class="mono ${x.outer5 >= 60 ? 'up' : x.outer5 <= 40 && x.outer5 != null ? 'down' : ''}">${x.outer5 == null ? '—' : x.outer5 + '%'}</td><td class="mono">${x.spread ?? '—'}</td>
    <td class="mono ${cls(x.gap)}">${x.gap == null ? '—' : pct(x.gap)}</td><td>${x.last ? `<span class="ix-tag up">${SIG[x.last.type] || esc(x.last.type)}</span> <small class="mono">${esc(x.last.t?.slice(0, 5))}</small>` : x.pending ? '<small>補資料中</small>' : ''}</td></tr>`;
}
function scanView(d) {
  const ex = Object.entries(d.excluded || {}).filter(([, n]) => n).map(([k, n]) => `${FILTERS[k] || k} ${n}`), watched = (d.watched || []).filter(w => !d.top.some(x => x.id === w.id));
  const head = `<tr><th>#</th><th>股票</th><th>價格</th><th title="量能 35 · 結構 30 · 五檔 20 · 族群與大盤 15">當沖分數</th><th title="現價相對 VWAP（當日成交均價）">VWAP 乖離</th><th title="累計量 ÷ 歷史同時段累計量">量比</th><th title="最近 1 分鐘量 ÷ 歷史同時段 1 分鐘量">1 分量</th><th title="五檔委買量與委賣量的不平衡（−1～+1，30 秒平均）">OBI</th><th title="最近 5 分鐘外盤成交量占比">外盤</th><th title="委買賣價差（檔）">價差</th><th title="開盤價相對參考價">跳空</th><th>最新訊號</th></tr>`;
  const table = d.top.length ? `<div class="dt-table"><table>${head}${d.top.map(row).join('')}</table></div>` : `<div class="empty"><p>${d.feed?.window ? '尚無報價，開盤後開始計算。' : '盤中（開盤後）才會計算當沖分數。'}</p></div>`;
  return `${table}${ex.length ? `<p class="dt-foot">已排除：${ex.join(' · ')}（共 ${d.total} 檔中）</p>` : ''}${watched.length ? `<p class="dt-foot">自選未進榜：${watched.map(w => `${esc(w.name)} <b class="mono">${n1(w.score)}</b>${w.filters.length ? `（${w.filters.map(f => FILTERS[f] || f).join('、')}）` : ''}`).join(' · ')}</p>` : ''}
    <p class="dt-foot">分數為研究用初始權重（量能 35＋結構 30＋五檔 20＋族群與大盤 15），尚未回測，請以「訊號檢討」累積的實際結果調整。訊號只做提醒，請自行在券商下單並設定停損。</p>`;
}
function reviewView() {
  const r = D.review; if (!r) return '<div class="empty"><span class="spinner"></span></div>';
  if (!r.signals) return `<div class="empty"><p>尚無訊號紀錄。每個交易日收盤後，系統會以分 K 檢討當天的當沖訊號。</p></div>`;
  const v = x => x == null ? '—' : `<span class="${cls(x)}">${x > 0 ? '+' : ''}${fmt(x, 2)}%</span>`;
  const table = `<div class="dt-table"><table><tr><th>訊號</th><th>次數</th><th>15 分鐘勝率</th><th>5 分鐘</th><th>15 分鐘</th><th>30 分鐘</th><th>持有到收盤</th><th title="30 分鐘內最大有利／不利幅度（未扣成本）">最大有利／不利</th></tr>
    ${r.types.map(x => `<tr><td>${SIG[x.type] || esc(x.title)}</td><td class="mono">${x.n}</td><td class="mono">${x.win15 == null ? '—' : x.win15 + '%'}</td><td class="mono">${v(x.r5)}</td><td class="mono">${v(x.r15)}</td><td class="mono">${v(x.r30)}</td><td class="mono">${v(x.rClose)}</td><td class="mono">${v(x.mfe)}／${v(x.mae)}</td></tr>`).join('')}</table></div>`;
  const recent = r.recent.map(d => `<details class="dt-day"><summary>${esc(d.date)} · ${d.signals.length} 則${d.mode === 'lite' ? ' · 精簡模式' : ''}</summary>${d.signals.map(s => `<div class="dt-sig"><span class="mono">${esc(s.t?.slice(0, 5))}</span><b>${esc(s.name)}</b> <small class="mono">${esc(s.id)}</small><span>${SIG[s.type] || esc(s.title)}</span><span class="mono">${n2(s.price)}</span><span class="mono">15 分 ${v(s.outcome?.r15)}</span><span class="mono">收盤 ${v(s.outcome?.rClose)}</span></div>`).join('')}</details>`).join('');
  return `${table}<p class="dt-foot">共 ${r.days} 個交易日、${r.signals} 則訊號。淨報酬以訊號價加滑價買進、到時以收盤價減滑價賣出，已扣除手續費與證交稅（來回約 ${fmt(r.cost, 3)}%）；樣本少時僅供參考。</p>${recent}`;
}
function settingsView(d) {
  const s = D.draft || d.settings, plans = d.plans || {}, need = d.need || {};
  const sel = (key, opts, fmtv = v => v) => `<select data-dtset="${key}">${opts.map(v => `<option value="${v}" ${String(key.split('.').reduce((o, k) => o?.[k], s)) === String(v) ? 'selected' : ''}>${fmtv(v)}</option>`).join('')}</select>`;
  const chk = (key, label) => `<label class="lv-rule"><input type="checkbox" data-dtset="${key}" ${key.split('.').reduce((o, k) => o?.[k], s) ? 'checked' : ''}><span>${label}</span></label>`;
  const advice = need.symbols ? `${fmt(need.symbols)} 檔 × 3 頻道（逐筆、分 K、五檔）＝ ${fmt(need.full)} 個訂閱${plans.advanced ? `：進階方案（${fmt(plans.advanced.limit)}）可用完整模式` : ''}；開發者方案（${fmt(plans.developer?.limit || 300)}）改用聚合行情（${fmt(need.lite)} 個）` : '';
  return `<div class="lv-settings">
    ${chk('enabled', '啟用當沖監控（盤中掃描、當沖訊號推播、收盤檢討）')}
    <label class="dt-field"><span>富果方案</span>${sel('plan', ['auto', 'advanced', 'developer', 'basic'], v => ({ auto: '自動判斷', advanced: '進階（2,000 訂閱）', developer: '開發者（300 訂閱）', basic: '基本（5 訂閱）' })[v])}</label>
    <p class="dt-foot">${advice}。自動判斷時先嘗試完整模式，訂閱不足就當天改用精簡模式。</p>
    <label class="dt-field"><span>顯示前幾名</span>${sel('top', [10, 20, 30])}</label>
    <label class="dt-field"><span>訊號分數門檻</span>${sel('minScore', [40, 50, 60, 70, 80])}</label>
    ${chk('signals.breakout', '💥 爆量突破：1 分 K 收盤突破前 N 分鐘高點，且量達同時段均量倍數')}
    <label class="dt-field sub"><span>前幾分鐘高點</span>${sel('breakoutLookback', [10, 15, 20, 30], v => `${v} 分鐘`)}<span>量倍數</span>${sel('breakoutVolume', [1.5, 2, 3], v => `${v} 倍`)}</label>
    ${chk('signals.vwap', '📈 VWAP 趨勢延續：在 VWAP 上方、5 分鐘趨勢向上，回測 VWAP 後重新轉強')}
    ${chk('signals.bid', '🟢 買盤持續增強：五檔委買持續偏強（OBI 30 秒平均 ≥ 0.3），價量同步向上')}
    <label class="dt-field"><span>開盤觀察至</span>${sel('watchFrom', ['09:05', '09:10', '09:15', '09:30'])}<span>停止新訊號</span>${sel('stopNew', ['12:30', '13:00', '13:10', '13:20'])}</label>
    <label class="dt-field"><span>價差上限</span>${sel('maxSpreadTicks', [2, 3, 5], v => `${v} 檔價位`)}<span>近 20 日均額至少</span>${sel('minDailyAmount', [0, 50e6, 100e6, 300e6, 500e6], v => v ? `${fmt(v / 1e8, 1)} 億` : '不限')}</label>
    <label class="dt-field"><span>手續費折扣</span>${sel('costs.feeDiscount', [1, 0.6, 0.5, 0.38, 0.28, 0.2], v => v === 1 ? '無折扣' : `${+(v * 10).toFixed(1)} 折`)}<span>證交稅</span>${sel('costs.taxRate', [0.0015, 0.003], v => `${fmt(v * 100, 2)}%`)}<span>滑價</span>${sel('costs.slipTicks', [0, 1, 2], v => `${v} 檔價位`)}</label>
    <p class="dt-foot">現股當沖證交稅目前減半為 0.15%（至 2027 年底）；滑價與成本只用於訊號檢討的淨報酬計算。</p>
    <div class="form-actions"><button class="primary" data-dtsave>儲存當沖監控設定</button></div></div>`;
}
export function daytradePanel() {
  const d = D.info; if (!d?.capable) return '';
  const tabs = [['scan', `掃描 Top ${d.settings?.top || 20}`], ['review', '訊號檢討'], ['settings', '設定']];
  const body = !d.enabled && D.tab === 'scan' ? '<div class="empty"><p>當沖監控已關閉，可在「設定」開啟。</p></div>' : D.tab === 'scan' ? scanView(d) : D.tab === 'review' ? reviewView() : settingsView(d);
  return `<section class="panel dt-panel"><div class="panelhead"><div><h2><span class="idx">DT</span>當沖掃描</h2><p>${d.phaseName ? `${esc(d.phaseName)} · ` : ''}FinMind 盤後選股與盤前資料＋富果盤中即時行情${d.marketChange != null ? ` · 監控股票平均 ${pct(d.marketChange)}` : ''}</p></div><div class="segmented">${tabs.map(([k, l]) => `<button class="${D.tab === k ? 'selected' : ''}" data-dttab="${k}">${l}</button>`).join('')}</div></div>
    <div class="contentpad"><div class="dt-status">${feedLine(d)}</div><div class="dt-status">${prepLine(d)}</div>${D.error ? `<div class="notice err"><span>${esc(D.error)}</span></div>` : ''}${body}</div></section>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-kbar-row]'); if (!b || !X) return; const ds = b.dataset;
  try {
    if (ds.dttab) { D.tab = ds.dttab; if (D.tab === 'review') { X.repaint(); await loadReview(); } return X.repaint(); }
    if (ds.kbarRow) return X.openChart(ds.kbarRow);
    if ('dtsave' in ds && D.draft) { const r = await X.api('daytrade/settings', D.draft); D.draft = structuredClone(r.settings); await loadDaytrade(); X.toast('當沖監控設定已儲存'); return X.repaint(); }
  } catch (err) { X.toast(err.message); }
});
document.addEventListener('change', e => {
  const t = e.target; if (!X || !t.dataset?.dtset || !D.draft) return;
  const keys = t.dataset.dtset.split('.'), v = t.type === 'checkbox' ? t.checked : /^(auto|advanced|developer|basic|\d{2}:\d{2})$/.test(t.value) ? t.value : Number(t.value);
  keys.slice(0, -1).reduce((o, k) => o[k], D.draft)[keys.at(-1)] = v;
});
