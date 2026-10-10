@echo off
setlocal
cd /d "%~dp0"
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Autostart.ps1"
echo.
echo ---- Scheduled task status ----
powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName EquiLens* | Select-Object TaskName,State | Format-Table -AutoSize; Get-ScheduledTask -TaskName EquiLens* | Get-ScheduledTaskInfo | Select-Object LastRunTime,LastTaskResult,NextRunTime | Format-List"
pause
