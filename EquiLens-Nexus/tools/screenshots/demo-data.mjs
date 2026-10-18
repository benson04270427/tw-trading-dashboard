// 產生 README 截圖用的示意資料（全部是合成數字，不是真實行情）
// 用法：EQUITY_DATA_DIR=<空目錄> node tools/screenshots/demo-data.mjs（之後再執行 demo-data2.mjs）
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.env.EQUITY_DATA_DIR; if (!DIR) throw new Error('EQUITY_DATA_DIR');
const NEX = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { buildHeatmap } = await import(NEX + '/lib/heatmap.mjs');
const { recordFrame } = await import(NEX + '/lib/replay.mjs');
fs.mkdirSync(DIR, { recursive: true });
const W = (f, v) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), JSON.stringify(v)); };
let seed = 20261016; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const tick = p => p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5;
const rp = p => { const t = tick(p); return Math.round(Math.round(p / t) * t * 100) / 100; };

// 股票清單：代號、名稱、產業、上市／上櫃、參考價位、當日板塊主題
const S = s => s.trim().split('\n').map(l => { const [id, name, sector, market, price] = l.trim().split(/\s+/); return { id, name, sector, market: market === 'O' ? '上櫃' : '上市', base: +price }; });
const universe = S(`
2330 台積電 半導體業 L 1450
2454 聯發科 半導體業 L 1320
2303 聯電 半導體業 L 52
3711 日月光投控 半導體業 L 168
3034 聯詠 半導體業 L 455
2379 瑞昱 半導體業 L 520
3443 創意 半導體業 L 1680
3661 世芯-KY 半導體業 L 3150
6488 環球晶 半導體業 O 410
5483 中美晶 半導體業 O 128
3105 穩懋 半導體業 O 96
8299 群聯 半導體業 O 610
3529 力旺 半導體業 O 2280
2408 南亞科 半導體業 L 58
2344 華邦電 半導體業 L 27
6415 矽力*-KY 半導體業 L 395
2382 廣達 電腦及週邊設備業 L 292
3231 緯創 電腦及週邊設備業 L 128
2356 英業達 電腦及週邊設備業 L 52
6669 緯穎 電腦及週邊設備業 L 2650
2357 華碩 電腦及週邊設備業 L 610
2376 技嘉 電腦及週邊設備業 L 285
2377 微星 電腦及週邊設備業 L 142
2395 研華 電腦及週邊設備業 L 360
4938 和碩 電腦及週邊設備業 L 72
3017 奇鋐 電腦及週邊設備業 L 980
2301 光寶科 電子零組件業 L 108
3324 雙鴻 電子零組件業 O 790
2421 建準 電子零組件業 L 118
3653 健策 電子零組件業 L 1350
3037 欣興 電子零組件業 L 186
8046 南電 電子零組件業 L 172
2368 金像電 電子零組件業 L 365
3189 景碩 電子零組件業 L 132
3044 健鼎 電子零組件業 L 232
6274 台燿 電子零組件業 O 315
4958 臻鼎-KY 電子零組件業 L 141
2059 川湖 電子零組件業 L 1220
3533 嘉澤 電子零組件業 L 1080
2308 台達電 電子零組件業 L 765
2317 鴻海 其他電子業 L 238
2474 可成 其他電子業 L 205
2345 智邦 通信網路業 L 1010
5388 中磊 通信網路業 L 118
3596 智易 通信網路業 L 152
2412 中華電 通信網路業 L 129
3008 大立光 光電業 L 2450
2409 友達 光電業 L 14.6
1519 華城 電機機械 L 820
1503 士電 電機機械 L 232
1513 中興電 電機機械 L 178
1514 亞力 電機機械 L 132
1590 亞德客-KY 電機機械 L 1120
2049 上銀 電機機械 L 242
1605 華新 電器電纜 L 31.5
2603 長榮 航運業 L 198
2609 陽明 航運業 L 62
2615 萬海 航運業 L 88
2618 長榮航 航運業 L 37
2610 華航 航運業 L 22.8
2881 富邦金 金融保險業 L 91
2882 國泰金 金融保險業 L 66
2891 中信金 金融保險業 L 44.5
2886 兆豐金 金融保險業 L 40.2
2884 玉山金 金融保險業 L 30.1
2885 元大金 金融保險業 L 35.6
2892 第一金 金融保險業 L 28.4
5880 合庫金 金融保險業 L 24.9
5871 中租-KY 其他業 L 142
1101 台泥 水泥工業 L 33.2
1102 亞泥 水泥工業 L 41.5
1216 統一 食品工業 L 82
1301 台塑 塑膠工業 L 41.3
1303 南亞 塑膠工業 L 38.6
6505 台塑化 油電燃氣業 L 46.2
2002 中鋼 鋼鐵工業 L 20.9
2027 大成鋼 鋼鐵工業 L 48.3
2207 和泰車 汽車工業 L 560
2105 正新 橡膠工業 L 36.8
1402 遠東新 紡織纖維 L 29.5
1476 儒鴻 紡織纖維 L 452
1477 聚陽 紡織纖維 L 268
9910 豐泰 其他業 L 98
2912 統一超 貿易百貨 L 258
9904 寶成 其他業 L 34.2
6446 藥華藥 生技醫療業 O 612
4743 合一 生技醫療業 O 72
1795 美時 生技醫療業 L 268
2542 興富發 建材營造 L 46.5
2501 國建 建材營造 L 22.1
6409 旭隼 電機機械 L 820
`);
// 研究族群（使用者自訂的族群）
const groups = [
  { id: 'ai', name: 'AI 伺服器', ids: ['2382', '3231', '2356', '6669', '2317', '2376', '2357'] },
  { id: 'semi', name: '晶圓代工與 IC 設計', ids: ['2330', '2454', '2303', '3034', '2379', '3443', '3661', '6415'] },
  { id: 'cool', name: '散熱', ids: ['3017', '3324', '2421', '3653'] },
  { id: 'pcb', name: 'PCB 與載板', ids: ['3037', '8046', '2368', '3189', '3044', '6274', '4958'] },
  { id: 'power', name: '重電與電網', ids: ['1519', '1503', '1513', '1514', '1605'] },
  { id: 'net', name: '網通', ids: ['2345', '5388', '3596'] },
  { id: 'ship', name: '航運', ids: ['2603', '2609', '2615', '2618'] },
  { id: 'fin', name: '金控', ids: ['2881', '2882', '2891', '2886', '2884'] },
];
// 當日主題：族群／產業的漲跌幅中心（%）
const theme = { cool: 4.2, ai: 2.6, pcb: 1.9, semi: 0.9, net: 1.2, power: -1.8, ship: -2.4, fin: 0.3 };
const sectorTheme = { '光電業': -0.6, '生技醫療業': 1.1, '建材營造': -0.4, '鋼鐵工業': -1.1, '塑膠工業': -0.8, '航運業': -2.0, '水泥工業': -0.3, '紡織纖維': 0.4, '食品工業': 0.1 };
const groupOf = new Map(); for (const g of groups) for (const id of g.ids) if (!groupOf.has(id)) groupOf.set(id, g.id);
const dayMove = new Map(universe.map(s => { const c = theme[groupOf.get(s.id)] ?? sectorTheme[s.sector] ?? 0.2; return [s.id, Math.max(-9.9, Math.min(9.95, c + gauss() * 1.6))]; }));
dayMove.set('3324', 9.95); dayMove.set('2421', 9.9); dayMove.set('3017', 6.8); dayMove.set('6669', 4.9); dayMove.set('2330', 1.04); dayMove.set('1519', -4.6); dayMove.set('2609', -5.2);

