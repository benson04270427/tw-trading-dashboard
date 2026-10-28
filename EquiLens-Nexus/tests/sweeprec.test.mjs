import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('全市場掃描畫格：記錄、同分鐘覆寫、新股票補欄位，轉成走勢', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-sweep-'));
  process.env.EQUITY_DATA_DIR = dir;
  const { recordSweep, loadSweep, sweepDays } = await import('../lib/sweeprec.mjs?' + Date.now());
  const { seriesFromReplay, replayRef } = await import('../lib/intraday.mjs');
  const row = (id, close, chg, vol, date = '2026-10-28 09:05:00') => ({ stock_id: id, date, close, change_price: chg, total_volume: vol, total_amount: vol * 1000 * close });
  assert.equal(recordSweep('2026-10-28', '09:05', [row('1101', 30, 0.5, 100), row('9999', 10, 0, 5, '2026-10-27 13:30:00')]), true);
  assert.equal(recordSweep('2026-10-28', '09:08', [row('1101', 31, 1.5, 300), row('2330', 1500, 10, 2000)]), true);
  assert.equal(recordSweep('2026-10-28', '09:08', [row('1101', 31.5, 2, 320), row('2330', 1505, 15, 2100)]), true);
  assert.equal(recordSweep('2026-10-28', '09:06', [row('1101', 30, 0.5, 100)]), false);
  const day = loadSweep('2026-10-28');
  assert.deepEqual(day.ids, ['1101', '2330']); assert.equal(day.frames.length, 2);
  const p = { lot: 1000 }, s = seriesFromReplay(day, '1101', p);
  assert.deepEqual(s.c, [30, 31.5]); assert.deepEqual(s.v, [100, 220]); assert.equal(replayRef(day, '1101', p), 29.5);
  assert.deepEqual(seriesFromReplay(day, '2330', p).c, [1505]);
  assert.deepEqual(sweepDays(), ['2026-10-28']);
});
