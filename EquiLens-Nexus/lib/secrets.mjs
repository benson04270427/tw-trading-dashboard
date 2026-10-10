// 金鑰保管：依作業系統使用內建的金鑰保護機制，金鑰只存在這台電腦，頁面與 API 永不讀回。
// Windows：DPAPI（綁定目前的 Windows 帳戶）→ .local/<name>.dpapi
// macOS：鑰匙圈（security 指令）→ .local/<name>.keychain 只是「已設定」的標記
// Linux：secret-tool（GNOME Keyring／KWallet）；沒有時改存 .local/<name>.secret（僅限本人讀取的檔案權限，並在設定頁提示）
// 也可用環境變數提供（例如 FINMIND_API_TOKEN），環境變數優先。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { LOCAL } from './storage.mjs';
import { UserError } from './i18n.mjs';

const SERVICE = 'EquiLens';
const run = (cmd, args, input, env) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: env || process.env });
  let out = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', c => out += c); child.stderr.resume();
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`)));
  child.stdin.on('error', () => { }); child.stdin.end(input ?? '');
});

/* ---------- 各平台實作 ---------- */
const psEnv = () => ({ ...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') });
const DPAPI_SEAL = '$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s))';
const DPAPI_OPEN = '$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';
const dpapi = (mode, input) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', mode === 'seal' ? DPAPI_SEAL : DPAPI_OPEN], input, psEnv()).then(o => { if (!o.trim()) throw new Error('empty'); return o.trim(); });
const q = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

const hasSecretTool = (() => { let v; return () => v ??= process.platform === 'linux' && spawnSync('secret-tool', ['--version'], { stdio: 'ignore' }).status === 0; })();

function backend() {
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  return hasSecretTool() ? 'secret-tool' : 'file';
}
const fileOf = (name, ext) => path.join(LOCAL, `${name}.${ext}`);
const EXT = { dpapi: 'dpapi', keychain: 'keychain', 'secret-tool': 'secretstore', file: 'secret' };

const cache = new Map();

export function secretBackend() { return backend(); }
export function secretConfigured(name, envName) {
  if (envName && process.env[envName]) return true;
  return Object.values(EXT).some(ext => fs.existsSync(fileOf(name, ext)));
}
export async function getSecret(name, envName) {
  if (envName && process.env[envName]) return process.env[envName].trim();
  if (cache.has(name)) return cache.get(name);
  let value = '';
  try {
    if (fs.existsSync(fileOf(name, 'dpapi'))) value = await dpapi('open', fs.readFileSync(fileOf(name, 'dpapi'), 'utf8'));
    else if (fs.existsSync(fileOf(name, 'keychain'))) value = (await run('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w'])).trim();
    else if (fs.existsSync(fileOf(name, 'secretstore'))) value = (await run('secret-tool', ['lookup', 'service', SERVICE, 'account', name])).trim();
    else if (fs.existsSync(fileOf(name, 'secret'))) value = Buffer.from(fs.readFileSync(fileOf(name, 'secret'), 'utf8').trim(), 'base64').toString('utf8');
    else return '';
  } catch { throw new UserError('無法讀取已保存的金鑰，請重新設定'); }
  cache.set(name, value); return value;
}
export async function saveSecret(name, value) {
  if (typeof value !== 'string' || !value || value.length > 10000) throw new UserError('金鑰格式無效');
  const b = backend();
  try {
    if (b === 'dpapi') fs.writeFileSync(fileOf(name, 'dpapi'), await dpapi('seal', value), 'utf8');
    else if (b === 'keychain') { await run('security', ['-i'], `add-generic-password -U -s ${q(SERVICE)} -a ${q(name)} -w ${q(value)}\n`); fs.writeFileSync(fileOf(name, 'keychain'), 'stored in macOS Keychain\n'); }
    else if (b === 'secret-tool') { await run('secret-tool', ['store', `--label=${SERVICE} ${name}`, 'service', SERVICE, 'account', name], value); fs.writeFileSync(fileOf(name, 'secretstore'), 'stored in Secret Service\n'); }
    else fs.writeFileSync(fileOf(name, 'secret'), Buffer.from(value, 'utf8').toString('base64'), { encoding: 'utf8', mode: 0o600 });
  } catch (e) { throw new UserError('作業系統的金鑰保管服務無法使用，金鑰未儲存') }
  for (const ext of Object.values(EXT)) if (ext !== EXT[b]) fs.rmSync(fileOf(name, ext), { force: true });
  cache.set(name, value);
}
export async function deleteSecret(name) {
  if (fs.existsSync(fileOf(name, 'keychain'))) await run('security', ['delete-generic-password', '-s', SERVICE, '-a', name]).catch(() => { });
  if (fs.existsSync(fileOf(name, 'secretstore'))) await run('secret-tool', ['clear', 'service', SERVICE, 'account', name]).catch(() => { });
  for (const ext of Object.values(EXT)) fs.rmSync(fileOf(name, ext), { force: true });
  cache.delete(name);
}
