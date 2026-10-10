// 在電腦上設定手機版登入密碼（至少 10 個字元）。變更密碼會登出所有手機。
import { setPassword, validPassword } from '../lib/auth.mjs';
function ask(prompt) {
  return new Promise(resolve => {
    const stdin = process.stdin; let value = '';
    process.stdout.write(prompt);
    if (!stdin.isTTY) { let buf = ''; stdin.setEncoding('utf8'); stdin.on('data', d => buf += d); stdin.on('end', () => resolve(buf.split(/\r?\n/)[0])); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(value); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (c === '\u007f' || c === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        value += c; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}
const fromEnv = process.env.POCKET_PASSWORD;
const first = fromEnv ?? await ask('請輸入手機版密碼（至少 10 個字元）：');
if (!validPassword(first)) { console.error('密碼長度須為 10–128 個字元，未變更。'); process.exit(1); }
if (!fromEnv) { const again = await ask('請再輸入一次：'); if (again !== first) { console.error('兩次輸入不同，未變更。'); process.exit(1); } }
setPassword(first);
console.log('已設定密碼，所有已登入的手機需重新登入。');
