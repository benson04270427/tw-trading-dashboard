// 推理模型：Anthropic Claude、OpenAI、Google Gemini，以及 OpenAI 相容端點（OpenRouter、本機 Ollama／LM Studio、自架服務等）。
// 統一提供 generateJSON（依 JSON Schema 產生結構化結果）、listModels（驗證金鑰並列出可用模型）。
// 金鑰存在作業系統的金鑰保管機制（secrets.mjs）；OpenAI 相容端點的金鑰可留空（例如本機模型）。
import Anthropic from '@anthropic-ai/sdk';
import { UserError } from './i18n.mjs';

export const LLM_INFO = {
  anthropic: { name: 'Anthropic Claude', keyEnv: 'ANTHROPIC_API_KEY', site: 'https://console.anthropic.com', defaultModel: 'claude-opus-5-5', suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openai: { name: 'OpenAI', keyEnv: 'OPENAI_API_KEY', site: 'https://platform.openai.com', defaultModel: '' },
  gemini: { name: 'Google Gemini', keyEnv: 'GEMINI_API_KEY', site: 'https://aistudio.google.com', defaultModel: '' },
  compatible: { name: 'OpenAI 相容端點', keyEnv: 'LLM_API_KEY', site: '', defaultModel: '', keyOptional: true, needsBaseUrl: true },
};
const fail = (msg, params) => { throw new UserError(msg, params); };
// Claude：伺服器端拒答備援（fallbacks: 'default'）只適用於 Opus 5.5、Sonnet 5.5、Fable 5.1
const CLAUDE_FALLBACK = /^claude-(opus-5-5|sonnet-5-5|fable-5-1)$/;
const CLAUDE_EFFORT = /^claude-(opus-5|opus-4-[5-8]|sonnet-5|haiku-5|fable-5|mythos-5)/;

/* ---------- Claude（官方 SDK） ---------- */
async function claudeJSON({ key, model, effort, system, prompt, schema }) {
  const client = new Anthropic({ apiKey: key, timeout: 15 * 60 * 1000 });
  const params = { model, max_tokens: 32000, system, messages: [{ role: 'user', content: prompt }], output_config: { ...(CLAUDE_EFFORT.test(model) ? { effort } : {}), format: { type: 'json_schema', schema } } };
  try {
    const stream = CLAUDE_FALLBACK.test(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : client.messages.stream(params);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') fail('模型拒絕產生這份內容{detail}', { detail: msg.stop_details?.explanation ? `：${msg.stop_details.explanation}` : '' });
    if (msg.stop_reason === 'max_tokens') fail('產生內容過長被截斷，請稍後重試');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { data: parseJSON(text), model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
  } catch (e) {
    if (e instanceof UserError) throw e;
    if (e instanceof Anthropic.AuthenticationError) fail('{name} 金鑰無效，請到「資料與設定」重新設定', { name: 'Claude API' });
    if (e instanceof Anthropic.PermissionDeniedError) fail('{name} 金鑰沒有使用此模型的權限', { name: 'Claude API' });
    if (e instanceof Anthropic.NotFoundError) fail('找不到模型 {model}，請到「資料與設定」重新選擇', { model });
    if (e instanceof Anthropic.RateLimitError) fail('{name} 達到速率或額度上限，稍後自動重試', { name: 'Claude API' });
    if (e instanceof Anthropic.APIConnectionError) fail('無法連線到 {name}，請確認網路', { name: 'Claude API' });
    if (e instanceof Anthropic.APIError) fail('{name} 錯誤 {status}：{message}', { name: 'Claude API', status: e.status ?? '', message: e.message });
    throw e;
  }
}

/* ---------- OpenAI 與相容端點（Chat Completions） ---------- */
async function post(url, headers, body, name) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60 * 1000) }); }
  catch { fail('無法連線到 {name}，請確認網路', { name }); }
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, body: j, message: j?.error?.message || j?.message || '' };
}
function httpFail(name, res) {
  if (res.status === 401 || res.status === 403) fail('{name} 金鑰無效，請到「資料與設定」重新設定', { name });
  if (res.status === 404) fail('找不到模型或端點：{message}', { message: res.message || res.status });
  if (res.status === 429) fail('{name} 達到速率或額度上限，稍後自動重試', { name });
  fail('{name} 錯誤 {status}：{message}', { name, status: res.status, message: res.message });
}
async function chatJSON({ base, key, model, effort, system, prompt, schema, name }) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  // 依序嘗試：嚴格 JSON Schema（含推理強度）→ 不帶推理強度 → 只要求 JSON → 純文字（在提示中附上 Schema）
  const attempts = [
    { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } }, reasoning_effort: effort === 'xhigh' ? 'high' : effort },
    { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } } },
    { response_format: { type: 'json_object' } },
    {},
  ];
  let last;
  for (const extra of attempts) {
    const schemaInPrompt = !extra.response_format || extra.response_format.type !== 'json_schema';
    const msgs = schemaInPrompt ? [messages[0], { role: 'user', content: `${prompt}\n\nReply with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}` }] : messages;
    const res = await post(`${base}/chat/completions`, headers, { model, messages: msgs, ...extra }, name);
    if (res.ok) {
      const m = res.body?.choices?.[0]?.message;
      if (m?.refusal) fail('模型拒絕產生這份內容{detail}', { detail: `：${m.refusal}` });
      if (res.body?.choices?.[0]?.finish_reason === 'length') fail('產生內容過長被截斷，請稍後重試');
      return { data: parseJSON(m?.content || ''), model: res.body.model || model, usage: { input: res.body.usage?.prompt_tokens ?? null, output: res.body.usage?.completion_tokens ?? null } };
    }
    last = res;
    if (res.status !== 400 && res.status !== 422) httpFail(name, res); // 只有「參數不支援」才換下一種寫法
  }
  httpFail(name, last);
}

