param([switch]$KeepTunnel)
# -KeepTunnel stops only the web server, so the phone URL stays the same (used by Restart-Pocket.ps1).
$ErrorActionPreference = 'Stop'
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
    $id = [int](Get-Content -LiteralPath $sp)
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine.Contains((Join-Path $root 'server.mjs'))) { Stop-Process -Id $id; Write-Host 'EquiLens Pocket stopped.' }
    Remove-Item -LiteralPath $sp
}
Write-Host 'EquiLens Nexus keeps running (stop it with its own Stop-Nexus.ps1).'
