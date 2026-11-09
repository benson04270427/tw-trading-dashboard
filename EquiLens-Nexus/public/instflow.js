// 法人資金板塊頁（台股）：板塊法人資金四象限泡泡圖、錢流去哪、跟平常比／買賣換邊、個股異常爆買爆賣、法人成本與乖離。
// 資料：GET /api/instflow?date=&by=group|industry；POST /api/instflow/query 在背景補齊近 21 個交易日，畫面每 3 秒查進度。
import * as MK from './market.js';
let C = null; // { api, toast, page, openStock, esc }
const S = { res: null, by: 'group', date: '', loading: false, error: '', sel: '', money: 'today', side: 'sell', costScope: 'focus', costSort: 'all', one: null, oneError: '', loaded: false, poll: null };
export function initInstFlow(ctx) { C = ctx; }
const fmt = (v, n = 2) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
const sgn = (v, n = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}`;
const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}%`;
const cls = v => v == null || v === 0 ? 'muted' : v > 0 ? 'up' : 'down';
const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
const STATE = { surge: ['漲潮', '加速流入'], rotate: ['輪動', '流入但放緩'], wait: ['觀望', '流出但放緩'], ebb: ['退潮', '加速流出'] };
const repaint = () => { if (C?.page() !== 'instflow') return; const pc = document.getElementById('pagecontent'); if (pc) { const y = window.scrollY; pc.innerHTML = instFlowPage(); window.scrollTo(0, y); } };

export async function enterInstFlow() { if (!S.loaded) { S.loaded = true; await load(); } else repaint(); }
async function load() {
  S.loading = true; S.error = ''; repaint();
  try { S.res = await C.api(`instflow?by=${S.by}${S.date ? '&date=' + S.date : ''}`); if (S.sel && !S.res.data?.sectors.some(s => s.name === S.sel)) S.sel = ''; }
  catch (e) { S.error = e.message; }
  S.loading = false; repaint(); watch();
}
function watch() {
  clearTimeout(S.poll);
  if (!S.res?.query?.busy) return;
  S.poll = setTimeout(async () => { try { const r = await C.api(`instflow?by=${S.by}${S.date ? '&date=' + S.date : ''}`); const done = !r.query.busy; S.res = r; repaint(); if (done) C.toast('法人資金板塊已更新'); else watch(); } catch { watch(); } }, 3000);
}
async function query() {
  try { const r = await C.api('instflow/query', S.date ? { date: S.date } : {}); S.res = { ...(S.res || {}), query: r.query }; repaint(); watch(); }
  catch (e) { S.error = e.message; repaint(); }
}

