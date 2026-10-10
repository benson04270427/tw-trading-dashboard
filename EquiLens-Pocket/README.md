# 衡析 Pocket（手機版）

衡析 Nexus 的手機網頁版（PWA）。資料與金鑰都留在你的電腦，手機透過 **Cloudflare Tunnel** 的 https 網址連回來，並以密碼保護。

```
手機瀏覽器 ──https──▶ Cloudflare ──tunnel──▶ 衡析 Pocket (127.0.0.1:4340) ──▶ 衡析 Nexus (127.0.0.1:4330) ──▶ 資料源
```

- Pocket 只綁定 127.0.0.1，不直接開放連接埠；所有資料都向 Nexus 取得（Nexus 是唯一寫入者），兩邊永遠一致。
- 介面語言、研究市場、漲跌配色跟隨 Nexus 的設定。
- **電腦必須開機，且 Nexus 與 Pocket 都在執行**，手機才讀得到。

## 第一次使用

| | Windows | macOS／Linux |
|---|---|---|
| 設定手機密碼（至少 10 個字元） | 雙擊 **設定手機密碼.cmd** | `node scripts/set-password.mjs` |
| 啟動（含 Nexus 與通道） | 雙擊 **啟動衡析手機版.cmd** | `./start.sh` |
| 停止（Nexus 繼續執行） | 雙擊 **停止衡析手機版.cmd** | `./stop.sh` |

1. 需要 `cloudflared`（Windows 啟動時會詢問是否用 winget 安裝；macOS 可用 `brew install cloudflared`）。
2. 啟動後會顯示 `https://xxxx.trycloudflare.com` 網址；在手機開啟並輸入密碼登入（可保持 30 天）。
3. iPhone：Safari「分享 → 加入主畫面」；Android：Chrome 選單「加到主畫面」。之後像 App 一樣全螢幕開啟。
4. 在「盤中 → 雷達」按「開啟通知」即可收到雷達異動、新聞與 AI 日報推播（iPhone 需 iOS 16.4 以上並從主畫面開啟）。

## 固定網址（Named Tunnel）

臨時網址（Quick Tunnel）每次重新啟動通道都會改變，且舊網址的推播訂閱會失效。需要固定網址時，改用 Named Tunnel（需要免費 Cloudflare 帳號＋託管在 Cloudflare 的網域）：

```bash
cloudflared tunnel login
cloudflared tunnel create equilens
cloudflared tunnel route dns equilens pocket.example.com
```

在本資料夾的 `.local/cloudflared.yml` 設定：

```yaml
tunnel: equilens
credentials-file: <你的 .cloudflared 資料夾>/<tunnel-id>.json
ingress:
  - hostname: pocket.example.com
    service: http://127.0.0.1:4340
  - service: http_status:404
```

並在 `.local/config.json` 加入允許的主機名稱：`{"hosts":["pocket.example.com"]}`。有 `cloudflared.yml` 時，啟動腳本一律使用固定網址
（Windows 要臨時改回 Quick Tunnel 請執行 `Start-Tunnel.ps1 -New`）。最後在電腦版「資料與設定 → 市場與語言 → 手機版對外網址」填入
`https://pocket.example.com`，作為推播通知的聯絡網址。

- Windows 開機自動啟動：`Install-Autostart.ps1`（取消：`Remove-Autostart.ps1`）。
- 更新程式後要套用變更但不換網址：**重新啟動衡析（網址不變）.cmd**。
- 加碼防護（選用）：在 Cloudflare Zero Trust → Access 為手機版網址加上 Email 一次性驗證碼。

## 安全設計

- 密碼以 scrypt 雜湊保存（`.local/auth.json`），Session 只保存雜湊；變更密碼會登出所有裝置。
- 同一來源 15 分鐘內錯 5 次即鎖 15 分鐘；全站 1 小時錯 50 次暫停登入 1 小時。
- Cookie：HttpOnly、SameSite=Strict、https 下 Secure；寫入操作需自訂標頭與同源檢查。
- 主機名稱白名單（本機、`*.trycloudflare.com`、`.local/config.json` 的 hosts），防 DNS rebinding。
- CSP、禁止被嵌入框架、不傳 Referrer；搜尋引擎 noindex。
- 手機端可以閱讀、查詢熱浪圖與法人、加減自選、更新行情與型態資料、調整雷達與新聞推播；資料來源、金鑰、AI 模型與研究族群只能在電腦版設定。

## 檔案

| 路徑 | 用途 |
|---|---|
| `server.mjs` | 手機版伺服器、登入、安全標頭、API 代理、推播轉送 |
| `lib/auth.mjs`／`lib/nexus.mjs`／`lib/push.mjs` | 密碼與 Session、Nexus API 用戶端、Web Push |
| `public/` | 手機介面；`i18n.js`、`market.js`、`insight-ui.js`、`report-card.js`、`flow-cards.js`、`save-image.js` 與電腦版共用（保持相同內容） |
| `scripts/set-password.mjs` | 設定密碼 |
| `.local/` | 密碼雜湊、Session、推播訂閱、通道設定（勿公開） |

```bash
npm test
```

研究資訊，非交易建議。
