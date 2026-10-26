// 手機版的對外連線設定（來自衡析 Nexus「資料與設定 → 遠端存取」）：允許的網域、連線方式、如何取得真實來源 IP。
// Pocket 只綁定 127.0.0.1，所有外部連線都經過這台電腦上的通道或反向代理，因此依連線方式決定要相信哪個標頭：
//   Cloudflare（auto／cloudflare-quick／cloudflare-named）：CF-Connecting-IP、CF-Visitor
//   自行處理（custom）：X-Real-IP 或 X-Forwarded-For 的最後一筆（本機代理附加的那筆）、X-Forwarded-Proto
//   不對外開放（off）：只接受本機網址
// 最近一次從 Nexus 取得的設定存在 .local/remote-cache.json，Nexus 尚未啟動時也能套用。
import { read, write } from './storage.mjs';

const CACHE = 'remote-cache.json';
const MODES = ['auto', 'cloudflare-quick', 'cloudflare-named', 'custom', 'off'];
const TRYCF = /^[a-z0-9-]+\.trycloudflare\.com$/;

export const loadRemote = () => read(CACHE, null);
export function storeRemote(r) {
  const next = { tunnel: MODES.includes(r?.tunnel) ? r.tunnel : 'auto', hosts: (Array.isArray(r?.hosts) ? r.hosts : []).map(h => String(h).toLowerCase()).slice(0, 20), contact: typeof r?.contact === 'string' ? r.contact : '' };
  if (JSON.stringify(read(CACHE, null)) !== JSON.stringify(next)) write(CACHE, next);
  return next;
}

// remote 為 null（還沒取得 Nexus 的設定，例如 Nexus 是舊版）時沿用舊行為：自動信任 Cloudflare 臨時網址
export function allowHost(host, { port, extra = [], remote = null } = {}) {
  const h = String(host || '').toLowerCase();
  if ([`127.0.0.1:${port}`, `localhost:${port}`].includes(h)) return true;
  const mode = remote?.tunnel || 'auto';
  if (mode === 'off') return false;
  if (extra.includes(h) || (remote?.hosts || []).includes(h)) return true;
  return (mode === 'auto' || mode === 'cloudflare-quick') && TRYCF.test(h);
}
const viaCloudflare = mode => !mode || mode === 'auto' || mode.startsWith('cloudflare');

// 真實來源 IP（登入錯誤次數限制用）；讀不到時用連線本身的位址
export function clientIp(req, mode) {
  const h = req.headers || {};
  let ip = '';
  if (viaCloudflare(mode)) ip = h['cf-connecting-ip'];
  else if (mode === 'custom') ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).at(-1);
  return String(ip || req.socket?.remoteAddress || 'local').slice(0, 64);
}
// Tailscale Serve 轉進來的私人網路請求：網址是 <電腦>.<tailnet>.ts.net、Tailscale 附上登入者身分標頭、
// 連線來自本機（Serve 在這台電腦上代理），而且沒有 Cloudflare 標頭（公開通道無法偽造 Host 與移除 CF 標頭）。
// Tailscale Funnel（公開）不會附上身分標頭，所以不算。
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
export function tailnetRequest(req) {
  const h = req?.headers || {}, host = String(h.host || '').toLowerCase().replace(/:\d+$/, '');
  return /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(host) && typeof h['tailscale-user-login'] === 'string' && h['tailscale-user-login'].length > 0
    && !h['cf-connecting-ip'] && !h['cf-ray'] && LOOPBACK.includes(String(req.socket?.remoteAddress || ''));
}
// 外部連線是否為 https（決定 Cookie 是否加上 Secure、是否送出 HSTS）
export function isHttps(req, mode) {
  if (tailnetRequest(req)) return true;
  if (mode === 'off') return false;
  const h = req.headers || {};
  if (String(h['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https') return true;
  return viaCloudflare(mode) && /"scheme":"https"/.test(String(h['cf-visitor'] || ''));
}
