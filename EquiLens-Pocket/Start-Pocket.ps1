param([switch]$NoTunnel, [ValidateSet('TW', 'US')][string]$Market = 'TW')
# -Market US: second phone app for the US Nexus (port 4341 -> Nexus 4331, data in .local-us). No Cloudflare tunnel;
# it is reached through Tailscale (see Setup-Tailscale.ps1).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$us = $Market -eq 'US'
$local = Join-Path $root $(if ($us) { '.local-us' } else { '.local' })
New-Item -ItemType Directory -Path $local -Force | Out-Null
$port = $(if ($us) { 4341 } else { 4340 })
$pocketUrl = "http://127.0.0.1:$port"
$nexusUrl = $(if ($us) { 'http://127.0.0.1:4331' } else { 'http://127.0.0.1:4330' })
$noPassword = $false
try { $noPassword = [bool]((Get-Content -LiteralPath (Join-Path $local 'config.json') -Raw | ConvertFrom-Json).tailnetNoPassword) } catch { }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js 22 or newer is required. Install from https://nodejs.org/ and run again.' }

# 1. Password must exist before anything is exposed.
if (-not $noPassword -and -not (Test-Path -LiteralPath (Join-Path $local 'auth.json'))) {
    Write-Host 'No mobile password yet. Please set one now (at least 10 characters).'
    $env:MOBILE_DATA_DIR = $local
    & $node (Join-Path $root 'scripts\set-password.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Password was not set. Nothing was started.' }
}

# 2. Make sure EquiLens Nexus (the data engine) is running.
$nexusOk = $false
try { $h = Invoke-RestMethod -Uri "$nexusUrl/api/health" -TimeoutSec 2; $nexusOk = ($h.app -eq 'equilens-nexus') } catch { }
if (-not $nexusOk) {
    $nexusDir = $env:NEXUS_DIR
    if (-not $nexusDir) { $nexusDir = Join-Path (Split-Path $root -Parent) 'EquiLens-Nexus' }
    $nexusStart = Join-Path $nexusDir $(if ($us) { 'Start-NexusUS.ps1' } else { 'Start-Nexus.ps1' })
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
    $env:MOBILE_DATA_DIR = $local; $env:PORT = "$port"; $env:NEXUS_URL = $nexusUrl
    $p = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $local 'server.pid') -Value $p.Id -Encoding ASCII
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 400
        try { $h = Invoke-RestMethod -Uri "$pocketUrl/health" -TimeoutSec 2; if ($h.app -eq 'equilens-pocket') { $running = $true; break } } catch { }
        if ($p.HasExited) { throw "EquiLens Pocket could not start. Port $port may be in use." }
    }
    if (-not $running) { throw 'EquiLens Pocket startup timed out. Run node server.mjs in this folder to see the error.' }
}
Write-Host "EquiLens Pocket is running locally: $pocketUrl"

# 4. Public URL according to the connection mode set in EquiLens Nexus (Remote access); Start-Tunnel.ps1 decides.
if (-not $NoTunnel -and -not $us) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Tunnel.ps1') }
