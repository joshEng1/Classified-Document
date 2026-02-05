param(
  [switch]$Vision,
  [switch]$Guardian,
  [switch]$Slm
)

$ErrorActionPreference = "Stop"

function Stop-FromPidFile([string]$Name, [string]$PidFile) {
  if (!(Test-Path $PidFile)) {
    Write-Host "[$Name] No pid file: $PidFile"
    return
  }

  $pidRaw = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $procId = 0
  if (![int]::TryParse([string]$pidRaw, [ref]$procId)) {
    Write-Host "[$Name] Invalid pid file; deleting: $PidFile"
    Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
    return
  }

  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($null -eq $p) {
    Write-Host "[$Name] Process $procId not running; deleting pid file."
    Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
    return
  }

  Write-Host "[$Name] Stopping pid $procId ($($p.ProcessName)) ..."
  Stop-Process -Id $procId -Force
  Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidDir = Join-Path $repoRoot ".run\\pids"

$stopAll = -not ($Vision.IsPresent -or $Guardian.IsPresent -or $Slm.IsPresent)

if ($stopAll -or $Vision)   { Stop-FromPidFile -Name "vision"   -PidFile (Join-Path $pidDir "vision.pid") }
if ($stopAll -or $Guardian) { Stop-FromPidFile -Name "guardian" -PidFile (Join-Path $pidDir "guardian.pid") }
if ($stopAll -or $Slm)      { Stop-FromPidFile -Name "slm"      -PidFile (Join-Path $pidDir "slm.pid") }

Write-Host "Done."
