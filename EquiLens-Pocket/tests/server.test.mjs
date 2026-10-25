import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// 假 Nexus：檢查 CSRF，回傳最小資料。
const calls = [];
let watch = ['2330'];
const nexus = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  calls.push({ method: req.method, url: req.url, csrf: req.headers['x-csrf-token'], body });
  const j = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (req.url === '/api/state') return j(200, { csrf: 'csrf-1', cutoff: '2026-09-29', appVersion: '2.0.0', tokenConfigured: true, watchlist: watch, weights: { technical: 30, chips: 30, topic: 15, industry: 25 },
    job: { running: false, done: 0, total: 0 }, heatSummary: null, heatDates: [], sectors: [{ id: 'g', name: '半導體', score: 70, count: 1, covered: 1, stockIds: ['2330'] }],
    stocks: [{ id: '2330', name: '台積電', market: '上市', sector: '半導體業', groupNames: ['半導體'], asOf: '2026-09-26', price: 1000, change: 1.2, score: 80, rating: '強勢', technical: { score: 80 }, chips: { score: 70 }, topic: { score: null }, industry: { score: 60 }, spark: [1, 2, 3] }] });
  if (req.url === '/api/job') return j(200, { job: { running: true, done: 3, total: 10, current: '2330', message: '更新 2330', errors: [{ id: '2330' }], startedAt: 'x' }, busy: false });
  if (['/api/update', '/api/pattern-update', '/api/news', '/api/cancel'].includes(req.url) && req.method === 'POST') return req.headers['x-csrf-token'] === 'csrf-1' ? j(req.url === '/api/cancel' ? 200 : 202, { ok: true }) : j(403, { error: 'csrf' });
  if (req.url.startsWith('/api/report/card')) return j(200, { date: '2026-10-01', index: { twse: { close: 48353.49 } }, url: req.url });
  if (req.url === '/api/heatmap/live') return j(200, { live: true, refreshMs: 10000, data: { date: '2026-09-30', live: true, asOf: '2026-09-30T10:31:23', sectors: [] } });
  if (req.url === '/api/patterns') return j(200, { asOf: '2026-09-26', matched: 0, patternCount: 0, eligible: 0, stocks: [] });
  if (req.url.startsWith('/api/flows?')) return j(200, { data: null });
  if (req.url.startsWith('/api/briefing/news?')) return j(200, { window: { start: 1, end: 2, inProgress: false }, items: [{ id: 1, title: '頭條', tw: ['2330'], us: [] }], fetchedAt: 3 });
  if (req.url.startsWith('/api/briefing/week')) return j(200, { range: { start: '2026-09-28', end: '2026-10-04', days: [] }, macro: [], earnings: [], errors: [], fetchedAt: 3 });
  if (req.url === '/api/watchlist' && req.method === 'POST') { if (req.headers['x-csrf-token'] !== 'csrf-1') return j(403, { error: 'csrf' }); watch = JSON.parse(body).ids; return j(200, { ok: true }); }
  // 假的自選分組：股票清單只有 2330（研究名單）與 2454（名單外）
  if (req.url === '/api/watch/set' && req.method === 'POST') { if (req.headers['x-csrf-token'] !== 'csrf-1') return j(403, { error: 'csrf' }); const b = JSON.parse(body); if (!['2330', '2454'].includes(b.id)) return j(400, { error: '股票代碼無效或不在股票清單中' }); watch = b.on ? [...new Set([...watch, b.id])] : watch.filter(x => x !== b.id); return j(200, { ok: true, watchlist: watch, watchGroups: { groups: [{ id: 'w1', name: '核心' }], assign: b.on && b.group ? { [b.id]: b.group } : {} } }); }
  if (req.url === '/api/watch/groups' && req.method === 'POST') { const b = JSON.parse(body); return j(200, { ok: true, watchGroups: { groups: b.groups.map((g, i) => ({ id: g.id || `w${i + 1}`, name: g.name })), assign: {} } }); }
  if (req.url.startsWith('/api/detail?id=2330')) return j(200, { id: '2330', name: '台積電', market: '上市', sector: '半導體業', risks: [], adjustedBars: Array.from({ length: 100 }, (_, i) => ({ date: '2026-06-' + String(i % 28 + 1).padStart(2, '0'), open: 10, max: 11, min: 9, close: 10 + i / 10 })), technical: { score: 80, reasons: ['x'] }, chips: {}, topic: {}, industry: {}, news: [], evidence: [] });
  return j(404, { error: 'nope' });
});
await new Promise(r => nexus.listen(0, '127.0.0.1', r));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-srv-'));
Object.assign(process.env, { MOBILE_DATA_DIR: dir, PORT: '4399', NEXUS_URL: `http://127.0.0.1:${nexus.address().port}` });
const { server, hostAllowed } = await import('../server.mjs');
const auth = await import('../lib/auth.mjs');
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { Host: '127.0.0.1:4399' };
const req = (p, opt = {}) => new Promise((resolve, reject) => { const r = http.request(base + p, { method: opt.method || 'GET', headers: { ...H, ...(opt.headers || {}) } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }); r.on('error', reject); if (opt.body) r.end(opt.body); else r.end(); });
const post = (p, v, headers = {}) => req(p, { method: 'POST', body: JSON.stringify(v), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nexus-pocket', ...headers } });

test.after(() => { server.close(); nexus.close(); });

test('host allowlist blocks DNS rebinding but allows quick tunnels', () => {
  assert.equal(hostAllowed('127.0.0.1:4399'), true);
  assert.equal(hostAllowed('abc-def.trycloudflare.com'), true);
  assert.equal(hostAllowed('evil.com'), false);
  assert.equal(hostAllowed('x.trycloudflare.com.evil.com'), false);
});

test('security headers, static files and private files', async () => {
  const r = await req('/');
  assert.equal(r.status, 200); assert.match(r.headers['content-security-policy'], /default-src 'self'/); assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal((await req('/.local/auth.json')).status, 404);
  assert.equal((await req('/server.mjs')).status, 404);
  // 模組 import 帶版本號（Cloudflare 會快取 js 4 小時，沒有版本號手機會一直用舊檔）
  const appJs = (await req('/app.js')).body, liveJs = (await req('/live.js')).body;
  assert.match(appJs, /from '\.\/live\.js\?v=\w+'/); assert.match(liveJs, /from '\.\/insight-ui\.js\?v=\w+'/); assert.match(liveJs, /import\('\.\/report-card\.js\?v=\w+'\)/);
  assert.doesNotMatch((await req('/sw.js')).body, /\?v=/);
  // 摺疊手機版面模組：app.js 與 live.js 都以同一個版本號載入（同一份模組）；manifest 不鎖定直向
  assert.equal((await req('/layout.js')).status, 200); assert.match(appJs, /from '\.\/layout\.js\?v=\w+'/); assert.match(liveJs, /from '\.\/layout\.js\?v=\w+'/);
  assert.equal(JSON.parse((await req('/manifest.webmanifest')).body).orientation, 'any');
  assert.equal((await req('/save-image.js')).status, 200); assert.match((await req('/report-card.js')).body, /from '\.\/save-image\.js\?v=\w+'/); assert.match((await req('/flow-cards.js')).body, /from'\.\/save-image\.js\?v=\w+'/);
  assert.equal((await req('/', { headers: { Host: 'evil.com' } })).status, 403);
});

test('API requires setup, then login; login is rate limited and CSRF-checked', async () => {
  let r = await req('/m/api/summary'); assert.equal(r.status, 503); assert.equal(r.json.setup, true);
  auth.setPassword('pocket-test-password');
  r = await req('/m/api/summary'); assert.equal(r.status, 401);
  assert.equal((await req('/m/api/briefing/news')).status, 401, 'briefing requires login');
  r = await req('/m/auth/login', { method: 'POST', body: '{"password":"pocket-test-password"}', headers: { 'Content-Type': 'application/json' } }); assert.equal(r.status, 403, 'missing X-Requested-With');
  r = await post('/m/auth/login', { password: 'pocket-test-password' }, { Origin: 'https://evil.com' }); assert.equal(r.status, 403, 'foreign origin');
  for (let i = 0; i < 5; i++) assert.equal((await post('/m/auth/login', { password: 'wrong-password-x' }, { 'CF-Connecting-IP': '5.5.5.5' })).status, 401);
  assert.equal((await post('/m/auth/login', { password: 'pocket-test-password' }, { 'CF-Connecting-IP': '5.5.5.5' })).status, 429);
  r = await post('/m/auth/login', { password: 'pocket-test-password' }, { 'CF-Connecting-IP': '6.6.6.6', 'CF-Visitor': '{"scheme":"https"}' });
  assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/);
  const C = { Cookie: cookie.split(';')[0] };
  r = await req('/m/api/summary', { headers: C });
  assert.equal(r.status, 200); assert.equal(r.json.watch.length, 1); assert.equal(r.json.watch[0].id, '2330'); assert.equal(r.json.flows, null);
  r = await req('/m/api/stock?id=2330', { headers: C }); assert.equal(r.status, 200); assert.equal(r.json.bars.length, 90); assert.equal(r.json.watch, true);
  assert.equal((await req('/m/api/stock?id=../x', { headers: C })).status, 400);
  assert.equal((await req('/m/api/heatmap?date=2026-02-30', { headers: C })).status, 400);
  r = await req('/m/api/job', { headers: C }); assert.equal(r.status, 200); assert.deepEqual([r.json.running, r.json.done, r.json.total, r.json.errors], [true, 3, 10, 1]);
  assert.equal(r.json.startedAt, undefined, 'job is slimmed');
  assert.equal((await post('/m/api/update', { scope: 'watchlist' }, C)).status, 202);
  assert.equal((await post('/m/api/update', { scope: 'selected', ids: ['2330'] }, C)).status, 202);
  assert.deepEqual(JSON.parse(calls.filter(c => c.url === '/api/update').at(-1).body), { scope: 'selected', ids: ['2330'] });
  assert.equal((await post('/m/api/update', { scope: 'universe' }, C)).status, 400, 'full-universe scope stays PC-only');
  assert.equal((await post('/m/api/update', { scope: 'selected', ids: ['../x'] }, C)).status, 400);
  assert.equal((await post('/m/api/update', { scope: 'selected', ids: [] }, C)).status, 400);
  assert.equal((await post('/m/api/pattern-update', {}, C)).status, 202);
  assert.equal((await post('/m/api/news', { id: '2330' }, C)).status, 202);
  assert.equal((await post('/m/api/news', { id: '../x' }, C)).status, 400);
  assert.equal((await post('/m/api/news', { id: 'x y' }, C)).status, 400);
  assert.equal((await post('/m/api/cancel', {}, C)).status, 200);
  assert.ok(calls.filter(c => ['/api/update', '/api/pattern-update', '/api/news', '/api/cancel'].includes(c.url)).every(c => c.csrf === 'csrf-1'), 'writes carry Nexus CSRF');
  assert.equal((await post('/m/api/settings', { interval: 1000 }, C)).status, 404, 'settings stay PC-only');
  r = await req('/m/api/report/card?date=2026-10-01', { headers: C }); assert.equal(r.status, 200); assert.equal(r.json.index.twse.close, 48353.49); assert.equal(r.json.url, '/api/report/card?date=2026-10-01');
  assert.equal((await req('/m/api/report/card?date=../x', { headers: C })).status, 400);
  r = await req('/m/api/heatmap/live', { headers: C }); assert.equal(r.status, 200); assert.equal(r.json.data.live, true); assert.equal(r.json.refreshMs, 10000);
  r = await req('/m/api/briefing/news?offset=1&refresh=1', { headers: C }); assert.equal(r.status, 200); assert.equal(r.json.items[0].title, '頭條');
  assert(calls.some(c => c.url === '/api/briefing/news?offset=1&refresh=1'), 'offset and refresh forwarded to Nexus');
  assert.equal((await req('/m/api/briefing/news?offset=7', { headers: C })).status, 400);
  r = await req('/m/api/briefing/week', { headers: C }); assert.equal(r.status, 200); assert.equal(r.json.range.start, '2026-09-28');
  r = await post('/m/api/watch', { id: '2330', on: false }, C); assert.equal(r.status, 200);
  assert.deepEqual(watch, []); assert.equal(calls.find(c => c.url === '/api/watch/set').csrf, 'csrf-1');
  assert.equal((await post('/m/api/watch', { id: '9999', on: true }, C)).status, 400);
  // 研究名單以外的股票（型態選股挑到的）也能加入自選並指定分組
  r = await post('/m/api/watch', { id: '2454', on: true, group: 'w1' }, C); assert.equal(r.status, 200); assert.deepEqual(r.json.watchlist, ['2454']); assert.equal(r.json.watchGroups.assign['2454'], 'w1');
  assert.deepEqual(JSON.parse(calls.filter(c => c.url === '/api/watch/set').at(-1).body), { id: '2454', on: true, group: 'w1' });
  assert.equal((await post('/m/api/watch', { id: '2454', on: true, group: 'x<script>' }, C)).status, 400, 'group id format');
  r = await post('/m/api/watch/groups', { groups: [{ id: 'w1', name: '核心' }, { name: '短線' }] }, C); assert.equal(r.status, 200); assert.deepEqual(r.json.watchGroups.groups.map(g => g.name), ['核心', '短線']);
  assert.equal((await post('/m/api/watch/groups', { groups: [{ id: 'bad', name: 'x' }] }, C)).status, 400);
  r = await post('/m/auth/logout', {}, C); assert.equal(r.status, 200);
  assert.equal((await req('/m/api/summary', { headers: C })).status, 401);
});

test('Nexus offline is reported as 503 without leaking details', async () => {
  const { token } = auth.createSession('t');
  nexus.close(); await new Promise(r => setTimeout(r, 50));
  const nx = await import('../lib/nexus.mjs'); nx.invalidate();
  const r = await req('/m/api/stocks', { headers: { Cookie: 'np_sid=' + token } });
  assert.equal(r.status, 503); assert.equal(r.json.nexusDown, true); assert.match(r.json.error, /Nexus/);
});
