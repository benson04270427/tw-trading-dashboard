// 首頁：盤前焦點新聞（鉅亨網頭條）＋ 本周大事紀（Forex Factory 經濟數據、Nasdaq 科技財報）。
import * as MK from './market.js';
let ctx, esc;
// 中文介面才顯示中文對照名稱；其他語言顯示原文（經濟數據、公司名稱）
const zh = () => MK.lang() === 'zh-TW';
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const news = { 0: null, 1: null }, loading = { news: false, week: false };
let week = null, offset = 0, section = 'all', kind = 'all';
const SECTIONS = [['all', '全部'], ['must', '必讀'], ['tw', '台股'], ['us', '美股'], ['global', '國際'], ['commodity', '原物料・匯率'], ['other', '其他']];
const WD = '日一二三四五六';

export function initBriefing(c) { ctx = c; esc = c.esc; }

/* ---------- 時間格式（台北） ---------- */
const parts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
const hm = ms => { const p = parts(ms); return `${p.hour}:${p.minute}`; };
const mdhm = ms => { const p = parts(ms); return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`; };
const twToday = () => { const p = parts(Date.now()); return `${p.year}-${p.month}-${p.day}`; };
const dayLabel = date => { const d = new Date(`${date}T00:00:00Z`); return zh() ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）` : `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WD_EN[d.getUTCDay()]})`; };
const windowLabel = ms => { const p = parts(ms); return `${dayLabel(`${p.year}-${p.month}-${p.day}`)} ${p.hour}:${p.minute}`; };
const cap = v => !v ? '' : v >= 1e12 ? `市值 ${(v / 1e12).toFixed(2)} 兆美元` : `市值 ${Math.round(v / 1e8).toLocaleString('en-US')} 億美元`;

/* ---------- 資料載入 ---------- */
async function get(path) { const r = await fetch(`/api/briefing/${path}`); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '讀取失敗'); return j; }
async function loadNews(refresh = false) {
  if (loading.news) return; loading.news = true; paint('news');
  const o = offset;
  try { news[o] = await get(`news?offset=${o}${refresh ? '&refresh=1' : ''}`); if (refresh && news[o].stale) ctx.toast(news[o].error); }
  catch (e) { news[o] = { ...(news[o] || {}), error: e.message, items: news[o]?.items || [] }; }
  finally { loading.news = false; paint('news'); }
}
async function loadWeek(refresh = false) {
  if (loading.week) return; loading.week = true; paint('week');
  try { week = await get(`week${refresh ? '?refresh=1' : ''}`); }
  catch (e) { week = { ...(week || {}), errors: [e.message] }; }
  finally { loading.week = false; paint('week'); }
}
function paint(which) { const el = document.getElementById(`brief-${which}`); if (el) el.innerHTML = which === 'news' ? newsBlock() : weekBlock(); }

// 每次繪製首頁時呼叫：沒有資料就載入；本期新聞每 10 分鐘向本機服務確認一次（收盤後自動換到下一期），行事曆每小時一次。
const checked = { news: 0, week: 0 };
export function mountBriefing() {
  const now = Date.now();
  if (!news[offset] || offset === 0 && now - checked.news > 10 * 60e3) { checked.news = now; loadNews(); }
  if (!week || now - checked.week > 3600e3) { checked.week = now; loadWeek(); }
}

/* ---------- 版面 ---------- */
export function briefPage() {
  // 盤前焦點新聞來自鉅亨網（中文、台股為主）：台股或中文介面才顯示；其他情況只顯示本周大事紀
  const news = MK.market().id === 'TW' || zh();
  return `<div class="brief-grid${news ? '' : ' single'}">${news ? `<section class="panel brief" id="brief-news" aria-label="盤前焦點新聞">${newsBlock()}</section>` : ''}<section class="panel brief" id="brief-week" aria-label="本周大事紀">${weekBlock()}</section></div>`;
}

