// 衡析 Pocket：個股即時走勢（看板點卡片）— 全日走勢圖（價格、當日均價線、所屬族群均價線、每分鐘量）、五檔、成交明細。
// 資料：Nexus /api/intraday（盤中為即時推播的逐筆、1 分 K 與五檔；沒有時用時光機每分鐘畫格）。
import { esc, fmt, cls } from './insight-ui.js';

const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tone = (x, ref) => x == null || !(ref > 0) ? '' : x > ref ? 'up' : x < ref ? 'down' : '';
const pctOf = (x, ref) => x == null || !(ref > 0) ? '—' : `${x >= ref ? '+' : ''}${fmt((x / ref - 1) * 100, 2)}%`;

// 全日走勢：x 軸固定開盤到收盤；y 軸以參考價為中心，涵蓋價格、均價線與族群均價線
export function intradaySVG(d, { w = 360, h = 300 } = {}) {
  const M = d?.minutes, ref = d?.ref;
  if (!M?.m?.length || !(ref > 0)) return `<div class="empty">${d?.source === null ? '今天還沒有這檔的盤中資料（開盤後才有走勢）。' : '讀取走勢…'}</div>`;
  const L = 44, R = 50, T = 8, gap = 14, hp = Math.round((h - T - 18) * 0.74), hv = h - T - 18 - hp - gap, x0 = L, x1 = w - R;
  const open = d.open, close = d.close, xOf = m => x0 + (Math.min(close, Math.max(open, m)) - open) / (close - open) * (x1 - x0);
  const vals = [ref, ...M.c, ...M.vwap.filter(v => v != null), ...M.group.filter(v => v != null)];
  let dev = Math.max(...vals.map(v => Math.abs(v - ref)), ref * 0.01) * 1.1;
  if (d.limitUp && d.limitDown) dev = Math.min(dev, Math.max(d.limitUp - ref, ref - d.limitDown));
  const yMax = ref + dev, yMin = ref - dev, yOf = v => T + (yMax - Math.min(yMax, Math.max(yMin, v))) / (yMax - yMin) * hp;
  const pts = M.m.map((m, i) => [xOf(m), yOf(M.c[i])]), line = arr => M.m.map((m, i) => arr[i] == null ? null : `${xOf(m).toFixed(1)},${yOf(arr[i]).toFixed(1)}`).filter(Boolean).join(' ');
  const last = M.c.at(-1), col = last >= ref ? 'var(--up)' : 'var(--down)', soft = last >= ref ? 'var(--up-soft)' : 'var(--down-soft)';
  const area = `${pts[0][0].toFixed(1)},${yOf(ref).toFixed(1)} ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} ${pts.at(-1)[0].toFixed(1)},${yOf(ref).toFixed(1)}`;
  const hours = []; for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) hours.push(m);
  const grid = hours.map(m => `<line x1="${xOf(m).toFixed(1)}" x2="${xOf(m).toFixed(1)}" y1="${T}" y2="${T + hp + gap + hv}" stroke="var(--line)" stroke-width="1"/><text x="${xOf(m).toFixed(1)}" y="${h - 3}" text-anchor="middle" class="ia-ax">${String(m / 60).padStart(2, '0')}</text>`).join('');
  const yLab = [[yMax, 'up'], [ref, ''], [yMin, 'down']].map(([v, c]) => `<text x="${L - 4}" y="${(yOf(v) + 4).toFixed(1)}" text-anchor="end" class="ia-ax ${c}">${fmt(v, v >= 100 ? 1 : 2)}</text><text x="${x1 + 4}" y="${(yOf(v) + 4).toFixed(1)}" class="ia-ax ${c}">${pctOf(v, ref)}</text>`).join('');
  // 量的刻度用第 97 百分位（開盤集合競價那一分鐘常是其他分鐘的數十倍，超出的部分截頂）
  const vs = M.v.slice().sort((a, b) => a - b), vmax = Math.max(1, vs[Math.floor((vs.length - 1) * 0.97)] * 1.15), bw = Math.max(1, (x1 - x0) / (close - open) - 0.4), vy = T + hp + gap;
  const bars = M.m.map((m, i) => { const bh = Math.min(1, M.v[i] / vmax) * hv; return bh > 0 ? `<rect x="${(xOf(m) - bw / 2).toFixed(1)}" y="${(vy + hv - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${i && M.c[i] < M.c[i - 1] ? 'var(--down)' : 'var(--up)'}" opacity=".55"/>` : ''; }).join('');
  const [lx, ly] = pts.at(-1);
  return `<svg class="ia-chart" viewBox="0 0 ${w} ${h}" data-intra-svg role="img" aria-label="走勢圖">
    ${grid}<line x1="${x0}" x2="${x1}" y1="${yOf(ref).toFixed(1)}" y2="${yOf(ref).toFixed(1)}" stroke="var(--soft)" stroke-dasharray="3 3"/>${yLab}
    <polygon points="${area}" fill="${soft}"/><polyline points="${line(M.c)}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>
    <polyline points="${line(M.vwap)}" fill="none" stroke="var(--amber)" stroke-width="1.4"/>
    ${M.group.some(v => v != null) ? `<polyline points="${line(M.group)}" fill="none" stroke="var(--violet)" stroke-width="1.4" stroke-dasharray="5 3"/>` : ''}
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${col}"/>${bars}
    <line class="ia-cross" x1="0" x2="0" y1="${T}" y2="${T + hp + gap + hv}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
    <rect x="${x0}" y="${T}" width="${x1 - x0}" height="${hp + gap + hv}" fill="transparent" data-intra-hit="${x0},${x1},${open},${close}"/></svg>`;
}
// 十字線讀值：觸控／滑鼠移到某分鐘，顯示該分鐘的價格、均價、族群均價與量
export function readAt(d, frac) {
  const M = d?.minutes; if (!M?.m?.length) return '';
  const target = d.open + frac * (d.close - d.open); let k = 0; for (let i = 0; i < M.m.length; i++) if (M.m[i] <= target) k = i;
  return `${hm(M.m[k])} · <b class="${tone(M.c[k], d.ref)}">${fmt(M.c[k], 2)}</b> ${pctOf(M.c[k], d.ref)} · <span class="amber">均 ${fmt(M.vwap[k], 2)}</span>${M.group[k] != null ? ` · <span class="violet">族群 ${fmt(M.group[k], 2)}</span>` : ''} · 量 ${fmt(M.v[k])}`;
}
export function legendHTML(d) {
  const q = d.quote || {}, g = d.group;
  return `<div class="ia-legend"><span><i style="background:var(--amber)"></i>當日均價 <b class="num">${fmt(q.vwap, 2)}</b></span>${g ? `<span><i class="dash" style="border-color:var(--violet)"></i>族群均價${g.name ? `（${esc(g.name)} ${g.members} 檔，量能加權）` : ''} <b class="num">${fmt(d.minutes?.group?.filter(v => v != null).at(-1), 2)}</b></span>` : '<span class="soft">不屬於任何研究族群，沒有族群均價線</span>'}</div>`;
}
// 五檔：左委買（量、價）、右委賣（價、量），下方五檔合計與比例條
export function bookHTML(d) {
  const b = d.book; if (!b) return `<div class="empty">${d.source === 'replay' ? '這檔目前沒有即時五檔（未在即時推播訂閱中，或推播尚未連線）。' : '尚無五檔資料。'}</div>`;
  const rows = Array.from({ length: 5 }, (_, i) => { const bi = b.bids[i], as = b.asks[i];
    return `<div class="ia-row"><span class="num ia-size">${bi ? fmt(bi.size) : ''}</span><span class="num ${tone(bi?.price, d.ref)}">${bi ? fmt(bi.price, 2) : '—'}</span><span class="num ${tone(as?.price, d.ref)}">${as ? fmt(as.price, 2) : '—'}</span><span class="num ia-size">${as ? fmt(as.size) : ''}</span></div>`; }).join('');
  const tot = b.bidTotal + b.askTotal, pb = tot ? b.bidTotal / tot * 100 : 50;
  return `<div class="ia-book"><div class="ia-row ia-head"><span>委買量</span><span>買</span><span>賣</span><span>委賣量</span></div>${rows}
    <div class="ia-ratio"><i class="up-bg" style="width:${pb.toFixed(1)}%"></i><i class="down-bg" style="width:${(100 - pb).toFixed(1)}%"></i></div>
    <div class="ia-row ia-tot"><span class="num">(${fmt(b.bidTotal)})</span><span></span><span></span><span class="num">(${fmt(b.askTotal)})</span></div>
    <p class="ix-foot">${b.time ? `五檔時間 ${esc(b.time)}` : ''}${d.quote?.atAsk != null ? ` · 今日外盤 ${fmt(d.quote.atAsk)}／內盤 ${fmt(d.quote.atBid)} 張` : ''}</p></div>`;
}
export function tapeHTML(d) {
  if (!d.tape?.length) return `<div class="empty">${d.source === 'stream' ? '尚無成交明細。' : '成交明細只在即時推播連線時提供。'}</div>`;
  return `<div class="ia-tape"><div class="ia-trow ia-head"><span>時間</span><span>成交價</span><span>單量</span><span>內外盤</span></div>${d.tape.map(([t, px, size, side]) => `<div class="ia-trow"><span class="num">${esc(t)}</span><span class="num ${tone(px, d.ref)}">${fmt(px, 2)}</span><span class="num">${fmt(size)}</span><span class="${side > 0 ? 'up' : side < 0 ? 'down' : 'soft'}">${side > 0 ? '外盤' : side < 0 ? '內盤' : '—'}</span></div>`).join('')}</div>`;
}
