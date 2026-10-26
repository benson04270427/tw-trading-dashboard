// 電腦版：回檔買點頁（強勢股回到支撐附近；規則見 lib/pullback.mjs）。股票名稱由 live.js 的 data-alert-stock 開啟個股視窗。
let C = null; // { api, toast, page }
const S = { info: null, bt: null, error: '', tab: 'near', group: '', showTrades: false };
const KEY = 'nexus.pullback';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 2) => v == null || !Number.isFinite(+v) ? '—' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const px = v => v == null ? '—' : fmt(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2);
const pc = v => v == null ? '<span class="soft">—</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${fmt(v, 1)}%</span>`;
const rr = v => v == null ? '—' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${fmt(v, 2)}R</span>`;
const LEVEL = { ema9: '9 日 EMA', ema21: '21 日 EMA', ema50: '50 日 EMA', avwap: 'AVWAP', priorHigh: '前高', gap: '缺口' };
function prefs() { try { return { account: 1000000, riskPct: 0.5, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { account: 1000000, riskPct: 0.5 }; } }
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { } }

export function initPullback(ctx) { C = ctx; }
export function pullbackPage() { return `${S.error ? `<div class="notice err"><span>${esc(S.error)}</span></div>` : ''}<section class="panel"><div class="contentpad rv-wrap" id="pb-box">${html()}</div></section>`; }
const paint = () => { if (C.page() !== 'pullback') return; const el = document.getElementById('pb-box'); if (el) el.innerHTML = html(); else { const pc2 = document.getElementById('pagecontent'); if (pc2) pc2.innerHTML = pullbackPage(); } };
export async function enterPullback() {
  try { [S.info, S.bt] = await Promise.all([C.api('pullback'), C.api('pullback/backtest')]); S.error = ''; } catch (e) { S.error = e.message; }
  paint(); if (S.info?.busy && !S.info?.available) poll(); if (S.bt?.busy) pollBt();
}
let polling = false, btPolling = false;
async function poll() { if (polling) return; polling = true; try { do { await sleep(3000); if (C.page() !== 'pullback') return; S.info = await C.api('pullback'); paint(); } while (S.info?.busy && !S.info?.available); } catch { } finally { polling = false; } }
async function pollBt() { if (btPolling) return; btPolling = true; try { do { await sleep(2500); if (C.page() !== 'pullback') return; S.bt = await C.api('pullback/backtest'); paint(); } while (S.bt?.busy); S.info = await C.api('pullback'); paint(); } catch { } finally { btPolling = false; } }

function sizing(plan, mk) {
  const p = prefs(); if (!plan?.r || !(p.account > 0) || !(p.riskPct > 0)) return '—';
  const risk = p.account * p.riskPct / 100, sh = Math.floor(risk / plan.r), w = sh * plan.trigger / p.account * 100;
  if (sh <= 0) return '<span class="soft">風險額太小</span>';
  const lots = mk === 'TW' ? Math.floor(sh / 1000) : null;
  return `${mk === 'TW' ? (lots >= 1 ? `${lots} 張` : `${sh} 股（零股）`) : `${sh.toLocaleString('en-US')} 股`}<br><small class="soft">約 ${fmt(w, 0)}% 資金</small>`;
}
const name = r => `<button class="ix-cw-stock" data-alert-stock="${esc(r.id)}">${esc(r.name)} <small class="num">${esc(r.id)}</small></button><br><small class="soft">${esc(r.sector)}${r.groupStrong ? ` · <span class="up">族群 ${r.peers} 檔同強</span>` : ''}</small>`;
const rets = r => `${pc(r.rets[0])} / ${pc(r.rets[1])} / ${pc(r.rets[2])}`;
const zone = r => r.zone ? `${px(r.zone.lo)}–${px(r.zone.top)}<br><small class="soft">${r.zone.keys.map(k => LEVEL[k] || k).join('、')}</small>` : '—';

function regimeBox(g) {
  if (!g) return '';
  return `<div class="notice ${g.caution ? 'err' : ''}"><span>風控水位 ${fmt(g.risk, 0)}（${esc(g.label)}，建議持股 ${g.exposure}%）。${g.caution ? '大盤風險偏高時，強勢股回測支撐常常直接跌破，這套順勢策略容易失靈：建議只觀察、或把單筆風險減半。' : '大盤風險不高，順勢策略比較有利；仍以停損控制每筆虧損。'}</span></div>`;
}
function btBox() {
  const b = S.bt || {}, r = b.result, s = r?.summary;
  const run = `<button class="primary" data-pb-bt ${b.busy ? 'disabled' : ''}>${b.busy ? `回測中… ${esc(b.step || '')}` : r ? '重新回測' : '執行回測'}</button>`;
  if (!s?.n) return `<div class="pb-bt"><h4 class="dd-h">歷史回測</h4><p class="soft">${b.error ? esc(b.error) : r ? '回測期間沒有符合條件的交易。' : '用電腦上已存的長期日 K（夜間預載會逐步補齊，約 6 年）回測這套規則：勝率、平均賺幾 R、最大連續虧損。'}</p>${run}</div>`;
  const cell = (label, v, note = '') => `<div class="pb-kpi"><small class="soft">${label}</small><b class="num">${v}</b>${note ? `<small class="soft">${note}</small>` : ''}</div>`;
  const grp = (title, list, labels) => list?.length ? `<tr><th colspan="5" class="soft">${title}</th></tr>${list.map(x => `<tr><td>${esc(labels[x.key] || x.key)}</td><td class="num">${x.n}</td><td class="num">${fmt(x.winRate, 1)}%</td><td class="num">${rr(x.avgR)}</td><td class="num">${x.pf ?? '—'}</td></tr>`).join('')}` : '';
  const why = { stop: '停損', ema9: '跌破 9 日 EMA', time: '持有滿 40 天' };
  const trades = S.showTrades ? `<div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>股票</th><th>訊號日</th><th>進場</th><th>出場</th><th>天數</th><th>停損距離</th><th>結果</th><th>出場原因</th></tr></thead><tbody>${r.trades.map(t => `<tr><td><button class="ix-cw-stock" data-alert-stock="${esc(t.id)}">${esc(t.id)}</button></td><td class="num">${esc(t.signal)}</td><td class="num">${esc(t.entry)}<br><small class="soft">${px(t.entryPx)}</small></td><td class="num">${esc(t.exit)}</td><td class="num">${t.days}</td><td class="num">${fmt(t.stopPct, 1)}%</td><td class="num">${rr(t.r)}<br><small>${pc(t.ret)}</small></td><td>${esc(why[t.why] || t.why)}${t.partial ? '<br><small class="soft">3R 先賣一半</small>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="pb-bt"><h4 class="dd-h">歷史回測 <small class="soft">${esc(r.from)}～${esc(r.to)} · ${r.stocks} 檔 · 已扣交易成本 ${fmt(r.cost * 100, 3)}%${r.stale ? ' · 規則已更新，請重新回測' : ''}</small></h4>
  <div class="pb-kpis">${cell('交易次數', s.n)}${cell('勝率', fmt(s.winRate, 1) + '%')}${cell('平均每筆', rr(s.avgR), `中位數 ${rr(s.medianR)}`)}${cell('獲利因子', s.pf ?? '—')}${cell('平均賺／賠', `${rr(s.avgWinR)} / ${rr(s.avgLossR)}`)}${cell('最大連續回落', rr(s.maxDDR), '依出場順序累計')}${cell('到 3R', fmt(s.hit3R, 0) + '%')}${cell('平均持有', fmt(s.avgDays, 1) + ' 天', `停損距離 ${fmt(s.avgStopPct, 1)}%`)}</div>
  <div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>分組</th><th>筆數</th><th>勝率</th><th>平均</th><th>獲利因子</th></tr></thead><tbody>${grp('依大盤寬度（站上 50 日 EMA 的比例）', r.byBreadth, { strong: '強（≥60%）', mid: '中（40–60%）', weak: '弱（<40%）', na: '資料不足' })}${grp('依第幾次回測', r.byRetest, { first: '第一次回測', later: '第二次以上' })}${grp('依年度', r.byYear, {})}</tbody></table></div>
  <p class="ix-foot">規則：前一天收盤符合「接近買點」，隔天突破前一天高點進場（開盤跳空用開盤價）；停損放前一天低點與支撐區下緣較低者；到 3R 先賣一半，其餘收盤跌破 9 日 EMA 出場，最多持有 40 天。日線無法看出分鐘線訊號，實際進出場會不同。回測股票是電腦上有長期資料的那幾檔（以持股、自選、AI 供應鏈為主），有選股偏差；股價未還原，除權息可能誤觸停損。</p>
  <div class="pb-actions">${run}<button data-pb-trades>${S.showTrades ? '收起交易明細' : `看最近 ${r.trades.length} 筆交易`}</button></div>${trades}</div>`;
}

function html() {
  const d = S.info; if (!d) return '<p class="soft">載入中…</p>';
  if (!d.available) return `<p class="soft">${esc(d.reason || '資料還沒準備好')}</p>`;
  const p = prefs(), mk = d.market;
  const rows = d.rows.filter(r => (S.tab === 'near' ? r.stage === 'near' : S.tab === 'base' ? r.stage === 'base' : true) && (!S.group || r.sector === S.group));
  const tabs = [['near', `接近買點 ${d.counts.near}`], ['base', `整理中 ${d.counts.base}`], ['strong', `強勢股 ${d.counts.strong}`]].map(([k, l]) => `<button class="${S.tab === k ? 'selected' : ''}" data-pb-tab="${k}">${l}</button>`).join('');
  const groups = d.groups.length ? `<div class="rv-strats pb-groups"><small class="soft">同族群一起轉強：</small>${d.groups.slice(0, 12).map(g => `<button class="${S.group === g.name ? 'selected' : ''}" data-pb-group="${esc(g.name)}">${esc(g.name)} ${g.n}</button>`).join('')}${S.group ? '<button data-pb-group="">全部</button>' : ''}</div>` : '';
  const form = `<form class="pb-form" data-pb-form><label>帳戶金額 <input name="account" type="number" min="0" step="1000" value="${p.account}"></label><label>單筆風險 <input name="riskPct" type="number" min="0.1" max="5" step="0.1" value="${p.riskPct}"> %</label><button>套用</button><small class="soft">可買股數＝帳戶 × 單筆風險 ÷（觸發價 − 停損）</small></form>`;
  let table;
  if (!rows.length) table = `<p class="soft">${S.tab === 'near' ? '今天沒有股票回到支撐附近。可以看「整理中」名單，等它們回測支撐。' : '沒有符合的股票。'}</p>`;
  else if (S.tab === 'near') table = `<div class="dd-scroll"><table class="tg-table dd-tbl pb-near"><thead><tr><th>股票</th><th>收盤</th><th>1／3／6 月漲幅</th><th>支撐區</th><th>距支撐</th><th>回測</th><th>觸發價</th><th>停損</th><th>3R／5R</th><th>可買</th></tr></thead><tbody>${rows.map(r => `<tr><td>${name(r)}</td><td class="num">${px(r.close)}</td><td class="num">${rets(r)}</td><td class="num">${zone(r)}</td><td class="num">${r.distance <= 0 ? '<small>在區內</small>' : fmt(r.distance, 1) + '%'}</td><td>${r.retest <= 1 ? '<span class="up">第一次</span>' : `第 ${r.retest} 次`}</td><td class="num">${px(r.plan.trigger)}<br><small class="soft">突破今天高點</small></td><td class="num">${px(r.plan.stop)}<br><small class="soft">−${fmt(r.plan.stopPct, 1)}%</small></td><td class="num">${px(r.plan.t3)}<br>${px(r.plan.t5)}</td><td class="num">${sizing(r.plan, mk)}</td></tr>`).join('')}</tbody></table></div>`;
  else table = `<div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>股票</th><th>收盤</th><th>1／3／6 月漲幅</th>${S.tab === 'base' ? '<th>回檔</th><th>波動收斂</th><th>支撐區</th><th>距支撐</th>' : '<th>整理區高點</th>'}<th>${S.tab === 'base' ? '還差什麼' : '狀態'}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${name(r)}</td><td class="num">${px(r.close)}</td><td class="num">${rets(r)}</td>${S.tab === 'base' ? `<td class="num">${fmt(r.depth * 100, 1)}%</td><td class="num">${r.contraction != null ? fmt(r.contraction * 100, 0) + '%' : '—'}</td><td class="num">${zone(r)}</td><td class="num">${r.distance == null ? '—' : r.distance <= 0 ? '<small>在區內</small>' : fmt(r.distance, 1) + '%'}</td>` : `<td class="num">${r.high ? `${px(r.high.price)}<br><small class="soft">${r.high.days} 天前</small>` : '—'}</td>`}<td><small>${r.stage === 'near' ? '<span class="up">接近買點</span>' : r.stage === 'base' ? (r.reasons.map(esc).join('、') || '整理中') : esc(r.reasons[0] || '')}</small></td></tr>`).join('')}</tbody></table></div>`;
  const scope = mk === 'US' ? 'AI 供應鏈＋持股＋自選' : '上市櫃普通股';
  return `${regimeBox(d.regime)}<div class="pb-head"><div><b>資料日 ${esc(d.asOf || '—')}</b> <small class="soft">掃描 ${scope} ${d.scanned} 檔</small></div>${form}</div>
  <div class="pb-steps"><div><b>① 強勢股</b><small>近 1、3、6 個月任一漲幅 >30% 且排名前 30%，排除成交量太小的</small></div><div><b>② 進入整理</b><small>回檔 3–25%、低點墊高、波動收斂，9 日 EMA 在 21 日之上且兩條都走平或向上</small></div><div><b>③ 接近買點</b><small>9／21／50 日 EMA、AVWAP、前高、缺口至少兩個擠在 3% 內，收盤在支撐區上緣 3% 以內、沒跌破</small></div><div><b>④ 進場</b><small>盤中回測不破、分鐘線突破前一根高點才進場；先放停損，3R、5R 分批賣</small></div></div>
  <div class="rv-strats pb-tabs">${tabs}</div>${groups}${table}${btBox()}
  <p class="ix-foot">參考 2025 美國投資錦標賽股票組冠軍 Martin Luk 公開分享的回調買入法，改寫成日線規則。比賽成績是極端值，不代表可預期的報酬；這是研究工具，不是買賣建議，進場與否請自行判斷並先設好停損。</p>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest?.('[data-pb-tab],[data-pb-group],[data-pb-bt],[data-pb-trades]'); if (!b || !C || C.page() !== 'pullback') return;
  if (b.dataset.pbTab) { S.tab = b.dataset.pbTab; return paint(); }
  if (b.dataset.pbGroup != null) { S.group = b.dataset.pbGroup; return paint(); }
  if (b.hasAttribute('data-pb-trades')) { S.showTrades = !S.showTrades; return paint(); }
  if (b.hasAttribute('data-pb-bt')) { try { S.bt = await C.api('pullback/backtest', {}); paint(); pollBt(); } catch (err) { C.toast(err.message); } }
});
document.addEventListener('submit', e => {
  const f = e.target.closest?.('[data-pb-form]'); if (!f || !C) return; e.preventDefault();
  const v = Object.fromEntries(new FormData(f)); savePrefs({ account: Math.max(0, +v.account || 0), riskPct: Math.min(5, Math.max(0.1, +v.riskPct || 0.5)) }); paint(); C.toast('已套用');
});
