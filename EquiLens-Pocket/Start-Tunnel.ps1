param([string]$Name = '', [switch]$New)
# Phone access through Cloudflare Tunnel, following the connection mode set in EquiLens Nexus (Remote access).
# Quick tunnel: random https://xxxx.trycloudflare.com URL, changes on every restart.
#   A tunnel that is already running is reused (same URL); pass -New to force a fresh URL.
# Named tunnel: .\Start-Tunnel.ps1 -Name equilens  (fixed hostname; see README).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$local = Join-Path $root '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
# Connection mode, set in EquiLens Nexus (Data & Settings -> Remote access):
#   auto | cloudflare-quick | cloudflare-named | custom (your own tunnel / reverse proxy) | off (local only)
$mode = ''
try { $prof = Invoke-RestMethod -Uri 'http://127.0.0.1:4330/api/profile' -TimeoutSec 3; if ($prof.remote.tunnel) { $mode = [string]$prof.remote.tunnel } } catch { }
if (-not $mode) { $cache = Join-Path $local 'remote-cache.json'; if (Test-Path -LiteralPath $cache) { try { $mode = [string](Get-Content -LiteralPath $cache -Raw | ConvertFrom-Json).tunnel } catch { } } }
if (-not $mode) { $mode = 'auto' }
if (-not $New -and -not $Name -and ($mode -eq 'custom' -or $mode -eq 'off')) {
    if ($mode -eq 'custom') { Write-Host 'Remote access: your own tunnel or reverse proxy (custom). No Cloudflare tunnel is started.'; Write-Host 'Forward your HTTPS address to http://127.0.0.1:4340 and add its domain in EquiLens Nexus -> Data & Settings -> Remote access.' }
    else { Write-Host 'Remote access is off (local only). No tunnel is started.' }
    exit 0
}
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    foreach ($c in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) { if ($c -and (Test-Path -LiteralPath $c)) { $cf = $c; break } }
}
if (-not $cf) {
    Write-Host 'cloudflared is not installed.'
    $answer = Read-Host 'Install it now with winget (Cloudflare.cloudflared)? [Y/N]'
    if ($answer -notmatch '^[Yy]') { Write-Host 'Skipped. Install later: winget install --id Cloudflare.cloudflared'; exit 1 }
    winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
    $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cf) { foreach ($c in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) { if ($c -and (Test-Path -LiteralPath $c)) { $cf = $c; break } } }
    if (-not $cf) { throw 'cloudflared installed, but not found yet. Open a new window and run this again.' }
}
$pidFile = Join-Path $local 'tunnel.pid'
$urlFile = Join-Path $local 'public-url.txt'
# Fixed domain: .local\cloudflared.yml (named tunnel, e.g. https://pocket.example.com). Takes priority over the quick tunnel.
$namedCfg = Join-Path $local 'cloudflared.yml'
if (-not $New -and -not $Name -and $mode -eq 'cloudflare-named' -and -not (Test-Path -LiteralPath $namedCfg)) { throw "Connection mode is 'Cloudflare fixed domain', but $namedCfg was not found. See EquiLens-Pocket/README.md." }
if (-not $New -and -not $Name -and $mode -ne 'cloudflare-quick' -and (Test-Path -LiteralPath $namedCfg)) {
    $hostLine = Select-String -LiteralPath $namedCfg -Pattern '^\s*-\s*hostname:\s*(\S+)' | Select-Object -First 1
    $url = 'https://' + $hostLine.Matches[0].Groups[1].Value
    $old = if (Test-Path -LiteralPath $pidFile) { Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue } else { $null }
    $running = $old -and $old.ProcessName -eq 'cloudflared' -and (Test-Path -LiteralPath $urlFile) -and ((Get-Content -LiteralPath $urlFile -TotalCount 1).Trim() -eq $url)
    if (-not $running) {
        if ($old -and $old.ProcessName -eq 'cloudflared') { Stop-Process -Id $old.Id; Start-Sleep -Milliseconds 500 }
        $log = Join-Path $local 'cloudflared.log'
        Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
        $p = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--config', "`"$namedCfg`"", '--logfile', "`"$log`"", 'run') -WindowStyle Hidden -PassThru
        Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ASCII
        $ok = $false
        for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-Path -LiteralPath $log) { $ok = [bool](Select-String -LiteralPath $log -Pattern 'Registered tunnel connection' -Quiet) }
            if ($p.HasExited) { throw "cloudflared exited. See $log" }
        }
        if (-not $ok) { Write-Warning "Tunnel started but not connected yet. See $log" }
        Set-Content -LiteralPath $urlFile -Value $url -Encoding ASCII
    }
    try { Set-Clipboard -Value $url } catch { }
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " Phone URL (fixed domain, copied to clipboard):"
    Write-Host " $url"
    Write-Host '============================================================'
    exit 0
}
if (-not $Name -and -not $New -and (Test-Path -LiteralPath $pidFile) -and (Test-Path -LiteralPath $urlFile)) {
    $old = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
    $url = (Get-Content -LiteralPath $urlFile -TotalCount 1).Trim()
    if ($old -and $old.ProcessName -eq 'cloudflared' -and $url) {
        try { Set-Clipboard -Value $url } catch { }
        Write-Host ''
        Write-Host '============================================================'
        Write-Host ' Tunnel already running - phone URL unchanged (copied to clipboard):'
        Write-Host " $url"
        Write-Host '============================================================'
        exit 0
    }
}
if (Test-Path -LiteralPath $pidFile) {
    $old = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
    if ($old -and $old.ProcessName -eq 'cloudflared') { Stop-Process -Id $old.Id; Start-Sleep -Milliseconds 500 }
}
$log = Join-Path $local 'cloudflared.log'
Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
if ($Name) {
    $cfArgs = @('tunnel', '--no-autoupdate', '--logfile', "`"$log`"", 'run', $Name)
} else {
    $cfArgs = @('tunnel', '--no-autoupdate', '--logfile', "`"$log`"", '--url', 'http://127.0.0.1:4340')
}
$p = Start-Process -FilePath $cf -ArgumentList $cfArgs -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ASCII
if ($Name) { Write-Host "Named tunnel '$Name' started. Open your configured hostname on the phone."; exit 0 }
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $log) { $m = Select-String -LiteralPath $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
    if ($p.HasExited) { throw "cloudflared exited. See $log" }
}
if (-not $url) { throw "Tunnel URL not found yet. See $log" }
Set-Content -LiteralPath $urlFile -Value $url -Encoding ASCII
try { Set-Clipboard -Value $url } catch { }
Write-Host ''
Write-Host '============================================================'
Write-Host " Phone URL (copied to clipboard):"
Write-Host " $url"
Write-Host '============================================================'
Write-Host 'This quick-tunnel URL changes every time the tunnel restarts.'
