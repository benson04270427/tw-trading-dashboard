# 法人／期貨籌碼

查詢指定日期的三大法人現貨流向、外資台指期與選擇權部位，以及上市、上櫃個股的法人買賣超排行，並可產生分享用的圖卡。

## 在哪裡

- 電腦版：左側選單「法人／期貨籌碼」。
- 手機版：「籌碼」分頁 →「法人」。
- 只在台股並啟用 FinMind 時顯示。

## 內容

| 區塊 | 內容 |
|---|---|
| 三大法人買賣超 | 合計、外資及陸資、投信、自營商（億元） |
| 外資期權部位 | 台指期淨未平倉與增減（和前一個有資料的交易日比較）、多單／空單；選擇權買權、賣權淨額與增減 |
| 選擇權未平倉分布 | 各履約價的買權、賣權未平倉量，標出買權、賣權最大未平倉的履約價；可切換到期月份 |
| 個股買賣超排行 | 上市／上櫃 × 三大法人合計／外資／投信／自營商 × 買超／賣超（普通股，排除 ETF 與權證；單位：張） |
| 分享圖卡 | 白底 9:16 圖卡，可左右滑動、下載 |

## 查詢方式

- 選日期後按「查詢 FinMind」（2018-06-05 之後）；只有按下查詢才會發出請求。
- 資料完整的日期會保存，之後按「紀錄」即可直接開啟，不再請求。
- AI 盤後日報產生時，如果當天還沒有紀錄會自動查一次。

## 資料來源

FinMind：`TaiwanStockTotalInstitutionalInvestors`、`TaiwanStockInstitutionalInvestorsBuySell`、`TaiwanFuturesInstitutionalInvestors`、`TaiwanOptionInstitutionalInvestors`、`TaiwanOptionDaily`、`TaiwanStockInfo`。一次查詢約需 1 分鐘（依請求間隔設定）。

## 注意事項

- 期貨淨未平倉的增減和「前一個有資料的交易日」比較，不會把缺資料的日子當成 0。
- 部分資料未取得時會標示缺少哪些項目，該日不保存，下次可重新查詢。

## 相關檔案

`EquiLens-Nexus/lib/flows.mjs`、`lib/options.mjs`、`public/flow-cards.js`；紀錄 `.local/flows-<日期>.json`。
