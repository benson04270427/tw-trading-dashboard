param([string]$NexusDir = '', [switch]$IncludeCache)
# 在「舊電腦」執行：把目前的族群、自選、設定與紀錄匯出到本搬家包的 migration-data。
# 不會匯出 FinMind 金鑰與手機密碼（這兩者無法跨電腦使用，需在新電腦重新設定）。
# -IncludeCache：一併匯出行情快取與型態快照（約 250 MB），新電腦可少下載部分資料。
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $NexusDir) {
    foreach ($c in @((Join-Path $root 'EquiLens-Nexus'), (Join-Path (Split-Path $root -Parent) 'EquiLens-Nexus'))) {
        if (Test-Path -LiteralPath (Join-Path $c '.local\groups.json')) { $NexusDir = $c; break }
    }
}
if (-not $NexusDir -or -not (Test-Path -LiteralPath (Join-Path $NexusDir '.local'))) { throw '找不到舊電腦的 EquiLens-Nexus\.local。請用 -NexusDir 指定，例如：.\Export-EquiLens.ps1 -NexusDir "D:\EquiLens-Nexus"' }
$srcLocal = Join-Path $NexusDir '.local'
$out = Join-Path $root 'migration-data\nexus-local'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null
$patterns = @('groups.json', 'watchlist.json', 'settings.json', 'evidence.json', 'universe.json', 'delisting.json', 'heatmap-*.json', 'flows-*.json', 'alerts-*.json')
foreach ($d in @('reports')) { $s = Join-Path $srcLocal $d; if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination $out -Recurse } }
if ($IncludeCache) { $patterns += @('pattern-active.json', 'pattern-calendar.json', 'pattern-ledger.json', 'bulk-ledger.json') }
$count = 0
foreach ($p in $patterns) { foreach ($f in Get-ChildItem -Path (Join-Path $srcLocal $p) -File -ErrorAction SilentlyContinue) { Copy-Item -LiteralPath $f.FullName -Destination $out; $count++ } }
if ($IncludeCache) {
    foreach ($d in @('stocks', 'pattern-snapshots')) { $s = Join-Path $srcLocal $d; if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination $out -Recurse; $count += (Get-ChildItem -LiteralPath $s -Recurse -File).Count } }
}
# 手機版只帶走固定網址設定（config.json），不帶密碼與登入紀錄。
$pocketCfg = Join-Path (Split-Path $NexusDir -Parent) 'EquiLens-Pocket\.local\config.json'
$pout = Join-Path $root 'migration-data\pocket-local'
if (Test-Path -LiteralPath $pout) { Remove-Item -LiteralPath $pout -Recurse -Force }
if (Test-Path -LiteralPath $pocketCfg) { New-Item -ItemType Directory -Path $pout -Force | Out-Null; Copy-Item -LiteralPath $pocketCfg -Destination $pout; $count++ }
Set-Content -LiteralPath (Join-Path $root 'migration-data\exported-at.txt') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " from $NexusDir") -Encoding UTF8
Write-Host "已匯出 $count 個檔案到 migration-data。把整個搬家包資料夾複製到新電腦後，執行「安裝衡析.cmd」。" -ForegroundColor Green
