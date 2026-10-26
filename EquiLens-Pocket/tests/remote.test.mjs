// 遠端存取：連線方式決定允許的網域、真實來源 IP 與 https 判斷；電腦版新增的網域不需重啟即生效
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-remote-'));
let profile = { language: 'zh-TW', publicUrl: 'https://pocket.example.com', remote: { tunnel: 'custom', hosts: ['pocket.example.com'], contact: '' } };
const nexus = http.createServer((req, res) => { res.writeHead(req.url === '/api/profile' ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url === '/api/profile' ? profile : { error: 'nope' })); });
await new Promise(r => nexus.listen(0, '127.0.0.1', r));
Object.assign(process.env, { MOBILE_DATA_DIR: dir, PORT: '4398', NEXUS_URL: `http://127.0.0.1:${nexus.address().port}` });
const { allowHost, clientIp, isHttps, storeRemote, loadRemote } = await import('../lib/remote.mjs');
const { server } = await import('../server.mjs');
const auth = await import('../lib/auth.mjs');
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = (p, headers = {}, body) => new Promise((resolve, reject) => { const r = http.request(base + p, { method: body ? 'POST' : 'GET', headers: { Host: '127.0.0.1:4398', ...(body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'nexus-pocket' } : {}), ...headers } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }); r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined); });
test.after(() => { server.close(); nexus.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('allowed hosts per connection mode', () => {
  const o = mode => ({ port: 4340, extra: ['legacy.example.com'], remote: mode ? { tunnel: mode, hosts: ['pocket.example.com'] } : null });
  assert.equal(allowHost('127.0.0.1:4340', o('off')), true);
  assert.equal(allowHost('pocket.example.com', o('off')), false, 'off: local only');
  assert.equal(allowHost('abc.trycloudflare.com', o(null)), true, 'no settings yet: legacy behaviour');
  assert.equal(allowHost('abc.trycloudflare.com', o('cloudflare-quick')), true);
  assert.equal(allowHost('abc.trycloudflare.com', o('cloudflare-named')), false);
  assert.equal(allowHost('abc.trycloudflare.com', o('custom')), false);
  assert.equal(allowHost('pocket.example.com', o('custom')), true);
  assert.equal(allowHost('legacy.example.com', o('custom')), true, 'hosts from Pocket/.local/config.json still work');
  assert.equal(allowHost('pocket.example.com.evil.com', o('custom')), false);
});
test('client IP and https follow the connection mode (headers of other proxies are ignored)', () => {
  const r = headers => ({ headers, socket: { remoteAddress: '127.0.0.1' } });
  const h = { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2', 'x-real-ip': '', 'cf-visitor': '{"scheme":"https"}' };
  assert.equal(clientIp(r(h), 'cloudflare-named'), '1.1.1.1');
  assert.equal(clientIp(r(h), 'custom'), '2.2.2.2', 'last X-Forwarded-For entry is the one added by the local proxy');
  assert.equal(clientIp(r({ ...h, 'x-real-ip': '3.3.3.3' }), 'custom'), '3.3.3.3');
  assert.equal(clientIp(r(h), 'off'), '127.0.0.1');
  assert.equal(isHttps(r(h), 'cloudflare-quick'), true);
  assert.equal(isHttps(r(h), 'custom'), false, 'CF-Visitor is ignored without Cloudflare');
  assert.equal(isHttps(r({ 'x-forwarded-proto': 'https' }), 'custom'), true);
  assert.equal(isHttps(r({ 'x-forwarded-proto': 'https' }), 'off'), false);
});
test('a domain added in Nexus is accepted without restarting Pocket; settings are cached', async () => {
  assert.equal((await req('/health', { Host: 'pocket.example.com' })).status, 200);
  assert.deepEqual(loadRemote(), { tunnel: 'custom', hosts: ['pocket.example.com'], contact: '' });
  assert.equal((await req('/health', { Host: 'abc.trycloudflare.com' })).status, 403, 'quick-tunnel hosts are not trusted in custom mode');
  assert.equal((await req('/health', { Host: 'evil.example.com' })).status, 403);
  storeRemote({ tunnel: 'weird', hosts: ['A.example.com'] }); assert.deepEqual(loadRemote(), { tunnel: 'auto', hosts: ['a.example.com'], contact: '' });
});
test('custom mode: login limits use X-Forwarded-For, rotating CF-Connecting-IP does not bypass them; Secure cookie via X-Forwarded-Proto', async () => {
  auth.setPassword('pocket-remote-password');
  const H = { Host: 'pocket.example.com', Origin: 'https://pocket.example.com' };
  for (let i = 0; i < 5; i++) assert.equal((await req('/m/auth/login', { ...H, 'X-Forwarded-For': '7.7.7.7', 'CF-Connecting-IP': `8.8.8.${i}` }, { password: 'wrong-password-x' })).status, 401);
  assert.equal((await req('/m/auth/login', { ...H, 'X-Forwarded-For': '7.7.7.7', 'CF-Connecting-IP': '8.8.8.99' }, { password: 'pocket-remote-password' })).status, 429);
  const ok = await req('/m/auth/login', { ...H, 'X-Forwarded-For': '6.6.6.6', 'X-Forwarded-Proto': 'https' }, { password: 'pocket-remote-password' });
  assert.equal(ok.status, 200); assert.match(ok.headers['set-cookie'][0], /Secure/);
});

test('tailnet requests come through Tailscale Serve with identity headers and no Cloudflare headers', async () => {
  const { tailnetRequest } = await import('../lib/remote.mjs');
  const r = (headers, addr = '127.0.0.1') => ({ headers, socket: { remoteAddress: addr } });
  const ok = { host: 'desktop-3b96ffu.tail1234.ts.net', 'tailscale-user-login': 'me@example.com' };
  assert.equal(tailnetRequest(r(ok)), true);
  assert.equal(tailnetRequest(r({ ...ok, host: 'desktop-3b96ffu.tail1234.ts.net:8443' })), true, 'second port for the US phone app');
  assert.equal(tailnetRequest(r({ host: ok.host })), false, 'Funnel (public) has no identity header');
  assert.equal(tailnetRequest(r({ ...ok, 'cf-connecting-ip': '1.2.3.4' })), false, 'came through Cloudflare');
  assert.equal(tailnetRequest(r({ ...ok, host: 'abc.trycloudflare.com' })), false);
  assert.equal(tailnetRequest(r({ ...ok, host: 'x.ts.net.evil.com' })), false);
  assert.equal(tailnetRequest(r(ok, '192.168.1.5')), false, 'not proxied on this computer');
});

test('home-screen name and icon differ between the Taiwan and US phone apps', async () => {
  const { brandFor } = await import('../server.mjs');
  const html = '<meta name="apple-mobile-web-app-title" content="衡析"><title>衡析 Pocket</title>';
  assert.equal(brandFor('US').us, true);
  assert.match(brandFor('US').html(html), /content="美股".*<title>衡析 美股<\/title>/);
  assert.match(brandFor('TW').html(html), /content="台股"/);
  assert.equal(brandFor('US').manifest({ short_name: '衡析' }).short_name, '美股');
});
