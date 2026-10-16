// 五檔錄製器（lib/bookrec.mjs）：選股、盤中換股、錄製 → 收盤整理 → 匯出 CSV
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { normalizeBooks, checkpoints, buildLiquidity, reduceDay, pickExtras, swapExtras, createBookRecorder, compactDay, readStock, toCSV, writeMeta, readMeta, listBookDays, pruneDays } from '../lib/bookrec.mjs';

const TW = { open: 540, close: 810 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'books-'));

test('books: settings normalized; checkpoints start after the first 5-minute bar', () => {
  assert.deepEqual(normalizeBooks(null), { enabled: true, extra: 1000, keepDays: 20, swap: true, exportDir: '' });
  assert.deepEqual(normalizeBooks({ enabled: false, extra: 99999, keepDays: 0, swap: false }), { enabled: false, extra: 1900, keepDays: 20, swap: false, exportDir: '' });
  assert.deepEqual(checkpoints(TW), [5, 30, 60, 90, 120, 150, 180, 210]);
});

test('books: liquidity from replay frames; top extras exclude the streamed list', () => {
  // 3 檔、6 天；每天 09:05 與收盤的累計成交金額（百萬元）
  const days = Array.from({ length: 6 }, (_, d) => ({ ids: ['1101', '2330', '3406'], as: 1e6, frames: [{ t: '09:00', a: [1, 10, 2] }, { t: '09:05', a: [2, 20 + d, 4] }, { t: '09:31', a: [3, 30, 5] }, { t: '13:30', a: [10, 900, 300] }] }));
  const r = reduceDay(days[0], TW);
  assert.deepEqual(r.frames.map(f => f.t), ['09:05', '09:31', '13:30'], 'only checkpoint frames and the last one are kept');
  const liq = buildLiquidity(days.map(d => reduceDay(d, TW)), TW);
  assert.equal(liq.days, 6);
  assert.equal(liq.avg.get('2330'), 900e6);
  assert.equal(liq.at.get(5).get('2330'), (21 + 22 + 23 + 24 + 25) / 5 * 1e6, 'same-time average over the last 5 days');
  assert.equal(liq.at.get(30).get('3406'), 4e6, '09:30 checkpoint uses the last frame at or before 09:30');
  assert.deepEqual(pickExtras(liq, new Set(['2330']), 5), ['3406', '1101']);
  assert.deepEqual(pickExtras(liq, new Set(), 1, new Set(['1101'])), ['1101']);
});

test('books: checkpoint swap adds surging stocks and whole strong sectors, dropping only dead extras', () => {
  const rows = new Map([
    ['A', { amount: 50e6, change: 1 }],   // 量比 5 倍 → 候選
    ['B', { amount: 6e6, change: 4 }],    // 漲 4% → 候選
    ['C', { amount: 3e6, change: 9 }],    // 金額不足 500 萬 → 不加
    ['S1', { amount: 8e6, change: 3 }], ['S2', { amount: 9e6, change: 2.5 }], ['S3', { amount: 7e6, change: 2 }], ['S4', { amount: 2.5e6, change: 0.5 }], // 同產業 3 檔漲 ≥ 2% → 整個產業
    ['D1', { amount: 0.2e6, change: 0 }], ['D2', { amount: 0.5e6, change: 0 }], ['K', { amount: 30e6, change: 0 }], // 加錄中：D1、D2 冷清，K 活躍
    ['M', { amount: 90e6, change: 5 }],   // 已在推播清單
  ]);
  const base = new Map([['A', 10e6], ['B', 5e6], ['S1', 8e6], ['S2', 9e6], ['S3', 7e6], ['S4', 2.5e6], ['M', 10e6]]);
  const sectorOf = id => id.startsWith('S') ? '光學' : '';
  const r = swapExtras({ extras: ['D1', 'D2', 'K'], exclude: new Set(['M']), rows, base, sectorOf, slots: 5 });
  assert.deepEqual(r.sectors, ['光學']);
  assert.deepEqual(r.added.slice(0, 4).sort(), ['S1', 'S2', 'S3', 'S4'], 'strong sector first');
  assert.equal(r.added.length, 4, 'two free slots + two dead extras');
  assert.deepEqual(r.dropped, ['D1', 'D2']);
  assert.ok(r.next.includes('K') && !r.next.includes('M') && !r.next.includes('C'));
  assert.equal(r.next.length, 5);
  const calm = swapExtras({ extras: ['K'], exclude: new Set(), rows: new Map([['K', { amount: 30e6, change: 0 }]]), base: new Map([['K', 30e6]]), slots: 3 });
  assert.deepEqual([calm.added, calm.dropped, calm.next], [[], [], ['K']], 'nothing hot: no change');
});

