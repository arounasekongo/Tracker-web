param(
    [string]$BackupFile = ''
)

$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectDir '.env'
$backupDir = Join-Path $projectDir '.backups'
$postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
$createdb = Join-Path $postgresBin 'createdb.exe'
$dropdb = Join-Path $postgresBin 'dropdb.exe'
$pgRestore = Join-Path $postgresBin 'pg_restore.exe'
$psql = Join-Path $postgresBin 'psql.exe'

foreach ($tool in @($createdb, $dropdb, $pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Outil PostgreSQL introuvable : $tool" }
}
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Fichier .env introuvable.' }
if (-not (Test-Path -LiteralPath $backupDir)) { throw 'Dossier de sauvegarde introuvable.' }

$settings = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    $settings[$name.Trim()] = $value.Trim()
}

$dbHost = if ($settings.DB_HOST) { $settings.DB_HOST } else { '127.0.0.1' }
$dbPort = if ($settings.DB_PORT) { $settings.DB_PORT } else { '5433' }
$dbUser = if ($settings.DB_USER) { $settings.DB_USER } else { 'wave_admin' }
if (-not $settings.DB_PASSWORD) { throw 'DB_PASSWORD est absent du fichier .env.' }

if (-not $BackupFile) {
    $latest = Get-ChildItem -LiteralPath $backupDir -File -Filter 'wave-verification-*.dump' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) { throw 'Aucune sauvegarde a verifier.' }
    $BackupFile = $latest.FullName
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
$resolvedBackupDir = (Resolve-Path -LiteralPath $backupDir).Path.TrimEnd('\') + '\'
if (-not $resolvedBackup.StartsWith($resolvedBackupDir, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($resolvedBackup) -notmatch '^wave-verification-\d{8}-\d{6}\.dump$') {
    throw 'La verification accepte uniquement une archive datee du dossier .backups.'
}

$temporaryDatabase = "wave_restore_verify_$PID`_$(Get-Date -Format 'yyyyMMddHHmmss')"
$previousPassword = $env:PGPASSWORD
$databaseCreated = $false
try {
    $env:PGPASSWORD = $settings.DB_PASSWORD

    & $pgRestore --list $resolvedBackup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Le catalogue de la sauvegarde est illisible.' }

    & $createdb -h $dbHost -p $dbPort -U $dbUser --maintenance-db postgres --template template0 $temporaryDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Creation de la base temporaire impossible.' }
    $databaseCreated = $true

    & $pgRestore -h $dbHost -p $dbPort -U $dbUser --dbname $temporaryDatabase --no-owner --no-privileges --exit-on-error $resolvedBackup
    if ($LASTEXITCODE -ne 0) { throw 'La restauration de verification a echoue.' }

    $schemaCheck = & $psql -h $dbHost -p $dbPort -U $dbUser -d $temporaryDatabase -X -A -t -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN to_regclass('public.verifications') IS NOT NULL AND to_regclass('public.admins') IS NOT NULL AND to_regclass('public.audit_logs') IS NOT NULL THEN 'ok' ELSE 'missing' END;"
    if ($LASTEXITCODE -ne 0 -or $schemaCheck.Trim() -ne 'ok') {
        throw 'La sauvegarde restauree ne contient pas le schema attendu.'
    }

    $verificationCount = & $psql -h $dbHost -p $dbPort -U $dbUser -d $temporaryDatabase -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) FROM verifications;'
    if ($LASTEXITCODE -ne 0) { throw 'Lecture de la base restauree impossible.' }
    Write-Output "Sauvegarde restauree et validee : $resolvedBackup ($($verificationCount.Trim()) verification(s))."
} finally {
    if ($databaseCreated) {
        & $dropdb -h $dbHost -p $dbPort -U $dbUser --maintenance-db postgres --if-exists $temporaryDatabase
        if ($LASTEXITCODE -ne 0) { Write-Warning "Suppression de la base temporaire $temporaryDatabase impossible." }
    }
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $previousPassword }
}