// 對稱對數刻度：大小板塊同時看得清楚（單位：億元）
const slog = v => Math.sign(v) * Math.log10(1 + Math.abs(v));
function bubbles(d) {
  const W = 760, H = 460, P = { l: 56, r: 18, t: 30, b: 42 }, list = d.sectors.filter(s => s.state);
  if (!list.length) return '<div class="empty">前面累積的交易日不足 10 日，還不能和平常比較；請按「更新資料」補齊近 21 個交易日。</div>';
  const mx = Math.max(1, ...list.map(s => Math.abs(slog(s.flow5)))), my = Math.max(1, ...list.map(s => Math.abs(slog(s.bias))));
  const X = v => P.l + (slog(v) / mx * .88 + 1) / 2 * (W - P.l - P.r), Y = v => P.t + (1 - (slog(v) / my * .86 + 1) / 2) * (H - P.t - P.b);
  const mt = Math.max(1, ...list.map(s => Math.abs(s.today))), R = v => 7 + Math.sqrt(Math.abs(v) / mt) * 26;
  const col = { surge: MK.upColors().up, rotate: '#ffc34d', wait: '#6b84a6', ebb: MK.upColors().down };
  const ticks = m => { const out = [0]; for (let p = 0; p <= 4; p++) { const v = 10 ** p; if (slog(v) <= m) out.push(v, -v); } return out; };
  const lbl = new Set([...list].sort((a, b) => Math.abs(b.flow5) - Math.abs(a.flow5)).slice(0, 14).map(s => s.name));
  const grid = ticks(mx).map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${P.t}" y2="${H - P.b}" class="if-grid ${v === 0 ? 'zero' : ''}"/><text x="${X(v)}" y="${H - P.b + 16}" class="if-tick" text-anchor="middle">${v > 0 ? '+' : ''}${fmt(v, 0)}</text>`).join('')
    + ticks(my).map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="if-grid ${v === 0 ? 'zero' : ''}"/><text x="${P.l - 6}" y="${Y(v) + 4}" class="if-tick" text-anchor="end">${v > 0 ? '+' : ''}${fmt(v, 0)}</text>`).join('');
  const dots = [...list].sort((a, b) => Math.abs(b.today) - Math.abs(a.today)).map(s => `<g class="if-dot ${S.sel === s.name ? 'sel' : ''}" data-if-sector="${C.esc(s.name)}" tabindex="0" role="button"><title>${C.esc(s.name)}｜近 5 日 ${sgn(s.flow5)} 億｜今天比平常 ${sgn(s.bias)} 億｜今天 ${sgn(s.today)} 億</title><circle cx="${X(s.flow5)}" cy="${Y(s.bias)}" r="${R(s.today)}" fill="${col[s.state]}" fill-opacity=".28" stroke="${col[s.state]}"/>${lbl.has(s.name) || S.sel === s.name ? `<text x="${X(s.flow5)}" y="${Y(s.bias) + 4}" text-anchor="middle" class="if-lbl">${C.esc(s.name.length > 7 ? s.name.slice(0, 7) + '…' : s.name)}</text>` : ''}</g>`).join('');
  return `<svg class="if-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="板塊法人資金泡泡圖">${grid}<text x="${W - P.r}" y="${H - 6}" class="if-axis" text-anchor="end">近 5 日資金流入（億）→</text><text x="${P.l}" y="14" class="if-axis">↑ 今天比平常更偏買（億）</text>${dots}</svg>`;
}
function sectorDetail(d) {
  const s = d.sectors.find(x => x.name === S.sel); if (!s) return '<p class="fine" style="padding:12px 18px">點泡泡或下方板塊名稱，查看成分股的法人買賣。</p>';
  return `<div class="if-detail"><h3>${C.esc(s.name)} <span class="tag">${s.state ? STATE[s.state][0] : '累積中'}</span></h3><p class="fine">${s.count} 檔 · 今天 <b class="${cls(s.today)}">${sgn(s.today)} 億</b> · 近 5 日 <b class="${cls(s.flow5)}">${sgn(s.flow5)} 億</b> · 平常單日 ${sgn(s.base)} 億${s.ratio != null ? ` · 力道約平常 ${fmt(s.ratio, 1)} 倍` : ''}</p>
    <table class="if-table"><thead><tr><th class="l">成分股</th><th>法人（億）</th><th>漲跌</th></tr></thead><tbody>${s.stocks.map(x => `<tr><td><button class="stocklink" data-if-stock="${x.id}">${C.esc(x.name)} <span class="stockcode">${x.id}</span></button></td><td class="num ${cls(x.net)}">${sgn(x.net, 2)}</td><td class="num ${cls(x.change)}">${pct(x.change)}</td></tr>`).join('')}</tbody></table></div>`;
}
const bar = (list, max) => list.map(x => `<div class="sector-item"><div class="sector-top"><button class="textbtn" data-if-sector="${C.esc(x.name)}">${C.esc(x.name)}</button><b class="${cls(x.value)}">${sgn(x.value, 0)} 億</b></div><div class="sector-bar ${x.value < 0 ? 'neg' : ''}"><i style="width:${Math.max(3, Math.abs(x.value) / max * 100)}%"></i></div></div>`).join('') || '<p class="fine">無</p>';
function moneyPanel(d) {
  const m = d.money[S.money], max = Math.max(1, ...[...m.buy, ...m.sell].map(x => Math.abs(x.value)));
  const ins = d.insights.map(x => x.type === 'spike' ? `<li><span class="tag">跟平常比</span> <b>${C.esc(x.sector)}</b> 今天${x.today > 0 ? '買' : '賣'}超 <b class="${cls(x.today)}">${fmt(Math.abs(x.today), 0)} 億</b>，約是近 20 日單日平均的 ${fmt(x.ratio, 1)} 倍</li>`
    : `<li><span class="tag">買賣換邊</span> <b>${C.esc(x.sector)}</b> 今天${x.today > 0 ? '買' : '賣'}超 <b class="${cls(x.today)}">${fmt(Math.abs(x.today), 0)} 億</b>，前 4 天合計${x.prior4 > 0 ? '買' : '賣'}超 <b class="${cls(x.prior4)}">${fmt(Math.abs(x.prior4), 0)} 億</b></li>`).join('');
  return `<section class="panel"><div class="panelhead"><h2><span class="idx">02</span>錢流去哪</h2><div class="segmented">${[['today', '今天'], ['five', '近 5 日']].map(([k, l]) => `<button data-if-money="${k}" class="${S.money === k ? 'selected' : ''}" aria-pressed="${S.money === k}">${l}</button>`).join('')}</div></div>
    <div class="contentpad"><p class="fine"><span class="up">●</span> 法人買最多</p><div class="sector-list">${bar(m.buy, max)}</div><p class="fine" style="margin-top:12px"><span class="down">●</span> 法人賣最多</p><div class="sector-list">${bar(m.sell, max)}</div>
    ${ins ? `<h3 style="margin-top:16px">跟平常比・買賣換邊</h3><ul class="bullet-list">${ins}</ul>` : ''}</div></section>`;
}
function abnormalPanel(d) {
  const list = d.abnormal[S.side];
  return `<section class="panel"><div class="panelhead"><div><h2><span class="idx">03</span>個股異常</h2><p>今天法人淨額 ≥ 近 20 日平均單日淨額的 ${d.rules.abnormalRatio} 倍，且 ≥ ${fmt(d.rules.abnormalMin / 1e8, 0)} 億元（全市場普通股）</p></div><div class="segmented">${[['buy', '爆買'], ['sell', '爆賣']].map(([k, l]) => `<button data-if-side="${k}" class="${S.side === k ? 'selected' : ''}" aria-pressed="${S.side === k}">${l}</button>`).join('')}</div></div>
    <div class="tablewrap"><table class="if-table"><thead><tr><th class="l">#</th><th class="l">股票</th><th>法人淨額（億）</th><th>倍數</th><th>股價</th></tr></thead><tbody>${list.map((x, i) => `<tr><td class="rank">${i + 1}</td><td><button class="stocklink" data-if-stock="${x.id}">${C.esc(x.name)} <span class="stockcode">${x.id}</span></button></td><td class="num ${cls(x.net)}"><b>${sgn(x.net)}</b></td><td class="num">${x.ratio == null ? '平常無買賣' : fmt(x.ratio, 1) + ' 倍'}</td><td class="num ${cls(x.change)}">${pct(x.change)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">今天沒有符合條件的股票</div></td></tr>'}</tbody></table></div></section>`;
}
const costCell = c => c?.avg == null ? '—' : `${fmt(c.avg)}<small class="${cls(c.deviation)}" style="display:block">現價${c.deviation >= 0 ? '高' : '低'} ${fmt(Math.abs(c.deviation), 1)}%</small>`;
const streakCell = s => !s?.days ? '—' : `<span class="${cls(s.days)}">連續${s.days > 0 ? '流入' : '流出'} ${Math.abs(s.days)} 天</span>${s.accel ? `<small style="display:block" class="${cls(s.days)}">${s.days > 0 ? '↑ 流入加速' : '↓ 流出加速'}</small>` : ''}`;
const costRow = x => `<tr><td><button class="stocklink" data-if-stock="${x.id}">${C.esc(x.name)} <span class="stockcode">${x.id}</span></button></td><td class="num">${fmt(x.close)}<small class="${cls(x.change)}" style="display:block">${pct(x.change)}</small></td><td class="num ${cls(x.net)}">${sgn(x.net, 2)}${x.ratio != null ? `<small class="muted" style="display:block">平常 ${fmt(x.ratio, 1)} 倍</small>` : ''}</td><td class="num">${costCell(x.cost.all)}</td><td class="num">${costCell(x.cost.foreign)}</td><td class="num">${costCell(x.cost.trust)}</td><td class="num">${streakCell(x.streak.foreign)}</td><td class="num">${streakCell(x.streak.trust)}</td></tr>`;
function costPanel(d) {
  const key = { all: 'all', foreign: 'foreign', trust: 'trust' }[S.costSort];
  const rows = d.costs.filter(x => S.costScope === 'all' || x.focus).sort((a, b) => (a.cost[key].deviation ?? 1e9) - (b.cost[key].deviation ?? 1e9));
  const one = S.one ? `<div class="notice"><span>單檔查詢</span></div><div class="tablewrap"><table class="if-table">${COST_HEAD}<tbody>${costRow(S.one)}</tbody></table></div>` : S.oneError ? `<p class="form-error">${C.esc(S.oneError)}</p>` : '';
  return `<section class="panel"><div class="panelhead"><div><h2><span class="idx">04</span>法人成本與乖離</h2><p>近 ${d.rules.costDays} 個交易日「買進股數 × 當日收盤」加權的均價 · 依乖離由小到大排序（越接近成本越前面）</p></div>
    <div class="actions"><div class="segmented">${[['focus', '自選＋研究名單'], ['all', '含異常個股']].map(([k, l]) => `<button data-if-scope="${k}" class="${S.costScope === k ? 'selected' : ''}">${l}</button>`).join('')}</div><select data-if-sort aria-label="排序">${[['all', '依法人乖離'], ['foreign', '依外資乖離'], ['trust', '依投信乖離']].map(([k, l]) => `<option value="${k}" ${S.costSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select><form data-if-one class="inline-form"><input name="id" placeholder="查任一代號" aria-label="查詢個股代號" size="8"><button type="submit">查詢</button></form></div></div>
    ${one}<div class="tablewrap"><table class="if-table">${COST_HEAD}<tbody>${rows.map(costRow).join('') || '<tr><td colspan="8"><div class="empty">自選與研究名單在這天沒有法人資料</div></td></tr>'}</tbody></table></div></section>`;
}
const COST_HEAD = '<thead><tr><th class="l">股票</th><th>收盤</th><th>今日法人（億）</th><th>法人均價</th><th>外資均價</th><th>投信均價</th><th>外資停留</th><th>投信停留</th></tr></thead>';

export function instFlowPage() {
  const r = S.res, d = r?.data, q = r?.query, dates = r?.dates || [];
  const status = q?.busy ? `<span><i class="spinner"></i>補資料中 ${q.done}/${q.total}${q.current ? ' · ' + q.current : ''}（每日 2 個請求）</span>` : dates.length ? `<span>已存 <b>${dates.length}</b> 個交易日（${md(dates[0])}–${md(dates.at(-1))}）${q?.finishedAt ? ` · 上次更新 ${C.esc(MK.dateTime(q.finishedAt))}` : ''}${q?.errors?.length ? ` · <span class="down">${q.errors.length} 日未取得</span>` : ''}</span>` : '<span>尚無資料，按「更新資料」補齊近 21 個交易日（第一次約需 1–2 分鐘）。</span>';
  const head = `<section class="panel heat-controls"><button class="primary" data-if="query" ${q?.busy ? 'disabled' : ''}>${q?.busy ? '<i class="spinner"></i>更新中…' : '⟳ 更新資料'}</button>
    <select data-if-date aria-label="分析日期"><option value="">最新交易日</option>${dates.slice().reverse().map(x => `<option value="${x}" ${S.date === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <div class="segmented" aria-label="板塊分組">${[['group', '研究族群'], ['industry', '產業別']].map(([k, l]) => `<button data-if-by="${k}" class="${S.by === k ? 'selected' : ''}" aria-pressed="${S.by === k}">${l}</button>`).join('')}</div><span class="spacer"></span><span class="fine">${status}</span></section>`;
  const errs = (S.error ? `<div class="notice err"><span>${C.esc(S.error)}</span></div>` : '') + (q?.error ? `<div class="notice err"><span>${C.esc(q.error)}</span></div>` : '') + (q?.errors?.length && !q.busy ? `<details class="notice warn"><summary>${q.errors.length} 個交易日未取得（今天的資料約在收盤後 1.5 小時公布）</summary><ul class="bullet-list">${q.errors.map(e => `<li>${C.esc(e.date)}：${C.esc(e.message)}</li>`).join('')}</ul></details>` : '');
  if (!d) return head + errs + `<section class="panel empty">${S.loading ? '<p><i class="spinner"></i>讀取中…</p>' : '<h3>尚無法人資金資料</h3><p>按「更新資料」取得近 21 個交易日的全市場法人買賣超與收盤價。之後每天自動更新排程會一併補上當天。</p>'}</section>`;
  const few = d.baseDays < d.rules.minBaseDays ? `<div class="notice warn"><span>目前只有 ${d.days} 個交易日，前面不足 ${d.rules.minBaseDays} 日時無法和平常比較；按「更新資料」補齊。</span></div>` : '';
  const counts = `<div class="if-states">${Object.entries(STATE).map(([k, [n, sub]]) => `<div class="if-state ${k}"><small>${n}</small><b>${d.counts[k]}</b><span>${sub}</span></div>`).join('')}</div>`;
  const noGroup = S.by === 'group' && !d.sectors.length ? '<div class="notice warn"><span>研究族群沒有成分股在這天有法人資料；可改用「產業別」。</span></div>' : '';
  return head + errs + few + `<div class="notice"><span><b class="mono">${C.esc(d.date)}</b> 法人資金 · 比較基準 ${d.baseDays} 個交易日（${md(d.from)} 起）· 全市場 ${fmt(d.coverage.stocks, 0)} 檔、列入板塊 ${fmt(d.coverage.sectored, 0)} 檔 · 金額 = 淨買賣股數 × 當日收盤（億元）</span></div>`
    + noGroup + `<section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>板塊資金四象限</h2><p>${S.by === 'group' ? '研究族群' : '產業別'} · 橫軸近 5 日法人淨流入、縱軸今天比平常更偏買 · 泡泡大小 = 今天淨額</p></div></div>${counts}<div class="if-chartwrap">${bubbles(d)}</div>${sectorDetail(d)}</section>`
    + `<div class="if-grid2">${moneyPanel(d)}${abnormalPanel(d)}</div>` + costPanel(d)
    + `<details class="panel contentpad" style="margin-top:16px"><summary>計算方式與限制</summary>
      <p><b>金額：</b>三大法人（外資含外資自營、投信、自營商含避險）每日淨買賣股數 × 當日收盤價。</p>
      <p><b>四象限：</b>近 5 日（含今天）淨額 &gt; 0 為流入；今天淨額減去前 20 日平均單日淨額 &gt; 0 為「比平常更偏買」。流入且偏買＝漲潮、流入但偏賣＝輪動、流出但偏買＝觀望、流出且偏賣＝退潮。</p>
      <p><b>跟平常比：</b>今天板塊淨額 ≥ 前 20 日平均單日淨額絕對值的 ${d.rules.sectorSpikeRatio} 倍且 ≥ ${fmt(d.rules.sectorSpikeMin / 1e8, 0)} 億。<b>買賣換邊：</b>今天 ≥ ${fmt(d.rules.flipToday / 1e8, 0)} 億，前 4 日合計反方向 ≥ ${fmt(d.rules.flipPrior / 1e8, 0)} 億。</p>
      <p><b>法人均價：</b>只計買進那一側（買進股數加權的收盤價），是成本的近似值，不是實際成交均價；不含 20 日以前的持股。</p>
      <p><b>研究族群：</b>一檔可屬多個族群，會分別計入；不在族群內的股票不列入板塊，但仍列入個股異常。只呈現事實，不構成投資建議。</p></details>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-if],[data-if-by],[data-if-sector],[data-if-stock],[data-if-money],[data-if-side],[data-if-scope]'); if (!b || !C || C.page() !== 'instflow') return;
  if (b.dataset.if === 'query') return query();
  if (b.dataset.ifBy) { S.by = b.dataset.ifBy; S.sel = ''; return load(); }
  if (b.dataset.ifSector) { S.sel = S.sel === b.dataset.ifSector ? '' : b.dataset.ifSector; return repaint(); }
  if (b.dataset.ifStock) return C.openStock(b.dataset.ifStock);
  if (b.dataset.ifMoney) { S.money = b.dataset.ifMoney; return repaint(); }
  if (b.dataset.ifSide) { S.side = b.dataset.ifSide; return repaint(); }
  if (b.dataset.ifScope) { S.costScope = b.dataset.ifScope; return repaint(); }
});
document.addEventListener('keydown', e => { const g = e.target.closest?.('[data-if-sector]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
document.addEventListener('change', e => {
  if (!C || C.page() !== 'instflow') return;
  if (e.target.matches('[data-if-date]')) { S.date = e.target.value; load(); }
  if (e.target.matches('[data-if-sort]')) { S.costSort = e.target.value; repaint(); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-if-one]'); if (!f || !C) return; e.preventDefault();
  const id = f.elements.id.value.trim(); if (!id) return;
  try { const r = await C.api(`instflow/stock?id=${encodeURIComponent(id)}${S.date ? '&date=' + S.date : ''}`); S.one = r.data; S.oneError = r.data ? '' : `${id} 這段期間沒有法人資料`; }
  catch (err) { S.one = null; S.oneError = err.message; }
  repaint();
});
