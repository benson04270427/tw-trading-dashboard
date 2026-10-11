// 本機設定（.local/config.json）：研究的市場、介面語言、資料源與推理模型的選擇、對外網址與遠端存取。
// 金鑰不放在這裡，另以作業系統的金鑰保管機制保存（secrets.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, read, write } from './storage.mjs';
import { marketProfile, MARKETS } from './markets.mjs';

export const LANGUAGES = ['zh-TW', 'en'];
export const LLM_PROVIDERS = ['anthropic', 'openai', 'gemini', 'compatible'];
// 手機版的對外連線方式：
//   auto              有 Pocket/.local/cloudflared.yml 時用 Cloudflare 固定網域，否則用 Cloudflare 臨時網址（舊版行為）
//   cloudflare-quick  Cloudflare 臨時網址（https://xxxx.trycloudflare.com，每次重啟會變）
//   cloudflare-named  Cloudflare 固定網域（Named Tunnel，設定在 Pocket/.local/cloudflared.yml）
//   custom            自行處理（ngrok、Tailscale Funnel、自架 Caddy／Nginx 等），衡析不啟動通道
//   off               不對外開放，只能在這台電腦使用
export const TUNNEL_MODES = ['auto', 'cloudflare-quick', 'cloudflare-named', 'custom', 'off'];
export const REMOTE_DEFAULTS = Object.freeze({ tunnel: 'auto', pocketHosts: [], contact: '', access: { hosts: [], teamDomain: '', aud: '' } });
export const CONFIG_DEFAULTS = Object.freeze({ version: 1, setupDone: false, market: 'TW', language: 'zh-TW', providers: { enabled: [], prefer: {} }, llm: { provider: 'anthropic', model: '', baseUrl: '', effort: 'high' }, publicUrl: '', upColor: '', remote: REMOTE_DEFAULTS });

const str = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const safeUrl = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.toString().replace(/\/$/, '') : ''; } catch { return ''; } };
// 主機名稱（可含連接埠），小寫；不合格式的略過
export const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;
export const EMAIL_RE = /^[^\s@<>"']{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const hosts = v => [...new Set((Array.isArray(v) ? v : []).map(h => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(h => HOST_RE.test(h)))].slice(0, 10);

export function normalizeRemote(r = {}) {
  const a = r.access || {};
  return {
    tunnel: TUNNEL_MODES.includes(r.tunnel) ? r.tunnel : 'auto',
    pocketHosts: hosts(r.pocketHosts),
    contact: EMAIL_RE.test(str(r.contact, 260)) ? str(r.contact, 260) : '',
    access: { hosts: hosts(a.hosts), teamDomain: str(a.teamDomain, 200).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''), aud: /^[A-Za-z0-9-]{8,128}$/.test(str(a.aud, 128)) ? str(a.aud, 128) : '' },
  };
}

export function normalizeConfig(c = {}) {
  const d = CONFIG_DEFAULTS, p = c.providers || {}, l = c.llm || {};
  return {
    version: 1,
    setupDone: c.setupDone === true,
    market: MARKETS[c.market] ? c.market : d.market,
    language: LANGUAGES.includes(c.language) ? c.language : d.language,
    providers: {
      enabled: [...new Set((Array.isArray(p.enabled) ? p.enabled : []).filter(x => typeof x === 'string' && /^[a-z0-9]{2,20}$/.test(x)))],
      prefer: Object.fromEntries(Object.entries(p.prefer || {}).filter(([k, v]) => /^[a-zA-Z]{2,20}$/.test(k) && typeof v === 'string' && /^[a-z0-9]{2,20}$/.test(v))),
    },
    llm: { provider: LLM_PROVIDERS.includes(l.provider) ? l.provider : d.llm.provider, model: str(l.model, 120), baseUrl: l.baseUrl ? safeUrl(l.baseUrl) : '', effort: ['low', 'medium', 'high', 'xhigh'].includes(l.effort) ? l.effort : d.llm.effort },
    publicUrl: c.publicUrl ? safeUrl(c.publicUrl) : '',
    upColor: ['red', 'green'].includes(c.upColor) ? c.upColor : '',
    remote: normalizeRemote(c.remote),
  };
}

// 舊版（只支援台股、FinMind、Claude）已有資料的安裝：自動視為完成設定的台股安裝，沿用 FinMind 與 Claude
function legacyInstall() { return ['finmind.dpapi', 'groups.json', 'settings.json', 'universe.json'].some(f => fs.existsSync(path.join(LOCAL, f))); }
// 舊版的電腦版遠端存取設定檔 .local/remote.json：第一次讀到新版設定時轉入 config.remote.access
const legacyAccess = () => { const r = read('remote.json', null); return r ? { hosts: r.hosts, teamDomain: r.teamDomain, aud: r.aud } : {}; };

let cfg = null;
export function config() {
  if (cfg) return cfg;
  const saved = read('config.json', null);
  if (saved && !saved.remote) { cfg = normalizeConfig({ ...saved, remote: { access: legacyAccess() } }); write('config.json', cfg); }
  else if (saved) cfg = normalizeConfig(saved);
  else if (legacyInstall()) {
    const report = read('settings.json', {})?.report || {};
    cfg = normalizeConfig({ setupDone: true, market: 'TW', language: 'zh-TW', providers: { enabled: ['finmind'], prefer: {} }, llm: { provider: 'anthropic', model: report.model || '', effort: report.effort || 'high' }, remote: { access: legacyAccess() } });
    write('config.json', cfg);
  } else cfg = normalizeConfig({});
  return cfg;
}
export function saveConfig(patch) { cfg = normalizeConfig({ ...config(), ...patch }); write('config.json', cfg); return cfg; }
export const activeMarket = () => marketProfile(config().market);
export const language = () => config().language;
// 漲紅跌綠或漲綠跌紅：使用者設定優先，否則依市場慣例
export const upColor = () => config().upColor || activeMarket().upColor;
export function resetConfigCache() { cfg = null; }
