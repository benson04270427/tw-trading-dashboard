# 背景啟動、桌面圖示與美股版

讓衡析在 Windows 登入後自動在背景執行（不跳出黑色命令列視窗），桌面放「衡析 台股」「衡析 美股」兩個圖示，並可同時執行一套研究美股的衡析。電腦重新開機、手機網址改變時，會推播新網址到手機。

## 在哪裡

| 檔案 | 用途 |
|---|---|
| `EquiLens.vbs` | 在背景依序啟動台股 Nexus、手機版、Cloudflare 通道與美股 Nexus，不開任何視窗；加參數 `tw`／`us` 會在啟動後開啟對應的網頁 |
| `EquiLens-Nexus/Start-NexusUS.ps1` | 啟動美股版 Nexus：埠 **4331**、資料夾 `EquiLens-Nexus/.local-us`；第一次啟動寫入 `market: US` 的設定 |
| `icons/equilens-tw.ico`、`icons/equilens-us.ico` | 桌面捷徑圖示（台股青色、美股金色） |

## 怎麼用

- **自動啟動**：把一支呼叫 `EquiLens.vbs` 的小程式放進 Windows「啟動」資料夾（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`），登入後就在背景啟動全部服務。
- **桌面圖示**：捷徑目標為 `wscript.exe "…\EquiLens.vbs" tw`（或 `us`）。服務已在執行時直接開網頁；沒有執行時先在背景啟動再開。
- **美股版**：第一次開啟 http://127.0.0.1:4331 會進入設定精靈，選美國股市並貼上美股資料源金鑰（例如 [Twelve Data](https://twelvedata.com) 免費方案）。美股版與台股版的設定、族群、自選、金鑰各自獨立。

## 手機網址更換通知

使用 Cloudflare 臨時網址時，通道重新啟動後網址會改變。手機版每 30 秒檢查 `EquiLens-Pocket/.local/public-url.txt`，網址改變時推播「衡析手機網址已更換」，點通知直接開啟新網址（推播不經過通道，舊網址失效後仍收得到）。登入後重新加到主畫面即可。想完全避免換網址，改用 Cloudflare 固定網域（見[手機版與推播通知](mobile.md)）。

## 注意事項

- 手機版只連台股版 Nexus；美股版目前只在電腦上使用。
- 風控水位、低估選股、個股判讀卡只支援台股，美股版不顯示。
- 背景執行時看不到錯誤訊息；啟動失敗時可雙擊 `EquiLens-Pocket\啟動衡析手機版.cmd` 或在 `EquiLens-Nexus` 執行 `Start-NexusUS.ps1` 查看原因。
