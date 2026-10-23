// README 截圖：電腦版（http://127.0.0.1:4391）與手機版（http://127.0.0.1:4392），畫面為示意資料
// Playwright 是全域安裝：PLAYWRIGHT=$(npm root -g)/playwright/index.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const OUT = process.argv[2], ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const T = new Date('2026-10-16T21:30:00+08:00');
const want = k => !ONLY || ONLY.has(k);
const b = await chromium.launch();
const VIEW = { width: 1440, height: 1000 };

// 當沖掃描：盤中的觀察名單（示意）
const ctx = (d, h, vr, sup, res, obi, delta) => ({ ready: true, reasons: [], conditions: { breakout: vr >= 2, vwap: false, bid: false, weak: false }, daily: { long: d, count: 30, ma20: 0 }, hour: { long: h, count: 24, ma20: 0 }, five: { volumeRatio: vr, support: sup, resistance: res }, book: { obi, delta, age: 1.2 } });
const st = new Map((await (await fetch('http://127.0.0.1:4391/api/state')).json()).stocks.map(s => [s.id, s]));
const item = (id, name, _p, _c, _v, score, part, c, last, stop) => { const s = st.get(id), price = s.price, change = s.change, vwap = Math.round(price * 0.986 * 100) / 100;
  c.daily.ma20 = s.technical?.ma20 ?? null; c.hour.ma20 = Math.round(price * 0.975 * 100) / 100; c.five.support = Math.round(price * 0.985 * 10) / 10; c.five.resistance = Math.round(price * 0.996 * 10) / 10;
  return { id, name, price, change, vwap, vwapDist: 1.42, rvol: Math.round(c.five.volumeRatio * 1.3 * 100) / 100, obi: c.book.obi, outer5: 62, score, part, filters: [], context: c, reference: stop ? { stop: Math.round(price * 0.982) } : null, last, watch: true, scan: true }; };
const dtScan = {
  phaseName: '掃描中', market: { twse: { chg: 0.62, r15: 0.18, avg: 23102.3, vsAvg: 0.21, up: 612, down: 301, regime: 'tailwind', stale: false }, tpex: { chg: 0.48, r15: -0.06, avg: 261.4, vsAvg: 0.12, up: 455, down: 330, regime: 'neutral', stale: false } },
  feed: { window: true, connected: true, mode: 'full', subscribed: 132, expected: 132, connections: [1, 2] }, plan: 'advanced', plans: { advanced: { limit: 2000 } },
  prep: { eligible: 1612, disposition: 14, suspended: 3, sellFirstOff: 22, ref: 1980, errors: [] }, marketChange: 1.12, history: Array.from({ length: 43 }, () => ({ status: 'ready' })), total: 43, displayMin: 70, hidden: 31,
  top: [
    item('3017', '奇鋐', 1048, 4.28, 1031.6, 92, { daily: 20, hour: 25, five: 27, book: 20 }, ctx(true, true, 2.6, 1032, 1045, 0.42, 0.12), { type: 'dt-breakout', t: '09:42:18' }, 1029),
    item('6669', '緯穎', 2745, 3.58, 2721.4, 88, { daily: 20, hour: 25, five: 23, book: 20 }, ctx(true, true, 1.7, 2712, 2740, 0.36, 0.08), { type: 'dt-vwap', t: '10:26:09' }, 2705),
    item('2368', '金像電', 361.5, 2.12, 357.9, 81, { daily: 20, hour: 25, five: 21, book: 15 }, ctx(true, true, 1.5, 356, 361, 0.27, 0.04), null, null),
    item('3037', '欣興', 190.5, 1.88, 188.7, 76, { daily: 20, hour: 25, five: 18, book: 13 }, ctx(true, true, 1.3, 187.5, 190, 0.22, 0.03), null, null),
    item('2382', '廣達', 299.5, 1.01, 300.2, 72, { daily: 20, hour: 25, five: 14, book: 13 }, ctx(true, true, 1.1, 297.5, 301, 0.18, -0.02), null, null),
  ],
};
async function desktop(page) {
  await page.clock.install({ time: T });
  await page.route('**/api/daytrade', async r => { const res = await r.fetch(); const j = await res.json(); r.fulfill({ response: res, json: { ...j, ...dtScan, capable: true, enabled: true, settings: j.settings } }); });
  await page.goto('http://127.0.0.1:4391/'); await page.waitForTimeout(1500);
}
const nav = async (p, k) => { await p.locator(`button[data-page="${k}"]`).first().click(); await p.waitForTimeout(2200); };
const shot = (p, name, clip) => p.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
const MAIN = (y = 60, h = 840) => ({ x: 238, y, width: 1202, height: h });

