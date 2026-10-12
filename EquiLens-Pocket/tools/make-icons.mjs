// 衡析標誌與 App 圖示（電光青 #2EE6FF、深墨 #07101C）：圓角六角形＋上升折線。
// 產生：手機版 icon.svg、icon-192.png、icon-512.png、badge-96.png（通知狀態列用的透明單色剪影），電腦版 favicon.svg。
// PNG 以內建的超取樣光柵化與 zlib 編碼產生，不需要其他套件。用法：node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const CYAN = '#2EE6FF', INK = '#07101C';
const HERE = path.dirname(fileURLToPath(import.meta.url)), POCKET = path.join(HERE, '..', 'public'), NEXUS = path.join(HERE, '..', '..', 'EquiLens-Nexus', 'public');
// 100×100 座標：尖頂六角形（頂點半徑 40、圓角 5，視覺半徑約 46）與折線（線寬 9、圓頭）
const HEX_R = 40, HEX_ROUND = 5, LINE = [[28, 67], [44, 50], [56, 60], [74, 34]], LINE_W = 9;
const hexPts = (cx = 50, cy = 50, r = HEX_R) => [-90, -30, 30, 90, 150, 210].map(a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)]);
const f = n => Math.round(n * 100) / 100;

// 標誌（不含底）：hex＝六角形顏色、line＝折線顏色；s／tx／ty 為縮放與位移
export function markSVG({ hex = CYAN, line = INK, s = 1, tx = 0, ty = 0 } = {}) {
  const P = hexPts().map(([x, y]) => `${f(x * s + tx)},${f(y * s + ty)}`).join(' '), L = LINE.map(([x, y]) => `${f(x * s + tx)},${f(y * s + ty)}`).join(' ');
  return `<polygon points="${P}" fill="${hex}" stroke="${hex}" stroke-width="${f(HEX_ROUND * 2 * s)}" stroke-linejoin="round"/><polyline points="${L}" fill="none" stroke="${line}" stroke-width="${f(LINE_W * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// App 圖示：深墨圓角方形底＋電光青六角形
export const appIconSVG = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${INK}"/>${markSVG({ s: .66, tx: 17, ty: 17 })}</svg>`;

/* ---------- PNG ---------- */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function segDist(px, py, [ax, ay], [bx, by]) { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function inPoly(px, py, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; }
const polyDist = (px, py, P) => Math.min(...P.map((p, i) => segDist(px, py, p, P[(i + 1) % P.length])));
// layers：由下而上 [{ shape: 'bg'|'hex'|'line', color, alpha }]；mark 的縮放 s 與位移 t 以 100 座標計
function rasterize(size, layers, { s = 1, t = 0 } = {}) {
  const hex = hexPts(50 * s + t, 50 * s + t, HEX_R * s), line = LINE.map(([x, y]) => [x * s + t, y * s + t]), out = Buffer.alloc(size * size * 4), N = 4;
  const cover = (shape, x, y) => shape === 'bg' ? true : shape === 'hex' ? inPoly(x, y, hex) || polyDist(x, y, hex) <= HEX_ROUND * s : line.some((p, i) => i < line.length - 1 && segDist(x, y, p, line[i + 1]) <= LINE_W * s / 2);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const x = (px + (sx + .5) / N) / size * 100, y = (py + (sy + .5) / N) / size * 100;
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (const L of layers) if (cover(L.shape, x, y)) { if (L.cut) { cr = cg = cb = ca = 0; continue; } const [lr, lg, lb] = rgb(L.color), la = L.alpha ?? 1; cr = lr * la + cr * (1 - la); cg = lg * la + cg * (1 - la); cb = lb * la + cb * (1 - la); ca = la + ca * (1 - la); }
      r += cr; g += cg; b += cb; a += ca;
    }
    const k = (py * size + px) * 4, n = N * N; out[k] = a ? Math.round(r / a) : 0; out[k + 1] = a ? Math.round(g / a) : 0; out[k + 2] = a ? Math.round(b / a) : 0; out[k + 3] = Math.round(a / n * 255);
  }
  return png(size, out);
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size); for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const icon = [{ shape: 'bg', color: INK }, { shape: 'hex', color: CYAN }, { shape: 'line', color: INK }];
  const files = {
    [path.join(POCKET, 'icon.svg')]: appIconSVG(), [path.join(NEXUS, 'favicon.svg')]: appIconSVG(),
    // PNG 圖示滿版深墨底（系統自行套用圓角或遮罩；六角形在安全範圍內）
    [path.join(POCKET, 'icon-192.png')]: rasterize(192, icon, { s: .62, t: 19 }), [path.join(POCKET, 'icon-512.png')]: rasterize(512, icon, { s: .62, t: 19 }),
    // 通知狀態列小圖示：Android 只取透明度 → 白色六角形、折線鏤空
    [path.join(POCKET, 'badge-96.png')]: rasterize(96, [{ shape: 'hex', color: '#FFFFFF' }, { shape: 'line', cut: true }], { s: .92, t: 4 }),
  };
  for (const [file, data] of Object.entries(files)) { fs.writeFileSync(file, data); console.log(path.relative(path.join(HERE, '..', '..'), file), data.length, 'bytes'); }
}
