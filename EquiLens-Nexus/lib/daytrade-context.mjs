// Taiwan cash-session context. All timestamps are interval STARTs in milliseconds.
// No synthetic candles: incomplete intervals and missing minutes cannot confirm a setup.
const MIN = 60000, OFFSET = 8 * 3600000;
export const contextDate = time => new Date(time + OFFSET).toISOString().slice(0, 10);
const minute = time => Math.floor((time + OFFSET) / MIN) % 1440;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sma = (bars, n) => bars.length >= n ? mean(bars.slice(-n).map(b => b.c)) : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);
export const validBar = b => b && [b.o, b.h, b.l, b.c, b.v].every(finite) && b.l > 0 && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c) && b.v >= 0;

export function aggregateMinutes(rows, width, now = Infinity) {
  const unique = new Map();
  for (const b of rows || []) if (validBar(b) && finite(b.time) && b.time % MIN === 0 && b.time + MIN <= now) unique.set(b.time, b);
  const buckets = new Map();
  for (const b of [...unique.values()].sort((a, b) => a.time - b.time)) {
    const m = minute(b.time);
    // 60-minute bars: 09–10, 10–11, 11–12, 12–13 only. Never label 13–13:30 as 60m.
    if (m < 540 || m >= (width === 60 ? 780 : 805)) continue;
    const start = b.time - ((m - 540) % width) * MIN;
    if (start + width * MIN > now) continue;
    const xs = buckets.get(start) || []; xs.push(b); buckets.set(start, xs);
  }
  return [...buckets].filter(([, xs]) => xs.length === width).map(([time, xs]) => ({ time, end: time + width * MIN, o: xs[0].o, h: Math.max(...xs.map(b => b.h)), l: Math.min(...xs.map(b => b.l)), c: xs.at(-1).c, v: xs.reduce((a, b) => a + b.v, 0) }));
}

export function prepareContext(input, date) {
  const daily = [...new Map((input?.daily || []).filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.date < date && validBar(b)).map(b => [b.date, b])).values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const dates = new Set(daily.map(b => b.date));
  const minutes = (input?.minutes || []).filter(b => finite(b.time) && dates.has(contextDate(b.time)) && validBar(b));
  const five = aggregateMinutes(minutes, 5), sixty = aggregateMinutes(minutes, 60);
  const covered = new Set(five.map(b => contextDate(b.time)));
  const complete = daily.length === 30 && daily.every(b => covered.has(b.date)) && sixty.length >= 21;
  return { daily, five, sixty, complete, source: input?.source || null, asOf: daily.at(-1)?.date || null, rawClose: input?.rawClose || daily.at(-1)?.c || null };
}

// Keep the original event timing; repeated snapshots cannot fabricate persistence.
export function appendBook(samples, ev) {
  if (!finite(ev.time) || (samples.length && ev.time <= samples.at(-1).time)) return false;
  const sides = [ev.bids, ev.asks];
  const valid = sides.every(xs => Array.isArray(xs) && xs.length >= 5 && xs.slice(0, 5).every(x => finite(x.price) && x.price > 0 && finite(x.size) && x.size > 0));
  const bids = valid ? ev.bids.slice(0, 5) : [], asks = valid ? ev.asks.slice(0, 5) : [];
  const ordered = valid && bids.every((b, i) => !i || bids[i - 1].price > b.price) && asks.every((b, i) => !i || asks[i - 1].price < b.price) && asks[0].price > bids[0].price;
  const B = bids.reduce((a, b) => a + b.size, 0), A = asks.reduce((a, b) => a + b.size, 0);
  samples.push({ time: ev.time, valid: ordered, obi: ordered ? (B - A) / (B + A) : null, bid: bids[0]?.price, ask: asks[0]?.price });
  while (samples.length > 1 && samples[1].time < ev.time - 60000) samples.shift();
  return true;
}

export function bookWindow(samples, now, tick, settings) {
  const start = now - settings.bookWindowSeconds * 1000, maxGap = settings.bookMaxAgeSeconds * 1000;
  const past = samples.filter(b => b.time <= now), anchor = past.filter(b => b.time <= start).at(-1);
  const xs = anchor ? [anchor, ...past.filter(b => b.time > start)] : past.filter(b => b.time >= start);
  const last = xs.at(-1), age = last ? (now - last.time) / 1000 : null;
  const covered = !!anchor && start - anchor.time <= maxGap && xs.length >= 3 && xs.every((b, i) => b.valid && (i === xs.length - 1 ? now : xs[i + 1].time) - Math.max(start, b.time) <= maxGap) && age <= settings.bookMaxAgeSeconds;
  if (!covered) return { ready: false, age, samples: xs.length, obi: null, delta: null, long: false, weak: false };
  let weighted = 0;
  for (let i = 0; i < xs.length; i++) weighted += xs[i].obi * ((xs[i + 1]?.time ?? now) - Math.max(start, xs[i].time));
  const obi = weighted / (now - start), delta = last.obi - anchor.obi;
  const spread = tick > 0 ? (last.ask - last.bid) / tick : Infinity;
  const long = obi >= settings.bookImbalance && Math.min(...xs.map(b => b.obi)) >= 0.1 && delta >= 0.05 && last.bid >= anchor.bid && spread <= settings.maxSpreadTicks;
  const weak = obi <= -settings.bookImbalance && Math.max(...xs.map(b => b.obi)) <= -0.1 && delta <= -0.05 && last.ask <= anchor.ask;
  return { ready: true, age, samples: xs.length, obi, delta, spread, long, weak };
}

