// Web Push（RFC 8291 aes128gcm 加密 + RFC 8292 VAPID 簽章），只用 Node 內建 crypto。
// 金鑰與訂閱保存在 .local/push.json；手機在 App 內按「開啟通知」後才會建立訂閱。
import crypto from 'node:crypto';
import { read, write } from './storage.mjs';
import { tx, t } from '../public/i18n.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');
// VAPID 聯絡資訊：Apple 推播服務（iPhone）要求是有效的 https 或 mailto 網址，localhost 類的假信箱會被拒絕（BadJwtToken）。
// 依序使用：環境變數 VAPID_SUBJECT → Nexus 設定的對外網址 → 手機開啟通知時所用的 https 網址
const validSubject = u => { try { const x = new URL(u); return (x.protocol === 'https:' && /\.[a-z]{2,}$/i.test(x.hostname) && !/localhost/i.test(x.hostname)) || (x.protocol === 'mailto:' && /@[^@]+\.[a-z]{2,}$/i.test(x.pathname)); } catch { return false; } };
export function setSubject(url) { if (!validSubject(url)) return; const s = store(); const v = new URL(url).origin; if (s.subject !== v) { s.subject = v; save(s); } }
const subject = s => process.env.VAPID_SUBJECT || s?.subject || 'mailto:webpush@equilens.invalid';

export function generateVapid() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}
function store() {
  const s = read('push.json', null);
  if (s?.vapid?.publicKey) return s;
  const fresh = { vapid: generateVapid(), subs: [], lastSeq: 0 }; write('push.json', fresh); return fresh;
}
const save = s => write('push.json', s);
export const publicKey = () => store().vapid.publicKey;

export function vapidAuthorization(endpoint, vapid, now = Date.now(), sub = subject(read('push.json', null))) {
  const pub = unb64u(vapid.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}
export function encryptPayload(payload, keys, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const ua = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  if (ua.length !== 65 || auth.length < 16) throw new Error('推播訂閱金鑰格式錯誤');
  const as = ecdh || crypto.createECDH('prime256v1'); if (!ecdh) as.generateKeys();
  const asPub = as.getPublicKey(), shared = as.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

export function validSubscription(s) {
  try { const u = new URL(s.endpoint); return u.protocol === 'https:' && s.endpoint.length < 1000 && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && unb64u(s.keys.p256dh).length === 65; } catch { return false; }
}
export function subscribe(sub, ua = '', origin = '') {
  if (!validSubscription(sub)) throw Object.assign(new Error('推播訂閱格式錯誤'), { status: 400 });
  const s = store(); s.subs = s.subs.filter(x => x.endpoint !== sub.endpoint);
  s.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ua: String(ua).slice(0, 120), createdAt: new Date().toISOString() });
  if (s.subs.length > 10) s.subs = s.subs.slice(-10);
  if (!s.subject && validSubject(origin)) s.subject = new URL(origin).origin;
  save(s); return s.subs.length;
}
export function unsubscribe(endpoint) { const s = store(); s.subs = s.subs.filter(x => x.endpoint !== endpoint); save(s); }
export const subscriptionCount = () => store().subs.length;
export const hasSubscription = endpoint => store().subs.some(x => x.endpoint === endpoint);

export async function sendToAll(message, { fetcher = fetch } = {}) {
  const s = store(), payload = JSON.stringify(message).slice(0, 3000), gone = new Set();
  let sent = 0;
  await Promise.all(s.subs.map(async sub => {
    try {
      const res = await fetcher(sub.endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuthorization(sub.endpoint, s.vapid, Date.now(), subject(s)) }, body: encryptPayload(payload, sub.keys) });
      if (res.status === 404 || res.status === 410) gone.add(sub.endpoint); else if (res.ok) sent++;
    } catch { }
  }));
  if (gone.size) { const now = store(); now.subs = now.subs.filter(x => !gone.has(x.endpoint)); save(now); }
  return sent;
}
export const lastSeq = () => store().lastSeq || 0;
export function setLastSeq(seq) { const s = store(); s.lastSeq = seq; save(s); }

