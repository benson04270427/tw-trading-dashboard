// AI 盤後日報：彙整當日資金板塊、雷達異動、自選股、型態訊號、焦點新聞（台股另含法人籌碼），交給使用者選擇的推理模型寫成結構化日報。
// 提示詞與欄位說明依介面語言（繁中／英文）與市場調整；資料欄位名稱也依語言翻譯。
import { generateJSON } from './llm.mjs';
import { t } from './i18n.mjs';
import { localParts, closeHM } from './markets.mjs';

export const REPORT_DEFAULTS = { auto: true, time: '16:30' };
export function normalizeReportSettings(r = {}) {
  return { auto: r.auto !== false, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : REPORT_DEFAULTS.time };
}

const zh = lang => lang === 'zh-TW';
export function reportSchema(lang = 'zh-TW') {
  const d = zh(lang)
    ? { card: '9:16 摘要圖卡用的精簡重點', hi: '今日盤勢重點 6–8 則，每則 40 字內，含關鍵數字', watch: '下一個交易日的總體觀察 5–7 則，每則 28 字內：大盤量價、法人與期權部位、資金面、今晚美國數據與財報；不寫個股走勢', tomorrow: '明日觀察 4–6 則，以專業投資顧問的角度分析整體市場，依系統提示的格式與禁止事項撰寫', risks: '總體風險 2–4 則：大盤結構、籌碼、資金面或國際事件的風險，不寫個股', headline: '一句話標題，30 字內', summary: '盤勢總結，2–4 句', notes: '自選股逐檔短評：資料中每一檔自選股各一則（依資料順序），note 40–70 字，說明今天的走勢、量能、籌碼（大戶、追蹤分點）與觸發的提醒；stance 只能是 偏多／中性／偏空，代表資料呈現的技術與籌碼狀態，不是買賣建議' }
    : { card: 'Condensed points for a 9:16 summary card', hi: '6–8 key points of the session, each under 18 words, with the key numbers', watch: '5–7 market-level things to watch next session, each under 12 words: index volume and breadth, institutional and derivatives positioning, leverage, tonight\'s US data and earnings; no single-stock calls', tomorrow: '4–6 next-session outlook points written as a professional investment adviser about the whole market, following the format and prohibitions in the system prompt', risks: '2–4 market-level risks (structure, positioning, leverage or overseas events); no single-stock calls', headline: 'One-line headline, under 14 words', summary: 'Market summary in 2–4 sentences', notes: 'One short note per watchlist stock in the data (same order), 20–40 words: today\'s move, volume, chips (big holders, tracked broker branches) and any alerts it triggered. stance is one of the enum values: the first means constructive, the second neutral, the third weak; it describes the state shown by the data, not a trade recommendation' };
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
      tomorrow: { type: 'array', items: { type: 'string' }, description: d.tomorrow },
      risks: { type: 'array', items: { type: 'string' }, description: d.risks },
    },
  };
}
export function reportSystem(lang = 'zh-TW', marketName = '台灣股市', hasFlows = false) {
  if (zh(lang)) return `你是${marketName}的盤後研究助理，替一位個人投資者撰寫當日盤後日報，使用繁體中文。

資料來源是使用者本機系統當天彙整的 JSON：全市場資金板塊（成交金額與漲跌）${hasFlows ? '、三大法人與期貨選擇權部位' : ''}、加權與櫃買指數、期貨近月、融資券、散戶小台／微台多空、盤中異動雷達紀錄（含使用者自訂的價位提醒）、自選股與研究名單表現、型態訊號、籌碼追蹤（使用者追蹤的券商分點進出、千張大戶持股週變化，有資料時才有）、焦點新聞、今晚到明日（台灣時間）的國際經濟數據與美股財報，以及本周行事曆。籌碼追蹤資料可能是前一個交易日或上週的，請依其中標示的日期描述。只根據這些資料撰寫；資料缺漏時直接說明缺什麼，不要推測數字。

寫作方式：
- sections 依序涵蓋「大盤與資金板塊」${hasFlows ? '「法人與期權籌碼」' : ''}「盤中異動回顧」「型態與題材」，沒有資料的段落可省略；每段 2–5 個重點，重點要有具體數字與比較。
- watchlist 只挑今天真正值得注意的自選或研究股（最多 6 檔），note 說明原因。
- notes 是自選股逐檔短評，資料中每一檔自選股都要有一則（最多 30 檔），沒有當日報價的就說明缺資料。
- tomorrow（明日觀察）以專業投資顧問的角度，替投資人整理下一個交易日該注意的整體市場面向，4–6 則，每則 60–110 字：
  - 每則以【大盤】【法人籌碼】【期權】【資金面】【國際】【行事曆】其中一個標籤開頭，依重要性排序。
  - 【大盤】指數漲跌、成交量能較前日的變化、漲跌家數與資金集中的板塊，判斷多方氣勢是延續、鈍化還是轉弱。
  - 【法人籌碼】三大法人現貨買賣超的方向與規模，外資是連續買超還是轉賣，與指數走勢是否背離。
  - 【期權】外資台指期淨未平倉與增減、選擇權買權／賣權部位與 P/C 比、散戶小台與微台多空比，說明籌碼偏多或偏空、是否有避險或反向訊號。
  - 【資金面】融資餘額增減代表的槓桿變化、融券變化。
  - 【國際】依「今晚與明日」資料列出今晚美國公布的重要經濟數據（附預估值與前值，說明優於或差於預期可能對美股、利率、匯率與台股開盤的影響），以及今晚重要財報（尤其是與台股供應鏈相關的公司）；沒有資料時寫明今晚無重大數據。
  - 【行事曆】明日盤中公布的數據、休市或其他已知事件。
  - 每則要引用具體數字，寫出「為什麼重要」以及「若…則…」的情境判斷，讓投資人知道明天開盤前該看什麼、看到什麼代表什麼。
  - 不寫個股：不要預測個股明天的走勢（例如某檔跌停股明天會不會打開、某檔能否站上某價位、某檔是否續強）。個股只在影響大盤的權值股或美股財報公司時提及，且要說明對大盤或族群的意義。
- risks 列出 2–4 個總體層面的風險（大盤結構、籌碼、資金面、國際事件），同樣不寫個股。
- card 是要印在手機圖卡上的摘要：highlights 每則一句話講完一個數據重點；watch 每則是下一個交易日要盯的一件總體事件或數據（大盤、法人、期權、資金面、國際），不寫個股；兩者都要短，不寫完整句的鋪陳。
- 這是研究紀錄，不給買賣建議、目標價或報酬保證。`;
  return `You are a post-market research assistant for the ${marketName} stock market, writing today's end-of-day report for an individual investor, in English.

The data is JSON compiled today by the user's local system: market-wide turnover and moves by sector${hasFlows ? ', institutional and derivatives positioning' : ''}, the intraday alert log (including the user's own price alerts), watchlist and research-list performance, chart-pattern signals, the TAIEX and OTC indices, near-month futures, margin balances, retail mini/micro futures positioning, chip tracking when available (trades of broker branches the user tracks, weekly change in 1,000-lot holders; these may be from the previous session or last week, so use the dates given), top news, overseas economic data and US earnings from tonight to tomorrow (Taiwan time), and this week's calendar. Write only from this data; when something is missing, say what is missing instead of guessing numbers.

How to write:
- sections cover, in order, "Market and sectors"${hasFlows ? ', "Institutional flows and derivatives"' : ''}, "Intraday alerts", "Patterns and themes"; omit sections with no data. Give 2–5 points per section, each with concrete numbers and comparisons.
- watchlist: only the watchlist or research stocks that truly deserve attention today (at most 6), with the reason in note.
- notes: one entry for every watchlist stock in the data (at most 30); if a stock has no quote today, say the data is missing.
- tomorrow (next-session outlook): write as a professional investment adviser about the whole market, 4–6 points of 40–70 words each:
  - Start each point with one tag: [Market], [Institutions], [Derivatives], [Leverage], [Overseas] or [Calendar], ordered by importance.
  - [Market]: index move, turnover vs the prior day, breadth and where money concentrated; is momentum extending, stalling or fading?
  - [Institutions]: direction and size of the three institutional groups' net buying; is foreign buying continuing or reversing, and does it diverge from the index?
  - [Derivatives]: foreign net open interest in TAIEX futures and its change, option call/put positions and the put/call ratio, retail mini/micro futures positioning; what bias or hedging do they show?
  - [Leverage]: change in margin balances and short sales.
  - [Overseas]: from the "tonight and tomorrow" data, the US economic releases tonight (with forecast and previous, and what a beat or miss would mean for US stocks, rates, the currency and the Taiwan open) and tonight's important earnings (especially Taiwan supply-chain names); say so if there is nothing major tonight.
  - [Calendar]: data due during tomorrow's session, holidays or other known events.
  - Quote concrete numbers, explain why each matters and give if-then scenarios so the investor knows what to check before the open.
  - No single-stock calls: never predict a stock's next-day move (for example whether a limit-down stock will reopen, whether a stock can hold a price level). Mention individual names only as index heavyweights or US earnings reporters, and only for their meaning to the market or a sector.
- risks: 2–4 market-level risks (structure, positioning, leverage, overseas events), again no single-stock calls.
- card is printed on a phone-sized summary card: each highlight states one data point in one short line; each watch item is one market-level event or figure to monitor next session (market, institutions, derivatives, leverage, overseas), never a single stock. Keep both terse.
- This is a research record: no buy/sell advice, price targets or return promises.`;
}