export function analyzeContext(history, liveMinutes, samples, { date, now, last, lastAt, ref, tick, vwap, settings, full }) {
  const h = history || prepareContext(null, date), daily = h.daily;
  const live5 = aggregateMinutes(liveMinutes, 5, now), live60 = aggregateMinutes(liveMinutes, 60, now);
  const five = [...h.five, ...live5], sixty = [...h.sixty, ...live60];
  const b = five.at(-1), before = five.at(-2), hour = sixty.at(-1);
  const d20 = sma(daily, 20), d5 = sma(daily, 5), d20prev = sma(daily.slice(0, -1), 20);
  const h5 = sma(sixty, 5), h20 = sma(sixty, 20), h20prev = sma(sixty.slice(0, -1), 20);
  const dayLong = daily.length === 30 && daily.at(-1).c > d20 && d5 >= d20 && d20 >= d20prev;
  const hourLong = !!hour && sixty.length >= 21 && hour.c > h20 && h5 >= h20 && h20 >= h20prev;
  const current = !!b && contextDate(b.time) === date && now - b.end >= 0 && now - b.end < 5 * MIN;
  // A missing interval must not silently extend a 15-minute setup into an older session.
  const preceding = n => current ? live5.filter(x => x.time >= b.time - n * 5 * MIN && x.end <= b.time) : [];
  const recent = preceding(settings.breakoutLookback / 5), priorThree = preceding(3);
  const adjacent = !!before && current && before.end === b.time && contextDate(before.time) === date;
  const resistance = recent.length ? Math.max(...recent.map(b => b.h)) : null;
  const support = priorThree.length === 3 ? Math.min(...priorThree.map(b => b.l)) : null;
  const sameSlot = current ? h.five.filter(x => minute(x.time) === minute(b.time)) : [];
  const baseline = sameSlot.length >= 10 ? mean(sameSlot.map(x => x.v)) : null;
  const volumeRatio = baseline > 0 ? b.v / baseline : null;
  const book = bookWindow(samples, now, tick, settings);
  const quoteFresh = finite(lastAt) && lastAt <= now && now - lastAt <= settings.quoteMaxAgeSeconds * 1000;
  const reasons = [];
  if (!full) reasons.push('fullFeed');
  if (!h.complete) reasons.push('history');
  if (!current) reasons.push('fiveMinute');
  const expectedHourEnd = minute(now) >= 600 ? Date.parse(`${date}T09:00:00+08:00`) + Math.min(4, Math.floor((minute(now) - 540) / 60)) * 60 * MIN : h.asOf ? Date.parse(`${h.asOf}T13:00:00+08:00`) : null;
  if (!hour || hour.end !== expectedHourEnd) reasons.push('hourStale');
  if (!quoteFresh) reasons.push('quoteStale');
  if (!(finite(vwap) && vwap > 0)) reasons.push('vwap');
  if (!book.ready) reasons.push('bookPending');
  if (!(baseline > 0)) reasons.push('volumeHistory');
  if (!(ref > 0) || (h.rawClose > 0 && Math.abs(ref - h.rawClose) > tick * 1.5)) reasons.push('priceBasis');
  const ready = !reasons.length;
  const aligned = ready && dayLong && hourLong && last > vwap && b.c > vwap && last >= b.c - tick && book.long;
  const breakout = aligned && recent.length >= settings.breakoutLookback / 5 && b.c >= resistance + tick * 0.5 && volumeRatio >= settings.breakoutVolume;
  const pullback = aligned && adjacent && before.l <= vwap * 1.002 && before.c >= vwap * 0.998 && b.c > before.h && volumeRatio >= 1.2;
  const bid = aligned && adjacent && b.c > before.h && b.c > b.o && volumeRatio >= 1.5 && book.delta >= 0.1;
  const weak = ready && support > 0 && b.c < support && b.c < vwap && last < support && book.weak;
  const risk = current && b.l > 0 ? Math.round((b.l - tick) * 10000) / 10000 : null;
  return { ready, reasons, daily: { count: daily.length, long: dayLong, ma5: d5, ma20: d20, high: daily.length ? Math.max(...daily.map(b => b.h)) : null, low: daily.length ? Math.min(...daily.map(b => b.l)) : null, asOf: h.asOf },
    hour: { count: sixty.length, long: hourLong, ma5: h5, ma20: h20, end: hour?.end || null },
    five: { end: b?.end || null, close: b?.c || null, current, resistance, support, volumeRatio, baselineDays: sameSlot.length },
    book, quoteFresh, conditions: { breakout, vwap: pullback, bid, weak }, risk, source: h.source };
}
