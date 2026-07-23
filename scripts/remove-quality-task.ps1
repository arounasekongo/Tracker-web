$ErrorActionPreference = 'Stop'

$taskName = 'PortefeuilleDemoQualityWatch'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Output "Tache $taskName absente."
    exit 0
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output "Tache $taskName supprimee. Le dernier rapport local est conserve."