// 給模型的當日資料：欄位名稱依語言翻譯；成交金額以「億」（1e8）為單位
export function buildReportContext({ date, heat, flows, market = null, outlook = null, alerts, watch, movers, patterns, news, agenda, chips = null }, lang) {
  const k = s => t(s, null, lang);
  const top = heat?.sectors?.slice(0, 12).map(s => ({ [k('板塊')]: s.name, [k('成交億')]: Math.round(s.money / 1e8), [k('占比')]: s.share, [k('漲跌')]: s.change, [k('漲跌家數')]: `${s.up}/${s.down}`, ...(s.limitUp != null ? { [k('漲停')]: s.limitUp } : {}), [k('較前日量能')]: s.moneyChange }));
  return {
    [k('日期')]: date,
    [k('大盤')]: heat ? { [k('成交金額億')]: Math.round(heat.total.money / 1e8), [k('成交加權漲跌')]: heat.total.change, [k('上漲')]: heat.total.up, [k('下跌')]: heat.total.down, [k('漲停')]: heat.total.limitUp, [k('跌停')]: heat.total.limitDown, [k('較前日量能')]: heat.total.moneyChange, [k('資料')]: k(heat.live ? '盤中最後快照' : '收盤日資料') } : null,
    [k('資金板塊')]: top || null,
    [k('法人')]: flows ? { [k('日期')]: flows.date, [k('現貨')]: flows.summary, [k('外資台指期')]: flows.futures, [k('選擇權')]: flows.options?.positions } : null,
    [k('盤中異動')]: alerts.slice(-60).map(a => `${a.t} ${a.stockId} ${a.name} ${a.title} ${a.detail}`),
    [k('自選股')]: watch,
    [k('研究名單漲跌')]: movers,
    [k('型態訊號')]: patterns,
    [k('籌碼追蹤')]: chips,
    [k('指數與期貨籌碼')]: marketContext(market, k),
    [k('今晚與明日（台灣時間）')]: outlook ? { [k('今晚至明晨經濟數據')]: outlook.tonight, [k('今晚美股財報')]: outlook.earnings, [k('明日盤中數據')]: outlook.intraday, [k('休市')]: outlook.holidays } : null,
    [k('焦點新聞')]: news,
    [k('本周行事曆')]: agenda,
  };
}

