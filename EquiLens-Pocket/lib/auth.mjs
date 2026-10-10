// 手機版登入保護：scrypt 密碼雜湊、伺服器端 Session（只存雜湊）、登入失敗限速。
import crypto from 'node:crypto';
import { read, write } from './storage.mjs';

const SESSION_DAYS = 30, MAX_SESSIONS = 20;
const sha = v => crypto.createHash('sha256').update(v).digest('hex');

export function passwordConfigured() { const a = read('auth.json', null); return !!(a && a.hash && a.salt); }
export function validPassword(p) { return typeof p === 'string' && p.length >= 10 && p.length <= 128; }
export function setPassword(password) {
  if (!validPassword(password)) throw new Error('密碼長度須為 10–128 個字元');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  write('auth.json', { v: 1, salt, hash, updatedAt: new Date().toISOString() });
  write('sessions.json', []); // 變更密碼即登出所有裝置
}
export function checkPassword(password) {
  const a = read('auth.json', null);
  if (!a || typeof password !== 'string' || password.length > 128) return false;
  const got = crypto.scryptSync(password, a.salt, 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(a.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

let sessions = null;
function load() { if (!sessions) sessions = read('sessions.json', []).filter(s => s.exp > Date.now()); return sessions; }
function save() { write('sessions.json', sessions); }
export function createSession(label = '') {
  load();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.push({ id: sha(token), exp: Date.now() + SESSION_DAYS * 864e5, created: new Date().toISOString(), label: String(label).slice(0, 120) });
  sessions = sessions.sort((a, b) => b.exp - a.exp).slice(0, MAX_SESSIONS);
  save();
  return { token, maxAge: SESSION_DAYS * 86400 };
}
export function validSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  load(); const id = sha(token), s = sessions.find(x => x.id === id);
  return !!s && s.exp > Date.now();
}
export function destroySession(token) { load(); const id = sha(String(token || '')); sessions = sessions.filter(s => s.id !== id); save(); }
export function resetSessionCache() { sessions = null; }

// 登入失敗限速：同一來源 15 分鐘內 5 次失敗即鎖 15 分鐘；全站 1 小時 50 次失敗則全面暫停登入 1 小時。
const fails = new Map(); let globalFails = [];
export function loginBlocked(ip, now = Date.now()) {
  globalFails = globalFails.filter(t => now - t < 3600e3);
  if (globalFails.length >= 50) return '登入嘗試過多，已暫停 1 小時';
  const list = (fails.get(ip) || []).filter(t => now - t < 900e3); fails.set(ip, list);
  return list.length >= 5 ? '密碼錯誤次數過多，請 15 分鐘後再試' : null;
}
export function recordFail(ip, now = Date.now()) { const list = (fails.get(ip) || []).filter(t => now - t < 900e3); list.push(now); fails.set(ip, list); globalFails.push(now); }
export function clearFails(ip) { fails.delete(ip); }
export function resetLimits() { fails.clear(); globalFails = []; }
