# 衡析 EquiLens：開發規則

給在這個 repo 工作的 AI 助理（Claude Code、Codex 等）與開發者。

## 說明文件（每次變更都要做）

使用者的要求：**每次有新版本就重寫說明文件，每項功能都有自己的說明文件。** 任何會改變功能、畫面、預設值、排程或資料來源的變更，在同一個提交（或同一個分支）內完成以下事項：

1. **功能說明**：更新 `docs/features/` 中受影響的文件。新增功能時新增一份文件，並加入 `docs/features/README.md` 的索引；移除功能時刪除文件與索引。
2. **主說明**：更新 `README.zh-TW.md` 受影響的段落（「一天的流程」表格、功能、手機版、資料來源、設定與資料位置、常見問題）；變動大時整份重寫。同步更新 `README.md`（英文）、`EquiLens-Nexus/README.md`、`EquiLens-Pocket/README.md` 與 `docs/ARCHITECTURE.md` 中受影響的部分。
3. **版本紀錄**：在 `docs/CHANGELOG.zh-TW.md` 最上面新增一節（日期＋標題＋變更重點，連到對應的功能說明）。
4. **以程式為準**：文件中的門檻、預設值、時間、請求量、檔案路徑都要與程式碼一致；不確定時先讀程式再寫。
5. 當沖監控的完整說明維持在 `docs/DAYTRADE.zh-TW.md`，功能索引連到該文件。

功能說明的格式：標題、一段用途說明，接著依需要使用「在哪裡」「怎麼用／內容」「運作方式」「設定」「資料來源與請求量」「注意事項」「相關檔案」等小節。使用繁體中文，表格用來列條件與數字。

`EquiLens-Nexus/tests/docs.test.mjs` 會檢查：每份功能說明都在索引中、索引與說明中的相對連結都存在、主說明連到功能索引與版本紀錄。

## 程式

- 沒有建置步驟：Node 22 以上的 ES 模組，前端為原生 JavaScript。架構與擴充方式見 `docs/ARCHITECTURE.md`。
- 介面文字以繁體中文為 key，英文翻譯在 `EquiLens-Nexus/public/locales/en.json`；新增字串後執行 `node EquiLens-Nexus/tools/i18n-keys.mjs --missing en` 直到 0。
- `insight-ui.js`、`i18n.js`、`market.js`、`report-card.js`、`flow-cards.js`、`save-image.js` 在 Nexus 與 Pocket 各有一份，必須完全相同。
- 測試：`cd EquiLens-Nexus && npm test`、`cd EquiLens-Pocket && npm test`。「Windows credential encryption」測試只能在 Windows 執行。
- `.local/` 存放金鑰與個人資料，絕不提交。
