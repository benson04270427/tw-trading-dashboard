// 產生衡析手機版的專用通知音效（WAV，44.1 kHz、16 位元、單聲道），寫到 public/sound-*.wav。
// 網頁通知在 Android 無法逐則指定音效；使用者下載後，到 Android 的通知設定把衡析的通知音換成這些檔案。
// 用法：node tools/make-sounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100, OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// 一個音：頻率、開始時間、衰減時間常數、音量、泛音 [倍數, 相對音量, 衰減倍率]
function render(notes, seconds) {
  const n = Math.round(seconds * RATE), buf = new Float64Array(n);
  for (const { f, at, tau, gain = 1, partials = [[1, 1, 1]] } of notes) {
    const start = Math.round(at * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE, attack = Math.min(1, t / 0.004);
      let v = 0; for (const [k, a, d] of partials) v += a * Math.sin(2 * Math.PI * f * k * t) * Math.exp(-t / (tau * d));
      buf[i] += gain * attack * v;
    }
  }
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1, fade = Math.round(0.03 * RATE);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) { const tail = i > n - fade ? (n - i) / fade : 1; pcm.writeInt16LE(Math.round(buf[i] / peak * 0.8 * tail * 32767), i * 2); }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const bell = [[1, 1, 1], [2.76, 0.28, 0.45], [5.4, 0.12, 0.25]];
export const SOUNDS = {
  // 標準：上行雙音鐘聲（與電腦版浮動雷達提示音同一組音高）
  chime: render([{ f: 1318.5, at: 0, tau: 0.22, partials: bell }, { f: 1760, at: 0.13, tau: 0.32, partials: bell }], 0.95),
  // 醒目：快速三連音（Do–Mi–Sol），適合吵雜環境
  alert: render([{ f: 1046.5, at: 0, tau: 0.08, partials: [[1, 1, 1], [3, 0.18, 0.6]] }, { f: 1318.5, at: 0.11, tau: 0.08, partials: [[1, 1, 1], [3, 0.18, 0.6]] }, { f: 1568, at: 0.22, tau: 0.28, partials: [[1, 1, 1], [3, 0.18, 0.6], [2, 0.2, 0.5]] }], 0.9),
  // 柔和：木琴般的單音，適合辦公室
  soft: render([{ f: 784, at: 0, tau: 0.3, partials: [[1, 1, 1], [4, 0.22, 0.25], [10, 0.05, 0.1]] }], 1.0),
};
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const [name, wav] of Object.entries(SOUNDS)) { fs.writeFileSync(path.join(OUT, `sound-${name}.wav`), wav); console.log(`sound-${name}.wav`, wav.length, 'bytes'); }
}
