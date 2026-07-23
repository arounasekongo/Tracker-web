param(
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action = 'status'
)

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataDir = Join-Path $projectDir '.postgres-data'
$logFile = Join-Path $projectDir 'postgres-app.log'
$postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
$pgCtl = Join-Path $postgresBin 'pg_ctl.exe'
$pgIsReady = Join-Path $postgresBin 'pg_isready.exe'

if (-not (Test-Path -LiteralPath $pgCtl)) { throw "pg_ctl introuvable dans $postgresBin" }
if (-not (Test-Path -LiteralPath $pgIsReady)) { throw "pg_isready introuvable dans $postgresBin" }
if (-not (Test-Path -LiteralPath $dataDir)) { throw "Instance dediee absente: $dataDir" }

switch ($Action) {
    'start' {
        & $pgIsReady -h 127.0.0.1 -p 5433 -d wave_verification -q
        if ($LASTEXITCODE -eq 0) {
            Write-Output 'PostgreSQL local est deja actif sur 127.0.0.1:5433.'
            exit 0
        }
        & $pgCtl start -D $dataDir -l $logFile -o '-p 5433 -h 127.0.0.1' -w
    }
    'stop' { & $pgCtl stop -D $dataDir -m fast -w }
    'status' {
        & $pgIsReady -h 127.0.0.1 -p 5433 -d wave_verification
        if ($LASTEXITCODE -eq 0) {
            Write-Output 'Stockage PostgreSQL local disponible.'
            exit 0
        }
        Write-Error 'PostgreSQL local est arrete ou indisponible.'
        exit 1
    }
}

exit $LASTEXITCODE
