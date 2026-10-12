import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOBILE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-push-'));
const push = await import('../lib/push.mjs');

// 依 RFC 8291 以使用者端私鑰解密，驗證加密格式正確。
function decrypt(buf, uaEcdh, auth) {
  const salt = buf.subarray(0, 16), rs = buf.readUInt32BE(16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPub), ua = uaEcdh.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(rs, 4096); assert.equal(plain.at(-1), 2, 'last-record delimiter');
  return plain.subarray(0, -1).toString();
}

test('payload encryption round-trips with the subscriber keys', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const msg = JSON.stringify({ title: '台積電 急拉', body: '+2.1%' });
  assert.equal(decrypt(push.encryptPayload(msg, keys), ua, auth), msg);
  assert.throws(() => push.encryptPayload(msg, { p256dh: 'AAAA', auth: keys.auth }), /格式錯誤/);
});

test('VAPID JWT is ES256-signed for the push service origin', () => {
  // 聯絡網址：不接受 localhost 或非 https；接受 Nexus 設定的對外網址（只取網域）
  push.setSubject('http://localhost:4340'); push.setSubject('https://localhost'); push.setSubject('https://pocket.example.com/m/');
  const vapid = push.generateVapid(), header = push.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 1_700_000_000_000);
  const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header); assert.equal(k, vapid.publicKey);
  const [h, b, s] = t.split('.'), claims = JSON.parse(Buffer.from(b, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.exp, 1_700_000_000 + 43200); assert.match(claims.sub, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/, 'Apple 推播要求有效的聯絡網址'); assert.doesNotMatch(claims.sub, /localhost/); assert.equal(claims.sub, 'https://pocket.example.com');
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('subscriptions are validated, deduplicated and pruned when the push service says gone', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = e => ({ endpoint: `https://push.example.com/${e}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });
  assert.throws(() => push.subscribe({ endpoint: 'http://insecure', keys: {} }), /格式錯誤/);
  push.subscribe(sub('a')); push.subscribe(sub('a')); push.subscribe(sub('b'));
  assert.equal(push.subscriptionCount(), 2);
  const calls = [];
  const sent = await push.sendToAll({ title: 'x' }, { fetcher: async (url, opt) => { calls.push({ url, opt }); return { ok: !url.endsWith('/b'), status: url.endsWith('/b') ? 410 : 201 }; } });
  assert.equal(sent, 1); assert.equal(push.subscriptionCount(), 1, 'gone subscription removed');
  assert.equal(calls[0].opt.headers['Content-Encoding'], 'aes128gcm'); assert.match(calls[0].opt.headers.Authorization, /^vapid t=/);
});

test('alerts become concise notifications, batching bursts', () => {
  const a = (i, extra = {}) => ({ type: 'surge-up', stockId: '2330', name: `股${i}`, title: '急拉', close: 100, change: 2.5, detail: '5 分鐘內 +2.5%', watch: i === 0, ...extra });
  assert.deepEqual(push.notificationsFor([a(0)]).map(n => [n.title, n.url]), [['🚀 股0 2330 急拉', '/#live']]);
  const many = push.notificationsFor([...Array.from({ length: 6 }, (_, i) => a(i)), { type: 'report', detail: '電子股領漲' }]);
  assert.equal(many.length, 2); assert.equal(many[0].title, '📰 AI 盤後日報'); assert.match(many[1].title, /6 則/); assert.equal(many[1].body, '股0急拉');
  // 新聞：各自一則、點開到原文；夜間勿擾不推；不和雷達異動合併
  const n = (i, extra = {}) => ({ type: 'news', seq: 100 + i, stockId: '2330', name: '台積電', detail: `標題${i}`, source: '經濟日報', url: `https://news.example/${i}`, ...extra });
  assert.deepEqual(push.notificationsFor([n(1), n(2, { quiet: true }), a(0)]).map(x => [x.title, x.body, x.url]), [['🗞️ 台積電 2330', '標題1（經濟日報）', 'https://news.example/1'], ['🚀 股0 2330 急拉', '100（+2.5%）· 5 分鐘內 +2.5%', '/#live']]);
  const burst = push.notificationsFor(Array.from({ length: 6 }, (_, i) => n(i)));
  assert.equal(burst.length, 1); assert.equal(burst[0].title, '🗞️ 個股新聞 6 則'); assert.equal(burst[0].url, '/#live');
  // 當沖：個股訊號照一般格式；不屬於個股的提醒（停止新增部位）只顯示標題與說明
  const dt = push.notificationsFor([a(0, { type: 'dt-breakout', title: '爆量突破' }), { type: 'dt-stop', stockId: '', name: '', title: '停止新增部位', detail: '13:10 起不再發出當沖訊號' }]);
  assert.deepEqual(dt.map(x => [x.title, x.body]), [['💥 股0 2330 爆量突破', '100（+2.5%）· 5 分鐘內 +2.5%'], ['⏰ 停止新增部位', '13:10 起不再發出當沖訊號']]);
});
