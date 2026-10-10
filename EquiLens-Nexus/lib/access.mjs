// 遠端存取（例如 https://nexus.example.com）：只接受經 Cloudflare Access 驗證過的請求。
// 設定檔 .local/remote.json：{ "hosts": ["nexus.example.com"], "teamDomain": "xxx.cloudflareaccess.com", "aud": "<Application Audience Tag>" }
// 未設定 teamDomain/aud 時，所有外部主機的請求一律拒絕；本機 127.0.0.1／localhost 不受影響。
import crypto from 'node:crypto';
import { read } from './storage.mjs';

export const remoteConfig = () => { const c = read('remote.json', {}); return { hosts: (c.hosts || []).map(h => String(h).toLowerCase()), teamDomain: String(c.teamDomain || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''), aud: String(c.aud || '') }; };
export const isRemoteHost = host => remoteConfig().hosts.includes(String(host || '').toLowerCase());

let jwks = { team: '', at: 0, keys: [] };
async function keysFor(team, fetcher) {
  if (jwks.team === team && Date.now() - jwks.at < 3600e3 && jwks.keys.length) return jwks.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('無法取得 Cloudflare Access 公鑰');
  const body = await res.json(); jwks = { team, at: Date.now(), keys: body.keys || [] }; return jwks.keys;
}
const b64 = s => Buffer.from(String(s), 'base64url');
// 驗證 Cf-Access-Jwt-Assertion：RS256 簽章、iss、aud、exp／nbf。成功回傳 { email }，失敗丟出錯誤。
export async function verifyAccessJwt(token, { teamDomain, aud }, { fetcher = fetch, now = Date.now() } = {}) {
  if (!teamDomain || !aud) throw new Error('尚未完成 Cloudflare Access 設定');
  const parts = String(token || '').split('.'); if (parts.length !== 3) throw new Error('缺少 Cloudflare Access 憑證');
  const header = JSON.parse(b64(parts[0])), claims = JSON.parse(b64(parts[1]));
  if (header.alg !== 'RS256') throw new Error('憑證演算法不符');
  let jwk = (await keysFor(teamDomain, fetcher)).find(k => k.kid === header.kid);
  if (!jwk) { jwks.at = 0; jwk = (await keysFor(teamDomain, fetcher)).find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('找不到對應的 Access 公鑰');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64(parts[2]));
  if (!ok) throw new Error('憑證簽章無效');
  const sec = now / 1000, auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${teamDomain}`) throw new Error('憑證簽發者不符');
  if (!auds.includes(aud)) throw new Error('憑證不屬於此應用程式');
  if (!(claims.exp > sec - 30) || (claims.nbf && claims.nbf > sec + 30)) throw new Error('憑證已過期');
  return { email: claims.email || claims.sub || '' };
}
