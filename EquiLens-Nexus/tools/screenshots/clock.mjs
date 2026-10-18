// 讓伺服器的時間從 2026-10-16（五）14:40（台北）開始走
const shift = Date.parse(process.env.DEMO_TIME || '2026-10-16T14:40:00+08:00') - Date.now();
const Real = Date;
class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
globalThis.Date = FakeDate;
// 示意環境不連外：所有對外請求一律回 503（避免用假金鑰打到真的資料源）
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { const u = String(url?.url || url); if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return realFetch(url, opts); return new Response(JSON.stringify({ msg: 'offline demo' }), { status: 503, headers: { 'content-type': 'application/json' } }); };
