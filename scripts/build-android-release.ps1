$ErrorActionPreference = 'Stop'

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$keyProperties = Join-Path $projectDir 'android\key.properties'
$apiUrl = $env:CAPACITOR_SERVER_URL
if (-not $apiUrl -or $apiUrl -notmatch '^https://') {
    throw 'CAPACITOR_SERVER_URL doit contenir une URL HTTPS publique pour construire la release.'
}
if (-not (Test-Path -LiteralPath $keyProperties)) {
    throw 'android\key.properties est requis. Copiez key.properties.example puis renseignez votre keystore prive.'
}

$env:NODE_ENV = 'production'
$env:JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

Set-Location -LiteralPath $projectDir
& npm.cmd run mobile:sync
if ($LASTEXITCODE -ne 0) { throw 'Synchronisation Capacitor impossible.' }
& '.\android\gradlew.bat' -p android clean assembleRelease bundleRelease --no-daemon --max-workers=2 --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Compilation Android release impossible.' }

$artifactDir = Join-Path $projectDir 'artifacts'
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
$apkSource = Join-Path $projectDir 'android\app\build\outputs\apk\release\app-release.apk'
$bundleSource = Join-Path $projectDir 'android\app\build\outputs\bundle\release\app-release.aab'
Copy-Item -LiteralPath $apkSource -Destination (Join-Path $artifactDir 'PortefeuilleDemo-release.apk') -Force
Copy-Item -LiteralPath $bundleSource -Destination (Join-Path $artifactDir 'PortefeuilleDemo-release.aab') -Force
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $artifactDir 'PortefeuilleDemo-release.apk'), (Join-Path $artifactDir 'PortefeuilleDemo-release.aab') |
    Select-Object Path, Hash
