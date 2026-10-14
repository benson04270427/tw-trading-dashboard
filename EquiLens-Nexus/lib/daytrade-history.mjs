// One serial queue, cache by trading date/provider, and retry incomplete data with backoff.
// The engine receives history only; this loader never sends notifications.
import { prepareContext } from './daytrade-context.mjs';
export function createHistoryLoader({ read, write, fetchHistory, now = Date.now }) {
  const states = new Map(); let busy = false, generation = 0;
  return {
    reset() { generation++; states.clear(); },
    status(ids) { return ids.map(id => ({ id, ...(states.get(id) || { status: 'pending' }) })); },
    async load({ ids, date, source, engine, active = () => true, interval = 120 }) {
      if (busy) return;
      busy = true; const version = generation;
      try {
        for (const id of ids) {
          if (version !== generation || !active()) break;
          const state = states.get(id);
          if (state?.date === date && state.source === source && ((state.status === 'ready' && engine.historyReady(id)) || now() < state.retryAt)) continue;
          states.set(id, { date, source, status: 'loading' });
          try {
            const key = `daytrade-history/${id}.json`, cached = read(key, null);
            let value = cached?.date === date && cached.source === source && cached.version === 2 ? cached.value : null;
            if (!value || !prepareContext(value, date).complete) value = await fetchHistory(id, date, { interval });
            if (version !== generation || !active()) break;
            engine.setHistory(id, value);
            const ready = engine.historyReady(id);
            if (ready) write(key, { version: 2, date, source, value });
            states.set(id, { date, source, status: ready ? 'ready' : 'incomplete', retryAt: now() + 600000 });
          } catch (error) {
            if (version !== generation || !active()) break;
            states.set(id, { date, source, status: 'error', error: error.message, retryAt: now() + 600000 });
            if (['auth', 'quota', 'plan'].includes(error.code)) {
              for (const other of ids) if (states.get(other)?.status !== 'ready') states.set(other, { date, source, status: 'error', error: error.message, retryAt: now() + 600000 });
              break;
            }
          }
        }
      } finally { busy = false; }
    },
  };
}
