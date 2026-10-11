# 衡析 EquiLens

**架在自己電腦上的股市研究戰情室。** 衡析在你的電腦上執行：替你挑選的研究族群評分排序、呈現資金流向、盤中監控異動、
辨識技術型態，並用你選擇的 AI 模型撰寫盤後日報。資料來源與 API 金鑰由你自己準備，資料不會送到其他地方。

[English](README.md) · [架構說明（英文）](docs/ARCHITECTURE.md)

> 衡析是研究工具。分數用來排序研究對象，不是買賣訊號、目標價或報酬預測，也不構成投資建議。

---

## 組成

| 元件 | 說明 | 預設網址 |
|---|---|---|
| **衡析 Nexus**（`EquiLens-Nexus/`） | 電腦版，也是唯一的資料引擎：研究評分、資金熱浪、盤中雷達、型態選股、AI 日報、設定 | http://127.0.0.1:4330 |
| **衡析 Pocket**（`EquiLens-Pocket/`） | 選用的手機網頁版（PWA），資料都向 Nexus 取得；以密碼保護，透過 Cloudflare Tunnel 從手機連回；支援推播通知 | http://127.0.0.1:4340 |

兩個服務都只綁定 `127.0.0.1`。設定、研究族群與行情快取存在各自的 `.local/` 資料夾；API 金鑰由作業系統加密保存（見[安全設計](#安全設計)）。

### 功能

- **研究總覽**：對「你的研究族群」裡每檔股票計算四維分數（技術、法人籌碼、話題證據、行業趨勢），附評分依據、缺值處理與有效權重。
- **資金熱浪**：以成交金額為面積、漲跌幅為顏色的全市場板塊熱浪圖（資料源沒有全市場行情時改以研究族群為範圍），盤中即時更新，並有每分鐘一格的**時光機**回放。
- **盤中雷達**：自選與研究族群的爆量、急拉急殺、漲跌停、型態進場、跌破防守提醒，以及可看日 K／5 分 K 的即時看板。
- **族群排名**：研究族群依量能加權漲幅排名，每日自動保存收盤紀錄。
- **型態選股**：90 個交易日、10 種經典型態，附條件式進場與防守價位。
- **AI 盤後日報**：可用 Claude、OpenAI、Gemini 或任何 OpenAI 相容端點（含本機模型）撰寫，並可下載 9:16 摘要圖卡。
- **市場在地模組**：台股搭配 FinMind 時另有券商分點、股權分散、法人與期貨選擇權籌碼。
- **介面語言**：繁體中文、英文。

## 市場與資料來源

一套衡析一次研究一個市場。交易時段（含午休）、時區、價格跳動、漲跌幅限制、漲跌配色、成交量單位與代號格式都依市場設定。
切換市場時，各市場的族群、自選與紀錄分開保存，切回來就恢復。

支援市場：**台灣、美國、日本、香港、韓國、英國、德國、法國、加拿大、澳洲、新加坡、印度**。

| 資料源 | 市場 | 金鑰 | 提供 |
|---|---|---|---|
| [證交所／櫃買開放資料](https://openapi.twse.com.tw) | 台股 | 免 | 股票清單、交易日曆、日 K、全市場單日行情、法人（全市場逐日）、本益比、月營收 |
| [FinMind](https://finmindtrade.com) | 台股 | 免費／Sponsor | 日 K 與還原股價、法人、營收、本益比、新聞、股權分散、期貨、融資；**Sponsor** 另有盤中即時快照、分 K、全市場資料、券商分點 |
| [富果 Fugle](https://developer.fugle.tw) | 台股 | 免費／付費 | 日 K（含還原）、分 K；付費方案另有全市場即時快照 |
| [Twelve Data](https://twelvedata.com) | 12 個市場 | 免費／付費 | 股票清單、日 K、即時報價、分 K |
| [Alpha Vantage](https://www.alphavantage.co) | 美、英、加、德、印 | 免費／付費 | 日 K、報價、新聞情緒、本益比、季營收 |

可同時啟用多個資料源，衡析會依勾選順序（或在「資料與設定 → 資料來源 → 進階」指定）為每項資料挑選來源。
資料源不支援的功能會自動隱藏，或改用研究名單的本機資料；設定頁會列出目前可用的功能。

免費方案額度有限。衡析對每個資料源都有請求間隔控制、更新可停止續傳，也不會假設高於驗證金鑰時偵測到的方案等級。

## 需求

- **Node.js 22 以上**：https://nodejs.org
- Windows 10／11、macOS 或 Linux
- 至少一個涵蓋你研究市場的資料源（台股可用免金鑰的證交所開放資料）
- 選用：AI 模型的 API 金鑰；手機連線需要 `cloudflared`

## 快速開始

```bash
git clone https://github.com/wakin61043/equilens_nexus.git
cd equilens_nexus/EquiLens-Nexus
npm install --omit=dev
```

啟動 Nexus：

| Windows | macOS／Linux |
|---|---|
| 雙擊 `EquiLens-Nexus\啟動衡析Nexus.cmd`（或 `Start-Nexus.ps1`） | `./start.sh` |
| 停止：`Stop-Nexus.ps1` | 停止：`./stop.sh` |

開啟 http://127.0.0.1:4330，第一次會出現**設定精靈**：

1. 介面語言與研究市場
2. 資料來源：勾選要用的資料源並貼上金鑰（儲存前會先向資料源驗證）
3. AI 模型：服務、金鑰與模型（選用；不設定也能使用其他功能）
4. 研究族群：自行建立、載入該市場的範例族群，或匯入設定檔

完成後按「更新」下載研究族群的歷史資料（可隨時停止、下次續傳）。之後都能在「資料與設定」修改。

Windows 使用者也可以在專案根目錄雙擊 **安裝衡析.cmd**，會自動檢查 Node.js、安裝套件、啟動並開啟設定精靈。

### 手機版（選用）

```bash
cd EquiLens-Pocket
node scripts/set-password.mjs     # 至少 10 個字元
./start.sh                        # Windows：啟動衡析手機版.cmd
```

`start.sh` 會在需要時啟動 Nexus、啟動 Pocket，並用 `cloudflared` 開一個臨時的 `https://….trycloudflare.com` 網址。
需要固定網址時改用 Cloudflare Named Tunnel（見 `EquiLens-Pocket/README.md`），並在「資料與設定 → 市場與語言 → 手機版對外網址」填入該網址，推播通知才有有效的聯絡網址。
把手機版加入主畫面即可收到推播（iPhone 需 iOS 16.4 以上）。

## 設定與資料位置

| 位置 | 內容 |
|---|---|
| 「資料與設定」頁 | 市場、語言、漲跌配色、資料源與金鑰、AI 模型、研究族群、更新排程、評分權重、雷達與新聞推播 |
| `EquiLens-Nexus/.local/` | Nexus 所有資料（`config.json`、族群、自選、行情快取、紀錄）——**不要上傳** |
| `EquiLens-Pocket/.local/` | 密碼雜湊、登入紀錄、推播訂閱、通道設定——**不要上傳** |
| 設定檔 | 「資料與設定 → 設定檔」可匯出族群、自選與各項設定（**不含金鑰**），在另一台電腦匯入 |

環境變數（選用）：`PORT`、`EQUITY_DATA_DIR`（Nexus 資料夾）、`MOBILE_DATA_DIR`、`NEXUS_URL`（Pocket），
以及金鑰覆寫 `FINMIND_API_TOKEN`、`FUGLE_API_KEY`、`TWELVEDATA_API_KEY`、`ALPHAVANTAGE_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY`、`LLM_API_KEY`。

## 安全設計

- 服務只監聽 `127.0.0.1`；寫入類 API 需要 CSRF 權杖並檢查同源。
- API 金鑰由作業系統保護：**Windows DPAPI**、**macOS 鑰匙圈**、Linux 的 **Secret Service**（沒有時改存僅限本人讀取的檔案）。網頁不會讀回金鑰。
- Pocket 使用 scrypt 密碼雜湊、登入限速、HttpOnly／SameSite Cookie、主機名稱白名單與嚴格的 CSP。
- 選用的電腦版遠端存取經 Cloudflare Access，Nexus 也會自行驗證每個請求的 Access JWT（見 `EquiLens-Nexus/README.md`）。
- 資料留在你的電腦。對外連線只有你設定的資料源與 AI 服務，以及「今日焦點」使用的公開新聞與行事曆。

## 開發

```bash
cd EquiLens-Nexus && npm test        # 函式庫、伺服器與框架測試
cd EquiLens-Pocket && npm test
node EquiLens-Nexus/tools/i18n-keys.mjs --missing en   # 列出還沒有英文翻譯的介面字串
```

新增市場、資料源、AI 服務或語言的方式見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 免責聲明

行情資料的權利屬於各資料提供者，請遵守各資料源的使用條款與方案限制。本專案依現狀提供，不提供任何保證，亦不構成投資建議。