function newsBlock() {
  const n = news[offset], w = n?.window, items = n?.items || [];
  const count = k => k === 'all' ? items.length : k === 'must' ? items.filter(i => i.must).length : items.filter(i => i.section === k).length;
  const shown = section === 'all' ? items : section === 'must' ? items.filter(i => i.must) : items.filter(i => i.section === section);
  const status = !w ? '' : w.inProgress ? `<span class="tag amber">彙整中 · 至 ${hm(Math.min(Date.now(), n.fetchedAt))}</span>` : '<span class="tag cyan">已收齊</span>';
  return `<div class="panelhead"><div><h2><span class="idx">01</span>盤前焦點新聞</h2><p>${w ? `${windowLabel(w.start)} → ${windowLabel(w.end)} ${status}` : '前一交易日台股收盤 13:30 → 今日 06:00（美股收盤後）'}</p></div>
  <div class="actions"><div class="segmented" aria-label="新聞期間">${[[0, '本期'], [1, '上一期']].map(([v, l]) => `<button data-brief-offset="${v}" class="${offset === v ? 'selected' : ''}" aria-pressed="${offset === v}">${l}</button>`).join('')}</div><button class="textbtn" data-brief-refresh="news" ${loading.news ? 'disabled' : ''} title="重新取得">${loading.news ? '<i class="spinner"></i>' : '⟳'} 更新</button></div></div>
  ${items.length ? `<div class="brief-filters" role="group" aria-label="新聞分類">${SECTIONS.filter(([k]) => count(k)).map(([k, l]) => `<button data-brief-section="${k}" class="${section === k ? 'selected' : ''}" aria-pressed="${section === k}">${l}<b>${count(k)}</b></button>`).join('')}</div>` : ''}
  ${n?.error ? `<p class="notice ${items.length ? 'warn' : 'err'} brief-notice" role="alert">${esc(n.error)}</p>` : ''}
  <div class="brief-scroll">${!n && loading.news ? '<div class="empty"><i class="spinner"></i>正在讀取鉅亨網頭條…</div>'
    : shown.length ? `<ol class="brief-list">${shown.map(newsItem).join('')}</ol>`
    : n ? `<div class="empty"><h3>這段期間沒有焦點新聞</h3><p>${w?.inProgress ? '新聞會在台股收盤後陸續更新。' : '可切換「上一期」查看。'}</p></div>` : ''}</div>
  ${n ? `<p class="fine brief-foot">來源：<a href="${esc(n.source?.url)}" target="_blank" rel="noopener noreferrer">${esc(n.source?.title || '鉅亨網')}</a> · 共 ${items.length} 則 · 取得 ${mdhm(n.fetchedAt)} · 標題與摘要版權屬原媒體</p>` : ''}`;
}

function newsItem(i) {
  const st = ctx.state(), tw = i.tw.map(id => { const s = st?.stocks.find(x => x.id === id); return s ? `<button class="bi-chip in" data-stock="${esc(id)}" title="開啟走勢／五檔">${esc(s.name)} <span class="mono">${esc(id)}</span></button>` : `<button class="bi-chip mono" data-stock="${esc(id)}" title="開啟走勢／五檔">${esc(id)}</button>`; });
  const us = i.us.map(u => `<span class="bi-chip us">${esc(u.name)}</span>`);
  return `<li class="brief-item ${i.must ? 'must' : ''}"><div class="bi-meta"><time class="mono">${mdhm(i.time)}</time><span class="bi-cat">${esc(i.category)}</span>${i.must ? '<span class="bi-must">必讀</span>' : ''}</div>
  <a class="bi-title" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>${i.summary ? `<p class="bi-sum">${esc(i.summary)}</p>` : ''}${tw.length || us.length ? `<div class="bi-tags">${[...tw, ...us].join('')}</div>` : ''}</li>`;
}

