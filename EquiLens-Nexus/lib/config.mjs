// 本機設定（.local/config.json）：研究的市場、介面語言、資料源與推理模型的選擇、對外網址。
// 金鑰不放在這裡，另以作業系統的金鑰保管機制保存（secrets.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, read, write } from './storage.mjs';
import { marketProfile, MARKETS } from './markets.mjs';

export const LANGUAGES = ['zh-TW', 'en'];
export const LLM_PROVIDERS = ['anthropic', 'openai', 'gemini', 'compatible'];
export const CONFIG_DEFAULTS = Object.freeze({ version: 1, setupDone: false, market: 'TW', language: 'zh-TW', providers: { enabled: [], prefer: {} }, llm: { provider: 'anthropic', model: '', baseUrl: '', effort: 'high' }, publicUrl: '', upColor: '' });

const str = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const safeUrl = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.toString().replace(/\/$/, '') : ''; } catch { return ''; } };

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
  };
}

// 舊版（只支援台股、FinMind、Claude）已有資料的安裝：自動視為完成設定的台股安裝，沿用 FinMind 與 Claude
function legacyInstall() { return ['finmind.dpapi', 'groups.json', 'settings.json', 'universe.json'].some(f => fs.existsSync(path.join(LOCAL, f))); }

let cfg = null;
export function config() {
  if (cfg) return cfg;
  const saved = read('config.json', null);
  if (saved) cfg = normalizeConfig(saved);
  else if (legacyInstall()) {
    const report = read('settings.json', {})?.report || {};
    cfg = normalizeConfig({ setupDone: true, market: 'TW', language: 'zh-TW', providers: { enabled: ['finmind'], prefer: {} }, llm: { provider: 'anthropic', model: report.model || '', effort: report.effort || 'high' } });
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
