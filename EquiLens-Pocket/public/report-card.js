// 盤後籌碼整理 9:16 摘要圖卡（1080×1920）：衡析霓虹 HUD 風格，深底高對比、大字號，漲跌配色依市場設定。
// 電腦版與手機版共用（兩邊各放一份相同檔案）。只用 Canvas 2D，不載入外部資源。
import { saveImage } from './save-image.js';
import { tx } from './i18n.js';
import * as MK from './market.js';
const W = 1080, H = 1920, M = 28, G = 16;
const C = { bg: '#050b17', grid: 'rgba(70,200,255,.05)', panel1: '#0d1b30', panel2: '#081221', line: 'rgba(80,215,255,.42)', cyan: '#4ff0ff', text: '#ffffff', label: '#cfdcee', muted: '#8ea3bf', up: '#ff5a74', down: '#33e8a2', amber: '#ffcf57', violet: '#b1a6ff', rowAlt: 'rgba(79,240,255,.06)' };
const SANS = '"Microsoft JhengHei UI","Microsoft JhengHei","Noto Sans TC","PingFang TC",sans-serif';
const NUM = '"Segoe UI","Roboto","Helvetica Neue","Noto Sans TC",sans-serif';
const font = (size, weight = 700, fam = SANS) => `${weight} ${size}px ${fam}`;
const num = v => v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const fx = (v, n = 2) => num(v) == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
const sx = (v, n = 2) => num(v) == null ? '—' : `${v > 0 ? '+' : ''}${fx(v, n)}`;
const tone = v => num(v) == null || v === 0 ? C.text : v > 0 ? C.up : C.down;

