param([switch]$Nexus)
# Apply code changes without changing the phone URL: restart the web server(s) only, keep the tunnel running.
# -Nexus also restarts EquiLens Nexus (the data engine).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
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
