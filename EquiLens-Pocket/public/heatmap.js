// 手機版資金熱浪圖：squarified treemap，面積＝成交金額、顏色＝漲跌幅（紅漲綠跌）。
import * as MK from './market.js';
// 接近漲跌停的門檻（台股 10% 以 9.5% 判定）；沒有漲跌幅限制的市場不標示漲跌停
const LIM = () => { const p = MK.market().limit?.pct; return p ? p * .95 : Infinity; };
const BASE = [26, 36, 52], UP = [232, 30, 66], DOWN = [0, 180, 108], UPMAX = [255, 46, 92], DOWNMAX = [20, 228, 140];
export function heatColor(c) {
  if (c == null) return 'rgb(36,48,68)';
  if (c === 0) return `rgb(${BASE})`;
  const t = Math.pow(Math.min(1, Math.abs(c) / 7), 0.72), lim = Math.abs(c) >= LIM();
  const red = (c > 0) === (MK.upColors().up === '#ff3d5a'); // UP／UPMAX 為紅色系
  const target = red ? (lim ? UPMAX : UP) : (lim ? DOWNMAX : DOWN);
  return `rgb(${BASE.map((b, i) => Math.round(b + (target[i] - b) * t))})`;
}
export function squarify(items, x, y, w, h) {
  const out = [], list = items.filter(i => i.value > 0), total = list.reduce((a, i) => a + i.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const areas = list.map(i => i.value * w * h / total);
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b, 0); return Math.max(side * side * Math.max(...row) / (s * s), s * s / (side * side * Math.min(...row))); };
  let row = [], start = 0, i = 0;
  const layout = () => {
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) { const cw = s / h; let yy = y; row.forEach((a, k) => { out.push({ item: list[start + k], x, y: yy, w: cw, h: a / cw }); yy += a / cw; }); x += cw; w -= cw; }
    else { const rh = s / w; let xx = x; row.forEach((a, k) => { out.push({ item: list[start + k], x: xx, y, w: a / rh, h: rh }); xx += a / rh; }); y += rh; h -= rh; }
    start += row.length; row = [];
  };
  while (i < areas.length) { const side = Math.min(w, h); if (!row.length || worst([...row, areas[i]], side) <= worst(row, side)) row.push(areas[i++]); else layout(); }
  if (row.length) layout();
  return out;
}
export function aggregate(data, market = '全部') {
  const all = data.sectors.flatMap(s => s.stocks).filter(s => market === '全部' || s.market === market);
  const map = new Map();
  for (const s of all) { if (!map.has(s.sector)) map.set(s.sector, []); map.get(s.sector).push(s); }
  const total = all.reduce((a, s) => a + s.money, 0);
  const sum = (l, f) => l.reduce((a, s) => a + f(s), 0);
  const sectors = [...map].map(([name, stocks]) => {
    stocks.sort((a, b) => b.money - a.money);
    const money = sum(stocks, s => s.money), priced = stocks.filter(s => s.change != null), pm = sum(priced, s => s.money);
    const both = stocks.filter(s => s.prevMoney > 0), now = sum(both, s => s.money), prev = sum(both, s => s.prevMoney);
    return { name, stocks, money, count: stocks.length, share: total ? money / total * 100 : 0, change: pm ? sum(priced, s => s.change * s.money) / pm : null,
      up: priced.filter(s => s.change > 0).length, down: priced.filter(s => s.change < 0).length, moneyChange: prev > 0 ? (now / prev - 1) * 100 : null };
  }).sort((a, b) => b.money - a.money);
  const priced = all.filter(s => s.change != null), pm = sum(priced, s => s.money);
  return { sectors, byId: new Map(all.map(s => [s.id, s])), total: { money: total, count: all.length, change: pm ? sum(priced, s => s.change * s.money) / pm : null,
    up: priced.filter(s => s.change > 0).length, down: priced.filter(s => s.change < 0).length, flat: priced.filter(s => s.change === 0).length,
    limitUp: priced.filter(s => s.change >= LIM()).length, limitDown: priced.filter(s => s.change <= -LIM()).length } };
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export function renderTreemap(el, agg, { focus = null, selected = null } = {}) {
  const W = el.clientWidth, H = el.clientHeight; if (W < 10 || H < 10) return;
  const sectors = focus ? agg.sectors.filter(s => s.name === focus) : agg.sectors;
  let html = '';
  for (const r of squarify(sectors.map(s => ({ value: s.money, s })), 0, 0, W, H)) {
    const s = r.item.s, head = r.w > 46 && r.h > 34 ? 18 : 0;
    html += `<div class="hm-sec" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">`;
    if (head) html += `<header data-sec="${esc(s.name)}"><b>${esc(s.name)}</b><span>${pct(s.change)}</span></header>`;
    if (!focus && r.w * r.h < 900) { html += `<div class="hm-t" data-sec="${esc(s.name)}" style="left:0;top:0;width:100%;height:100%;background:${heatColor(s.change)}"></div></div>`; continue; }
    for (const t of squarify(s.stocks.map(st => ({ value: st.money, st })), 0, head, r.w - 2, r.h - 2 - head)) {
      const st = t.item.st, w = t.w, h = t.h;
      let fs = Math.max(9, Math.min(22, Math.sqrt(w * h) / 5));
      const units = [...st.name].reduce((a, c) => a + (/[\x00-\x7f]/.test(c) ? .58 : 1), 0), fit = Math.min(fs, (w - 4) / units);
      let label = '';
      if (fit >= 10 && h >= fit * 1.25) { fs = fit; label = st.name; } else if (w >= fs * 2.5 && h >= fs * 1.2) label = st.id;
      const lim = Math.abs(st.change ?? 0) >= LIM();
      html += `<div class="hm-t${lim ? ' lim' : ''}${selected === st.id ? ' sel' : ''}" data-id="${st.id}" style="left:${t.x}px;top:${t.y}px;width:${w}px;height:${h}px;background:${heatColor(st.change)}">${label ? `<b style="font-size:${fs}px">${esc(label)}</b>${h >= fs * 2.4 && w >= fs * 2.8 ? `<em style="font-size:${Math.max(9, fs * .78)}px">${pct(st.change)}</em>` : ''}` : ''}</div>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
}