// 交易日：最近 300 個平日，最後一天 2026-10-16
const days = []; for (let d = Date.parse('2026-10-16T00:00:00Z'); days.length < 300; d -= 86400000) { const x = new Date(d), w = x.getUTCDay(); if (w && w < 6) days.unshift(x.toISOString().slice(0, 10)); }
const LAST = days.at(-1), PREV = days.at(-2);
const daily = new Map();
for (const s of universe) {
  // 從目標收盤往回推，讓最後收盤接近 base
  const trend = (groupOf.get(s.id) && ['ai', 'cool', 'pcb', 'semi', 'net'].includes(groupOf.get(s.id)) ? 0.0016 : groupOf.get(s.id) === 'ship' || groupOf.get(s.id) === 'power' ? -0.0006 : 0.0003) + gauss() * 0.0004;
  const vol = 0.012 + rnd() * 0.012, px = [s.base];
  for (let i = days.length - 2; i >= 0; i--) px.unshift(px[0] / Math.exp(trend + gauss() * vol));
  const lastClose = rp(px.at(-2) * (1 + dayMove.get(s.id) / 100)); px[px.length - 1] = lastClose;
  const avgLots = Math.max(300, Math.round((s.id === '2330' ? 4e10 : ['2317', '2454', '2382', '3231'].includes(s.id) ? 1.2e10 : 1e9 * (0.3 + rnd() * 3)) / (s.base * 1000)));
  const rows = []; let prev = rp(px[0] / (1 + gauss() * vol));
  for (let i = 0; i < days.length; i++) {
    const c = rp(px[i]), o = rp(prev * (1 + gauss() * vol * 0.4)), h = rp(Math.max(o, c) * (1 + rnd() * vol * 0.6)), l = rp(Math.min(o, c) * (1 - rnd() * vol * 0.6));
    const lots = Math.round(avgLots * (0.6 + rnd() * 0.8) * (i === days.length - 1 ? 1 + Math.abs(dayMove.get(s.id)) / 3 : 1));
    rows.push({ date: days[i], stock_id: s.id, open: o, max: h, min: l, close: c, spread: Math.round((c - prev) * 100) / 100, Trading_Volume: lots * 1000, Trading_money: Math.round(lots * 1000 * (o + c) / 2), Trading_turnover: Math.round(lots / 2) });
    prev = c;
  }
  daily.set(s.id, rows);
}
// 研究名單的個股資料：還原日 K、法人、營收、估值
const research = new Set(groups.flatMap(g => g.ids));
for (const id of research) {
  const s = universe.find(x => x.id === id), price = daily.get(id), adjusted = price.map(r => ({ ...r }));
  const g = groupOf.get(id), bias = (theme[g] ?? 0) / 4;
  const institutions = [];
  for (const r of price.slice(-130)) {
    const lots = r.Trading_Volume / 1000;
    for (const [name, k] of [['Foreign_Investor', 0.12], ['Investment_Trust', 0.04], ['Dealer_self', 0.02], ['Dealer_Hedging', 0.02]]) {
      const net = Math.round(lots * k * (bias + gauss() * 0.9) * 1000), base = Math.round(lots * k * 2 * 1000);
      institutions.push({ date: r.date, stock_id: id, name, buy: base + Math.max(0, net), sell: base + Math.max(0, -net) });
    }
  }
  const revenue = []; let rev = s.base * 4e6 * (0.5 + rnd());
  for (let m = 0; m < 26; m++) {
    const y = 2024 + Math.floor((m + 8) / 12), mo = (m + 8) % 12 + 1; rev *= 1 + (bias / 30) + gauss() * 0.05;
    const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
    revenue.push({ date: `${ny}-${String(nm).padStart(2, '0')}-10`, stock_id: id, country: 'Taiwan', revenue: Math.round(rev), revenue_month: mo, revenue_year: y, create_time: `${ny}-${String(nm).padStart(2, '0')}-10` });
  }
  const valuation = price.slice(-30).map(r => ({ date: r.date, stock_id: id, PER: Math.round((12 + rnd() * 25) * 100) / 100, PBR: Math.round((1.2 + rnd() * 6) * 100) / 100, dividend_yield: Math.round((0.8 + rnd() * 4) * 100) / 100 }));
  const checked = { price: LAST, adjusted: LAST, institutions: LAST, revenue: LAST, valuation: LAST };
  W(`stocks/${id}.json`, { price, adjusted, institutions, revenue, valuation, news: [], checked, errors: {} });
}
W('universe.json', universe.map(({ id, name, sector, market }) => ({ id, name, sector, market })));
W('groups.json', { version: 1, groups: groups.map(g => ({ id: g.id, name: g.name, stockIds: g.ids })), stockMetadata: [] });
W('watchlist.json', ['2330', '3017', '2382', '6669', '1519', '2345']);
W('watch-groups.json', { groups: [{ id: 'w1', name: '核心持股' }, { id: 'w2', name: '短線觀察' }], assign: { '2330': 'w1', '2382': 'w1', '3017': 'w2', '6669': 'w2', '1519': 'w2' } });

