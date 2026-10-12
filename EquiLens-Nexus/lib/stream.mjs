// 盤中即時推播（WebSocket）：連線、認證、分頻道分批訂閱、心跳檢查、斷線重連；收到的資料每隔一小段時間批次交給呼叫端。
// 資料源只需提供 stream 規格：{ url, auth(key), subscribe(symbols, channel), batch, parse(msg, market) → 事件或 null }。
// 事件有 key 的（例如五檔、分 K、聚合行情）同一批只保留最新一筆；沒有 key 的（逐筆成交）全部依序保留。
// 只在盤中由伺服器開啟，收盤後關閉；金鑰只用於連線後的認證訊息，不出現在網址或紀錄中。

const QUIET_MS = 75000;      // 這麼久沒有任何訊息（伺服器每 30 秒送心跳）就重新連線
const AUTH_RETRY_MS = 10 * 60e3; // 認證失敗（金鑰無效）時 10 分鐘後才再試
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createStream({ spec, key, market, symbols = [], channels = ['aggregates'], onEvents, onStatus = () => { }, connect = url => new WebSocket(url), now = Date.now, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, flushMs = 1000 }) {
  let ws = null, closed = false, want = [...new Set(symbols)], chans = [...channels], backoff = 5000, retryTimer = null, lastMsg = 0, subscribed = 0, authed = false, everAuthed = false;
  let list = [], keyed = new Map();
  const status = s => onStatus({ ...s, symbols: want.length, channels: chans, expected: want.length * chans.length, subscribed });
  const flushTimer = timers.setInterval(() => {
    if (list.length || keyed.size) { const events = [...list, ...keyed.values()]; list = []; keyed = new Map(); try { onEvents(events); } catch { } }
    if (ws && authed) { if (now() - lastMsg > QUIET_MS) { status({ connected: false, error: 'no-heartbeat' }); reopen(0); } else status({ connected: true, alive: lastMsg }); }
  }, flushMs);
  flushTimer?.unref?.();

  function open() {
    if (closed || !want.length) return;
    authed = false; subscribed = 0; lastMsg = now();
    let sock;
    try { sock = connect(spec.url); } catch (e) { status({ connected: false, error: e.message }); return reopen(); }
    ws = sock;
    sock.addEventListener('open', () => { if (ws === sock) sock.send(JSON.stringify(spec.auth(key))); });
    sock.addEventListener('message', ev => {
      if (ws !== sock) return;
      lastMsg = now();
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg.event === 'authenticated') {
        authed = true; backoff = 5000;
        const n = spec.batch || 50;
        for (const ch of chans) for (let i = 0; i < want.length; i += n) sock.send(JSON.stringify(spec.subscribe(want.slice(i, i + n), ch)));
        const resumed = everAuthed ? now() : 0; everAuthed = true;
        return status({ connected: true, error: '', authFailed: false, since: now(), ...(resumed ? { resumed } : {}) });
      }
      if (msg.event === 'subscribed') { subscribed += Array.isArray(msg.data) ? msg.data.length : 1; return status({ connected: true }); }
      if (msg.event === 'error') {
        const text = String(msg.data?.message || msg.message || 'error');
        if (!authed) { status({ connected: false, error: text, authFailed: true }); return reopen(AUTH_RETRY_MS); }
        return status({ connected: true, error: text });
      }
      const e = spec.parse(msg, market);
      if (e) { if (e.key) keyed.set(e.key, e); else list.push(e); }
    });
    sock.addEventListener('close', () => { if (ws === sock) { ws = null; status({ connected: false }); reopen(); } });
    sock.addEventListener('error', () => { /* close 事件會接著處理重連 */ });
  }
  function drop() { if (ws) { const s = ws; ws = null; try { s.close(); } catch { } } }
  function reopen(delay = backoff) {
    if (closed) return;
    drop();
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(open, delay);
    retryTimer?.unref?.();
    if (delay === backoff) backoff = Math.min(60000, backoff * 2);
  }
  open();
  return {
    // 訂閱清單或頻道變更（例如自選股增減、方案改變）：重新連線並以新清單訂閱
    update(next, nextChannels = chans) {
      const l = [...new Set(next)];
      if (same(l, want) && same(nextChannels, chans)) return;
      want = l; chans = [...nextChannels];
      if (!want.length) { drop(); return status({ connected: false }); }
      reopen(0);
    },
    close() { closed = true; timers.clearInterval(flushTimer); timers.clearTimeout(retryTimer); drop(); },
    get symbols() { return want; },
    get channels() { return chans; },
  };
}

// 多條連線：把股票分組（例如依代號排序平均分成兩組），每組一條連線；狀態合併後回報
export function createStreamPool({ groups, onStatus = () => { }, ...common }) {
  let streams = [], states = [];
  const report = () => {
    const live = states.slice(0, streams.length);
    onStatus({
      connected: live.length > 0 && live.every(s => s.connected), connections: live.map(s => ({ connected: !!s.connected, symbols: s.symbols || 0, subscribed: s.subscribed || 0, expected: s.expected || 0, error: s.error || '' })),
      symbols: live.reduce((a, s) => a + (s.symbols || 0), 0), subscribed: live.reduce((a, s) => a + (s.subscribed || 0), 0), expected: live.reduce((a, s) => a + (s.expected || 0), 0),
      channels: live[0]?.channels || [], alive: live.length ? Math.min(...live.map(s => s.alive || 0)) : 0, error: live.map(s => s.error).find(Boolean) || '', authFailed: live.some(s => s.authFailed),
      resumed: Math.max(0, ...live.map(s => s.resumed || 0)), since: Math.max(0, ...live.map(s => s.since || 0)),
    });
  };
  const make = (g, i) => createStream({ ...common, symbols: g.symbols, channels: g.channels, onStatus: s => { states[i] = { ...states[i], ...s }; report(); } });
  function set(next) {
    while (streams.length > next.length) { streams.pop().close(); states.pop(); }
    next.forEach((g, i) => { if (streams[i]) streams[i].update(g.symbols, g.channels); else { states[i] = {}; streams[i] = make(g, i); } });
    report();
  }
  set(groups);
  return { update: set, close() { for (const s of streams) s.close(); streams = []; }, get size() { return streams.length; } };
}
// 依代號排序後平均分成 n 組（固定分組，重啟後訂閱不變）
export function splitSymbols(symbols, n) {
  const list = [...new Set(symbols)].sort(), size = Math.ceil(list.length / Math.max(1, n)), out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}
