$ErrorActionPreference = 'Continue'
# 依連接埠找出實際在執行的伺服器（用 netstat 與 Get-Process，不依賴 WMI；WMI 卡住時也能停止）
function Stop-ByPort([int]$Port) {
    $ids = netstat -ano -p TCP | Select-String -Pattern (":$Port\s+\S+\s+LISTENING\s+(\d+)") | ForEach-Object { [int]$_.Matches[0].Groups[1].Value } | Select-Object -Unique
    foreach ($o in $ids) { $p = Get-Process -Id $o -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $o -Force; Start-Sleep -Milliseconds 800; Write-Host "Stopped server on port $Port." } }
}
$nexusPidPath = Join-Path $PSScriptRoot '.local/server.pid'
if (Test-Path -LiteralPath $nexusPidPath) {
    $nexusProcess = Get-Process -Id ([int](Get-Content -LiteralPath $nexusPidPath)) -ErrorAction SilentlyContinue
    if ($nexusProcess -and $nexusProcess.ProcessName -eq 'node') { Stop-Process -Id $nexusProcess.Id -Force; Write-Host 'EquiLens Nexus stopped.' }
    Remove-Item -LiteralPath $nexusPidPath -ErrorAction SilentlyContinue
}
Stop-ByPort 4330
