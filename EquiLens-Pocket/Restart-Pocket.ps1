param([switch]$Nexus)
# Apply code changes without changing the phone URL: restart the web server(s) only, keep the tunnel running.
# -Nexus also restarts EquiLens Nexus (the data engine).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# 重新啟動紀錄（每次覆寫），重新啟動失敗時可查看 .local/restart.log
try { Start-Transcript -Path (Join-Path $root '.local/restart.log') -Force | Out-Null } catch { }
& (Join-Path $root 'Stop-Pocket.ps1') -KeepTunnel
if ($Nexus) {
    $nexusDir = $env:NEXUS_DIR
    if (-not $nexusDir) { $nexusDir = Join-Path (Split-Path $root -Parent) 'EquiLens-Nexus' }
    & (Join-Path $nexusDir 'Stop-Nexus.ps1')
    Start-Sleep -Milliseconds 500
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $nexusDir 'Start-Nexus.ps1') -NoBrowser
    if ($LASTEXITCODE -ne 0) { throw 'EquiLens Nexus could not restart.' }
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Pocket.ps1')
# 美股手機版（有 .local-us 時）：只重啟伺服器，美股 Nexus 由 Start-NexusUS.ps1 -Restart 重啟
if (Test-Path -LiteralPath (Join-Path $root '.local-us')) {
    & (Join-Path $root 'Stop-Pocket.ps1') -Market US
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Pocket.ps1') -Market US
}
