// 個股深入與持股（電腦版與手機版共用，兩邊檔案必須相同）：財報、估價河流圖、股利、內部人、借券／放空、同業比較、持股健檢、策略回測
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, n = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const sign = (v, n = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}`;
const pc = (v, n = 1) => v == null ? '<span class="soft">—</span>' : `<span class="num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${sign(v, n)}%</span>`;
const px = v => fmt(v, v != null && Math.abs(v) < 100 ? 2 : v != null && Math.abs(v) < 1000 ? 1 : 0);
const md = d => esc(String(d || '').slice(5).replace('-', '/'));
const empty = d => !d ? '<p class="ix-empty">讀取中…</p>' : !d.available ? `<p class="ix-empty">${esc(d.reason || '沒有資料。')}${d.error ? `<br><small class="soft">${esc(d.error)}</small>` : ''}</p>` : '';
// 金額：台股以億／萬元，美股以 $B／$M
export const big = (v, market) => { if (v == null || !Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; if (market === 'TW') return a >= 1e8 ? `${s}${fmt(a / 1e8, a >= 1e10 ? 0 : 1)} 億` : `${s}${fmt(a / 1e4, 0)} 萬`; return a >= 1e9 ? `${s}$${fmt(a / 1e9, 1)}B` : a >= 1e6 ? `${s}$${fmt(a / 1e6, 1)}M` : `${s}$${fmt(a, 0)}`; };
const tiles = list => `<div class="dd-tiles">${list.filter(Boolean).map(([k, v, sub]) => `<div><small>${esc(k)}</small><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`).join('')}</div>`;
const axisY = (lo, hi, y, L, R, n = 4, f = v => fmt(v, Math.abs(hi - lo) < 10 ? 1 : 0)) => Array.from({ length: n + 1 }, (_, k) => lo + (hi - lo) * k / n).map(v => `<line class="tg-grid" x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}"/><text class="tg-ax" x="${L - 5}" y="${(+y(v) + 3).toFixed(1)}" text-anchor="end">${f(v)}</text>`).join('');
const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

// ---- 財報 ----
function finChartSVG(q, market) {
  const W = 640, H = 220, L = 52, R = 600, T = 12, B = 24, n = q.length; if (n < 2) return '';
  const maxR = Math.max(...q.map(x => x.revenue || 0)) * 1.1 || 1, ms = q.flatMap(x => [x.grossMargin, x.opMargin]).filter(v => v != null), mHi = Math.max(60, ...ms) * 1.05, mLo = Math.min(0, ...ms);
  const bw = (R - L) / n, y = v => (T + (1 - v / maxR) * (H - T - B)).toFixed(1), ym = v => T + (mHi - v) / (mHi - mLo) * (H - T - B), cx = i => L + bw * (i + 0.5);
  const bars = q.map((x, i) => x.revenue != null ? `<rect class="dd-bar" x="${(L + bw * i + bw * 0.18).toFixed(1)}" y="${y(Math.max(0, x.revenue))}" width="${(bw * 0.64).toFixed(1)}" height="${(H - B - +y(Math.max(0, x.revenue))).toFixed(1)}"><title>${esc(x.label)} ${big(x.revenue, market)}</title></rect>` : '').join('');
  const line = (k, cls) => { const p = q.map((x, i) => x[k] != null ? [cx(i), ym(x[k])] : null).filter(Boolean); return p.length > 1 ? `<path class="${cls}" d="${path(p)}"/>${p.map(([a, b]) => `<circle class="${cls}-dot" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="2.6"/>`).join('')}` : ''; };
  const grid = axisY(0, maxR, y, L, R, 4, v => big(v, market).replace(' 億', '億').replace(' 萬', '萬'));
  const right = [mLo, (mLo + mHi) / 2, mHi].map(v => `<text class="tg-ax" x="${R + 4}" y="${(ym(v) + 3).toFixed(1)}">${fmt(v, 0)}%</text>`).join('');
  const xs = q.map((x, i) => i % Math.ceil(n / 8) === 0 || i === n - 1 ? `<text class="tg-ax" x="${cx(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(x.label)}</text>` : '').join('');
  return `<svg class="dd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="營收與利潤率">${grid}${bars}${line('grossMargin', 'dd-gm')}${line('opMargin', 'dd-om')}${right}${xs}</svg>`;
}
const FIN_ROWS = [['revenue', '營收', 'big'], ['revYoY', '營收年增', 'pct'], ['grossMargin', '毛利率', 'rate'], ['opMargin', '營業利益率', 'rate'], ['netMargin', '淨利率', 'rate'], ['eps', 'EPS', 'eps'], ['epsYoY', 'EPS 年增', 'pct'], ['roe', 'ROE（年化）', 'rate'], ['fcf', '自由現金流', 'big'], ['debtRatio', '負債比', 'rate']];
export function financialsHTML(d) {
  const e = empty(d); if (e) return e;
  const q = d.quarters, s = d.summary, mk = d.market, cell = (k, t, x) => { const v = x[k]; if (v == null) return '<td class="soft">—</td>'; if (t === 'big') return `<td class="num ${v < 0 ? 'down' : ''}">${big(v, mk)}</td>`; if (t === 'pct') return `<td>${pc(v)}</td>`; if (t === 'eps') return `<td class="num">${fmt(v, 2)}</td>`; return `<td class="num">${fmt(v, 1)}%</td>`; };
  const head = tiles([['近四季 EPS', fmt(s.epsTTM, 2)], ['毛利率', s.grossMargin != null ? fmt(s.grossMargin, 1) + '%' : '—'], ['營業利益率', s.opMargin != null ? fmt(s.opMargin, 1) + '%' : '—'], ['ROE（年化）', s.roe != null ? fmt(s.roe, 1) + '%' : '—'], ['近四季自由現金流', big(s.fcfTTM, mk)], ['負債比', s.debtRatio != null ? fmt(s.debtRatio, 1) + '%' : '—']]);
  const legend = '<div class="tg-legend"><span><i class="dd-k-bar"></i>營收</span><span><i class="dd-k-gm"></i>毛利率</span><span><i class="dd-k-om"></i>營業利益率</span></div>';
  const cols = [...q].reverse(), table = `<div class="dd-scroll"><table class="tg-table dd-fin"><thead><tr><th>季度</th>${cols.map(x => `<th>${esc(x.label)}</th>`).join('')}</tr></thead><tbody>${FIN_ROWS.map(([k, label, t]) => `<tr><th>${esc(label)}</th>${cols.map(x => cell(k, t, x)).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<div class="dd">${head}${legend}${finChartSVG(q, mk)}${table}<p class="ix-foot">資料來源：${esc(d.source)}。季度以結算月份標示（例如 26/06 為 2026 年 6 月結束的那一季）；ROE 為單季淨利年化除以平均股東權益，自由現金流＝營業現金流－資本支出。${d.note ? `<br>${esc(d.note)}` : ''}</p></div>`;
}

// ---- 估價河流圖 ----
export function riverSVG(r) {
  const s = r.series, n = s.length; if (n < 10) return '';
  const W = 640, H = 300, L = 50, R = 572, T = 12, B = 24, lo = Math.min(...s.flatMap(x => [x[1], x[3]]).filter(v => v > 0)) * 0.95, hi = Math.max(...s.flatMap(x => [x[1], x[6]]).filter(v => v > 0)) * 1.12; // 上緣取股價與 70% 倍數線，90% 線超出時裁掉
  const x = i => L + i * (R - L) / (n - 1), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const band = k => `<path class="dd-rv dd-rv${k}" d="${path(s.map((p, i) => [x(i), y(p[3 + k])]))} ${s.map((p, i) => [x(n - 1 - i), y(s[n - 1 - i][4 + k])]).map(p => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} Z"/>`;
  const lines = r.levels.map((_, k) => `<path class="dd-rl" d="${path(s.map((p, i) => [x(i), y(p[3 + k])]))}"/>`).join('');
  const labs = r.levels.map((m, k) => ({ t: `${fmt(m, m < 10 ? 1 : 0)}× ${px(s.at(-1)[3 + k])}`, yy: Math.max(T + 4, y(s.at(-1)[3 + k])) })).sort((a, b) => a.yy - b.yy); for (let k = 1; k < labs.length; k++) if (labs[k].yy - labs[k - 1].yy < 13) labs[k].yy = labs[k - 1].yy + 13;
  const xs = [0, Math.floor(n / 2), n - 1].map(i => `<text class="tg-ax" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(s[i][0].slice(0, 7).replace('-', '/'))}</text>`).join('');
  return `<svg class="dd-chart dd-river" viewBox="0 0 ${W} ${H}" role="img" aria-label="估價河流圖"><defs><clipPath id="dd-rv-clip"><rect x="${L}" y="${T}" width="${R - L}" height="${H - T - B}"/></clipPath></defs>${axisY(lo, hi, v => y(v).toFixed(1), L, R)}<g clip-path="url(#dd-rv-clip)">${[0, 1, 2, 3].map(band).join('')}${lines}</g><path class="dd-rp" d="${path(s.map((p, i) => [x(i), y(p[1])]))}"/>${labs.map(l => `<text class="dd-rlab" x="${R + 5}" y="${(l.yy + 4).toFixed(1)}">${esc(l.t)}</text>`).join('')}${xs}</svg>`;
}
export function riverHTML(d, { kind = 'pe' } = {}) {
  const e = empty(d); if (e) return e;
  const k = kind === 'pb' && d.pb ? 'pb' : d.pe ? 'pe' : 'pb', r = d[k], name = k === 'pe' ? '本益比' : '股價淨值比', base = k === 'pe' ? '近四季 EPS' : '每股淨值';
  const tabs = d.pb && d.pe ? `<div class="rv-strats">${[['pe', '本益比河流'], ['pb', '股價淨值比河流']].map(([v, l]) => `<button data-dd-river="${v}" class="${k === v ? 'selected' : ''}" aria-pressed="${k === v}">${l}</button>`).join('')}</div>` : '';
  const zone = `<b class="${r.zone === '偏低' ? 'cyan' : r.zone === '偏高' ? 'amber' : 'muted'}">${esc(r.zone)}</b>`;
  const head = tiles([['目前' + name, `${fmt(r.multiple, 1)}×`, `${esc(r.years)} 年百分位 ${fmt(r.percentile, 0)}`], ['位置', zone], ['合理價（中位倍數）', px(r.fair), `${fmt(r.levels[2], 1)}× ${esc(base)} ${fmt(r.base, 2)}`], ['偏低／偏高價', `${px(r.cheap)}／${px(r.rich)}`, `${fmt(r.levels[1], 1)}×／${fmt(r.levels[3], 1)}×`]]);
  return `<div class="dd">${tabs}${head}<div class="tg-legend"><span><i class="tg-k-price"></i>股價</span><span><i class="dd-k-river"></i>${esc(name)}倍數通道</span></div>${riverSVG(r)}<p class="ix-foot">通道為過去 ${esc(r.years)} 年${esc(name)}的 10%、30%、50%、70%、90% 分位倍數，乘上當時的${esc(base)}（每週一點）。股價在下緣附近代表以自己的歷史來看偏便宜，反之偏貴；獲利大幅變動或產業轉型時，歷史倍數的參考性會下降。不是買賣建議。資料來源：${esc(d.source || '')}</p></div>`;
}

// ---- 股利 ----
export function dividendsHTML(d) {
  const e = empty(d); if (e) return e;
  const mk = d.market, cur = v => mk === 'US' ? `$${fmt(v, 2)}` : fmt(v, 2);
  const next = d.upcoming?.[0];
  const head = tiles([['近 12 個月現金股利', cur(d.ttmCash)], ['現金殖利率', d.yield != null ? fmt(d.yield, 2) + '%' : '—', d.price ? `股價 ${px(d.price)}` : ''], ['平均填息天數', d.avgFillDays != null ? `${d.avgFillDays} 天` : '—', d.fillRate != null ? `填息率 ${d.fillRate}%` : ''], next ? ['下次除息', md(next.exDate), `${cur(next.cash)}${next.payDate ? ` · ${md(next.payDate)} 發放` : ''}`] : ['下次除息', '尚未公告'], d.income ? ['持股預估股利', mk === 'US' ? `$${fmt(d.income.ttm, 0)}` : fmt(d.income.ttm, 0), d.income.next ? `下次約 ${mk === 'US' ? '$' : ''}${fmt(d.income.next, 0)}` : '近 12 個月'] : null]);
  const ys = [...(d.years || [])].reverse(), maxY = Math.max(...ys.map(x => x.cash), 0.01);
  const bars = ys.length > 1 ? `<div class="dd-years">${ys.map(x => `<div><span style="height:${Math.max(4, x.cash / maxY * 100).toFixed(0)}%"></span><b class="num">${fmt(x.cash, 2)}</b><small>${esc(x.year)}</small></div>`).join('')}</div>` : '';
  const fill = f => !f ? '<span class="soft">—</span>' : f.filled ? `<span class="down">${f.days} 天</span>` : `<span class="up">未填息（${f.days} 天）</span>`;
  const rows = d.events.map(x => `<tr><td>${esc(x.period)}</td><td class="num">${md(x.exDate) || '—'}</td><td class="num">${x.cash ? cur(x.cash) : '—'}</td>${mk === 'TW' ? `<td class="num">${x.stock ? fmt(x.stock, 2) : '—'}</td>` : ''}<td class="num">${md(x.payDate) || '—'}</td><td>${fill(x.fill)}</td></tr>`).join('');
  return `<div class="dd">${head}${bars ? `<h4 class="dd-h">每年現金股利</h4>${bars}` : ''}<div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>期別</th><th>除息日</th><th>現金</th>${mk === 'TW' ? '<th>股票（元）</th>' : ''}<th>發放日</th><th>填息</th></tr></thead><tbody>${rows}</tbody></table></div><p class="ix-foot">填息天數：除息日起收盤價回到除息前一日收盤價所需的交易日數。${mk === 'TW' ? '資料來源：FinMind（公開資訊觀測站股利政策、除權息結果）。' : '資料來源：Nasdaq 股利紀錄。'}股利是公司過去的發放紀錄，未來不一定相同。</p></div>`;
}

// ---- 內部人 ----
const lots = v => v == null ? '—' : fmt(Math.round(v / 1000), 0);
export function insidersHTML(d) {
  const e = empty(d); if (e) return e;
  if (d.market === 'US') {
    const head = tiles([['近 3 個月公開市場買進', `${fmt(d.buys.m3, 0)} 筆`, `12 個月 ${fmt(d.buys.m12, 0)} 筆`], ['近 3 個月賣出', `${fmt(d.sells.m3, 0)} 筆`, `12 個月 ${fmt(d.sells.m12, 0)} 筆`], ['近 3 個月淨買賣股數', `<span class="${d.net.m3 > 0 ? 'up' : d.net.m3 < 0 ? 'down' : ''}">${sign(d.net.m3, 0)}</span>`], ['近 12 個月淨買賣股數', `<span class="${d.net.m12 > 0 ? 'up' : d.net.m12 < 0 ? 'down' : ''}">${sign(d.net.m12, 0)}</span>`]]);
    const rows = d.trades.map(x => `<tr><td class="num">${md(x.date)}</td><td>${esc(x.insider)}<br><small class="soft">${esc(x.relation || '')}</small></td><td class="${/buy|acqui/i.test(x.type) ? 'up' : /sell|dispos/i.test(x.type) ? 'down' : ''}">${esc(x.type)}</td><td class="num">${fmt(x.shares, 0)}</td><td class="num">${x.price ? '$' + fmt(x.price, 2) : '—'}</td><td class="num">${fmt(x.held, 0)}</td></tr>`).join('');
    return `<div class="dd">${head}<div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>日期</th><th>內部人</th><th>交易</th><th>股數</th><th>價格</th><th>交易後持股</th></tr></thead><tbody>${rows}</tbody></table></div><p class="ix-foot">資料來源：Nasdaq（SEC Form 4 申報）。Automatic Sell 多為事先排定的 10b5-1 計畫賣出，Disposition (Non Open Market) 多為贈與或稅務扣股，訊號意義較公開市場買賣低。不是買賣建議。</p></div>`;
  }
  const b = d.board, head = tiles([['董監持股', `${lots(b.shares)} 張`, d.ym ? `${esc(d.ym)} 申報` : ''], ['較上月', b.change == null ? '<span class="soft">累積中</span>' : `<span class="${b.change > 0 ? 'up' : b.change < 0 ? 'down' : ''}">${sign(Math.round(b.change / 1000), 0)} 張</span>`, d.prevYm ? `對照 ${esc(d.prevYm)}` : '下個月起可比較'], ['較選任時', `<span class="${b.sinceElected > 0 ? 'up' : b.sinceElected < 0 ? 'down' : ''}">${sign(Math.round(b.sinceElected / 1000), 0)} 張</span>`], ['董監質押比', b.pledgeRatio != null ? `<span class="${b.pledgeRatio >= 30 ? 'up' : ''}">${fmt(b.pledgeRatio, 1)}%</span>` : '—'], ['申報轉讓（近 180 天）', `${d.transfers.length} 筆`, d.transferShares ? `${lots(d.transferShares)} 張` : '']]);
  const tr = d.transfers.length ? `<h4 class="dd-h">申報轉讓</h4><div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>申報日</th><th>身分／姓名</th><th>方式</th><th>轉讓張數</th><th>轉讓後</th><th>有效期間</th></tr></thead><tbody>${d.transfers.map(x => `<tr><td class="num">${md(x.date)}</td><td>${esc(x.role)}<br><small class="soft">${esc(x.person)}</small></td><td>${esc(x.method)}</td><td class="num down">${lots(x.shares)}</td><td class="num">${lots(x.after)}</td><td class="num"><small>${esc(x.period)}</small></td></tr>`).join('')}</tbody></table></div>` : '';
  const ch = d.changed.length ? `<h4 class="dd-h">本月持股變動</h4><div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>職稱</th><th>姓名</th><th>增減（張）</th><th>目前（張）</th></tr></thead><tbody>${d.changed.map(x => `<tr><td>${esc(x.title)}</td><td>${esc(x.name)}</td><td class="num ${x.change > 0 ? 'up' : 'down'}">${sign(x.changeLots, 0)}</td><td class="num">${fmt(x.lots, 0)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const people = `<h4 class="dd-h">董監與經理人持股</h4><div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>職稱</th><th>姓名</th><th>持股（張）</th><th>質押（張）</th><th>較選任時</th></tr></thead><tbody>${d.people.map(x => `<tr><td>${esc(x.title)}</td><td>${esc(x.name)}</td><td class="num">${fmt(x.lots, 0)}</td><td class="num">${x.pledged ? lots(x.pledged) : '—'}</td><td class="num">${x.sinceElected == null ? '—' : sign(Math.round(x.sinceElected / 1000), 0)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="dd">${head}${tr}${ch}${people}<p class="ix-foot">資料來源：證交所／櫃買開放資料（董監事持股餘額明細每月更新、內部人持股轉讓事前申報每日更新）。逐月增減從開始保存的月份起計算；申報轉讓是「預定」轉讓，不一定全部成交。不是買賣建議。</p></div>`;
}

// ---- 借券賣出／放空 ----
function lineSVG(series, keys, cls, label) {
  const n = series.length; if (n < 3) return '';
  const W = 640, H = 200, L = 56, R = 620, T = 10, B = 22, vals = series.flatMap(s => keys.map(k => s[k])).filter(v => v != null), lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.08 || 1;
  const x = i => L + i * (R - L) / (n - 1), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ls = keys.map((k, j) => { const p = series.map((s, i) => s[k] != null ? [x(i), y(s[k])] : null).filter(Boolean); return p.length > 1 ? `<path class="${cls[j]}" d="${path(p)}"/>` : ''; }).join('');
  const xs = [0, Math.floor(n / 2), n - 1].map(i => `<text class="tg-ax" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${md(series[i][0])}</text>`).join('');
  return `<svg class="dd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${axisY(lo, hi, v => y(v).toFixed(1), L, R, 4, v => fmt(v >= 1e6 ? v / 1e6 : v, v >= 1e6 ? 1 : 0) + (v >= 1e6 ? 'M' : ''))}${ls}${xs}</svg>`;
}
export function shortsHTML(d) {
  const e = empty(d); if (e) return e;
  if (d.market === 'US') {
    const head = tiles([['放空股數', fmt(d.interest, 0), `${md(d.date)} 結算`], ['較前期', pc(d.change)], ['較 3 個月前', pc(d.change3m)], ['回補天數', d.daysToCover != null ? `${fmt(d.daysToCover, 1)} 天` : '—', `平均日量 ${fmt(d.avgVol, 0)}`], d.floatPct != null ? ['占流通股數', `${fmt(d.floatPct, 2)}%`] : null]);
    return `<div class="dd">${head}<div class="tg-legend"><span><i class="dd-k-sbl"></i>放空股數</span></div>${lineSVG(d.series, [1], ['dd-ls'], '放空股數')}<p class="ix-foot">資料來源：Nasdaq（交易所每月兩次公布的結算日放空股數）。回補天數＝放空股數 ÷ 平均日成交量，越高代表空方回補需要越久；占流通股數以市值估算的股數計算。不是買賣建議。</p></div>`;
  }
  const head = tiles([['借券賣出餘額', `${fmt(d.sbl, 0)} 張`, `${md(d.date)}`], ['5 日變化', pc(d.sblChange5)], ['20 日變化', pc(d.sblChange20)], ['融券餘額', `${fmt(d.margin, 0)} 張`], ['近 5 日借券賣出／還券', `${fmt(d.sblSell5, 0)}／${fmt(d.sblReturn5, 0)} 張`], ['空單回補天數', d.daysToCover != null ? `${fmt(d.daysToCover, 1)} 天` : '—', `20 日均量 ${fmt(d.avgVolLots, 0)} 張`]]);
  return `<div class="dd">${head}<div class="tg-legend"><span><i class="dd-k-sbl"></i>借券賣出餘額</span><span><i class="dd-k-mg"></i>融券餘額</span></div>${lineSVG(d.series, [1, 2], ['dd-ls', 'dd-lm'], '借券賣出與融券餘額')}<p class="ix-foot">資料來源：FinMind（證交所／櫃買信用額度總量管制餘額表）。借券賣出餘額增加代表看空或避險部位增加，大量還券可能是空方回補；回補天數＝（借券賣出＋融券餘額）÷ 20 日平均成交量。不是買賣建議。</p></div>`;
}

// ---- 同業比較 ----
const PEER_COLS = { pe: ['本益比', 1, ''], pb: ['股價淨值比', 2, ''], yield: ['殖利率', 2, '%'], revYoY: ['營收年增', 1, '%'], revCumYoY: ['累計營收年增', 1, '%'], epsYoY: ['EPS 年增', 1, '%'], offHigh: ['距 52 週高', 1, '%'], change: ['今日漲跌', 2, '%'] };
export function peersHTML(d) {
  const e = empty(d); if (e) return e;
  const cols = d.cols, val = (k, v) => v == null || (['pe', 'pb'].includes(k) && !(v > 0)) ? '<span class="soft">—</span>' : ['revYoY', 'revCumYoY', 'epsYoY', 'offHigh', 'change'].includes(k) ? pc(v, PEER_COLS[k][1]) : `<span class="num">${fmt(v, PEER_COLS[k][1])}${PEER_COLS[k][2]}</span>`;
  const rank = cols.filter(k => d.rank[k]).map(k => `<span class="dd-chip">${esc(PEER_COLS[k][0])} 第 ${d.rank[k].rank}／${d.rank[k].of}</span>`).join('');
  const rows = d.rows.map(r => `<tr class="${r.self ? 'dd-self' : ''}"><td><button class="ix-cw-stock" data-alert-stock="${esc(r.id)}">${esc(r.name)} <small class="num">${esc(r.id)}</small></button></td><td class="num">${px(r.close)}</td>${cols.map(k => `<td>${val(k, r[k])}</td>`).join('')}</tr>`).join('');
  const med = `<tr class="dd-med"><td>同業中位數</td><td></td>${cols.map(k => `<td>${val(k, d.median[k])}</td>`).join('')}</tr>`;
  return `<div class="dd"><p class="dd-group">${d.kind === 'chain' ? 'AI 供應鏈' : '產業'}：<b>${esc(d.group)}</b>（${d.rows.length} 檔，依成交金額）</p>${rank ? `<div class="dd-chips">${rank}</div>` : ''}<div class="dd-scroll"><table class="tg-table dd-tbl dd-peers"><thead><tr><th>股票</th><th>股價</th>${cols.map(k => `<th>${esc(PEER_COLS[k][0])}</th>`).join('')}</tr></thead><tbody>${rows}${med}</tbody></table></div><p class="ix-foot">排名：本益比、股價淨值比越低排越前，其餘越高排越前。${d.kind === 'chain' || d.cols.includes('pb') ? '台股估值取自證交所／櫃買每日本益比，營收為最新月營收。' : '美股本益比、營收與 EPS 年增（近四季）取自 Finnhub，範圍為策略選股已取得基本面的公司。'}不是買賣建議。</p></div>`;
}

// ---- 持股損益與健檢 ----
export function portfolioHTML(p, { editable = false, market = 'TW' } = {}) {
  if (!p) return '<p class="ix-empty">讀取中…</p>';
  if (!p.capable) return '<p class="ix-empty">持股健檢目前只支援台股與美股。</p>';
  const mk = p.market || market, money = v => mk === 'US' ? (v == null ? '—' : `${v < 0 ? '-' : ''}$${fmt(Math.abs(v), 0)}`) : (v == null ? '—' : fmt(v, 0)), T = p.totals;
  const head = p.count ? tiles([['持股市值', money(T.value), `成本 ${money(T.cost)}`], ['未實現損益', `<span class="${T.pnl > 0 ? 'up' : T.pnl < 0 ? 'down' : ''}">${money(T.pnl)}</span>`, T.pnlPct != null ? `${sign(T.pnlPct, 2)}%` : ''], ['今日損益', `<span class="${T.day > 0 ? 'up' : T.day < 0 ? 'down' : ''}">${money(T.day)}</span>`, T.dayPct != null ? `${sign(T.dayPct, 2)}%` : ''], ['持股檔數', `${p.count}`]]) : '';
  const x = p.exposure, expo = x.actual != null || x.suggested != null ? `<div class="pf-expo"><div class="pf-expo-top"><span>實際持股 <b class="num">${x.actual != null ? fmt(x.actual, 1) + '%' : '—'}</b></span><span>風控建議 <b class="num amber">${x.suggested != null ? x.suggested + '%' : '—'}</b>${x.risk != null ? ` <small class="soft">（風險 ${fmt(x.risk, 1)} ${esc(x.label || '')}）</small>` : ''}</span></div><div class="pf-bar">${x.actual != null ? `<i style="width:${Math.min(100, x.actual)}%"></i>` : ''}${x.suggested != null ? `<em style="left:${x.suggested}%"></em>` : ''}</div>${x.advice ? `<p class="${x.diff > 10 ? 'up' : ''}">${esc(x.advice)}</p>` : ''}${x.actual == null ? '<p class="soft">填入現金部位（或在訊號面板設定總資金）後可計算實際持股比例。</p>' : ''}</div>` : '';
  const warn = p.warnings.length ? `<ul class="pf-warn">${p.warnings.map(w => `<li>⚠ ${esc(w.text)}</li>`).join('')}</ul>` : '';
  const rsTag = r => !r ? '<span class="soft">—</span>' : `<span class="dd-chip ${r.tone > 0 ? 'up' : r.tone < 0 ? 'down' : ''}" title="近一年 ${sign(r.ret, 1)}%，大盤 ${sign(r.index, 1)}%">${esc(r.label)} ${sign(r.diff, 0)}</span>`;
  const lv = (r, k) => r[k] == null ? '' : `<small class="${r[k === 'stop' ? 'hitStop' : 'hitTarget'] ? (k === 'stop' ? 'down' : 'up') : 'soft'}">${k === 'stop' ? '停損' : '停利'} ${px(r[k])}</small>`;
  const rows = p.rows.map(r => `<tr class="${r.hitStop ? 'pf-hit-stop' : r.hitTarget ? 'pf-hit-target' : ''}"><td><button class="ix-cw-stock" data-alert-stock="${esc(r.id)}">${esc(r.name)} <small class="num">${esc(r.id)}</small></button><br><small class="soft">${esc(r.sector)}</small></td><td class="num">${r.lots != null ? `${fmt(r.lots, r.lots % 1 ? 3 : 0)} 張` : fmt(r.shares, 0)}<br><small class="soft">成本 ${px(r.cost)}</small></td><td class="num">${px(r.close)}<br>${pc(r.change, 2)}</td><td class="num"><span class="${r.pnl > 0 ? 'up' : r.pnl < 0 ? 'down' : ''}">${money(r.pnl)}</span><br>${pc(r.pnlPct, 2)}</td><td class="num">${r.weight != null ? fmt(r.weight, 1) + '%' : '—'}</td><td>${rsTag(r.rs)}${r.signal ? `<br><small class="${r.signal === 'buy' ? 'up' : 'down'}">追蹤線${r.signal === 'buy' ? '偏多' : '偏空'}</small>` : ''}</td><td>${lv(r, 'stop')}${r.stop != null && r.target != null ? '<br>' : ''}${lv(r, 'target')}</td>${editable ? `<td><button class="pf-del" data-pf-del="${esc(r.id)}" title="移除" aria-label="移除">×</button></td>` : ''}</tr>`).join('');
  const table = p.count ? `<div class="dd-scroll"><table class="tg-table dd-tbl pf-table"><thead><tr><th>股票</th><th>持有</th><th>現價</th><th>損益</th><th>權重</th><th>相對大盤（1 年）</th><th>停損／停利</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="rv-empty"><p>${editable ? '還沒有持股。在下方輸入代號、股數與成本後按「加入／更新」。' : '還沒有持股；請在電腦版的「持股」頁輸入。'}</p></div>`;
  const sec = p.sectors.length > 1 ? `<h4 class="dd-h">產業／供應鏈分布</h4><div class="pf-sectors">${p.sectors.map(s => `<div><span>${esc(s.name)}</span><i style="width:${s.weight || 0}%"></i><b class="num">${fmt(s.weight, 1)}%</b></div>`).join('')}</div>` : '';
  const zn = { value: '價值區', heat: '升溫區', picks: '每日精選' };
  const swaps = p.swaps.length ? `<h4 class="dd-h">需要留意的持股與同產業候選</h4>${p.swaps.map(s => `<div class="pf-swap"><b>${esc(s.name)} <small class="num">${esc(s.id)}</small></b><span class="soft">${s.why.map(esc).join('、')}</span><div>${s.candidates.length ? s.candidates.map(c => `<button class="ix-cw-stock dd-chip" data-alert-stock="${esc(c.id)}">${esc(c.name)} ${esc(c.id)} · ${esc(zn[c.from] || '')}</button>`).join('') : '<small class="soft">目前價值區、升溫區、每日精選沒有同產業的候選</small>'}</div></div>`).join('')}` : '';
  const cal = p.calendar, calHTML = `<h4 class="dd-h">除權息行事曆（未來 30 天，持股與自選）</h4>${p.calendarBusy && !cal ? '<p class="ix-empty">整理中…</p>' : cal?.items?.length ? `<div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>除權息日</th><th>股票</th><th>類別</th><th>每股</th><th>預估入帳</th></tr></thead><tbody>${cal.items.map(i => `<tr><td class="num">${md(i.date)}</td><td><button class="ix-cw-stock" data-alert-stock="${esc(i.id)}">${esc(i.name)} <small class="num">${esc(i.id)}</small></button>${i.held ? ' <span class="dd-chip">持股</span>' : i.watch ? ' <span class="dd-chip soft">自選</span>' : ''}</td><td>${esc(i.type)}</td><td class="num">${i.cash != null ? (mk === 'US' ? '$' : '') + fmt(i.cash, mk === 'US' ? 4 : 2) : '—'}</td><td class="num">${i.income != null ? money(i.income) : '—'}</td></tr>`).join('')}</tbody></table></div>${cal.income ? `<p class="soft">持股預估入帳合計 ${money(cal.income)}（未扣稅與匯費）。</p>` : ''}` : `<p class="ix-empty">未來 30 天持股與自選沒有已公告的除權息。${cal?.marketCount ? `（全市場 ${cal.marketCount} 檔已公告）` : ''}</p>`}${p.calendarError ? `<p class="soft"><small>${esc(p.calendarError)}</small></p>` : ''}`;
  const form = editable ? `<form class="pf-form" data-pf-form><input name="id" placeholder="代號" required maxlength="10" autocomplete="off"><input name="shares" placeholder="${mk === 'TW' ? '股數（1 張＝1000 股）' : '股數'}" inputmode="decimal" required><input name="cost" placeholder="成本價" inputmode="decimal" required><input name="stop" placeholder="停損價（選填）" inputmode="decimal"><input name="target" placeholder="停利價（選填）" inputmode="decimal"><button class="rv-btn">加入／更新</button></form><form class="pf-form pf-cash" data-pf-cash><label>現金部位 <input name="cash" inputmode="decimal" placeholder="選填" value="${T.cash ?? ''}"></label><button class="rv-btn">儲存</button></form>` : '';
  return `<div class="dd pf">${head}${expo}${warn}${table}${form}${sec}${swaps}${calHTML}<p class="ix-foot">持股資料只存在這台電腦（${mk === 'US' ? '.local-us' : '.local'}/portfolio.json），不連接券商、不下單。現價盤中取即時報價、收盤後取收盤價；跌破停損或到達停利時會發出提醒（每檔每天一次）。相對大盤為近一年報酬減去${mk === 'US' ? ' S&P 500 ' : '加權指數'}報酬。不是買賣建議。</p></div>`;
}

// ---- 策略回測 ----
function curveSVG(s) {
  const c = s.curve || [], b = s.bench || []; if (c.length < 3) return '';
  const W = 600, H = 160, L = 44, R = 590, T = 8, B = 18, all = [...c.map(x => x[1]), ...b.map(x => x[1])], lo = Math.min(0, ...all), hi = Math.max(0, ...all) || 1, d0 = Date.parse(c[0][0]), d1 = Date.parse(c.at(-1)[0]) || d0 + 1;
  const x = d => L + (Date.parse(d) - d0) / (d1 - d0 || 1) * (R - L), y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  return `<svg class="dd-chart bt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="權益曲線">${axisY(lo, hi, v => y(v).toFixed(1), L, R, 3, v => fmt(v, 0) + '%')}<line class="tg-now" x1="${L}" x2="${R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>${b.length > 1 ? `<path class="bt-bench" d="${path(b.filter(p => p[0] >= c[0][0] && p[0] <= c.at(-1)[0]).map(p => [x(p[0]), y(p[1])]))}"/>` : ''}<path class="bt-eq" d="${path(c.map(p => [x(p[0]), y(p[1])]))}"/><text class="tg-ax" x="${L}" y="${H - 4}">${md(c[0][0])}</text><text class="tg-ax" x="${R}" y="${H - 4}" text-anchor="end">${md(c.at(-1)[0])}</text></svg>`;
}
export function backtestHTML(info) {
  if (!info) return '<p class="ix-empty">讀取中…</p>';
  if (!info.capable) return '<p class="ix-empty">策略回測目前只支援台股與美股。</p>';
  const d = info.data, hold = d?.hold || 20;
  const ctl = `<div class="pk-meta"><span class="soft">${d ? `${esc(d.date)} 計算 · 入選策略持有 ${hold} 個交易日 · 已保存 ${d.heatDays} 天收盤資料` : '尚未計算'}</span><span class="bt-ctl"><label>持有 <select data-bt-hold>${[5, 10, 20, 60].map(v => `<option value="${v}" ${v === hold ? 'selected' : ''}>${v} 天</option>`).join('')}</select></label><button class="rv-btn" data-bt-run ${info.busy ? 'disabled' : ''}>${info.busy ? `<i class="spinner"></i>計算中${info.total ? ` ${info.step}/${info.total}` : ''}` : '⟳ 重新計算'}</button></span></div>${info.error ? `<p class="rv-err">${esc(info.error)}</p>` : ''}`;
  if (!d) return `${ctl}<div class="rv-empty"><p>${info.busy ? '計算中…' : '每天第一次開啟時自動計算。'}</p></div>`;
  const card = s => `<section class="bt-card"><header><h4>${esc(s.name)}</h4>${!s.enough ? `<span class="dd-chip amber">樣本 ${s.trades} 筆，參考性有限</span>` : ''}</header>${s.trades ? tiles([['交易筆數', `${s.trades}`, s.open ? `另有 ${s.open} 筆持有中` : ''], ['勝率', `${fmt(s.winRate, 1)}%`], ['平均報酬', pc(s.avg, 2), `中位數 ${sign(s.median, 2)}%`], ['組合報酬', pc(s.total, 1), s.benchmark != null ? `同期${esc(d.indexName)} ${sign(s.benchmark, 1)}%` : ''], ['最大回撤', `<span class="down">${fmt(s.mdd, 1)}%</span>`], ['獲利因子', s.profitFactor != null ? fmt(s.profitFactor, 2) : '—', s.avgDays != null ? `平均持有 ${fmt(s.avgDays, 1)} 天` : '']]) + `<div class="tg-legend"><span><i class="bt-k-eq"></i>策略組合</span><span><i class="bt-k-bench"></i>${esc(d.indexName)}</span></div>${curveSVG(s)}<details><summary>最近的交易</summary><div class="dd-scroll"><table class="tg-table dd-tbl"><thead><tr><th>股票</th><th>進場</th><th>出場</th><th>報酬</th></tr></thead><tbody>${s.recent.map(t => `<tr><td>${esc(t.name || t.id)} <small class="num soft">${esc(t.id)}</small></td><td class="num">${md(t.entryDate)} ${px(t.entry)}</td><td class="num">${t.open ? '<span class="soft">持有中</span>' : `${md(t.exitDate)} ${px(t.exit)}`}</td><td>${pc(t.ret, 2)}</td></tr>`).join('')}</tbody></table></div></details>` : '<p class="ix-empty">還沒有完成的交易；入選策略從開始保存名單的那天起累積。</p>'}</section>`;
  return `${ctl}<div class="bt-grid">${d.strategies.map(card).join('')}</div><p class="ix-foot">訊號策略：研究名單每檔的本機日 K，ATR 追蹤線翻多以收盤買進（只做多），跌破停損（進場價 − 1.5 倍 ATR）或翻空時賣出。入選策略：價值區、升溫區、每日精選當天收盤買進，持有固定交易日數後賣出，價格取自每天保存的收盤熱浪圖。組合報酬：每天把資金平均分配給持有中的部位，最大回撤由這條權益曲線計算。不含手續費、稅與滑價；過去績效不代表未來，不是買賣建議。</p>`;
}
