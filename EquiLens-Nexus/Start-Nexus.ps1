param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$nexusRoot = $PSScriptRoot
$nexusUrl = 'http://127.0.0.1:4330'
try {
    $nexusHealth = Invoke-RestMethod -Uri "$nexusUrl/api/health" -TimeoutSec 2
    if ($nexusHealth.app -eq 'equilens-nexus') {
        if (-not $NoBrowser) { Start-Process $nexusUrl }
        exit 0
    }
} catch { }
$nexusNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nexusNode) { throw 'Node.js 22 or newer is required. Install from https://nodejs.org/ and run again.' }
$nexusMajor = [int]((& $nexusNode --version).TrimStart('v').Split('.')[0])
if ($nexusMajor -lt 22) { throw 'Please update Node.js to version 22 or newer.' }
$nexusProcess = Start-Process -FilePath $nexusNode -ArgumentList ('"' + (Join-Path $nexusRoot 'server.mjs') + '"') -WorkingDirectory $nexusRoot -WindowStyle Hidden -PassThru
New-Item -ItemType Directory -Path (Join-Path $nexusRoot '.local') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $nexusRoot '.local/server.pid') -Value $nexusProcess.Id -Encoding ASCII
for ($nexusTry = 0; $nexusTry -lt 30; $nexusTry++) {
    Start-Sleep -Milliseconds 400
    try {
        $nexusHealth = Invoke-RestMethod -Uri "$nexusUrl/api/health" -TimeoutSec 2
        if ($nexusHealth.app -eq 'equilens-nexus') {
            if (-not $NoBrowser) { Start-Process $nexusUrl }
            Write-Host "EquiLens Nexus is ready: $nexusUrl"
            exit 0
        }
    } catch { }
    if ($nexusProcess.HasExited) { throw 'EquiLens Nexus could not start. Port 4330 may be in use.' }
}
throw 'EquiLens Nexus startup timed out. Run node server.mjs in this folder to inspect the startup error.'
