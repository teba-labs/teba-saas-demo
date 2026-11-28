param(
  [Parameter(Mandatory=$true)][string]$BaselineInstaller,
  [Parameter(Mandatory=$true)][string]$UpgradeInstaller
)
$ErrorActionPreference = 'Stop'
$baseline = (Resolve-Path $BaselineInstaller).Path
$upgrade = (Resolve-Path $UpgradeInstaller).Path
$appExe = Join-Path $env:LOCALAPPDATA 'Programs\Taiba Smart Lab\Taiba Smart Lab.exe'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Taiba Smart Lab.lnk'
$marker = [guid]::NewGuid().ToString('N')

function Wait-Renderer([int]$port) {
  node tests/windows/electron-devtools.mjs wait $port
  if ($LASTEXITCODE -ne 0) { throw "Renderer did not load on DevTools port $port" }
}
function Launch-Shortcut([int]$port) {
  if (-not (Test-Path $shortcutPath)) { throw "Installed desktop shortcut is missing: $shortcutPath" }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne [IO.Path]::GetFullPath($appExe)) {
    throw "Desktop shortcut points to an unexpected executable: $($shortcut.TargetPath)"
  }
  $shortcut.Arguments = "--remote-debugging-port=$port"
  $shortcut.Save()
  $shell.Run('"' + $shortcutPath + '"', 1, $false) | Out-Null
}
function Close-Renderer([int]$port, $process) {
  node tests/windows/electron-devtools.mjs close $port
  if ($LASTEXITCODE -ne 0) { throw "Could not close renderer on port $port" }
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
  } while ((Get-Date) -lt $deadline -and -not $process.HasExited)
  if (-not $process.HasExited) { throw "Taiba Smart Lab did not exit after closing the renderer" }
}

# Install the known previous release on a clean Windows runner.
$oldInstall = Start-Process -FilePath $baseline -ArgumentList '/S' -Wait -PassThru
if ($oldInstall.ExitCode -ne 0) { throw "Baseline installer failed: $($oldInstall.ExitCode)" }
if (-not (Test-Path $appExe)) { throw "Baseline application was not installed: $appExe" }
Launch-Shortcut 9222
Wait-Renderer 9222
$oldProcess = Get-Process -Name 'Taiba Smart Lab' -ErrorAction Stop | Select-Object -First 1
node tests/windows/electron-devtools.mjs seed 9222 $marker
if ($LASTEXITCODE -ne 0) { throw 'Could not seed the real offline database and persistent browser storage' }
Close-Renderer 9222 $oldProcess

# Upgrade in place using the newer NSIS installer; no uninstall or profile deletion.
$newInstall = Start-Process -FilePath $upgrade -ArgumentList '/S' -Wait -PassThru
if ($newInstall.ExitCode -ne 0) { throw "Upgrade installer failed: $($newInstall.ExitCode)" }
if (-not (Test-Path $appExe)) { throw 'The upgraded application executable is missing' }
Launch-Shortcut 9223
Wait-Renderer 9223
$newProcess = Get-Process -Name 'Taiba Smart Lab' -ErrorAction Stop | Select-Object -First 1
node tests/windows/electron-devtools.mjs verify 9223 $marker
if ($LASTEXITCODE -ne 0) { throw 'Upgrade lost one or more local settings, IndexedDB, Outbox, or OPFS file sentinels' }
Close-Renderer 9223 $newProcess

# A deliberately invalid installer package must fail before touching the working installation.
$badInstaller = Join-Path $env:TEMP 'Taiba-Smart-Lab-Invalid-Update.exe'
[IO.File]::WriteAllBytes($badInstaller, [Text.Encoding]::ASCII.GetBytes('NOT-A-WINDOWS-INSTALLER'))
$failedUpdateObserved = $false
try {
  $badRun = Start-Process -FilePath $badInstaller -ArgumentList '/S' -Wait -PassThru -ErrorAction Stop
  if ($badRun.ExitCode -ne 0) { $failedUpdateObserved = $true }
} catch {
  $failedUpdateObserved = $true
}
if (-not $failedUpdateObserved) { throw 'The intentionally invalid update unexpectedly reported success' }
if (-not (Test-Path $appExe)) { throw 'Failed update attempt removed the existing executable' }

# Recovery check: the upgraded app must still launch and retain every sentinel after the failed update attempt.
Launch-Shortcut 9224
Wait-Renderer 9224
$recoveredProcess = Get-Process -Name 'Taiba Smart Lab' -ErrorAction Stop | Select-Object -First 1
node tests/windows/electron-devtools.mjs verify 9224 $marker
if ($LASTEXITCODE -ne 0) { throw 'The installed application did not recover with its local data after the failed update attempt' }
Close-Renderer 9224 $recoveredProcess
Remove-Item $badInstaller -Force -ErrorAction SilentlyContinue
Write-Host 'PASS: baseline install -> in-place upgrade -> IndexedDB/Outbox/localStorage/OPFS persistence -> invalid-package failure -> app recovery.'
