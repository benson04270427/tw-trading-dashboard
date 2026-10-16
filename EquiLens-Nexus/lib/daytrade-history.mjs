// One serial queue, cache by trading date/provider; errors retry with backoff.
// History covers past sessions only, so data that is fetched but incomplete (e.g. thinly traded stocks with missing minutes)
// is cached for the day and not fetched again: refetching ~4 historical requests per stock every 10 minutes would
// exhaust Fugle's 60-per-minute historical limit once the whole research list is scanned.
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
            const fetched = !value; if (fetched) value = await fetchHistory(id, date, { interval });
            if (version !== generation || !active()) break;
            engine.setHistory(id, value);
            const ready = engine.historyReady(id);
            if (fetched) write(key, { version: 2, date, source, value });
            states.set(id, { date, source, status: ready ? 'ready' : 'incomplete', retryAt: ready ? now() + 600000 : Infinity });
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