/* ---------- 基本繪圖 ---------- */
function text(ctx, s, x, y, { size = 28, weight = 700, color = C.text, align = 'left', fam = SANS, max = 0, glow = 0 } = {}) {
  s = tx(String(s ?? '')); ctx.textAlign = align; ctx.fillStyle = color; let sz = size; ctx.font = font(sz, weight, fam);
  if (max) while (ctx.measureText(s).width > max && sz > 12) { sz -= 1; ctx.font = font(sz, weight, fam); }
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillText(s, x, y); ctx.shadowBlur = 0; ctx.textAlign = 'left';
}
function panel(ctx, x, y, w, h, title, sub = '') {
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, C.panel1); g.addColorStop(1, C.panel2);
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = C.cyan; ctx.lineWidth = 4; ctx.shadowColor = C.cyan; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(x, y + 26); ctx.lineTo(x, y); ctx.lineTo(x + 26, y); ctx.moveTo(x + w - 26, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - 26); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = C.cyan; ctx.fillRect(x + 18, y + 22, 6, 30);
  ctx.font = font(22, 600); const subW = sub ? ctx.measureText(tx(sub)).width + 24 : 0;
  text(ctx, title, x + 36, y + 49, { size: 33, weight: 900, color: C.cyan, glow: 12, max: w - 56 - subW });
  if (sub) text(ctx, sub, x + w - 18, y + 47, { size: 22, weight: 600, color: C.muted, align: 'right' });
  ctx.strokeStyle = 'rgba(80,215,255,.22)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 16, y + 68); ctx.lineTo(x + w - 16, y + 68); ctx.stroke();
}
// 標籤／數值列
function rows(ctx, x, y, w, h, list, { top = 84, valueSize = 36, labelSize = 27, highlightLast = false } = {}) {
  const step = (h - top - 14) / list.length;
  list.forEach(([label, value, color, small], i) => {
    const cy = y + top + step * i;
    if (highlightLast && i === list.length - 1) { ctx.fillStyle = 'rgba(255,207,87,.12)'; ctx.fillRect(x + 12, cy - 2, w - 24, step - 4); }
    else if (i % 2) { ctx.fillStyle = C.rowAlt; ctx.fillRect(x + 12, cy - 2, w - 24, step - 4); }
    ctx.font = font(valueSize, 800, NUM); const vw = Math.min(ctx.measureText(value).width, w * .55);
    text(ctx, label, x + 22, cy + step / 2 + labelSize * .36, { size: labelSize, weight: 700, color: C.label, max: w - 56 - vw });
    text(ctx, value, x + w - 22, cy + step / 2 + valueSize * .36, { size: valueSize, weight: 800, color: color || C.text, align: 'right', fam: NUM, max: w * .55 });
    if (small) text(ctx, small, x + w - 22, cy + step / 2 + valueSize * .36 + 26, { size: 20, weight: 600, color: C.muted, align: 'right' });
  });
}
function wrap(ctx, s, width) {
  const tokens = String(s || '').match(/[A-Za-z0-9.,%+\-−_/:~()#&]+|\s+|[\s\S]/gu) || [], out = []; let line = '';
  for (const t of tokens) { if (!line && /^\s+$/.test(t)) continue; if (ctx.measureText(line + t).width <= width || !line || /^[，。、；：！？）」%,.;:!?)]/.test(t)) line += t; else { out.push(line.trimEnd()); line = t.trimStart(); } }
  if (line.trim()) out.push(line.trimEnd()); return out;
}
// 編號清單：自動縮小字級以塞進框內
function numbered(ctx, x, y, w, h, items, color) {
  const top = 84, room = h - top - 16, tw = w - 92;
  // 每則最多兩行（超過以「…」截斷）；先縮字級（27→21），仍放不下就減少則數
  const clip = l => { if (l.length <= 2) return l; let s = l[1]; while (s && ctx.measureText(s + '…').width > tw) s = s.slice(0, -1); return [l[0], s + '…']; };
  const height = (ls, size) => ls.reduce((a, l) => a + l.length * size * 1.32 + 12, 0);
  let size = 27, lines, list = items;
  for (;;) {
    for (size = 27; size >= 21; size--) { ctx.font = font(size, 600); lines = list.map(t => clip(wrap(ctx, t, tw))); if (height(lines, size) <= room) break; }
    if (height(lines, size) <= room || list.length <= 3) break;
    list = list.slice(0, -1);
  }
  let cy = y + top;
  lines.forEach((ls, i) => {
    const lh = size * 1.32;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x + 42, cy + lh / 2 + 2, 17, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    text(ctx, String(i + 1), x + 42, cy + lh / 2 + 10, { size: 22, weight: 900, color, align: 'center', fam: NUM });
    ctx.font = font(size, 600); ctx.fillStyle = C.text; ls.forEach((l, k) => ctx.fillText(l, x + 72, cy + size + k * lh - 2));
    cy += ls.length * lh + 12;
  });
}

/* ---------- 版面 ---------- */
export function drawCard(ctx, d) {
  const redUp = MK.upColors().up === '#ff3d5a'; C.up = redUp ? '#ff5a74' : '#33e8a2'; C.down = redUp ? '#33e8a2' : '#ff5a74';
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; for (let i = 0; i < W; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke(); } for (let i = 0; i < H; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke(); }
  const glowTop = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700); glowTop.addColorStop(0, 'rgba(79,240,255,.16)'); glowTop.addColorStop(1, 'rgba(79,240,255,0)'); ctx.fillStyle = glowTop; ctx.fillRect(0, 0, W, 600);
  // 標頭
  const [, mo, da] = d.date.split('-'), wd = '日一二三四五六'[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
  ctx.fillStyle = 'rgba(79,240,255,.08)'; ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.shadowColor = C.cyan; ctx.shadowBlur = 16; ctx.beginPath(); ctx.roundRect(M, M, 190, 190, 16); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  text(ctx, `${Number(mo)}/${da}`, M + 95, M + 100, { size: 64, weight: 900, align: 'center', fam: NUM, max: 170 });
  text(ctx, `（${wd}）`, M + 95, M + 158, { size: 40, weight: 800, color: C.cyan, align: 'center' });
  text(ctx, '盤後籌碼整理', M + 220, M + 112, { size: 92, weight: 900, glow: 24, color: C.text, max: W - M * 2 - 220 });
  text(ctx, 'EQUILENS NEXUS · AI 盤後日報', M + 224, M + 168, { size: 26, weight: 700, color: C.cyan, fam: NUM });
  if (d.index?.twse?.time) text(ctx, `資料時間 ${d.index.twse.time}`, W - M, M + 168, { size: 22, weight: 600, color: C.muted, align: 'right' });
  if (d.points?.headline) {
    ctx.fillStyle = 'rgba(255,207,87,.1)'; ctx.fillRect(M, 236, W - 2 * M, 60); ctx.fillStyle = C.amber; ctx.fillRect(M, 236, 6, 60);
    text(ctx, 'AI 摘要', M + 22, 276, { size: 26, weight: 900, color: C.amber });
    text(ctx, d.points.headline, M + 130, 277, { size: 30, weight: 800, max: W - 2 * M - 150 });
  }
  const cw3 = (W - 2 * M - 2 * G) / 3, col = i => M + i * (cw3 + G);
  // 第 1 排：大盤表現、三大法人、市場寬度
  let y = 312, h = 285;
  { const x = col(0), ix = d.index?.twse, m = d.market; panel(ctx, x, y, cw3, h, '大盤表現');
    text(ctx, '加權指數', x + 22, y + 106, { size: 27, color: C.label });
    text(ctx, fx(ix?.close), x + 22, y + 166, { size: 58, weight: 900, color: tone(ix?.change), fam: NUM, max: cw3 - 44 });
    text(ctx, ix ? `${ix.change > 0 ? '▲' : ix.change < 0 ? '▼' : ''}${fx(Math.abs(ix.change))}（${fx(Math.abs(ix.pct))}%）` : '—', x + 22, y + 207, { size: 31, weight: 800, color: tone(ix?.change), fam: NUM, max: cw3 - 44 });
    text(ctx, `成交 ${fx((ix?.amount ?? m?.money) / 1e8)} 億`, x + 22, y + 244, { size: 27, weight: 700, max: cw3 - 44 });
    if (m?.moneyChange != null) text(ctx, `較前日 ${sx(m.moneyChange, 1)}%`, x + 22, y + 270, { size: 22, weight: 600, color: C.muted }); }
  { const x = col(1), t = d.institutions; panel(ctx, x, y, cw3, h, '三大法人', '億 · 上市');
    rows(ctx, x, y, cw3, h, [['外資', sx(t?.foreign), tone(t?.foreign)], ['投信', sx(t?.trust), tone(t?.trust)], ['自營商', sx(t?.dealer), tone(t?.dealer)], ['合計', sx(t?.total), tone(t?.total)]], { highlightLast: true, valueSize: 36 }); }
  { const x = col(2), m = d.market; panel(ctx, x, y, cw3, h, '市場寬度', '上市櫃普通股');
    const up = m?.up || 0, down = m?.down || 0, flat = m?.flat || 0, tot = up + down + flat || 1;
    text(ctx, '上漲', x + 22, y + 116, { size: 25, color: C.label }); text(ctx, '下跌', x + cw3 - 22, y + 116, { size: 25, color: C.label, align: 'right' });
    text(ctx, fx(up, 0), x + 22, y + 166, { size: 46, weight: 900, color: C.up, fam: NUM }); text(ctx, fx(down, 0), x + cw3 - 22, y + 166, { size: 46, weight: 900, color: C.down, fam: NUM, align: 'right' });
    const bw = cw3 - 44; ctx.fillStyle = C.up; ctx.fillRect(x + 22, y + 182, bw * up / tot, 12); ctx.fillStyle = '#5b6b82'; ctx.fillRect(x + 22 + bw * up / tot, y + 182, bw * flat / tot, 12); ctx.fillStyle = C.down; ctx.fillRect(x + 22 + bw * (up + flat) / tot, y + 182, bw * down / tot, 12);
    text(ctx, `平盤 ${fx(flat, 0)}`, x + cw3 / 2, y + 222, { size: 22, weight: 600, color: C.muted, align: 'center' });
    text(ctx, '漲停', x + 22, y + 260, { size: 25, color: C.label }); text(ctx, fx(m?.limitUp, 0), x + 92, y + 262, { size: 36, weight: 900, color: C.up, fam: NUM });
    text(ctx, '跌停', x + cw3 / 2 + 8, y + 260, { size: 25, color: C.label }); text(ctx, fx(m?.limitDown, 0), x + cw3 / 2 + 78, y + 262, { size: 36, weight: 900, color: C.down, fam: NUM }); }
  // 第 2 排：台指期、散戶籌碼、選擇權指標
  y = 613; h = 250;
  { const x = col(0), f = d.futuresFlow; panel(ctx, x, y, cw3, h, '外資期權', '單位：口');
    rows(ctx, x, y, cw3, h, [['台指期淨部位', sx(f?.net, 0), tone(f?.net)], ['較前日', sx(f?.netChange, 0), tone(f?.netChange)], ['買權淨部位', sx(f?.callNet, 0), tone(f?.callNet)], ['賣權淨部位', sx(f?.putNet, 0), tone(f?.putNet)]], { valueSize: 32, labelSize: 25 }); }
  { const x = col(1), r = d.retail; panel(ctx, x, y, cw3, h, '散戶籌碼', '單位：口');
    rows(ctx, x, y, cw3, h, [['小台淨部位', sx(r?.mini?.net, 0), tone(r?.mini?.net)], ['較前日', sx(r?.mini?.change, 0), tone(r?.mini?.change)], ['微台淨部位', sx(r?.micro?.net, 0), tone(r?.micro?.net)], ['較前日', sx(r?.micro?.change, 0), tone(r?.micro?.change)]], { valueSize: 32, labelSize: 25 }); }
  { const x = col(2), r = d.retail; panel(ctx, x, y, cw3, h, '多空指標');
    rows(ctx, x, y, cw3, h, [['小台散戶多空', d.retail?.mini?.ratio == null ? '—' : `${sx(r.mini.ratio)}%`, tone(r?.mini?.ratio)], ['微台散戶多空', d.retail?.micro?.ratio == null ? '—' : `${sx(r.micro.ratio)}%`, tone(r?.micro?.ratio)], ['P/C Ratio', d.pcr == null ? '—' : `${fx(d.pcr)}%`, C.amber]], { valueSize: 32, labelSize: 25 }); }
  // 第 3 排：融資融券、指數表現、期貨市場
  y = 879; h = 285;
  const w1 = 384, w2 = 250, w3 = W - 2 * M - w1 - w2 - 2 * G, x1 = M, x2 = M + w1 + G, x3 = x2 + w2 + G;
  { const m = d.margin; panel(ctx, x1, y, w1, h, '融資融券', m?.date ? `上市 · ${m.date.slice(5).replace('-', '/')}` : '上市');
    rows(ctx, x1, y, w1, h, [['融資餘額（億）', fx(m?.marginMoney)], ['較前日', sx(m?.marginChange), tone(m?.marginChange)], ['融券餘額（張）', fx(m?.shortLots, 0)], ['較前日', sx(m?.shortChange, 0), tone(m?.shortChange)]], { valueSize: 32, labelSize: 25 }); }
  { panel(ctx, x2, y, w2, h, '指數表現');
    [['上市', d.index?.twse, y + 84], ['上櫃', d.index?.tpex, y + 190]].forEach(([lab, ix, yy]) => {
      ctx.fillStyle = lab === '上市' ? 'rgba(79,240,255,.14)' : 'rgba(177,166,255,.16)'; ctx.fillRect(x2 + 14, yy, 64, 34);
      text(ctx, lab, x2 + 46, yy + 26, { size: 22, weight: 900, color: lab === '上市' ? C.cyan : C.violet, align: 'center' });
      text(ctx, fx(ix?.close), x2 + w2 - 16, yy + 30, { size: 30, weight: 900, color: tone(ix?.change), fam: NUM, align: 'right', max: w2 - 100 });
      text(ctx, ix ? `${ix.change > 0 ? '▲' : ix.change < 0 ? '▼' : ''}${fx(Math.abs(ix.change))}（${fx(Math.abs(ix.pct))}%）` : '—', x2 + w2 - 16, yy + 72, { size: 24, weight: 800, color: tone(ix?.change), fam: NUM, align: 'right', max: w2 - 30 });
    }); }
  { panel(ctx, x3, y, w3, h, '期貨市場', '近月');
    const cols = [x3 + 20, x3 + w3 * .47, x3 + w3 * .71, x3 + w3 - 16];
    [['商品', 'left'], ['收盤', 'right'], ['漲跌', 'right'], ['幅度', 'right']].forEach(([t, a], i) => text(ctx, t, cols[i] + (i === 1 ? 0 : 0), y + 104, { size: 21, weight: 700, color: C.muted, align: a }));
    const list = d.futures.slice(0, 5), step = 34;
    list.forEach((f, i) => { const yy = y + 138 + i * step; if (i % 2) { ctx.fillStyle = C.rowAlt; ctx.fillRect(x3 + 10, yy - 26, w3 - 20, step); }
      text(ctx, f.name, cols[0], yy, { size: 23, weight: 800 }); text(ctx, fx(f.close, f.close >= 1000 ? 0 : 2), cols[1], yy, { size: 22, weight: 800, fam: NUM, align: 'right', max: w3 * .26 });
      text(ctx, sx(f.change, Math.abs(f.change) >= 100 ? 0 : 1), cols[2], yy, { size: 21, weight: 800, color: tone(f.change), fam: NUM, align: 'right' }); text(ctx, `${sx(f.pct)}%`, cols[3], yy, { size: 21, weight: 800, color: tone(f.change), fam: NUM, align: 'right' }); });
    if (!list.length) text(ctx, '期貨行情尚未取得', x3 + w3 / 2, y + 180, { size: 24, color: C.muted, align: 'center' }); }
  // 第 4 排：類股強弱
  y = 1180; h = 290; const cw2 = (W - 2 * M - G) / 2;
  [['類股強勢 Top 5', d.sectors?.strong || [], M, C.up], ['類股弱勢 Top 5', d.sectors?.weak || [], M + cw2 + G, C.down]].forEach(([title, list, x, color]) => {
    panel(ctx, x, y, cw2, h, title, '依加權漲跌幅');
    const cx = [x + 40, x + 74, x + cw2 * .62, x + cw2 * .81, x + cw2 - 18];
    [['類股', cx[1], 'left'], ['漲跌幅', cx[2], 'right'], ['成交比重', cx[3], 'right'], ['漲／跌', cx[4], 'right']].forEach(([t, xx, a]) => text(ctx, t, xx, y + 100, { size: 21, color: C.muted, align: a }));
    list.forEach((s, i) => { const yy = y + 136 + i * 35; if (i % 2) { ctx.fillStyle = C.rowAlt; ctx.fillRect(x + 10, yy - 26, cw2 - 20, 36); }
      ctx.fillStyle = i < 3 ? color : '#3a4a62'; ctx.beginPath(); ctx.arc(cx[0], yy - 8, 14, 0, Math.PI * 2); ctx.fill(); text(ctx, String(i + 1), cx[0], yy, { size: 19, weight: 900, color: i < 3 ? '#081221' : C.text, align: 'center', fam: NUM });
      text(ctx, s.name, cx[1], yy, { size: 24, weight: 800, max: cx[2] - cx[1] - 100 }); text(ctx, `${sx(s.change)}%`, cx[2], yy, { size: 23, weight: 800, color: tone(s.change), fam: NUM, align: 'right' });
      text(ctx, `${fx(s.share)}%`, cx[3], yy, { size: 22, weight: 700, fam: NUM, align: 'right' }); text(ctx, `${s.up}/${s.down}`, cx[4], yy, { size: 21, weight: 700, color: C.label, fam: NUM, align: 'right' }); });
    if (!list.length) text(ctx, '熱浪圖資料尚未取得', x + cw2 / 2, y + 190, { size: 24, color: C.muted, align: 'center' });
  });
  // 第 5 排：今日重點、明日觀盤
  y = 1486; h = 388;
  const next = (() => { const t = new Date(`${d.date}T12:00:00Z`); do t.setUTCDate(t.getUTCDate() + 1); while ([0, 6].includes(t.getUTCDay())); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; })();
  panel(ctx, M, y, cw2, h, '今日籌碼重點', 'AI 彙整'); numbered(ctx, M, y, cw2, h, (d.points?.highlights || []).slice(0, 8), C.cyan);
  panel(ctx, M + cw2 + G, y, cw2, h, `${next} 觀盤重點`, 'AI 彙整'); numbered(ctx, M + cw2 + G, y, cw2, h, (d.points?.watch || []).slice(0, 8), C.amber);
  text(ctx, '衡析 Nexus 彙整 · 重點由 AI 撰寫 · 研究紀錄，非投資建議', W / 2, H - 22, { size: 21, weight: 600, color: C.muted, align: 'center' });
}

/* ---------- 下載 ---------- */
export function renderCard(data) { const c = document.createElement('canvas'); c.width = W; c.height = H; drawCard(c.getContext('2d'), data); return c; }
// 回傳 'download'（已下載）或 'sheet'（iPhone／iPad 顯示儲存預覽）
export async function downloadReportCard(data) {
  if (!data?.date) throw new Error('沒有可製作圖卡的資料');
  const blob = await new Promise(res => renderCard(data).toBlob(res, 'image/png')); if (!blob) throw new Error('圖卡產生失敗，請重試');
  return saveImage(blob, `衡析盤後籌碼-${data.date}.png`);
}
