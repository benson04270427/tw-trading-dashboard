param([switch]$Force)
# 衡析安裝：檢查 Node.js → 還原搬家資料（選用）→ 啟動 Nexus → 在瀏覽器完成設定精靈 → 設定手機密碼 → (選擇) 更新資料／啟動手機版
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$nexus = Join-Path $root 'EquiLens-Nexus'
$pocket = Join-Path $root 'EquiLens-Pocket'
$data = Join-Path $root 'migration-data'
$url = 'http://127.0.0.1:4330'

function Step($t) { Write-Host ''; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Ask($q) { $a = Read-Host "$q [Y/N]"; return ($a -match '^[Yy]') }
function ApiError($e) { try { return (($e.ErrorDetails.Message | ConvertFrom-Json).error) } catch { return $e.Exception.Message } }

foreach ($d in @($nexus, $pocket)) { if (-not (Test-Path -LiteralPath (Join-Path $d 'server.mjs'))) { throw "找不到 $d，請確認搬家包完整解壓縮，且沒有更改資料夾名稱。" } }

# 1. Node.js
Step '1/6 檢查 Node.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$major = 0; if ($node) { $major = [int]((& $node --version).TrimStart('v').Split('.')[0]) }
if ($major -lt 22) {
    Write-Host '需要 Node.js 22 以上版本。'
    if (Ask '要用 winget 安裝 Node.js LTS 嗎？') {
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
        $node = (Get-Command node -ErrorAction SilentlyContinue).Source
        if (-not $node) { throw 'Node.js 已安裝但尚未生效，請關閉此視窗後重新執行「安裝衡析.cmd」。' }
    } else { throw '請先到 https://nodejs.org/ 安裝 Node.js 22 以上版本後再執行。' }
}
Write-Host "Node.js $(& $node --version) OK"
# Nexus 需要的套件（@anthropic-ai/sdk）缺少時自動安裝。
if (-not (Test-Path -LiteralPath (Join-Path $nexus 'node_modules\@anthropic-ai\sdk'))) {
    Write-Host '安裝 Nexus 套件（@anthropic-ai/sdk）…'
    Push-Location $nexus; try { & npm install --omit=dev --no-fund --no-audit } finally { Pop-Location }
}

# 2. 還原設定
Step '2/6 還原族群、自選與設定'
$src = Join-Path $data 'nexus-local'
$dst = Join-Path $nexus '.local'
New-Item -ItemType Directory -Path $dst -Force | Out-Null
if (Test-Path -LiteralPath $src) {
    $existing = Get-ChildItem -LiteralPath $dst -Force | Where-Object { $_.Name -notlike 'backup-*' }
    if ($existing -and -not $Force) {
        $bk = Join-Path $dst ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $bk | Out-Null
        foreach ($f in Get-ChildItem -LiteralPath $src -Force) { $t = Join-Path $dst $f.Name; if (Test-Path -LiteralPath $t) { Copy-Item -LiteralPath $t -Destination $bk -Recurse -Force } }
        Write-Host "已備份將被覆蓋的舊檔到 $bk"
    }
    Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
    $n = (Get-ChildItem -LiteralPath $src -Recurse -File).Count
    Write-Host "已還原 $n 個檔案到 EquiLens-Nexus\.local"
} else { Write-Host '沒有搬家資料；啟動後請在瀏覽器完成設定精靈（語言、市場、資料來源、推理模型、研究族群）。' }
$psrc = Join-Path $data 'pocket-local'
if (Test-Path -LiteralPath $psrc) { New-Item -ItemType Directory -Path (Join-Path $pocket '.local') -Force | Out-Null; Copy-Item -Path (Join-Path $psrc '*') -Destination (Join-Path $pocket '.local') -Recurse -Force; Write-Host '已還原手機版網址設定。' }

# 3. 啟動 Nexus
Step '3/6 啟動衡析 Nexus'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $nexus 'Start-Nexus.ps1') -NoBrowser
if ($LASTEXITCODE -ne 0) { throw 'Nexus 啟動失敗，可在 EquiLens-Nexus 資料夾執行 node server.mjs 查看錯誤。' }
$state = Invoke-RestMethod -Uri "$url/api/state" -TimeoutSec 60
Write-Host "Nexus 已啟動：$url（族群 $($state.groups.Count) 個、研究個股 $($state.stocks.Count) 檔、自選 $($state.watchlist.Count) 檔）"

# 4. 資料來源與金鑰：在瀏覽器的設定精靈或「資料與設定」頁輸入（金鑰無法跨電腦搬移，由作業系統加密保存）
Step '4/6 資料來源與推理模型'
if ($state.dataConfigured) { Write-Host '這台電腦已設定資料來源，略過。' }
else {
    Write-Host '請在接著開啟的瀏覽器頁面完成設定精靈：選擇市場、勾選資料來源並貼上金鑰、選擇推理模型。'
    Write-Host '（金鑰只在網頁輸入，經資料源驗證後由作業系統加密保存在這台電腦）'
    Start-Process $url
    Read-Host '完成設定後按 Enter 繼續' | Out-Null
}

# 5. 手機密碼
Step '5/6 設定手機版密碼'
if (Test-Path -LiteralPath (Join-Path $pocket '.local\auth.json')) { Write-Host '已設定過，略過（要更改請執行「設定手機密碼.cmd」）。' }
elseif (Ask '要現在設定手機版登入密碼嗎？（至少 10 個字元）') { & $node (Join-Path $pocket 'scripts\set-password.mjs') }

# 6. 後續動作
Step '6/6 完成'
$state = Invoke-RestMethod -Uri "$url/api/state" -TimeoutSec 60
if ($state.dataConfigured -and $state.groups.Count -and (Ask '要立即下載全部研究個股行情嗎？（需一段時間並使用資料源額度，可隨時在網頁停止）')) {
    try {
        $body = [Text.Encoding]::UTF8.GetBytes('{"scope":"all","ids":[]}')
        Invoke-RestMethod -Method Post -Uri "$url/api/update" -Headers @{ 'X-CSRF-Token' = $state.csrf } -ContentType 'application/json; charset=utf-8' -Body $body | Out-Null
        Write-Host '已開始更新。完成後請在「型態選股」頁按「更新型態資料」。'
    } catch { Write-Host ('無法開始更新：' + (ApiError $_)) -ForegroundColor Yellow }
}
Start-Process $url
if (Ask '要現在啟動手機版與公開網址嗎？') { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pocket 'Start-Pocket.ps1') }
Write-Host ''
Write-Host '安裝完成。之後：電腦版雙擊 EquiLens-Nexus\啟動衡析Nexus.cmd；手機版雙擊 EquiLens-Pocket\啟動衡析手機版.cmd。' -ForegroundColor Green
Write-Host '提醒：若是從舊電腦搬過來，請停止舊電腦的 Nexus 與手機版，避免兩台同時自動更新重複消耗額度。'
