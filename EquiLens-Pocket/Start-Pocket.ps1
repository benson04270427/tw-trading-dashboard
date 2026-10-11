param([switch]$NoTunnel)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$local = Join-Path $root '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
$pocketUrl = 'http://127.0.0.1:4340'
$nexusUrl = 'http://127.0.0.1:4330'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js 22 or newer is required. Install from https://nodejs.org/ and run again.' }

# 1. Password must exist before anything is exposed.
if (-not (Test-Path -LiteralPath (Join-Path $local 'auth.json'))) {
    Write-Host 'No mobile password yet. Please set one now (at least 10 characters).'
    & $node (Join-Path $root 'scripts\set-password.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Password was not set. Nothing was started.' }
}

# 2. Make sure EquiLens Nexus (the data engine) is running.
$nexusOk = $false
try { $h = Invoke-RestMethod -Uri "$nexusUrl/api/health" -TimeoutSec 2; $nexusOk = ($h.app -eq 'equilens-nexus') } catch { }
if (-not $nexusOk) {
    $nexusDir = $env:NEXUS_DIR
    if (-not $nexusDir) { $nexusDir = Join-Path (Split-Path $root -Parent) 'EquiLens-Nexus' }
    $nexusStart = Join-Path $nexusDir 'Start-Nexus.ps1'
    if (Test-Path -LiteralPath $nexusStart) {
        Write-Host 'Starting EquiLens Nexus...'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $nexusStart -NoBrowser
    } else {
        Write-Warning "EquiLens Nexus not found at $nexusDir. Start it manually; the phone app shows data only while Nexus runs."
    }
}

# 3. Start the mobile server (bound to 127.0.0.1 only).
$running = $false
try { $h = Invoke-RestMethod -Uri "$pocketUrl/health" -TimeoutSec 2; $running = ($h.app -eq 'equilens-pocket') } catch { }
if (-not $running) {
    $p = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $local 'server.pid') -Value $p.Id -Encoding ASCII
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 400
        try { $h = Invoke-RestMethod -Uri "$pocketUrl/health" -TimeoutSec 2; if ($h.app -eq 'equilens-pocket') { $running = $true; break } } catch { }
        if ($p.HasExited) { throw 'EquiLens Pocket could not start. Port 4340 may be in use.' }
    }
    if (-not $running) { throw 'EquiLens Pocket startup timed out. Run node server.mjs in this folder to see the error.' }
}
Write-Host "EquiLens Pocket is running locally: $pocketUrl"

# 4. Public URL according to the connection mode set in EquiLens Nexus (Remote access); Start-Tunnel.ps1 decides.
if (-not $NoTunnel) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Tunnel.ps1') }
