# 衡析美股：第二個 Nexus（埠 4331、資料在 .local-us），與台股版（埠 4330、.local）同時執行、互不影響。
# 第一次啟動時寫入 market=US 的設定，開啟網頁後在設定精靈貼上美股資料源金鑰（例如 Twelve Data）。
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$data = Join-Path $root '.local-us'
$url = 'http://127.0.0.1:4331'
try { $h = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2; if ($h.app -eq 'equilens-nexus') { if (-not $NoBrowser) { Start-Process $url }; exit 0 } } catch { }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js 22 or newer is required.' }
New-Item -ItemType Directory -Path $data -Force | Out-Null
$cfg = Join-Path $data 'config.json'
if (-not (Test-Path -LiteralPath $cfg)) { Set-Content -LiteralPath $cfg -Value '{"version":1,"setupDone":false,"market":"US","language":"zh-TW"}' -Encoding ASCII }
$env:EQUITY_DATA_DIR = $data
$env:PORT = '4331'
$p = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $data 'server.pid') -Value $p.Id -Encoding ASCII
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 400
    try { $h = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2; if ($h.app -eq 'equilens-nexus') { if (-not $NoBrowser) { Start-Process $url }; Write-Host "EquiLens Nexus (US) is ready: $url"; exit 0 } } catch { }
    if ($p.HasExited) { throw 'EquiLens Nexus (US) could not start. Port 4331 may be in use.' }
}
throw 'EquiLens Nexus (US) startup timed out.'