// 熱浪圖（10/15、10/16）
const rowsOn = date => universe.map(s => daily.get(s.id).find(r => r.date === date)).filter(Boolean);
for (const [d, p] of [[PREV, days.at(-3)], [LAST, PREV]]) W(`heatmap-${d}.json`, buildHeatmap(d, { universe, rows: rowsOn(d), previous: rowsOn(p), previousDate: p }));

// 時光機（10/16 每分鐘一格）：價格從昨收走到收盤，量呈 U 型
const ids = new Set(universe.map(s => s.id)), paths = new Map();
const MIN = 271; // 09:00–13:30
for (const s of universe) {
  const r = daily.get(s.id).at(-1), prev = daily.get(s.id).at(-2).close, pts = [];
  let x = 0; const w = [];
  for (let i = 0; i < MIN; i++) { x += gauss(); w.push(x); }
  for (let i = 0; i < MIN; i++) { const f = i / (MIN - 1), bridge = w[i] - f * w[MIN - 1]; pts.push(rp(prev + (r.close - prev) * Math.pow(f, 0.7) + bridge * prev * 0.0012)); }
  pts[MIN - 1] = r.close;
  const lots = r.Trading_Volume / 1000, shape = []; let acc = 0;
  for (let i = 0; i < MIN; i++) { acc += 1 + 3 * Math.exp(-i / 18) + 2 * Math.exp(-(MIN - 1 - i) / 6); shape.push(acc); }
  paths.set(s.id, { pts, cum: shape.map(v => v / acc * lots), prev });
}
fs.rmSync(path.join(DIR, 'replay'), { recursive: true, force: true });
for (let i = 0; i < MIN; i++) {
  const m = 540 + i, t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const rows = universe.map(s => { const p = paths.get(s.id), c = p.pts[i], v = Math.round(p.cum[i]); return { stock_id: s.id, date: `${LAST} ${t}:00`, close: c, change_price: Math.round((c - p.prev) * 100) / 100, total_volume: v, total_amount: Math.round(v * 1000 * c) }; });
  recordFrame(LAST, t, rows, ids);
}
W(`index-${LAST}.json`, { twse: { close: 23187.45, change: 182.36, pct: 0.79, amount: 4.21e11, time: '13:30' }, tpex: { close: 262.18, change: 1.85, pct: 0.71, amount: 1.12e11, time: '13:30' } });
W('demo-meta.json', { last: LAST, prev: PREV, moves: Object.fromEntries(dayMove) });
console.log('ok', universe.length, 'stocks', research.size, 'research', LAST);
