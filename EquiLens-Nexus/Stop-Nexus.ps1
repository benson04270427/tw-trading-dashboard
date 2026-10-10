$ErrorActionPreference = 'Stop'
$nexusPidPath = Join-Path $PSScriptRoot '.local/server.pid'
if (-not (Test-Path -LiteralPath $nexusPidPath)) { Write-Host 'No launcher-owned process was found.'; exit 0 }
$nexusProcessId = [int](Get-Content -LiteralPath $nexusPidPath)
$nexusProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $nexusProcessId"
$nexusServer = Join-Path $PSScriptRoot 'server.mjs'
if ($nexusProcess -and $nexusProcess.Name -eq 'node.exe' -and $nexusProcess.CommandLine.Contains($nexusServer)) {
    Stop-Process -Id $nexusProcessId
    Remove-Item -LiteralPath $nexusPidPath
    Write-Host 'EquiLens Nexus stopped.'
} else { Write-Host 'Process does not match this project. Nothing was stopped.' }