// 通知文字依 Nexus 的介面語言翻譯
export const localize = n => ({ ...n, title: tx(n.title), body: n.body ? tx(n.body) : n.body });
// 將雷達、新聞與日報事件轉成通知；同一批太多時合併成一則摘要。
const ICON = { signal: '📶', volume: '🔥', 'surge-up': '🚀', 'surge-down': '⚡', 'limit-up': '🔺', 'limit-down': '🔻', 'limit-up-open': '⚠️', 'limit-down-open': '↗️', 'pattern-entry': '🎯', stop: '🛑', report: '📰', news: '🗞️', 'dt-breakout': '💥', 'dt-vwap': '📈', 'dt-bid': '🟢', 'dt-stop': '⏰', 'dt-weak': '⚠️', 'dt-risk': '🛑', custom: '🔔', broker: '🏦', holders: '🐋' };
export function notificationsFor(alerts) { return build(alerts).map(localize); }
// 當沖做多訊號每 5 分鐘彙整成一則推播（在整 5 分鐘時送出，例如 09:20、09:25）；
// 多單轉弱、跌破參考停損、停止新增部位等風險提醒不彙整，仍立即推播。
export const DT_DIGEST_TYPES = new Set(['dt-breakout', 'dt-vwap', 'dt-bid']);
export const DIGEST_MS = 5 * 60e3;
export const digestSlot = (t, ms = DIGEST_MS) => Math.floor(t / ms) * ms; // 台北時差是整點，UTC 的 5 分鐘格線與當地一致
export function createDigest({ ms = DIGEST_MS, now = Date.now } = {}) {
  let held = [], slot = digestSlot(now(), ms);
  return {
    // 分出要彙整的訊號，其餘回傳立即推播
    split(alerts) { const later = alerts.filter(a => DT_DIGEST_TYPES.has(a.type)); held.push(...later); return alerts.filter(a => !DT_DIGEST_TYPES.has(a.type)); },
    // 跨過整 5 分鐘時，回傳上一段時間累積的訊號（沒有就回傳空陣列）
    due() { const s = digestSlot(now(), ms); if (s === slot) return []; slot = s; const out = held; held = []; return out; },
    get size() { return held.length; },
  };
}
export function digestNotification(alerts, at = Date.now()) {
  if (!alerts.length) return null;
  const latest = new Map(); for (const a of alerts) latest.set(`${a.stockId}:${a.type}`, a); // 同一檔同一種訊號只留最新一則
  const list = [...latest.values()];
  if (list.length === 1) return build(list).map(localize)[0];
  const hm = new Date(digestSlot(at)).toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  const lines = list.slice(0, 8).map(a => `${ICON[a.type] || '📡'} ${a.name} ${a.stockId} ${tx(a.title)} ${a.close ?? ''}（${a.change > 0 ? '+' : ''}${a.change ?? '—'}%）`);
  if (list.length > 8) lines.push(t('…另 {n} 則', { n: list.length - 8 }));
  return { title: t('📡 當沖訊號 {n} 則（{time} 前 5 分鐘）', { n: list.length, time: hm }), body: lines.join('\n'), tag: `dt-digest:${digestSlot(at)}`, url: '/#live' };
}
function build(alerts) {
  if (!alerts.length) return [];
  const report = alerts.filter(a => a.type === 'report').map(a => ({ title: '📰 AI 盤後日報', body: a.detail, tag: 'report', url: '/#brief' }));
  // 新聞：每則各自一個通知（點開直接看原文）；一次超過 4 則合併成摘要。夜間勿擾時段只記錄不推播。
  const news = alerts.filter(a => a.type === 'news' && !a.quiet), newsOut = news.length <= 4
    ? news.map(a => ({ title: `🗞️ ${a.name} ${a.stockId}`, body: `${a.detail}${a.source ? `（${a.source}）` : ''}`, tag: `news:${a.seq}`, url: a.url || '/#live' }))
    : [{ title: `🗞️ 個股新聞 ${news.length} 則`, body: news.slice(0, 5).map(a => `${a.name}：${a.detail}`).join('\n'), tag: 'news-batch', url: '/#live' }];
  // 自訂提醒：使用者自己設的條件，一律各自推播（一次超過 6 則才合併）；分點追蹤與大戶排行是盤後摘要，點開到籌碼分頁
  const custom = alerts.filter(a => a.type === 'custom'), customOut = custom.length <= 6
    ? custom.map(a => ({ title: `🔔 ${a.name} ${a.stockId}`, body: `${a.close}（${a.change > 0 ? '+' : ''}${a.change ?? '—'}%）· ${a.detail}`, tag: `custom:${a.rule || a.stockId}`, url: '/#live' }))
    : [{ title: `🔔 自訂提醒 ${custom.length} 則`, body: custom.slice(0, 6).map(a => `${a.name}：${a.detail}`).join('\n'), tag: 'custom-batch', url: '/#live' }];
  // 訊號面板：自選股收盤後出現新的買進／賣出訊號，各自推播（一次超過 4 則合併）
  const sig = alerts.filter(a => a.type === 'signal'), sigOut = sig.length <= 4
    ? sig.map(a => ({ title: `📶 ${a.name} ${a.stockId} ${a.title}`, body: `${a.close} · ${a.detail}`, tag: `signal:${a.stockId}`, url: '/#live' }))
    : [{ title: `📶 自選股新訊號 ${sig.length} 則`, body: sig.slice(0, 6).map(a => `${a.name} ${a.title}`).join('、'), tag: 'signal-batch', url: '/#live' }];
  const picks = alerts.filter(a => a.type === 'picks').map(a => ({ title: `⭐ ${a.title}`, body: a.detail, tag: `picks:${a.date || ''}`, url: '/#home' }));
  const risk = alerts.filter(a => a.type === 'risk').map(a => ({ title: `🛡️ ${a.title}`, body: a.detail, tag: 'risk', url: '/#home' }));
  const chips = alerts.filter(a => a.type === 'broker' || a.type === 'holders').map(a => ({ title: `${ICON[a.type]} ${a.title}`, body: a.detail, tag: `${a.type}:${a.date || ''}`, url: '/#flows' }));
  // 持股停損／停利：各自推播；內部人申報轉讓（自選與持股）：合併成一則
  const pf = alerts.filter(a => a.type === 'portfolio').map(a => ({ title: `💼 ${a.name} ${a.stockId} ${a.title}`, body: a.detail, tag: `portfolio:${a.stockId}`, url: '/#home' }));
  const ins = alerts.filter(a => a.type === 'insider'), insOut = ins.length ? [{ title: ins.length === 1 ? `🏛 ${ins[0].name} ${ins[0].stockId} ${ins[0].title}` : `🏛 內部人申報轉讓 ${ins.length} 則`, body: ins.slice(0, 5).map(a => `${a.name}：${a.detail}`).join('\n'), tag: `insider:${ins[0].date || ''}`, url: '/#home' }] : [];
  const head = [...report, ...pf, ...picks, ...customOut, ...chips, ...risk, ...sigOut, ...insOut];
  const rest = alerts.filter(a => !['report', 'news', 'custom', 'broker', 'holders', 'risk', 'signal', 'picks', 'portfolio', 'insider'].includes(a.type));
  if (rest.length <= 4) return [...head, ...newsOut, ...rest.map(a => !a.stockId ? { title: `${ICON[a.type] || '📡'} ${a.title}`, body: a.detail, tag: a.type, url: '/#live' } : { title: `${ICON[a.type] || '📡'} ${a.name} ${a.stockId} ${a.title}`, body: `${a.close}（${a.change > 0 ? '+' : ''}${a.change ?? '—'}%）· ${a.detail}`, tag: `${a.type}:${a.stockId}`, url: '/#live' })];
  const watch = rest.filter(a => a.watch);
  return [...head, ...newsOut, { title: `📡 盤中雷達：${rest.length} 則異動`, body: (watch.length ? watch : rest).slice(0, 5).map(a => `${a.name}${a.title}`).join('、'), tag: 'radar-batch', url: '/#live' }];
}
