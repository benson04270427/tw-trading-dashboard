// AI 盤後日報：彙整當日資金板塊、雷達異動、自選股、型態訊號、焦點新聞（台股另含法人籌碼），交給使用者選擇的推理模型寫成結構化日報。
// 提示詞與欄位說明依介面語言（繁中／英文）與市場調整；資料欄位名稱也依語言翻譯。
import { generateJSON } from './llm.mjs';
import { t } from './i18n.mjs';

export const REPORT_DEFAULTS = { auto: true, time: '16:30' };
export function normalizeReportSettings(r = {}) {
  return { auto: r.auto !== false, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : REPORT_DEFAULTS.time };
}

const zh = lang => lang === 'zh-TW';
export function reportSchema(lang = 'zh-TW') {
  const d = zh(lang)
    ? { card: '9:16 摘要圖卡用的精簡重點', hi: '今日盤勢重點 6–8 則，每則 40 字內，含關鍵數字', watch: '下一個交易日觀盤重點 6–8 則，每則 28 字內，具體到價位、部位或板塊', headline: '一句話標題，30 字內', summary: '盤勢總結，2–4 句', notes: '自選股逐檔短評：資料中每一檔自選股各一則（依資料順序），note 40–70 字，說明今天的走勢、量能、籌碼（大戶、追蹤分點）與觸發的提醒；stance 只能是 偏多／中性／偏空，代表資料呈現的技術與籌碼狀態，不是買賣建議' }
    : { card: 'Condensed points for a 9:16 summary card', hi: '6–8 key points of the session, each under 18 words, with the key numbers', watch: '6–8 things to watch next session, each under 12 words, concrete (levels, positions, sectors)', headline: 'One-line headline, under 14 words', summary: 'Market summary in 2–4 sentences', notes: 'One short note per watchlist stock in the data (same order), 20–40 words: today\'s move, volume, chips (big holders, tracked broker branches) and any alerts it triggered. stance is one of the enum values: the first means constructive, the second neutral, the third weak; it describes the state shown by the data, not a trade recommendation' };
  return {
    type: 'object', additionalProperties: false,
    required: ['headline', 'summary', 'sections', 'watchlist', 'notes', 'tomorrow', 'risks', 'card'],
    properties: {
      card: { type: 'object', additionalProperties: false, required: ['highlights', 'watch'], description: d.card, properties: { highlights: { type: 'array', items: { type: 'string' }, description: d.hi }, watch: { type: 'array', items: { type: 'string' }, description: d.watch } } },
      headline: { type: 'string', description: d.headline },
      summary: { type: 'string', description: d.summary },
      sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'points'], properties: { title: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } } } },
      watchlist: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'note'], properties: { id: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' } } } },
      notes: { type: 'array', description: d.notes, items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'stance', 'note'], properties: { id: { type: 'string' }, name: { type: 'string' }, stance: { type: 'string', enum: ['偏多', '中性', '偏空'] }, note: { type: 'string' } } } },
      tomorrow: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
  };
}
export function reportSystem(lang = 'zh-TW', marketName = '台灣股市', hasFlows = false) {
  if (zh(lang)) return `你是${marketName}的盤後研究助理，替一位個人投資者撰寫當日盤後日報，使用繁體中文。

資料來源是使用者本機系統當天彙整的 JSON：全市場資金板塊（成交金額與漲跌）${hasFlows ? '、三大法人與期貨選擇權部位' : ''}、盤中異動雷達紀錄（含使用者自訂的價位提醒）、自選股與研究名單表現、型態訊號、籌碼追蹤（使用者追蹤的券商分點進出、千張大戶持股週變化，有資料時才有）、焦點新聞與本周行事曆。籌碼資料可能是前一個交易日或上週的，請依其中標示的日期描述。只根據這些資料撰寫；資料缺漏時直接說明缺什麼，不要推測數字。

寫作方式：
- sections 依序涵蓋「大盤與資金板塊」${hasFlows ? '「法人與期權籌碼」' : ''}「盤中異動回顧」「型態與題材」，沒有資料的段落可省略；每段 2–5 個重點，重點要有具體數字與比較。
- watchlist 只挑今天真正值得注意的自選或研究股（最多 6 檔），note 說明原因。
- notes 是自選股逐檔短評，資料中每一檔自選股都要有一則（最多 30 檔），沒有當日報價的就說明缺資料。
- tomorrow 列出下一個交易日開盤前後該留意的事件或價位；risks 列出今天資料透露的風險。
- card 是要印在手機圖卡上的摘要：highlights 每則一句話講完一個數據重點，watch 每則是下一個交易日要盯的一件事；兩者都要短，不寫完整句的鋪陳。
- 這是研究紀錄，不給買賣建議、目標價或報酬保證。`;
  return `You are a post-market research assistant for the ${marketName} stock market, writing today's end-of-day report for an individual investor, in English.

The data is JSON compiled today by the user's local system: market-wide turnover and moves by sector${hasFlows ? ', institutional and derivatives positioning' : ''}, the intraday alert log (including the user's own price alerts), watchlist and research-list performance, chart-pattern signals, chip tracking when available (trades of broker branches the user tracks, weekly change in 1,000-lot holders; these may be from the previous session or last week, so use the dates given), top news and this week's calendar. Write only from this data; when something is missing, say what is missing instead of guessing numbers.

How to write:
- sections cover, in order, "Market and sectors"${hasFlows ? ', "Institutional flows and derivatives"' : ''}, "Intraday alerts", "Patterns and themes"; omit sections with no data. Give 2–5 points per section, each with concrete numbers and comparisons.
- watchlist: only the watchlist or research stocks that truly deserve attention today (at most 6), with the reason in note.
- notes: one entry for every watchlist stock in the data (at most 30); if a stock has no quote today, say the data is missing.
- tomorrow: events or price levels to watch around the next open; risks: risks visible in today's data.
- card is printed on a phone-sized summary card: each highlight states one data point in one short line, each watch item is one thing to monitor next session. Keep both terse.
- This is a research record: no buy/sell advice, price targets or return promises.`;
}

