$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$postgresScript = Join-Path $PSScriptRoot 'postgres.ps1'
$node = (Get-Command node -ErrorAction Stop).Source

Write-Output '1/3 Demarrage du stockage PostgreSQL...'
& $postgresScript start
if ($LASTEXITCODE -ne 0) { throw 'Impossible de demarrer PostgreSQL.' }

Write-Output '2/3 Verification du schema et du compte administrateur...'
& $node (Join-Path $projectDir 'database\init.js')
if ($LASTEXITCODE -ne 0) { throw 'Initialisation de la base impossible.' }

Write-Output '3/3 Demarrage de Portefeuille Demo sur http://localhost:3000'
Set-Location -LiteralPath $projectDir
& $node (Join-Path $projectDir 'server.js')
exit $LASTEXITCODE