function weekBlock() {
  const w = week, today = twToday(), now = Date.now();
  if (!w?.range) return `<div class="panelhead"><div><h2><span class="idx">02</span>本周大事紀</h2><p>重要經濟數據與科技大廠財報行程（台北時間）</p></div></div>${loading.week ? '<div class="empty"><i class="spinner"></i>正在讀取經濟與財報行事曆…</div>' : `<p class="notice err brief-notice" role="alert">${esc(w?.errors?.join('；') || '行事曆讀取失敗')}</p>`}`;
  const macro = kind === 'earnings' ? [] : w.macro, earnings = kind === 'macro' ? [] : w.earnings;
  const next = w.macro.find(e => !e.holiday && e.time > now);
  const days = w.range.days.map(d => ({ d, m: macro.filter(e => e.date === d), e: earnings.filter(e => e.date === d) })).filter(x => x.m.length || x.e.length);
  return `<div class="panelhead"><div><h2><span class="idx">02</span>本周大事紀</h2><p>${dayLabel(w.range.start)} – ${dayLabel(w.range.end)} · 經濟數據 ${w.macro.filter(e => !e.holiday).length} 項 · 財報 ${w.earnings.length} 家</p></div>
  <div class="actions"><div class="segmented" aria-label="事件類型">${[['all', '全部'], ['macro', '經濟數據'], ['earnings', '財報']].map(([v, l]) => `<button data-brief-kind="${v}" class="${kind === v ? 'selected' : ''}" aria-pressed="${kind === v}">${l}</button>`).join('')}</div><button class="textbtn" data-brief-refresh="week" ${loading.week ? 'disabled' : ''} title="重新取得">${loading.week ? '<i class="spinner"></i>' : '⟳'} 更新</button></div></div>
  ${(w.errors || []).map(e => `<p class="notice warn brief-notice" role="alert">${esc(e)}</p>`).join('')}
  ${next && kind !== 'earnings' ? `<div class="brief-next"><span>下一個數據</span><b>${dayLabel(next.date)} ${hm(next.time)}</b><em>${esc(next.countryName)} · ${esc(next.title)}</em></div>` : ''}
  <div class="brief-scroll">${days.length ? days.map(({ d, m, e }) => `<section class="wk-day ${d < today ? 'past' : ''} ${d === today ? 'today' : ''}"><h3>${dayLabel(d)}${d === today ? '<span class="tag cyan">今天</span>' : ''}</h3>
    ${m.map(ev => macroRow(ev, ev === next, now)).join('')}${e.map(earnRow).join('')}</section>`).join('') : '<div class="empty"><h3>本周沒有符合條件的事件</h3></div>'}</div>
  <p class="fine brief-foot">來源：${(w.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join(' · ')} · 取得 ${mdhm(w.fetchedAt)} · 經濟數據收錄美、中、歐、日的中高重要性項目；財報收錄科技大廠及市值千億美元以上企業。時間皆為台北時間，可能異動，以官方公布為準。</p>`;
}

function macroRow(e, isNext, now) {
  const nums = [e.forecast && `預估 <b>${esc(e.forecast)}</b>`, e.previous && `前值 ${esc(e.previous)}`].filter(Boolean).join(' · ');
  return `<div class="ev ${e.impact === 'High' ? 'hi' : ''} ${e.holiday ? 'holiday' : ''} ${!e.holiday && e.time < now ? 'done' : ''} ${isNext ? 'next' : ''}"><time class="mono">${e.holiday ? '全天' : hm(e.time)}</time><span class="ev-flag c-${esc(e.country)}">${esc(e.countryName)}</span>
  <div class="ev-body"><b translate="no">${esc(zh() ? e.title : e.titleEn || e.title)}</b>${zh() && e.title !== e.titleEn ? `<small>${esc(e.titleEn)}</small>` : ''}</div><div class="ev-num">${nums}</div></div>`;
}
function earnRow(e) {
  const hint = e.timing === '盤前' ? '台灣當晚公布' : e.timing === '盤後' ? '台灣隔日清晨公布' : '';
  return `<div class="ev earn ${e.tech ? 'tech' : ''}"><time>${esc(e.timing)}</time><span class="ev-flag earn">財報</span>
  <div class="ev-body"><b translate="no">${esc(zh() && e.zh || e.name)} <span class="mono">${esc(e.symbol)}</span></b><small>${[zh() && e.zh ? e.name : '', cap(e.cap), hint].filter(Boolean).map(esc).join(' · ')}</small></div><div class="ev-num">${e.eps ? `EPS 預估 <b>${esc(e.eps)}</b>` : ''}</div></div>`;
}

/* ---------- 互動 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.briefOffset !== undefined) { offset = Number(b.dataset.briefOffset); section = 'all'; paint('news'); if (!news[offset]) loadNews(); else mountBriefing(); }
  else if (b.dataset.briefSection) { section = b.dataset.briefSection; paint('news'); }
  else if (b.dataset.briefKind) { kind = b.dataset.briefKind; paint('week'); }
  else if (b.dataset.briefRefresh === 'news') loadNews(true);
  else if (b.dataset.briefRefresh === 'week') loadWeek(true);
});
