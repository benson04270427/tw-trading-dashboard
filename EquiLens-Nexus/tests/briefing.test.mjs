import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.EQUITY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'equilens-brief-'));
const { newsWindow, weekRange, mapNews, mapMacro, mapEarnings, zhTitle, focusNews, weekAgenda } = await import('../lib/briefing.mjs');
const tw = s => Date.parse(s + '+08:00'), iso = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 16);

test('news window runs from previous weekday 13:30 to target day 06:00 (Taipei)', () => {
  let w = newsWindow(tw('2026-09-30T08:00'));
  assert.equal(iso(w.start), '2026-09-29T13:30'); assert.equal(iso(w.end), '2026-09-30T06:00'); assert.equal(w.inProgress, false);
  w = newsWindow(tw('2026-09-30T05:00')); assert.equal(w.target, '2026-09-30'); assert.equal(w.inProgress, true);
  w = newsWindow(tw('2026-09-30T14:00')); assert.equal(w.target, '2026-10-01'); assert.equal(iso(w.start), '2026-09-30T13:30');
  w = newsWindow(tw('2026-10-05T08:00')); assert.equal(iso(w.start), '2026-10-02T13:30', 'Monday covers Friday close and the weekend');
  w = newsWindow(tw('2026-10-03T10:00')); assert.equal(w.target, '2026-10-05'); assert.equal(w.inProgress, true);
  w = newsWindow(tw('2026-10-05T08:00'), 1); assert.equal(w.target, '2026-10-02'); assert.equal(iso(w.start), '2026-10-01T13:30');
});

test('week is Monday–Sunday and rolls to next week after Sunday noon', () => {
  assert.equal(weekRange(tw('2026-09-30T10:00')).start, '2026-09-28');
  assert.equal(weekRange(tw('2026-10-04T11:59')).start, '2026-09-28');
  assert.equal(weekRange(tw('2026-10-04T12:00')).start, '2026-10-05');
  assert.equal(weekRange(tw('2026-09-28T00:10')).days.length, 7);
});

test('maps cnyes items: entities, sections, must-read, stock codes', () => {
  const n = mapNews({ newsId: 1, title: '〈台股盤前要聞〉A&amp;B', summary: '第一行&#10;第二行', categoryName: '台股盤勢', publishAt: 1790716203,
    stock: ['2330', 'US-NVDA', 'US-AAPL'], market: [{ code: '2330', name: '台積電', symbol: 'TWS:2330:STOCK' }, { code: 'NVDA', name: '輝達', symbol: 'USS:NVDA:STOCK' }] });
  assert.equal(n.title, '〈台股盤前要聞〉A&B'); assert.equal(n.summary, '第一行 第二行'); assert.equal(n.section, 'tw'); assert.equal(n.must, true);
  assert.deepEqual(n.tw, ['2330']); assert.deepEqual(n.us, [{ code: 'NVDA', name: '輝達' }, { code: 'AAPL', name: 'AAPL' }]);
  assert.equal(n.url, 'https://news.cnyes.com/news/id/1');
  assert.equal(mapNews({ newsId: 2, title: 'x', categoryName: '房產', publishAt: 1 }).section, 'other');
});

test('macro calendar keeps important events in range, translated to Chinese', () => {
  const range = { start: '2026-09-28', end: '2026-10-04' };
  const list = [
    { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-10-02T08:30:00-04:00', impact: 'High', forecast: '90K', previous: '162K' },
    { title: 'FOMC Member Waller Speaks', country: 'USD', date: '2026-10-01T10:00:00-04:00', impact: 'Medium' },
    { title: 'Bank Holiday', country: 'CNY', date: '2026-09-30T19:01:00-04:00', impact: 'Holiday' },
    { title: 'Retail Sales m/m', country: 'AUD', date: '2026-09-30T21:30:00-04:00', impact: 'High' },
    { title: 'Some Low Thing', country: 'USD', date: '2026-10-01T10:00:00-04:00', impact: 'Low' },
    { title: 'CPI m/m', country: 'USD', date: '2026-10-06T08:30:00-04:00', impact: 'High' },
  ];
  const m = mapMacro(list, range);
  assert.deepEqual(m.map(e => e.title), ['金融市場休假', 'Fed 官員 Waller 談話', '非農就業人數']);
  assert.equal(m[0].date, '2026-10-01'); assert.equal(m[2].date, '2026-10-02'); assert.equal(m[2].forecast, '90K');
  assert.equal(zhTitle('Unknown Indicator'), null);
});

test('earnings keep tech names and mega caps, ordered by release time then tech', () => {
  const rows = [{ symbol: 'JPM', name: 'JPMorgan', marketCap: '$700,000,000,000', time: 'time-pre-market', epsForecast: '$4.00' },
    { symbol: 'XYZ', name: 'Small Co', marketCap: '$2,000,000,000', time: 'time-after-hours' },
    { symbol: 'BIGCO', name: 'Big Co', marketCap: '$150,000,000,000', time: 'time-not-supplied' },
    { symbol: 'MU', name: 'Micron', marketCap: '$1,190,357,760,000', time: 'time-after-hours', epsForecast: '$31.35' }];
  const e = mapEarnings(rows, '2026-09-30');
  assert.deepEqual(e.map(r => r.symbol), ['JPM', 'MU', 'BIGCO']);
  assert.deepEqual(mapEarnings([rows[0], { ...rows[3], time: 'time-pre-market' }], 'x').map(r => r.symbol), ['MU', 'JPM'], 'tech first within same timing');
  assert.equal(e.find(r => r.symbol === 'JPM').zh, '摩根大通'); assert.equal(e.find(r => r.symbol === 'JPM').tech, false);
  assert.equal(e.find(r => r.symbol === 'MU').timing, '盤後'); assert.equal(e.find(r => r.symbol === 'BIGCO').timing, '時間未定');
});

test('news and agenda degrade gracefully when sources fail', async () => {
  const now = tw('2026-09-30T08:00');
  const fail = async () => { throw new Error('offline'); };
  const empty = await focusNews({ now, fetcher: fail });
  assert.equal(empty.items.length, 0); assert.match(empty.error, /鉅亨網/);
  const ok = await focusNews({ now, offset: 1, fetcher: async () => ({ items: { last_page: 1, data: [{ newsId: 9, title: '美股重點新聞摘要', categoryName: '美股雷達', publishAt: tw('2026-09-29T02:00') / 1000 }, { newsId: 8, title: '窗外', categoryName: '美股雷達', publishAt: tw('2026-09-30T07:00') / 1000 }] } }) });
  assert.deepEqual(ok.items.map(i => i.id), [9]); assert.equal(ok.complete, true);
  const again = await focusNews({ now: now + 3600e3, offset: 1, fetcher: fail });
  assert.equal(again.items.length, 1, 'completed window is served from cache');
  const week = await weekAgenda({ now, fetcher: async url => url.includes('faireconomy') ? [{ title: 'Unemployment Rate', country: 'USD', date: '2026-10-02T08:30:00-04:00', impact: 'High' }] : { data: { rows: [] } } });
  assert.equal(week.macro.length, 1); assert.deepEqual(week.errors, []);
  const failed = await weekAgenda({ now: now + 4 * 3600e3, fetcher: fail });
  assert.equal(failed.macro.length, 1, 'keeps last good calendar'); assert.equal(failed.errors.length, 2);
});