{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('pageerror', e.message.slice(0, 160)));
  await desktop(p);
  if (want('overview')) { await nav(p, 'overview'); await shot(p, 'desktop-overview'); }
  if (want('heatmap')) { await nav(p, 'heatmap'); await shot(p, 'desktop-heatmap', MAIN(60, 840)); }
  if (want('report')) { await nav(p, 'home'); await shot(p, 'desktop-report', MAIN(60, 840)); }
  if (want('live')) {
    await nav(p, 'live'); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800);
    await shot(p, 'desktop-daytrade', MAIN(60, 840));
    const board = p.locator('.lv-layout').first(); await board.scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
    await p.addStyleTag({ content: '.topbar{position:static!important}' });
    const bb = await board.boundingBox(), sy = await p.evaluate(() => window.scrollY);
    await p.screenshot({ path: `${OUT}/desktop-radar.png`, fullPage: true, clip: { x: bb.x, y: bb.y + sy, width: bb.width, height: 760 } });
    await p.locator('[data-dttab="review"]').click(); await p.waitForTimeout(1200); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400);
    await p.locator('.dt-panel').screenshot({ path: `${OUT}/desktop-daytrade-review.png` });
  }
  if (want('chart')) {
    await nav(p, 'live'); const c = p.locator('[data-kbar="3017"]').first(); await c.scrollIntoViewIfNeeded(); await c.click(); await p.waitForTimeout(2000);
    await shot(p, 'desktop-chart', { x: 200, y: 36, width: 1040, height: 720 });
    for (const [v, n] of [['day', 'desktop-chart-day']]) { await p.locator(`[data-cperiod="${v}"]`).first().click(); await p.waitForTimeout(1500); await shot(p, n); }
    const d = p.locator('[data-stock-detail="3017"]').first(); if (await d.count()) {
      await d.click(); await p.waitForTimeout(2200); await shot(p, 'desktop-detail');
      // 訊號面板（未設定資金時的畫面）
      const sg = p.locator('#ix-signal').first(); if (await sg.count()) { await sg.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await sg.locator('xpath=..').screenshot({ path: `${OUT}/desktop-signal.png` }); }
      // 個股的認購權證：展開第一檔的分點進出
      await p.waitForTimeout(1500);
      const wb = p.locator('#ix-warrants [data-wbr]').first(); if (await wb.count()) { await wb.click(); await p.waitForTimeout(1200); }
      await p.locator('#ix-warrants').evaluate(e => e.closest('section').scrollIntoView({ block: 'start' })); await p.waitForTimeout(600);
      await shot(p, 'desktop-warrants');
    }
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  if (want('grouprank')) { await p.goto('http://127.0.0.1:4391/'); await p.waitForTimeout(1200); await nav(p, 'grouprank'); await shot(p, 'desktop-grouprank', MAIN(60, 840)); }
  if (want('patterns')) { await nav(p, 'patterns'); await shot(p, 'desktop-patterns', MAIN(60, 840)); }
  if (want('flows')) { await nav(p, 'flows'); await p.locator('[data-flow-cache]').click(); await p.waitForTimeout(2000); await shot(p, 'desktop-flows', MAIN(60, 840)); }
  if (want('chips')) { await nav(p, 'chips'); await shot(p, 'desktop-chips', MAIN(60, 840)); const w = p.locator('.ix-cw-w').first(); if (await w.count()) { await w.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await w.screenshot({ path: `${OUT}/desktop-chips-warrants.png` }); } }
  if (want('topics')) { await nav(p, 'topics'); await shot(p, 'desktop-topics', MAIN(60, 640)); }
  await p.close();
}
// 手機版
if (want('mobile')) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await c.newPage(); await p.clock.install({ time: T });
  await p.route('**/m/api/daytrade', async r => { const res = await r.fetch(); const j = await res.json(); r.fulfill({ response: res, json: { ...j, ...dtScan, capable: true, enabled: true } }); });
  await p.goto('http://127.0.0.1:4392/'); await p.waitForTimeout(800);
  await p.evaluate(() => fetch('/m/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nexus-pocket' }, body: JSON.stringify({ password: 'demo-password-123' }) }));
  await p.goto('http://127.0.0.1:4392/'); await p.waitForTimeout(2000);
  const tab = async k => { await p.locator(`button.tab[data-tab="${k}"]`).click(); await p.waitForTimeout(1800); await p.evaluate(() => window.scrollTo(0, 0)); };
  await tab('brief'); await shot(p, 'mobile-brief');
  await tab('heat'); await shot(p, 'mobile-heat');
  await tab('live'); await shot(p, 'mobile-board');
  await p.locator('[data-lview="daytrade"]').click(); await p.waitForTimeout(1500); await shot(p, 'mobile-daytrade');
  await tab('stocks'); await shot(p, 'mobile-stocks');
  await tab('flows'); const br = p.locator('[data-fview="brokers"]'); if (await br.count()) { await br.click(); await p.waitForTimeout(1500); } await shot(p, 'mobile-chips');
  await c.close();
}
await b.close();
