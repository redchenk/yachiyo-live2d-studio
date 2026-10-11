param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$LegacyUninstaller = ""
)
$ErrorActionPreference = "Stop"
# Installation tests alter the app's registry entries; run only on an empty CI VM.
if (-not $env:CI) { throw "This installer lifecycle test is restricted to disposable CI machines." }
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$installed = @(Get-ChildItem $uninstallKey | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Yachiyo Live2D Studio' })
if ($installed.Count) { throw "An existing Yachiyo install is present. Refusing to modify it." }
$sandbox = Join-Path $env:TEMP ('yachiyo-installer-' + [Guid]::NewGuid().ToString('N'))
$installDir = Join-Path $sandbox 'app'
$dataDir = Join-Path $sandbox 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$oldData = $env:YACHIYO_DATA_DIR
$oldPort = $env:YACHIYO_DESKTOP_PORT
$env:YACHIYO_DATA_DIR = $dataDir
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start(); $env:YACHIYO_DESKTOP_PORT = [string]$listener.LocalEndpoint.Port; $listener.Stop()
function Run-Checked([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit(120000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    throw "Process timed out: $File"
  }
  if ($process.ExitCode -ne 0) { throw "Process failed ($($process.ExitCode)): $File" }
}
try {
  $Installer = (Resolve-Path $Installer).Path
  Run-Checked $Installer "/S /currentuser /D=$installDir"
  $appExe = Join-Path $installDir 'Yachiyo Live2D Studio.exe'
  if (-not (Test-Path $appExe)) { throw 'Fresh installation did not produce the application.' }
  Run-Checked $appExe '--smoke-test'
  $database = Join-Path $dataDir 'MemoryData\yachiyo-memory.sqlite'
  if (-not (Test-Path $database)) { throw 'Packaged app did not create embedded SQLite memory.' }
  $dbHash = (Get-FileHash $database -Algorithm SHA256).Hash
  $marker = Join-Path $dataDir 'DesktopProfile\installer-preservation.json'
  '{"viewer":"installer-test","settings":"preserve"}' | Set-Content $marker
  $markerHash = (Get-FileHash $marker -Algorithm SHA256).Hash
  $uninstaller = Join-Path $installDir 'Uninstall Yachiyo Live2D Studio.exe'
  $legacyRepair = 'not exercised: legacy fixture not supplied'
  if ($LegacyUninstaller) {
    Copy-Item (Resolve-Path $LegacyUninstaller).Path $uninstaller -Force
    $brokenHash = (Get-FileHash $uninstaller -Algorithm SHA256).Hash
    $legacyRepair = 'exercised'
  }
  Run-Checked $Installer "/S /currentuser /D=$installDir"
  if ((Get-FileHash $database -Algorithm SHA256).Hash -ne $dbHash -or
      (Get-FileHash $marker -Algorithm SHA256).Hash -ne $markerHash) { throw 'Upgrade changed user data.' }
  if ($LegacyUninstaller -and (Get-FileHash $uninstaller -Algorithm SHA256).Hash -eq $brokenHash) { throw 'Legacy uninstaller was not repaired.' }
  # Run the uninstaller from outside the installation directory, as upgrades do.
  $uninstallCopy = Join-Path $sandbox 'uninstall-test.exe'
  Copy-Item $uninstaller $uninstallCopy
  Run-Checked $uninstallCopy "/S /KEEP_APP_DATA /currentuser _?=$installDir"
  if (Test-Path $appExe) { throw 'Uninstall left the application executable behind.' }
  if ((Get-FileHash $database -Algorithm SHA256).Hash -ne $dbHash -or
      (Get-FileHash $marker -Algorithm SHA256).Hash -ne $markerHash) { throw 'Uninstall changed retained user data.' }
  @{passed=$true; freshInstall=$true; upgrade=$true; uninstall=$true; sqlitePreserved=$true; settingsPreserved=$true; legacyRepair=$legacyRepair} |
    ConvertTo-Json | Set-Content (Join-Path (Split-Path $Installer) 'windows-lifecycle.json')
} finally {
  $env:YACHIYO_DATA_DIR = $oldData
  $env:YACHIYO_DESKTOP_PORT = $oldPort
  # Keep the sandbox/logs for diagnosis if a test fails; the CI VM is disposable.
}
