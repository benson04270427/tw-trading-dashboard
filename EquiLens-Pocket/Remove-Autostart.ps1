# 取消「登入 Windows 後自動啟動衡析」。
Unregister-ScheduledTask -TaskName 'EquiLens 衡析' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host '已取消開機自動啟動。'