/* ---------- Google Gemini ---------- */
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
async function geminiJSON({ key, model, system, prompt, schema }) {
  const name = 'Gemini API', id = model.replace(/^models\//, '');
  const attempts = [{ responseMimeType: 'application/json', responseJsonSchema: schema }, { responseMimeType: 'application/json' }];
  let last;
  for (const generationConfig of attempts) {
    const text = generationConfig.responseJsonSchema ? prompt : `${prompt}\n\nReply with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const res = await post(`${GEMINI}/models/${encodeURIComponent(id)}:generateContent`, { 'x-goog-api-key': key }, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig }, name);
    if (res.ok) {
      const c = res.body?.candidates?.[0];
      if (!c || c.finishReason === 'SAFETY' || res.body?.promptFeedback?.blockReason) fail('模型拒絕產生這份內容{detail}', { detail: '' });
      if (c.finishReason === 'MAX_TOKENS') fail('產生內容過長被截斷，請稍後重試');
      return { data: parseJSON((c.content?.parts || []).map(p => p.text || '').join('')), model: res.body.modelVersion || id, usage: { input: res.body.usageMetadata?.promptTokenCount ?? null, output: res.body.usageMetadata?.candidatesTokenCount ?? null } };
    }
    last = res; if (res.status !== 400) httpFail(name, res);
  }
  httpFail(name, last);
}

// 從模型回覆取出 JSON（容許包在 ```json 區塊中）
export function parseJSON(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { } }
  fail('模型回傳格式無法解析');
}

// 產生結構化結果：opts = { provider, key, model, baseUrl, effort, system, prompt, schema }
export async function generateJSON(opts) {
  const { provider, model } = opts;
  if (!model) fail('請先到「資料與設定」選擇推理模型');
  if (provider === 'anthropic') return claudeJSON(opts);
  if (provider === 'openai') return chatJSON({ ...opts, base: 'https://api.openai.com/v1', name: 'OpenAI API' });
  if (provider === 'gemini') return geminiJSON(opts);
  if (provider === 'compatible') { if (!opts.baseUrl) fail('請先設定 OpenAI 相容端點的網址'); return chatJSON({ ...opts, base: opts.baseUrl.replace(/\/$/, ''), name: opts.baseUrl }); }
  fail('不支援的推理模型服務：{provider}', { provider });
}

// 驗證金鑰並列出可用模型（只讀取模型清單，不產生費用）
export async function listModels({ provider, key, baseUrl }) {
  const get = async (url, headers, name) => {
    let r; try { r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); } catch { fail('無法連線到 {name}，請確認網路', { name }); }
    const j = await r.json().catch(() => null);
    if (!r.ok) httpFail(name, { status: r.status, message: j?.error?.message || '' });
    return j;
  };
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key, timeout: 20000, maxRetries: 0 });
    try { const ids = []; for await (const m of client.models.list()) ids.push(m.id); return ids; }
    catch (e) { if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fail('{name} 金鑰無效，請到「資料與設定」重新設定', { name: 'Claude API' }); fail('無法連線到 {name}，請確認網路', { name: 'Claude API' }); }
  }
  if (provider === 'openai') { const j = await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }, 'OpenAI API'); return (j?.data || []).map(m => m.id).filter(id => /^(gpt|o\d|chatgpt)/i.test(id)).sort(); }
  if (provider === 'gemini') { const j = await get(`${GEMINI}/models?pageSize=200`, { 'x-goog-api-key': key }, 'Gemini API'); return (j?.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')).sort(); }
  if (provider === 'compatible') { if (!baseUrl) fail('請先設定 OpenAI 相容端點的網址'); const j = await get(`${baseUrl.replace(/\/$/, '')}/models`, key ? { Authorization: `Bearer ${key}` } : {}, baseUrl); return (j?.data || j?.models || []).map(m => m.id || m.name).filter(Boolean).sort(); }
  fail('不支援的推理模型服務：{provider}', { provider });
}
