import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-auth-'));
process.env.MOBILE_DATA_DIR = dir;
const auth = await import('../lib/auth.mjs');

test('password is scrypt-hashed, verified in constant time and short passwords are rejected', () => {
  assert.throws(() => auth.setPassword('short'), /10–128/);
  auth.setPassword('correct-horse-battery');
  const stored = fs.readFileSync(path.join(dir, 'auth.json'), 'utf8');
  assert(!stored.includes('correct-horse-battery'));
  assert.equal(auth.checkPassword('correct-horse-battery'), true);
  assert.equal(auth.checkPassword('correct-horse-batterx'), false);
  assert.equal(auth.checkPassword(undefined), false);
  assert.equal(auth.checkPassword('x'.repeat(500)), false);
});

test('sessions store only hashes, expire on logout and are cleared by password change', () => {
  const { token } = auth.createSession('test');
  assert.equal(auth.validSession(token), true);
  assert(!fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8').includes(token));
  assert.equal(auth.validSession(token + 'x'), false);
  auth.destroySession(token); assert.equal(auth.validSession(token), false);
  const s2 = auth.createSession('b'); auth.setPassword('another-long-password'); auth.resetSessionCache();
  assert.equal(auth.validSession(s2.token), false);
});

test('login attempts are rate limited per source and globally', () => {
  auth.resetLimits();
  for (let i = 0; i < 5; i++) { assert.equal(auth.loginBlocked('1.1.1.1'), null); auth.recordFail('1.1.1.1'); }
  assert.match(auth.loginBlocked('1.1.1.1'), /15 分鐘/);
  assert.equal(auth.loginBlocked('2.2.2.2'), null);
  assert.equal(auth.loginBlocked('1.1.1.1', Date.now() + 901e3), null);
  auth.resetLimits(); for (let i = 0; i < 50; i++) auth.recordFail('ip' + i);
  assert.match(auth.loginBlocked('9.9.9.9'), /暫停/);
  auth.resetLimits();
});
