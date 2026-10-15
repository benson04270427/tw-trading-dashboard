// 盤後日報「明日觀察」：今晚到明日開盤前的國際行事曆、大盤數據進入模型資料，提示要求總體分析且不寫個股走勢
import test from 'node:test';
import assert from 'node:assert/strict';
import { overnightOutlook, buildReportContext, reportSystem, reportSchema } from '../lib/report.mjs';
import { marketProfile } from '../lib/markets.mjs';

const tw = marketProfile('TW');
const at = (date, hm) => Date.parse(`${date}T${hm}:00+08:00`);
const macro = (date, hm, title, extra = {}) => ({ type: 'macro', time: at(date, hm), date, country: 'USD', countryName: '美國', impact: 'High', holiday: false, title, forecast: '0.3%', previous: '0.2%', ...extra });

test('overnight outlook keeps data from today\'s close to tomorrow\'s open, and tomorrow\'s session separately', () => {
  const week = {
    macro: [
      macro('2026-10-15', '10:00', '中國 GDP'), // 今天盤中：不列入
      macro('2026-10-15', '20:30', '美國 CPI'),
      macro('2026-10-16', '02:00', 'FOMC 會議紀要', { forecast: '' }),
      macro('2026-10-16', '10:00', '中國零售銷售', { impact: 'Medium', countryName: '中國' }),
      macro('2026-10-16', '20:30', '美國零售銷售'), // 明晚：不列入
      { ...macro('2026-10-16', '00:00', '金融市場休假'), holiday: true, date: '2026-10-16', countryName: '日本' },
    ],
    earnings: [{ date: '2026-10-15', symbol: 'TSM', name: 'Taiwan Semiconductor', zh: '台積電 ADR', timing: '盤前', eps: '$2.10' }, { date: '2026-10-16', symbol: 'NFLX', name: 'Netflix', timing: '盤後' }],
  };
  const o = overnightOutlook('2026-10-15', week, { market: tw, lang: 'zh-TW' });
  assert.deepEqual(o.tonight, ['今晚 20:30 美國 美國 CPI · 預估 0.3% · 前值 0.2% · 高影響', '明日 02:00 美國 FOMC 會議紀要 · 前值 0.2% · 高影響']);
  assert.deepEqual(o.intraday, ['明日 10:00 中國 中國零售銷售 · 預估 0.3% · 前值 0.2%']);
  assert.deepEqual(o.earnings, ['台積電 ADR(TSM) 盤前 · EPS 預估 $2.10']);
  assert.deepEqual(o.holidays, ['2026-10-16 日本 金融市場休假']);
});

test('report context carries index, futures, institutional, derivatives, leverage and overnight data', () => {
  const market = { index: { twse: { close: 23000, change: -150, pct: -0.65, amount: 4.2e11 } }, futures: [{ name: '台指期', close: 22980, change: -170, pct: -0.73 }], institutions: { foreign: -120.5, trust: 15.2, dealer: -8, total: -113.3 }, futuresFlow: { net: -25000, netChange: -3200, callNet: 1200, putNet: 800 }, pcr: 96.4, retail: { mini: { net: 8000, change: 1500, ratio: 18.2 } }, margin: { date: '2026-10-15', marginMoney: 3120.5, marginChange: -22.1, shortLots: 210000, shortChange: 5000 } };
  const ctx = buildReportContext({ date: '2026-10-15', heat: null, flows: null, market, outlook: { tonight: ['今晚 20:30 美國 CPI'], earnings: [], intraday: [], holidays: [] }, alerts: [], watch: [], movers: {}, patterns: [], news: [], agenda: null }, 'zh-TW');
  const m = ctx['指數與期貨籌碼'];
  assert.equal(m['加權指數']['成交金額億'], 4200); assert.equal(m['外資期權口數']['淨未平倉增減'], -3200); assert.equal(m['融資券']['融資增減億'], -22.1); assert.equal(m['散戶小台']['多空比'], 18.2);
  assert.deepEqual(ctx['今晚與明日（台灣時間）']['今晚至明晨經濟數據'], ['今晚 20:30 美國 CPI']);
  assert.equal(buildReportContext({ date: 'x', alerts: [], watch: [], movers: {}, patterns: [], news: [] }, 'zh-TW')['指數與期貨籌碼'], null);
});

test('tomorrow outlook prompt: market-level tags, overseas data, no single-stock predictions', () => {
  const zh = reportSystem('zh-TW', '台灣股市', true), en = reportSystem('en', 'Taiwan', true);
  for (const tag of ['【大盤】', '【法人籌碼】', '【期權】', '【資金面】', '【國際】']) assert.ok(zh.includes(tag), tag);
  assert.match(zh, /跌停股明天會不會打開/); assert.match(zh, /不寫個股/); assert.match(zh, /預估值與前值/);
  assert.match(en, /never predict a stock's next-day move/); assert.match(en, /\[Overseas\]/);
  assert.match(reportSchema('zh-TW').properties.tomorrow.description, /專業投資顧問/);
  assert.match(reportSchema('zh-TW').properties.card.properties.watch.description, /不寫個股/);
});
