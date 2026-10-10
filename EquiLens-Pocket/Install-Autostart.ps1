# 登入 Windows 後自動在背景啟動：衡析 Nexus → 手機版伺服器 → 通道（你的公開網址）。
# 建立目前使用者的工作排程「EquiLens 衡析」；移除請執行 Remove-Autostart.ps1。
$ErrorActionPreference = 'Stop'
$start = Join-Path $PSScriptRoot 'Start-Pocket.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$start`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT30S'  # 等網路就緒
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'EquiLens 衡析' -Description '登入後自動啟動衡析 Nexus、手機版與公開網址通道' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host '已設定：登入 Windows 後自動啟動衡析（Nexus、手機版、公開網址通道）。'
