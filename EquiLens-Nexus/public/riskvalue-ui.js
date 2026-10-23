// 風控水位與低估選股的畫面（電腦版與手機版共用；兩邊各有一份，內容必須完全相同）。
// 按鈕以 data-rv 標記動作，由各自的頁面程式處理；股票名稱沿用 data-alert-stock 開啟個股視窗。
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, n = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const sign = (v, n = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}`;
const TONES = ['low', 'lowish', 'mid', 'highish', 'high'];
const toneOf = r => r == null ? 'na' : TONES[r < 25 ? 0 : r < 40 ? 1 : r < 60 ? 2 : r < 75 ? 3 : 4];

// 半圓儀表：0（左，低風險）～100（右，高風險）
export function gaugeSVG(risk) {
  const cx = 100, cy = 100, R = 80, pt = (v, r = R) => { const a = Math.PI * (1 - v / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const segs = [[0, 25, 'low'], [25, 40, 'lowish'], [40, 60, 'mid'], [60, 75, 'highish'], [75, 100, 'high']].map(([a, b, k]) => `<path class="rv-seg rv-${k}" d="${arc(a + 0.6, b - 0.6)}"/>`).join('');
  const needle = risk == null ? '' : (() => { const [x, y] = pt(risk, R - 18); return `<line class="rv-needle" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="rv-hub" cx="${cx}" cy="${cy}" r="6"/>`; })();
  return `<svg class="rv-gauge" viewBox="0 0 200 112" role="img" aria-label="風險分數 ${risk ?? '—'}">${segs}${needle}</svg>`;
}

// 近 N 日風險分數（左軸 0～100）與加權指數（右側，依區間縮放）
export function riskHistorySVG(history = [], indexName = '加權指數') {
  const h = history.filter(x => x[1] != null); if (h.length < 2) return '';
  const W = 600, H = 150, P = 6, x = i => P + i * (W - 2 * P) / (h.length - 1), y = v => P + (100 - v) * (H - 2 * P) / 100;
  const ix = h.map(r => r[3]).filter(v => v != null), lo = Math.min(...ix), hi = Math.max(...ix), iy = v => P + (hi === lo ? 0.5 : (hi - v) / (hi - lo)) * (H - 2 * P);
  const line = (f, sel) => h.map((r, i) => sel(r) == null ? '' : `${i && sel(h[i - 1]) != null ? 'L' : 'M'}${x(i).toFixed(1)} ${f(sel(r)).toFixed(1)}`).join('');
  const bands = [[75, 100, 'high'], [60, 75, 'highish'], [40, 60, 'mid'], [25, 40, 'lowish'], [0, 25, 'low']].map(([a, b, k]) => `<rect class="rv-band rv-${k}" x="0" y="${y(b)}" width="${W}" height="${y(a) - y(b)}"/>`).join('');
  return `<svg class="rv-hist" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="風險分數走勢">${bands}<path class="rv-ixline" d="${line(iy, r => r[3])}"/><path class="rv-rline" d="${line(y, r => r[1])}"/></svg>
  <div class="rv-hist-axis"><span>${esc(h[0][0])}</span><span><i class="rv-key rv-rkey"></i>風險分數 <i class="rv-key rv-ikey"></i>${esc(indexName)}</span><span>${esc(h.at(-1)[0])}</span></div>`;
}

const factorValue = f => f.value == null ? '—' : f.unit === 'bp' ? sign(f.value, 0) + ' bp' : f.show === 'plain' ? fmt(f.value, 2) + (f.unit || '') : f.key === 'foreignFut' ? sign(f.value, 0) + ' 口' : f.key === 'foreignSpot' ? sign(f.value, 0) + ' 億' : f.key === 'retail' ? sign(f.value, 2) + '%' : sign(f.value, 2) + '%';
function factorRow(f) {
  const t = toneOf(f.risk), w = f.risk == null ? 0 : Math.max(3, f.risk);
  return `<div class="rv-factor"><div class="rv-fhead"><b>${esc(f.name)}</b><span class="rv-fval num">${factorValue(f)}</span></div>
  <div class="rv-bar"><i class="rv-${t}" style="width:${w}%"></i></div>
  <div class="rv-fmeta"><span>${f.risk == null ? '資料不足' : `風險 ${fmt(f.risk)}`}${f.pct != null ? (f.dir > 0 ? ` · 高於一年中 ${fmt(f.pct)}% 的日子` : ` · 低於一年中 ${fmt(100 - f.pct)}% 的日子`) : ''}${f.key === 'trend' && f.detail ? ` · 20 日線${f.detail.up ? '在' : '跌破'} 60 日線${f.detail.up ? '之上' : ''}` : ''}</span><span class="soft">權重 ${f.weight}%</span></div>
  <p class="rv-fdesc">${esc(f.desc)}</p></div>`;
}

export function riskHTML(info, { compact = false } = {}) {
  if (!info) return '<p class="ix-empty">讀取中…</p>';
  if (!info.capable) return '<p class="ix-empty">風控水位目前只支援台股與美股。</p>';
  const d = info.data, busy = info.busy ? `<span class="rv-busy"><i class="spinner"></i>更新中 ${info.step + 1}/${info.total}</span>` : '';
  const btn = `<button class="rv-btn" data-rv="risk-query" ${info.busy ? 'disabled' : ''}>⟳ 更新</button>`;
  const err = info.error ? `<p class="rv-err">${esc(info.error)}</p>` : '';
  if (!d?.available) return `<div class="rv-empty"><p>${info.busy ? '第一次取得一年份的指標資料，約需 1 分鐘…' : '尚無風控水位資料。'}</p>${busy || btn}${err}</div>`;
  const t = toneOf(d.risk), chg = (v, label) => v == null ? '' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}">${label} ${sign(v)}</span>`;
  const head = `<div class="rv-head"><div class="rv-dial">${gaugeSVG(d.risk)}<div class="rv-score num">${fmt(d.risk)}<small>風險分數</small></div></div>
    <div class="rv-main"><div class="rv-level rv-t-${t}">${esc(d.label)}</div>
      <div class="rv-expo"><span>建議持股</span><b class="num">${fmt(d.exposure)}%</b><span class="soft">現金 ${fmt(100 - d.exposure)}%</span></div>
      <div class="rv-split"><i style="width:${d.exposure}%"></i></div>
      <div class="rv-meta"><span>${esc(d.date)}</span>${chg(d.change1, '較前日')}${chg(d.change5, '較一週前')}${d.coverage < 100 ? `<span class="amber">指標涵蓋 ${d.coverage}%</span>` : ''}</div></div></div>`;
  const tags = d.summary?.length ? `<div class="rv-tags">${d.summary.map(s => `<span class="rv-tag ${s.tone === 'risk' ? 'rv-tag-risk' : 'rv-tag-calm'}">${s.tone === 'risk' ? '▲' : '▼'} ${esc(s.name)} ${fmt(s.risk)}</span>`).join('')}</div>` : '';
  if (compact) return `<div class="rv-compact">${head}</div>${tags}<div class="rv-actions"><button class="rv-btn" data-rv="risk-open">看完整分析 ›</button>${busy}</div>${err}`;
  const groups = [...new Set(d.factors.map(f => f.group))].map(g => `<div class="rv-group"><h4>${esc(g)}</h4>${d.factors.filter(f => f.group === g).map(factorRow).join('')}</div>`).join('');
  const ex = info.explain && info.explain.date === d.date ? info.explain : null;
  const ai = `<div class="rv-ai"><div class="rv-ai-head"><b>AI 解讀</b>${info.llm ? `<button class="rv-btn" data-rv="risk-explain" ${info.explainBusy ? 'disabled' : ''}>${info.explainBusy ? '<i class="spinner"></i>產生中…' : ex ? '重新產生' : '產生解讀'}</button>` : '<span class="soft">需先在電腦版「資料與設定」設定推理模型</span>'}</div>
    ${ex ? `<p class="rv-ai-title">${esc(ex.headline)}</p><ul>${ex.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>${ex.watch.length ? `<p class="rv-ai-sub">下週觀察</p><ul>${ex.watch.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${ex.stance ? `<p class="rv-ai-stance">${esc(ex.stance)}</p>` : ''}<p class="soft rv-small">${esc(ex.model || '')} · ${esc(String(ex.createdAt || '').slice(0, 16).replace('T', ' '))}</p>` : info.llm ? '<p class="soft rv-small">讓 AI 根據下方指標寫出風險來源、相互印證的訊號與下週觀察重點。</p>' : ''}</div>`;
  return `${head}${tags}<div class="rv-actions">${btn}${busy}</div>${err}${ai}
    <div class="rv-sect"><h4>近 ${d.history.length} 個交易日</h4>${riskHistorySVG(d.history, d.indexName || '加權指數')}</div>
    <div class="rv-factors">${groups}</div>
    <p class="ix-foot">風險分數＝各指標與自己過去一年相比的位置（百分位）加權平均，0 最安全、100 最危險；建議持股＝100 − 分數，取 10% 為單位，介於 20%～90%。${d.market === 'US' ? '資料來自 FRED、Cboe 與 Nasdaq（免金鑰），每天台北時間 08:40 與 20:40 自動更新' : '平日 15:40 與 21:40 自動更新（融資約晚上公布）'}，等級改變時推播。這是依公開資料計算的參考指標，不是買賣建議。</p>`;
}

const STRAT_ORDER = ['value', 'garp', 'income'];
const TURNOVER = [[0, '不限'], [5e6, '500 萬'], [1e7, '1,000 萬'], [3e7, '3,000 萬'], [1e8, '1 億']];
function stockCard(r, i) {
  const m = (label, v, extra = '') => `<span><small>${label}</small><b class="num">${v}</b>${extra ? `<small class="soft">${extra}</small>` : ''}</span>`;
  return `<div class="rv-stock"><div class="rv-shead"><span class="rv-rank num">${i + 1}</span><button class="ix-cw-stock rv-sname" data-alert-stock="${esc(r.id)}">${esc(r.name)} <small class="num">${esc(r.id)}</small></button><small class="soft">${esc(r.sector || '')}</small>
    <span class="rv-sscore num">${fmt(r.score)}</span><button class="rv-watch ${r.watch ? 'on' : ''}" data-rv-watch="${esc(r.id)}" aria-pressed="${!!r.watch}" title="${r.watch ? '從自選移除' : '加入自選'}">${r.watch ? '★' : '☆'}</button></div>
    <div class="rv-metrics">${m('本益比', fmt(r.pe, 1), `同業 ${fmt(r.peerPE, 1)}`)}${m('淨值比', fmt(r.pb, 2))}${m('殖利率', fmt(r.yield, 2) + '%')}${m('ROE', fmt(r.roe, 1) + '%')}${m('營收年增', sign(r.revCumYoY) + '%', '今年累計')}${m('收盤', fmt(r.close, 2))}</div>
    ${r.reasons.length ? `<div class="rv-why">${r.reasons.map(x => `<span>✓ ${esc(x)}</span>`).join('')}</div>` : ''}${r.warnings.length ? `<div class="rv-warn">${r.warnings.map(x => `<span>⚠ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`;
}
export function valueHTML(info, { limit = 30 } = {}) {
  if (!info) return '<p class="ix-empty">讀取中…</p>';
  if (!info.capable) return '<p class="ix-empty">低估選股目前只支援台股。</p>';
  const st = info.strategies[info.strategy], r = info.result;
  const tabs = `<div class="rv-strats">${STRAT_ORDER.map(k => `<button data-rv-strategy="${k}" class="${info.strategy === k ? 'selected' : ''}" aria-pressed="${info.strategy === k}">${esc(info.strategies[k].name)}</button>`).join('')}</div>`;
  const ctl = `<div class="rv-ctl"><label>成交金額 ≥ <select id="rv-turnover">${TURNOVER.map(([v, l]) => `<option value="${v}" ${info.minTurnover === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="rv-btn" data-rv="value-query" ${info.busy ? 'disabled' : ''}>${info.busy ? `<i class="spinner"></i>更新中 ${info.step + 1}/${info.total}` : '⟳ 更新資料'}</button></div>`;
  const meta = `<p class="rv-desc">${esc(st.desc)}</p><div class="ix-bmeta">${info.valDate ? `<span>本益比 <b>${esc(info.valDate)}</b></span>` : ''}${info.revMonth ? `<span>月營收 <b>${esc(info.revMonth)}</b></span>` : ''}${r ? `<span>可比較 ${fmt(r.eligible)} 檔 · 符合 <b>${fmt(r.matched)}</b> 檔</span>` : ''}</div>`;
  const err = info.error ? `<p class="rv-err">${esc(info.error)}</p>` : '';
  const body = !r ? `<div class="rv-empty"><p>${info.busy ? '正在取得全市場本益比、月營收與收盤行情（約 30 秒）…' : '尚無選股資料，按「更新資料」取得。'}</p></div>`
    : r.rows.length ? `<div class="rv-list">${r.rows.slice(0, limit).map(stockCard).join('')}</div>` : '<p class="ix-empty">沒有符合條件的股票，試著放寬成交金額門檻。</p>';
  return `${tabs}${ctl}${err}${meta}${body}
    <p class="ix-foot">本益比與淨值比和同產業比較（同業少於 6 檔時與全市場比較），ROE＝淨值比 ÷ 本益比（估算），營收成長、ROE 與殖利率和全市場比較。分數 0～100，依策略權重加總。資料：證交所與櫃買中心開放資料（免金鑰），平日 18:40 後更新。低本益比可能來自一次性獲利或產業循環高點，請搭配財報與產業狀況判斷；這不是買賣建議。</p>`;
}

// 個股判讀卡：綜合判讀、撐壓位、三大法人近 20 日、融資（股票視窗頂端）
function instBars(list = []) {
  if (!list.length) return '';
  const W = 300, H = 56, max = Math.max(...list.map(x => Math.abs(x.amount ?? 0)), 0.01), bw = W / list.length;
  return `<svg class="vd-bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="法人每日買賣超">${list.map((x, i) => { const v = x.amount ?? 0, h = Math.max(1.5, Math.abs(v) / max * (H / 2 - 2)); return `<rect class="${v >= 0 ? 'vd-up' : 'vd-down'}" x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(v >= 0 ? H / 2 - h : H / 2).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}"/>`; }).join('')}<line class="vd-zero" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/></svg>`;
}
export function verdictHTML(v) {
  if (!v) return '<p class="ix-empty">讀取中…</p>';
  if (!v.available) return '<p class="ix-empty">這檔股票還沒有日 K 資料，更新研究資料後即可判讀。</p>';
  const c = x => x == null ? 'muted' : x > 0 ? 'up' : x < 0 ? 'down' : 'muted', yi = x => x == null ? '—' : sign(x, Math.abs(x) >= 100 ? 0 : 1);
  const head = `<div class="vd-price"><b class="num ${c(v.change)}">${fmt(v.price, 2)}</b><span class="num ${c(v.change)}">${sign(v.change, 2)}　${sign(v.pct, 2)}%</span></div>
    <div class="vd-chips">${v.limit ? `<span class="vd-chip ${v.limit.kind.startsWith('up') ? 'vd-chip-up' : 'vd-chip-down'}">${esc(v.date.slice(5).replace('-', '/'))} ${esc(v.limit.label)}</span>` : ''}<span class="vd-chip">${v.session === 'live' ? '盤中' : '收盤'}</span>${v.amount ? `<span class="vd-chip">成交 ${fmt(v.amount / 1e8, 1)} 億</span>` : ''}</div>`;
  const pts = v.points.length ? `<div class="vd-box"><h4>綜合判讀</h4><ul>${v.points.map(p => `<li class="vd-${p.tone}">${esc(p.text)}</li>`).join('')}</ul></div>` : '';
  const tags = v.tags?.length ? `<p class="vd-tags">${v.tags.map(esc).join(' · ')}</p>` : '';
  const L = v.levels, lv = L ? `<div class="vd-sec"><div class="vd-sh"><b>撐壓位</b><span class="soft">${esc(L.appliesTo.slice(5).replace('-', '/'))} 適用</span></div>
    <div class="vd-track"><i style="left:${L.pct.toFixed(1)}%" class="${L.above ? 'vd-up' : L.below ? 'vd-down' : ''}"></i></div>
    <div class="vd-lv"><span><small>支撐</small><b class="num down">${fmt(L.support, 2)}</b></span><span><small>交界</small><b class="num">${fmt(L.pivot, 2)}</b></span><span><small>壓力</small><b class="num up">${fmt(L.resistance, 2)}</b></span></div>
    <p class="vd-small">距壓力 <span class="${c(L.toR)}">${sign(L.toR)}%</span>　距支撐 <span class="${c(L.toS)}">${sign(L.toS)}%</span>　· 以 ${esc(L.from.slice(5).replace('-', '/'))} 高低收計算的樞紐點，波動參考位，非進出場訊號</p></div>` : '';
  const I = v.institutions, ins = I ? `<div class="vd-sec"><div class="vd-sh"><b>三大法人 近 ${I.days} 日</b><span class="soft">${esc(I.asOf.slice(5).replace('-', '/'))} 公布</span></div>
    <div class="vd-ih"><b class="${I.total > 0 ? 'up' : I.total < 0 ? 'down' : ''}">${esc(I.label)}</b><span class="muted">買超 ${I.buyDays}/${I.days} 日</span><b class="num ${c(I.total)}">${yi(I.total)} 億</b></div>
    ${instBars(I.list)}<div class="vd-lv"><span><small>外資</small><b class="num ${c(I.foreign)}">${yi(I.foreign)}</b></span><span><small>投信</small><b class="num ${c(I.trust)}">${yi(I.trust)}</b></span><span><small>自營</small><b class="num ${c(I.dealer)}">${yi(I.dealer)}</b></span></div></div>` : '';
  const M = v.margin, mg = M ? `<div class="vd-sec"><div class="vd-sh"><b>融資</b><span class="soft">${esc(M.asOf.slice(5).replace('-', '/'))}</span></div>
    <div class="vd-lv"><span><small>餘額</small><b class="num">${fmt(M.balance)}</b></span><span><small>單日</small><b class="num ${c(M.d1)}">${sign(M.d1, 0)}</b></span><span><small>5 日</small><b class="num ${c(M.d5)}">${sign(M.d5, 0)}</b></span><span><small>使用率</small><b class="num">${M.usage == null ? '—' : fmt(M.usage, 1) + '%'}</b></span></div></div>` : '';
  return `<div class="vd">${head}${pts}${tags}${lv}${ins}${mg}<p class="ix-foot">判讀依本機日 K、法人與融資資料整理，僅供研究參考，不是買賣建議。</p></div>`;
}

// ---- 訊號面板（ATR 追蹤線訊號、共振、交易計畫） ----
const px = v => fmt(v, Number.isInteger(Number(v)) ? 0 : 2);
const md = d => esc(String(d || '').slice(5).replace('-', '/'));
// 近 90 根 K 棒、追蹤線（多方段與空方段分色）、訊號點與最新訊號的進場／停損／停利線
export function signalChartSVG(d) {
  const c = d.chart; if (!c?.bars?.length) return '';
  const W = 600, H = 210, padR = 54, n = c.bars.length, bw = (W - padR) / n, s = d.signal;
  const lv = s ? [s.entry, s.stop, ...s.targets.map(t => t.price)] : [];
  const lo = Math.min(...c.bars.map(b => b[3]), ...c.line.filter(Boolean).map(l => l[0]), ...lv), hi = Math.max(...c.bars.map(b => b[2]), ...c.line.filter(Boolean).map(l => l[0]), ...lv);
  const y = v => (8 + (hi - v) / ((hi - lo) || 1) * (H - 16)).toFixed(1), x = i => (i * bw + bw / 2).toFixed(1);
  const candles = c.bars.map((b, i) => { const up = b[4] >= b[1]; return `<g class="${up ? 'sg-cu' : 'sg-cd'}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(b[2])}" y2="${y(b[3])}"/><rect x="${(i * bw + bw * 0.18).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" y="${y(Math.max(b[1], b[4]))}" height="${Math.max(1, y(Math.min(b[1], b[4])) - y(Math.max(b[1], b[4]))).toFixed(1)}"/></g>`; }).join('');
  let path = '', prev = null; const segs = [];
  c.line.forEach((l, i) => { if (!l) { prev = null; return; } if (!prev || prev[1] !== l[1]) { segs.push({ dir: l[1], pts: [] }); } segs.at(-1).pts.push(`${x(i)},${y(l[0])}`); prev = l; });
  path = segs.map(g => `<polyline class="${g.dir > 0 ? 'sg-lu' : 'sg-ld'}" points="${g.pts.join(' ')}"/>`).join('');
  const marks = c.flips.map(([i, dir]) => dir > 0 ? `<path class="sg-mu" d="M${x(i)} ${(+y(c.bars[i][3]) + 4).toFixed(1)}l-5 9h10z"/>` : `<path class="sg-md" d="M${x(i)} ${(+y(c.bars[i][2]) - 4).toFixed(1)}l-5 -9h10z"/>`).join('');
  const start = s ? Math.max(0, c.bars.findIndex(b => b[0] === s.date)) : 0;
  const hl = (v, cls, label) => `<line class="${cls}" x1="${x(start)}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="${cls}-t" x="${W - padR + 4}" y="${(+y(v) + 4).toFixed(1)}">${esc(label)}</text>`;
  const lines = s ? [hl(s.entry, 'sg-le', '進 ' + px(s.entry)), hl(s.stop, 'sg-ls', '損 ' + px(s.stop)), ...s.targets.map((t, k) => hl(t.price, 'sg-lt', `TP${k + 1}`))].join('') : '';
  return `<svg class="sg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="近 ${n} 日 K 線與追蹤線">${candles}${path}${lines}${marks}</svg>`;
}
export function signalHTML(d, { editable = false } = {}) {
  if (!d) return '<p class="ix-empty">讀取中…</p>';
  if (!d.available) return `<p class="ix-empty">${esc(d.reason || '這檔股票還沒有日 K 資料')}</p>`;
  const tone = x => x > 0 ? 'up' : x < 0 ? 'down' : 'muted', row = (k, v) => `<div class="sg-row"><span>${k}</span><b>${v}</b></div>`;
  const R = d.resonance, s = d.signal, F = d.flow, V = d.volatility;
  const core = `<h4 class="sg-h">核心分析</h4>
    ${row('大週期共振', `<span class="${tone(R.tone)}">${esc(R.label)}</span> <span class="soft">(多${R.bull} / 空${R.bear}${R.frames.length ? '　' + R.frames.map(f => `${esc(f.label)}${f.trend > 0 ? '↑' : f.trend < 0 ? '↓' : '→'}`).join(' ') : ''})</span>`)}
    ${row('市場狀態', `<span class="amber">${esc(d.regime || '—')}</span>`)}
    ${row('波動狀態', V ? `${esc(V.label)} <span class="soft">ATR ${fmt(V.atrPct, 2)}%</span>` : '—')}
    ${row('量能流向', F ? `<span class="${tone(F.tone)}">${esc(F.label)} ${F.pct}%</span>` : '—')}`;
  const track = s ? `<h4 class="sg-h">訊號追蹤</h4>
    ${row('最新訊號', `<span class="${s.side === 'buy' ? 'up' : 'down'}">${esc(s.label)} @ ${px(s.entry)}</span> <span class="soft">(${md(s.date)}，${s.age ? s.age + ' 根前' : '最新一根'})</span>`)}
    ${row('與大趨勢', d.align === 'with' ? '<span class="sg-ok">順大趨勢</span>' : d.align === 'against' ? '<span class="amber">逆大趨勢</span>' : '<span class="muted">週線中性</span>')}
    ${row('現在可進場？', `<span class="${s.entryNow.ok ? 'sg-ok' : 'amber'}">${esc(s.entryNow.label)}</span>`)}
    ${row('信心分數', `<span class="sg-bar"><i style="width:${d.confidence}%"></i></span> <span class="num">${d.confidence}/100</span>`)}
    ${row('目前 ADX', `<span class="amber num">${fmt(d.adx, 1)} (${esc(d.adxLabel || '—')})</span>`)}` : `<h4 class="sg-h">訊號追蹤</h4><p class="soft">資料期間內還沒有訊號。</p>`;
  const Z = d.size, cur = d.settings || {};
  const size = Z ? (Z.lot > 1 ? `${Z.lots ? `${fmt(Z.lots)} 張` : ''}${Z.odd ? `${Z.lots ? '＋' : ''}${fmt(Z.odd)} 股零股` : ''}${!Z.lots && !Z.odd ? '0' : ''} <span class="soft">(風險 ${fmt(Z.risk)} ／預算 ${fmt(Z.budget)})</span>${Z.over ? ` <span class="amber">⚠ 一張風險 ${fmt(Z.oneLotRisk)} 超過預算</span>` : ''}` : `${fmt(Z.shares)} 股 <span class="soft">(風險 ${fmt(Z.risk)} ／預算 ${fmt(Z.budget)})</span>`)
    : s && !s.stopped && s.status.kind !== 'done' ? '<span class="soft">設定資金與每筆風險後顯示</span>' : '—';
  const plan = s ? `<h4 class="sg-h">交易計畫（依最新訊號）</h4>
    ${row('進場價', `<span class="num">${px(s.entry)}</span>`)}
    ${row('停損價', `<span class="num sg-bad">${px(s.stop)}</span> <span class="soft">(${fmt(d.params.stopAtr, 1)} 倍 ATR)</span>`)}
    ${s.targets.map((t, k) => row(`停利 ${k + 1}`, `<span class="num sg-ok">${px(t.price)}</span> <span class="soft">(${t.r}R)</span>${t.hit ? ' ✓' : ''}`)).join('')}
    ${row('目前結果', `<span class="${s.status.kind === 'stopped' ? 'amber' : 'sg-ok'}">${esc(s.status.label)}</span>`)}
    ${row('建議張數', size)}
    ${row('持倉立場', `<span class="${tone(d.stance.tone)}">${esc(d.stance.label)}</span>`)}
    ${row('追蹤停損線', `<span class="amber num">${px(d.trail)}</span>`)}` : '';
  const H = d.history, foot = `<h4 class="sg-h">資料</h4>
    ${row('K 線', `日線，資料到 ${md(d.date)}${d.provisional ? '（今天盤中，暫定）' : ''}`)}
    ${H ? row('過去訊號', `${H.trades} 次，先到 TP1 ${H.tp1} 次（${H.rate}%）、先停損 ${H.stopped} 次`) : ''}`;
  const form = editable ? `<form class="sg-form" data-sg-settings="${esc(d.id)}"><label>總資金<input name="capital" type="number" min="0" step="1000" inputmode="numeric" value="${cur.capital ?? ''}" placeholder="例如 1000000"></label><label>每筆風險 %<input name="riskPct" type="number" min="0.1" max="20" step="0.1" value="${cur.riskPct ?? ''}" placeholder="1"></label><button type="submit">儲存</button><span class="soft" data-sg-msg></span></form>` : '';
  return `<div class="sg">${signalChartSVG(d)}<div class="sg-grid"><div>${core}${track}</div><div>${plan}${foot}</div></div>${form}<p class="ix-foot">ATR 追蹤線（${d.params.stPeriod} 日、${d.params.stMult} 倍）翻轉即為訊號，停損 ${d.params.stopAtr} 倍 ATR、停利 ${d.params.targets.join('／')}R；以日線計算，僅供研究參考，不是買賣建議。</p></div>`;
}