test('books: record → compact per stock (trades de-duplicated by serial) → CSV with the book at each trade', async () => {
  const dir = tmp(), date = '2026-10-14', T0 = Date.UTC(2026, 9, 14, 1, 0, 0); // 09:00 台北
  const rec = createBookRecorder({ dir, date, flushMs: 5 });
  const book = (id, t, bid, ask) => ({ kind: 'book', id, time: T0 + t, bids: [{ price: bid, size: 10 }, { price: bid - 5, size: 20 }], asks: [{ price: ask, size: 3 }] });
  rec.record(book('3406', 0, 1100, 1105));
  rec.record(book('3406', 1, 1100, 1105)); // 沒變：不記
  rec.record({ kind: 'trade', id: '3406', time: T0 + 500, price: 1105, size: 7, volume: 7, bid: 1100, ask: 1105, serial: 11 });
  rec.record(book('3406', 600, 1105, 1110));
  rec.record({ kind: 'agg', id: '2330', time: T0 + 700, book: { bids: [{ price: 1450, size: 100 }], asks: [{ price: 1455, size: 50 }] } });
  rec.record({ kind: 'candle', id: '3406', time: T0 }); // 不錄
  assert.deepEqual([rec.stats.books, rec.stats.trades, rec.stats.stocks], [3, 1, 2]);
  await rec.close();
  // 收盤後補抓（REST）：同一筆成交（序號 11）不重複，新增序號 12
  const fill = createBookRecorder({ dir, date });
  for (const s of [11, 12]) fill.record({ kind: 'trade', id: '3406', time: T0 + (s === 11 ? 500 : 900), price: 1110, size: 2, volume: 9, bid: 1105, ask: 1110, serial: s });
  await fill.close();
  // 整理前也可以從 part 檔匯出
  assert.equal((await readStock(dir, date, '3406')).length, 5);
  const stocks = await compactDay(dir, date);
  assert.deepEqual(Object.keys(stocks).sort(), ['2330', '3406']);
  assert.deepEqual([stocks['3406'].books, stocks['3406'].trades], [2, 2]);
  assert.deepEqual(fs.readdirSync(path.join(dir, date)).sort(), ['2330.ndjson.gz', '3406.ndjson.gz'], 'part files removed');
  const rows = await readStock(dir, date, '3406');
  assert.deepEqual(rows.map(r => r[0]), ['b', 't', 'b', 't']);
  const csv = toCSV(rows).replace(/^﻿/, '').trim().split('\n');
  assert.match(csv[0], /^時間,類型,成交價,成交量\(張\),累計量\(張\),內外盤,委買1價,委買1量,/);
  assert.equal(csv[1], '09:00:00.000,五檔,,,,,1100,10,1095,20,,,,,,,1105,3,,,,,,,,,');
  assert.equal(csv[2], '09:00:00.500,成交,1105,7,7,外盤,1100,10,1095,20,,,,,,,1105,3,,,,,,,,,');
  assert.equal(csv[4].split(',').slice(0, 8).join(','), '09:00:00.900,成交,1110,2,9,外盤,1105,10');
  assert.equal(await readStock(dir, date, '9999'), null);
  assert.equal(await readStock(dir, '../x', '3406'), null);
});

