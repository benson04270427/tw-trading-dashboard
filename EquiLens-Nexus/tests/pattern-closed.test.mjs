import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'equilens-pattern-closed-')); process.env.EQUITY_DATA_DIR = directory;
const { updatePatternData } = await import('../lib/pattern-service.mjs'); const { read } = await import('../lib/storage.mjs');
test('型態資料：日曆裡的休市日查無行情時記為休市，往前補足 90 日並完成快照', async () => {
  try {
    const dates = []; for (let i = 0; i < 95; i++) dates.push(new Date(Date.UTC(2026, 0, 5) + i * 864e5).toISOString().slice(0, 10));
    const holiday = dates[80], stock = { id: '2330', name: '台積電', market: '上市', sector: '半導體業' };
    const mock = async (dataset, params) => { if (dataset === 'TaiwanStockTradingDate') return dates.map(date => ({ date })); if (params.start_date === holiday) return []; return [{ date: params.start_date, stock_id: '2330', open: 10, max: 11, min: 9, close: 10, Trading_Volume: 1e6 }]; };
    const r = await updatePatternData([stock], { cutoff: dates.at(-1), request: mock });
    assert.equal(r.complete, true); assert.deepEqual(read('pattern-closed.json', []), [holiday]);
    const active = read('pattern-active.json', {}); assert.equal(active.calendar.length, 90); assert.ok(!active.calendar.includes(holiday)); assert.equal(active.calendar[0], dates[4]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