// 「明日觀察」用的行事曆：今晚收盤後到明日開盤前（市場當地時間）的國際經濟數據、今晚的美股財報、明日盤中公布的數據與休市。
// week：weekAgenda() 的結果（macro 每筆有 time 毫秒；美股財報以美國日期標示，同一天的盤前與盤後公布都落在台灣今晚到明晨）
export function overnightOutlook(date, week, { market, lang } = {}) {
  const k = s => t(s, null, lang), next = new Date(Date.parse(date) + 864e5).toISOString().slice(0, 10);
  const open = market.sessions?.[0]?.[0] || '09:00', close = closeHM(market), at = e => localParts(market, new Date(e.time));
  const line = e => { const x = at(e); return `${x.date === date ? k('今晚') : k('明日')} ${x.hm} ${e.countryName} ${e.title}${e.forecast ? ` · ${k('預估')} ${e.forecast}` : ''}${e.previous ? ` · ${k('前值')} ${e.previous}` : ''}${e.impact === 'High' ? ` · ${k('高影響')}` : ''}`; };
  const macro = (week?.macro || []).filter(e => !e.holiday);
  const tonight = macro.filter(e => { const x = at(e); return (x.date === date && x.hm >= close) || (x.date === next && x.hm < open); });
  const intraday = macro.filter(e => { const x = at(e); return x.date === next && x.hm >= open && x.hm <= close; });
  return {
    tonight: tonight.slice(0, 15).map(line),
    earnings: (week?.earnings || []).filter(e => e.date === date).slice(0, 15).map(e => `${(lang === 'zh-TW' && e.zh) || e.name}(${e.symbol}) ${e.timing}${e.eps ? ` · EPS ${k('預估')} ${e.eps}` : ''}`),
    intraday: intraday.slice(0, 10).map(line),
    holidays: (week?.macro || []).filter(e => e.holiday && e.date >= date && e.date <= next).map(e => `${e.date} ${e.countryName} ${k(e.title)}`),
  };
}

