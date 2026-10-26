# 用 Tailscale 私人網路開啟手機版：台股 https://<電腦名稱>.<tailnet>.ts.net、美股同網址加 :8443。
# 只有登入同一個 Tailscale 帳號的手機與電腦連得到，所以設定為免密碼；關閉公開的 Cloudflare 臨時網址。
# 需要：這台電腦已安裝並登入 Tailscale（https://tailscale.com/download/windows），手機也裝 Tailscale App 並登入同一帳號。
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repo = Split-Path $root -Parent

$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { foreach ($c in @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) { if ($c -and (Test-Path -LiteralPath $c)) { $ts = $c; break } } }
if (-not $ts) { Write-Host 'Tailscale is not installed. Install it from https://tailscale.com/download/windows, sign in, then run this again.'; exit 1 }

# Windows PowerShell 5.1 cannot parse this JSON reliably (one object per line, keys differing only in case): read the two fields as text
$raw = (& $ts status --json) -join "`n"
$state = ''; if ($raw -match '"BackendState"\s*:\s*"([^"]*)"') { $state = $Matches[1] }
if ($state -ne 'Running') { Write-Host 'Tailscale is not signed in. Click the Tailscale icon in the taskbar, sign in, then run this again.'; exit 1 }
$dns = ''
$self = $raw.IndexOf('"Self"')
if ($self -ge 0 -and ($raw.Substring($self) -match '"DNSName"\s*:\s*"([^"]*)"')) { $dns = $Matches[1].TrimEnd('.') }
if (-not $dns) { Write-Host 'MagicDNS name not found. In the Tailscale admin console (DNS page) turn on MagicDNS, then run this again.'; exit 1 }

# 1. Tailscale Serve (tailnet only, not Funnel): 443 -> Taiwan phone app, 8443 -> US phone app
Write-Host 'Setting up Tailscale Serve...'
& $ts serve --bg --https=443 http://127.0.0.1:4340
if ($LASTEXITCODE -ne 0) { Write-Host ''; Write-Host 'If a link was shown above, open it, enable HTTPS certificates for your tailnet, then run this again.'; exit 1 }
& $ts serve --bg --https=8443 http://127.0.0.1:4341
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not set up port 8443 for the US phone app.'; exit 1 }

# 2. No password for requests that come through the tailnet (Taiwan .local, US .local-us)
foreach ($dir in @('.local', '.local-us')) {
    $d = Join-Path $root $dir
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    $f = Join-Path $d 'config.json'
    $o = [ordered]@{}
    if (Test-Path -LiteralPath $f) { try { $j = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $o[$p.Name] = $p.Value } } catch { } }
    $o['tailnetNoPassword'] = $true
    ($o | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $f -Encoding UTF8
}

# 3. Remote access in both Nexus instances: no public tunnel; phone URL = the tailnet address (used in notifications)
function Set-Remote([int]$Port, [string]$Url) {
    try {
        $s = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/state" -TimeoutSec 10
        $b = @{ tunnel = 'off'; publicUrl = $Url } | ConvertTo-Json
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/remote" -Method Post -Body $b -ContentType 'application/json' -Headers @{ 'x-csrf-token' = $s.csrf } -TimeoutSec 10 | Out-Null
        Write-Host "Nexus $Port remote access: tailnet only."
    } catch { Write-Warning "Could not update remote access on port $Port (is it running?): $($_.Exception.Message)" }
}
Set-Remote 4330 "https://$dns"
Set-Remote 4331 "https://${dns}:8443"

# 4. Stop the public Cloudflare tunnel and restart the phone apps (Taiwan + US)
& (Join-Path $root 'Stop-Pocket.ps1')
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Pocket.ps1')
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Start-Pocket.ps1') -Market US

$tw = "https://$dns"; $usUrl = "https://${dns}:8443"
Set-Content -LiteralPath (Join-Path $root '.local\tailnet-urls.txt') -Value @($tw, $usUrl) -Encoding ASCII
try { Set-Clipboard -Value "$tw`r`n$usUrl" } catch { }
Write-Host ''
Write-Host '============================================================'
Write-Host ' Phone URLs (Tailscale on, no password; copied to clipboard):'
Write-Host "  Taiwan: $tw"
Write-Host "  US:     $usUrl"
Write-Host '============================================================'
Write-Host 'These URLs do not change after a reboot. The phone needs the Tailscale app turned on.'