// 給模型的當日資料：欄位名稱依語言翻譯；成交金額以「億」（1e8）為單位
export function buildReportContext({ date, heat, flows, alerts, watch, movers, patterns, news, agenda, chips = null }, lang) {
  const k = s => t(s, null, lang);
  const top = heat?.sectors?.slice(0, 12).map(s => ({ [k('板塊')]: s.name, [k('成交億')]: Math.round(s.money / 1e8), [k('占比')]: s.share, [k('漲跌')]: s.change, [k('漲跌家數')]: `${s.up}/${s.down}`, ...(s.limitUp != null ? { [k('漲停')]: s.limitUp } : {}), [k('較前日量能')]: s.moneyChange }));
  return {
    [k('日期')]: date,
    [k('大盤')]: heat ? { [k('成交金額億')]: Math.round(heat.total.money / 1e8), [k('加權漲跌')]: heat.total.change, [k('上漲')]: heat.total.up, [k('下跌')]: heat.total.down, [k('漲停')]: heat.total.limitUp, [k('跌停')]: heat.total.limitDown, [k('較前日量能')]: heat.total.moneyChange, [k('資料')]: k(heat.live ? '盤中最後快照' : '收盤日資料') } : null,
    [k('資金板塊')]: top || null,
    [k('法人')]: flows ? { [k('日期')]: flows.date, [k('現貨')]: flows.summary, [k('外資台指期')]: flows.futures, [k('選擇權')]: flows.options?.positions } : null,
    [k('盤中異動')]: alerts.slice(-60).map(a => `${a.t} ${a.stockId} ${a.name} ${a.title} ${a.detail}`),
    [k('自選股')]: watch,
    [k('研究名單漲跌')]: movers,
    [k('型態訊號')]: patterns,
    [k('籌碼追蹤')]: chips,
    [k('焦點新聞')]: news,
    [k('本周行事曆')]: agenda,
  };
}

// llm = { provider, key, model, baseUrl, effort }
export async function generateReport({ llm, context, lang = 'zh-TW', marketName = '台灣股市', hasFlows = false }) {
  const r = await generateJSON({ ...llm, system: reportSystem(lang, marketName, hasFlows), prompt: `${zh(lang) ? '以下是今天的資料（JSON）：' : "Today's data (JSON):"}\n${JSON.stringify(context)}`, schema: reportSchema(lang) });
  const d = r.data || {};
  const arr = v => Array.isArray(v) ? v : [];
  const report = { headline: String(d.headline || ''), summary: String(d.summary || ''), sections: arr(d.sections).filter(s => s?.title).map(s => ({ title: String(s.title), points: arr(s.points).map(String) })), watchlist: arr(d.watchlist).filter(w => w?.id).map(w => ({ id: String(w.id), name: String(w.name || ''), note: String(w.note || '') })), notes: arr(d.notes).filter(w => w?.id).slice(0, 30).map(w => ({ id: String(w.id), name: String(w.name || ''), stance: ['偏多', '中性', '偏空'].includes(w.stance) ? w.stance : '', note: String(w.note || '') })), tomorrow: arr(d.tomorrow).map(String), risks: arr(d.risks).map(String), card: { highlights: arr(d.card?.highlights).map(String), watch: arr(d.card?.watch).map(String) } };
  if (!report.headline) throw new Error('empty report');
  return { report, model: r.model, usage: r.usage };
}
