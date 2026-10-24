param([switch]$KeepTunnel)
# -KeepTunnel stops only the web server, so the phone URL stays the same (used by Restart-Pocket.ps1).
$ErrorActionPreference = 'Stop'

# 依連接埠找出實際在執行的伺服器（用 netstat 與 Get-Process，不依賴 WMI；WMI 卡住時也能停止）
function Stop-ByPort([int]$Port) {
    $ids = netstat -ano -p TCP | Select-String -Pattern (":$Port\s+\S+\s+LISTENING\s+(\d+)") | ForEach-Object { [int]$_.Matches[0].Groups[1].Value } | Select-Object -Unique
    foreach ($o in $ids) { $p = Get-Process -Id $o -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $o -Force; Start-Sleep -Milliseconds 800; Write-Host "Stopped server on port $Port." } }
}
$root = $PSScriptRoot
$local = Join-Path $root '.local'
$tp = Join-Path $local 'tunnel.pid'
if (-not $KeepTunnel -and (Test-Path -LiteralPath $tp)) {
    $t = Get-Process -Id ([int](Get-Content -LiteralPath $tp)) -ErrorAction SilentlyContinue
    if ($t -and $t.ProcessName -eq 'cloudflared') { Stop-Process -Id $t.Id; Write-Host 'Tunnel stopped.' }
    Remove-Item -LiteralPath $tp
}
$sp = Join-Path $local 'server.pid'
if (Test-Path -LiteralPath $sp) {
    $proc = Get-Process -Id ([int](Get-Content -LiteralPath $sp)) -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $proc.Id -Force; Write-Host 'EquiLens Pocket stopped.' }
    Remove-Item -LiteralPath $sp -ErrorAction SilentlyContinue
}
Stop-ByPort 4340
Write-Host 'EquiLens Nexus keeps running (stop it with its own Stop-Nexus.ps1).'
