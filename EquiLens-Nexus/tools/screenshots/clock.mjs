// 讓伺服器的時間從 2026-10-16（五）21:30（台北，盤後資料都已公布）開始走
const shift = Date.parse(process.env.DEMO_TIME || '2026-10-16T21:30:00+08:00') - Date.now();
const Real = Date;
class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
globalThis.Date = FakeDate;
// 示意環境不連外：所有對外請求一律回 503（避免用假金鑰打到真的資料源）
const realFetch = globalThis.fetch;
const weekdays = () => { const out = []; for (let d = Date.now() + 8 * 3600e3; out.length < 60; d -= 864e5) { const x = new Date(d); if (x.getUTCDay() % 6) out.unshift(x.toISOString().slice(0, 10)); } return out; };
globalThis.fetch = async (url, opts) => { const u = String(url?.url || url); if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return realFetch(url, opts);
  // 交易日曆（分點、權證等盤後資料需要）：平日即交易日
  if (/api\.finmindtrade\.com/.test(u) && /dataset=TaiwanStockTradingDate/.test(u)) return new Response(JSON.stringify({ status: 200, data: weekdays().map(date => ({ date })) }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ msg: 'offline demo' }), { status: 503, headers: { 'content-type': 'application/json' } }); };