// 圖卡數據（assembleCard）→ 給模型的大盤數據：指數、期貨近月、法人（億元）、外資期權、選擇權 P/C、散戶多空、融資券
function marketContext(m, k) {
  if (!m) return null;
  const ix = x => x ? { [k('收盤')]: x.close, [k('漲跌')]: x.change, [k('漲跌幅')]: x.pct, [k('成交金額億')]: x.amount ? Math.round(x.amount / 1e8) : null } : null;
  const rt = x => x ? { [k('散戶淨口數')]: x.net, [k('較前日')]: x.change, [k('多空比')]: x.ratio } : null;
  const out = {
    [k('加權指數')]: ix(m.index?.twse), [k('櫃買指數')]: ix(m.index?.tpex),
    [k('期貨近月')]: m.futures?.length ? m.futures.map(f => `${f.name} ${f.close} (${f.change > 0 ? '+' : ''}${f.change}, ${f.pct}%)`) : null,
    [k('三大法人億')]: m.institutions ? { [k('外資')]: m.institutions.foreign, [k('投信')]: m.institutions.trust, [k('自營商')]: m.institutions.dealer, [k('合計')]: m.institutions.total } : null,
    [k('外資期權口數')]: m.futuresFlow ? { [k('台指期淨未平倉')]: m.futuresFlow.net, [k('淨未平倉增減')]: m.futuresFlow.netChange, [k('買權淨額')]: m.futuresFlow.callNet, [k('賣權淨額')]: m.futuresFlow.putNet } : null,
    [k('選擇權未平倉 P/C（%）')]: m.pcr,
    [k('散戶小台')]: rt(m.retail?.mini), [k('散戶微台')]: rt(m.retail?.micro),
    [k('融資券')]: m.margin ? { [k('日期')]: m.margin.date, [k('融資餘額億')]: m.margin.marginMoney, [k('融資增減億')]: m.margin.marginChange, [k('融券張')]: m.margin.shortLots, [k('融券增減')]: m.margin.shortChange } : null,
  };
  return Object.values(out).some(v => v != null) ? out : null;
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
