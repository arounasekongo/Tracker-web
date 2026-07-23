$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backupScript = Join-Path $PSScriptRoot 'backup-postgres.ps1'
$taskName = 'PortefeuilleDemoBackup'
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Sauvegarde quotidienne PostgreSQL et photos de Portefeuille Demo' -Force | Out-Null
Write-Output "Tache $taskName installee : sauvegarde quotidienne a 02:00, avec rattrapage au prochain demarrage."
