import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnership, insiderTotals } from '../lib/ownership.mjs';

test('insider totals count only own holdings and split out the board', () => {
  const t = insiderTotals([['董事長本人', 'A', 0, 5000, 0, 0], ['董事長之配偶', 'A2', 0, 999, 0, 0], ['經理人本人', 'B', 0, 1000, 0, 0], ['監察人本人', 'C', 0, 2000, 0, 0], ['大股東本人', 'D', 0, 3000, 0, 0]]);
  assert.deepEqual(t, { total: 11000, board: 7000 });
  assert.equal(insiderTotals([]), null);
});

test('ownership combines weekly big holders, monthly insider ratio and price', () => {
  const weeks = Array.from({ length: 14 }, (_, k) => ({ date: new Date(Date.UTC(2026, 6, 3 + k * 7)).toISOString().slice(0, 10), big1000: 80 + k * 0.1, big400: 85, people: 1000 - k * 10, shares: 1e8 }));
  const price = weeks.map((w, k) => ({ date: w.date, close: 100 + k }));
  const o = buildOwnership({ id: '2330', name: 'TSMC', weeks, price, insiders: [{ ym: '2026-08', total: 5e6, board: 4e6 }, { ym: '2026-09', total: 5.5e6, board: 4e6 }] });
  assert.equal(o.available, true);
  assert.equal(o.latest.big1000, 81.3);
  assert.equal(o.latest.chg4, 0.4);
  assert.equal(o.latest.chg12, 1.2);
  assert.equal(o.insiders[0].pct, 5);
  assert.equal(o.latest.insider.pct, 5.5);
  assert.equal(o.latest.insider.chg, 0.5);
  assert.equal(o.price.length, 14);
  assert.equal(buildOwnership({ id: 'x', weeks: [] }).available, false);
});

import { parseTdccForm, parseTdccTable } from '../lib/providers/tdcc.mjs';
import { holderLevels } from '../lib/insight.mjs';
test('集保結算所查詢頁：讀 token、週別與級距表', () => {
  const form = '<input type="hidden" name="SYNCHRONIZER_TOKEN" value="abc-123"><select name="scaDate" id="scaDate"><option value="20261022">20261022</option><option value="20261016">20261016</option></select>';
  assert.deepEqual(parseTdccForm(form), { token: 'abc-123', dates: ['2026-10-22', '2026-10-16'] });
  const tr = (...c) => `<tr>${c.map(x => `<td>${x}</td>`).join('')}</tr>`;
  const html = `<table>${tr('序', '持股/單位數分級', '人數', '股數/單位數', '占集保庫存數比例 (%)')}${tr('1', '1-999', '456,058', '62,657,873', '3.04')}${tr('12', '400,001-600,000', '87', '43,289,970', '2.10')}${tr('15', '1,000,001以上', '196', '1,271,009,361', '61.73')}${tr('16', '合　計', '619,908', '2,058,730,688', '100.00')}</table>`;
  const rows = parseTdccTable(html, '2026-10-22');
  assert.equal(rows.length, 4); assert.equal(rows.at(-1).HoldingSharesLevel, 'total');
  const lv = holderLevels(rows);
  assert.equal(lv.big1000, 61.73); assert.equal(lv.big400, 63.83); assert.equal(lv.people, 619908); assert.equal(lv.shares, 2058730688);
  assert.deepEqual(parseTdccTable('<table><tr><td colspan="5"><span>查無此資料</span></td></tr></table>', '2026-10-22'), []);
});