test('books: an unfinished part file (crash before close) is still readable up to the last flush', async () => {
  const dir = tmp(), date = '2026-10-15';
  const rec = createBookRecorder({ dir, date, flushMs: 10 });
  for (let i = 0; i < 50; i++) rec.record({ kind: 'trade', id: '1569', time: 1760490000000 + i, price: 100 + i, size: 1, serial: i });
  await new Promise(r => setTimeout(r, 60));
  // 不呼叫 close()：模擬當機，檔尾不完整
  const file = path.join(dir, date, 'part-1.ndjson.gz'), copy = path.join(dir, date, 'part-2.ndjson.gz');
  fs.copyFileSync(file, copy); fs.rmSync(file);
  const rows = await readStock(dir, date, '1569');
  assert.equal(rows.length, 50);
  assert.throws(() => zlib.gunzipSync(fs.readFileSync(copy)), 'plain gunzip would fail on the truncated stream');
  await rec.close();
});

test('books: meta round trip and retention keeps the newest days', () => {
  const dir = tmp();
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-05']) writeMeta(dir, d, { date: d, main: ['2330'] });
  assert.deepEqual(readMeta(dir, '2026-10-02').main, ['2330']);
  pruneDays(dir, 2);
  assert.deepEqual(listBookDays(dir), ['2026-10-02', '2026-10-05']);
});

test('books: daily export writes a valid ZIP (UTF-8 names, one CSV per stock and a stock list) via a temporary file', async () => {
  const { exportDay, normalizeBooks: nb } = await import('../lib/bookrec.mjs');
  const dir = tmp(), out = path.join(tmp(), 'TW_trade'), date = '2026-10-16', T0 = Date.UTC(2026, 9, 16, 1, 0, 0);
  const rec = createBookRecorder({ dir, date });
  rec.record({ kind: 'book', id: '3406', time: T0, bids: [{ price: 1100, size: 10 }], asks: [{ price: 1105, size: 3 }] });
  rec.record({ kind: 'trade', id: '3406', time: T0 + 500, price: 1105, size: 7, volume: 7, bid: 1100, ask: 1105, serial: 1 });
  rec.record({ kind: 'trade', id: '2330', time: T0 + 600, price: 1450, size: 2, volume: 2, bid: 1445, ask: 1450, serial: 1 });
  await rec.close(); const idx = await compactDay(dir, date);
  const r = await exportDay(dir, date, out, [{ id: '3406', name: '玉晶光', sector: '光電業', main: true, ...idx['3406'] }, { id: '2330', name: '台積電', sector: '半導體業', main: false, ...idx['2330'] }]);
  assert.equal(r.file, path.join(out, `${date}_五檔成交.zip`)); assert.deepEqual(fs.readdirSync(out), [`${date}_五檔成交.zip`], 'no .partial left behind');
  // 解析 ZIP：中央目錄 → 每個檔案解壓並比對
  const z = fs.readFileSync(r.file), eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = z.readUInt16LE(eocd + 10), cdAt = z.readUInt32LE(eocd + 16), files = {};
  for (let i = 0, p = cdAt; i < n; i++) {
    const comp = z.readUInt32LE(p + 20), nl = z.readUInt16LE(p + 28), el = z.readUInt16LE(p + 30), cl = z.readUInt16LE(p + 32), off = z.readUInt32LE(p + 42), name = z.subarray(p + 46, p + 46 + nl).toString('utf8');
    assert.equal(z.readUInt16LE(p + 8) & 0x0800, 0x0800, 'UTF-8 file names');
    const lnl = z.readUInt16LE(off + 26), lel = z.readUInt16LE(off + 28), data = zlib.inflateRawSync(z.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + comp));
    assert.equal(zlib.crc32(data), z.readUInt32LE(p + 16)); files[name] = data.toString('utf8'); p += 46 + nl + el + cl;
  }
  assert.deepEqual(Object.keys(files), ['股票清單.csv', '3406_玉晶光.csv', '2330_台積電.csv']);
  assert.match(files['股票清單.csv'], /3406,玉晶光,光電業,推播清單,1,1,09:00:00,09:00:00/);
  assert.match(files['3406_玉晶光.csv'], /09:00:00\.500,成交,1105,7,7,外盤,1100,10/);
  assert.equal(nb({ exportDir: 'relative/path' }).exportDir, '', 'only absolute paths'); assert.equal(nb({}).exportDir, '');
});
