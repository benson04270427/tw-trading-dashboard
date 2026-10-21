// 截圖用示意資料：風控水位（合成一年份的指標）與低估選股（合成全市場本益比、月營收與收盤）。不連外。
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, write } from '../../lib/storage.mjs';
import { buildRisk } from '../../lib/riskgauge.mjs';
import { mergeInputs } from '../../lib/valuescreen.mjs';

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const days = [], end = Date.parse('2026-10-16T00:00:00Z'); for (let d = end - 420 * 864e5; d <= end; d += 864e5) { const w = new Date(d).getUTCDay(); if (w > 0 && w < 6) days.push(new Date(d).toISOString().slice(0, 10)); }
const raw = { index: [], mtxInst: [], mtxDaily: [], txInst: [], spot: [], margin: [], fx: [], errors: {} };
let ix = 21000, marg = 3.1e11, fx = 31.2;
days.forEach((d, i) => {
  const late = i > days.length - 25;
  ix *= 1 + (rnd() - 0.47) * 0.018 - (late ? 0.004 : 0); marg *= 1 + (rnd() - 0.48) * 0.01 + (late ? 0.004 : 0); fx *= 1 + (rnd() - 0.5) * 0.004 + (late ? 0.0012 : 0);
  raw.index.push({ date: d, close: Math.round(ix * 100) / 100 });
  const inst = Math.round((rnd() - 0.5) * 12000 - (late ? 9000 : 0));
  raw.mtxInst.push({ date: d, institutional_investors: '外資', long_open_interest_balance_volume: Math.max(0, inst) + 3000, short_open_interest_balance_volume: Math.max(0, -inst) + 3000 });
  raw.mtxDaily.push({ date: d, trading_session: 'position', contract_date: '202611', close: ix, open_interest: 55000 + Math.round(rnd() * 10000) });
  raw.txInst.push({ date: d, institutional_investors: '外資', long_open_interest_balance_volume: 18000, short_open_interest_balance_volume: Math.round(48000 + (rnd() - 0.5) * 30000 + (late ? 35000 : 0)) });
  raw.spot.push({ date: d, name: 'Foreign_Investor', buy: 3e10, sell: 3e10 + (rnd() - 0.5) * 3e10 + (late ? 1.2e10 : 0) });
  raw.margin.push({ date: d, name: 'MarginPurchaseMoney', TodayBalance: Math.round(marg), YesBalance: Math.round(marg) });
  raw.fx.push({ date: d, currency: 'USD', spot_buy: Math.round(fx * 1000) / 1000 });
});
fs.mkdirSync(path.join(LOCAL, 'risk'), { recursive: true });
const risk = buildRisk(raw, { now: '2026-10-16T21:40:00+08:00' });
write('risk/latest.json', risk);
write('risk/explain.json', { date: risk.date, risk: risk.risk, createdAt: '2026-10-16T21:45:00+08:00', model: 'claude-opus-5-5（示意）', headline: '外資期現貨同步轉弱，散戶反而加碼，短線風險升溫', points: ['外資台指期淨空單升至一年高檔，現貨 20 日累計賣超，兩者方向一致。', '小台散戶多空比偏多、融資 20 日增加，散戶與外資站在對立面。', '新台幣近一個月走貶，與外資賣超互相印證，資金面偏緊。', '指數仍在 60 日線附近，趨勢尚未完全轉空，屬於高檔震盪。'], watch: ['外資期貨空單是否回補', '融資餘額能否降溫', '新台幣是否止貶'], stance: '持股水位可往建議區間下緣調整，保留現金等待外資空單回補或散戶籌碼降溫後再加碼。' });

const names = { 半導體業: ['晶達', '宏芯', '聯穎', '昇陽微', '科峰', '矽源', '旺晶', '台晶科', '銓訊', '凱創'], 電子零組件業: ['華聯', '富鼎', '佳能電', '台捷', '泰銘', '耀科', '新能', '和碩元', '立德'], 航運業: ['長航', '陽海', '萬通', '裕航', '台驊海', '新興航'], 金融保險業: ['國安金', '富邦信', '玉成金', '中興銀', '台新保', '永安金', '兆信金'], 食品工業: ['統聯', '大成食', '卜蜂科', '佳格食', '聯華實'], 電腦及週邊設備業: ['廣明', '英研', '緯成', '技創', '仁寶科', '神準', '迎銳'] };
const universe = [], valTw = [], revTw = [], priceTw = []; let n = 1100;
for (const [sector, list] of Object.entries(names)) for (const name of list) {
  const id = String(n += 37); universe.push({ id, name, sector, market: rnd() > 0.3 ? '上市' : '上櫃' });
  const pe = 6 + rnd() * 26, pb = 0.7 + rnd() * 3.2, yld = 1 + rnd() * 7, growth = (rnd() - 0.35) * 60;
  valTw.push({ Code: id, PEratio: pe.toFixed(2), PBratio: pb.toFixed(2), DividendYield: yld.toFixed(2), Date: '1151016' });
  revTw.push({ 公司代號: id, 資料年月: '11509', '營業收入-當月營收': String(Math.round(1e6 * (1 + growth / 100))), '營業收入-去年當月營收': '1000000', '累計營業收入-當月累計營收': String(Math.round(9e6 * (1 + growth * 0.8 / 100))), '累計營業收入-去年累計營收': '9000000' });
  priceTw.push({ Code: id, ClosingPrice: (20 + rnd() * 300).toFixed(2), TradeValue: String(Math.round(5e6 + rnd() * 3e9)) });
}
fs.mkdirSync(path.join(LOCAL, 'value'), { recursive: true });
write('value/inputs.json', { at: '2026-10-16T18:45:00+08:00', valDate: '2026-10-16', revMonth: '2026-09', errors: {}, rows: mergeInputs({ universe, valTw, valTp: [], revTw, revTp: [], priceTw, priceTp: [] }) });
console.log('risk', risk.risk, risk.label, risk.exposure + '%', 'value rows', universe.length);
