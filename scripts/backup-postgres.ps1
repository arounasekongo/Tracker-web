$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectDir '.env'
$backupDir = Join-Path $projectDir '.backups'
$postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
$pgDump = Join-Path $postgresBin 'pg_dump.exe'

if (-not (Test-Path -LiteralPath $pgDump)) { throw "pg_dump introuvable dans $postgresBin" }
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Fichier .env introuvable.' }

$settings = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    $settings[$name.Trim()] = $value.Trim()
}

$dbHost = if ($settings.DB_HOST) { $settings.DB_HOST } else { '127.0.0.1' }
$dbPort = if ($settings.DB_PORT) { $settings.DB_PORT } else { '5433' }
$dbName = if ($settings.DB_NAME) { $settings.DB_NAME } else { 'wave_verification' }
$dbUser = if ($settings.DB_USER) { $settings.DB_USER } else { 'wave_admin' }
if (-not $settings.DB_PASSWORD) { throw 'DB_PASSWORD est absent du fichier .env.' }

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $backupDir "wave-verification-$timestamp.dump"

$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $settings.DB_PASSWORD
    & $pgDump -h $dbHost -p $dbPort -U $dbUser -d $dbName -F c -f $backupFile
    if ($LASTEXITCODE -ne 0) { throw 'La sauvegarde PostgreSQL a echoue.' }
} finally {
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $previousPassword }
}

$size = (Get-Item -LiteralPath $backupFile).Length
Write-Output "Sauvegarde creee : $backupFile ($size octets)"

$retentionDays = 30
if ($settings.BACKUP_RETENTION_DAYS -and [int]::TryParse($settings.BACKUP_RETENTION_DAYS, [ref]$retentionDays)) {
    $retentionDays = [Math]::Min(3650, [Math]::Max(1, $retentionDays))
}
$cutoff = (Get-Date).AddDays(-$retentionDays)
$expiredBackups = Get-ChildItem -LiteralPath $backupDir -File -Filter 'wave-verification-*.dump' |
    Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName -ne $backupFile }
foreach ($expired in $expiredBackups) {
    Remove-Item -LiteralPath $expired.FullName -Force
}
Write-Output "Rotation terminee : $($expiredBackups.Count) ancienne(s) sauvegarde(s) supprimee(s), retention $retentionDays jours."
