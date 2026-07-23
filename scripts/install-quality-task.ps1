$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$qualityScript = Join-Path $PSScriptRoot 'quality-cycle.js'
$taskName = 'PortefeuilleDemoQualityWatch'
$node = (Get-Command node -ErrorAction Stop).Source
$arguments = "`"$qualityScript`""
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Start-Sleep -Milliseconds 500
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Controle syntaxe, tests et sante de Portefeuille Demo toutes les cinq minutes' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Tache $taskName installee et lancee : controle toutes les 5 minutes."
