param(
  # By default: Vision + Guardian ON, SLM OFF.
  [switch]$NoLlm,
  [switch]$NoVision,
  [switch]$NoGuardian,
  [switch]$Slm,

  [string]$LlamaServerExe = "",
  [string]$ModelsDir = "",
  [string]$ServerEnvFile = "",

  [string]$BindHost = "0.0.0.0",

  # Ports default to the values in server/.env if present; otherwise these defaults are used.
  [int]$LlmPort = 8080,
  [int]$VisionPort = 8082,
  [int]$GuardianPort = 8081,
  [int]$SlmPort = 8083,

  # Model files (relative to ModelsDir by default). These are GGUF filenames, not "model ids".
  [string]$LlmModelFile = "",
  [string]$VisionModelFile = "granite-vision-3.2-2b-Q5_K_M.gguf",
  [string]$VisionMmprojFile = "mmproj-model-f16.gguf",
  [string]$GuardianModelFile = "granite-guardian-3.2-3b-a800m-Q6_K.gguf",
  [string]$SlmModelFile = "Qwen3-0.6B-Q8_0.gguf",

  [int]$LlmCtx = 8192,
  [int]$VisionCtx = 8192,
  [int]$GuardianCtx = 8192,
  [int]$SlmCtx = 2048,

  [int]$SlmBatch = 128,
  [int]$SlmUBatch = 64
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPaths {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $defaultModelsDir = Join-Path $repoRoot "models"
  $defaultLlamaServerExe = Join-Path $repoRoot "llamacpp\\llama-server.exe"
  $defaultServerEnvFile = Join-Path $repoRoot "server\\.env"

  if ([string]::IsNullOrWhiteSpace($ModelsDir)) { $script:ModelsDir = $defaultModelsDir }
  else { $script:ModelsDir = (Resolve-Path $ModelsDir).Path }

  if ([string]::IsNullOrWhiteSpace($LlamaServerExe)) { $script:LlamaServerExe = $defaultLlamaServerExe }
  else { $script:LlamaServerExe = (Resolve-Path $LlamaServerExe).Path }

  if ([string]::IsNullOrWhiteSpace($ServerEnvFile)) { $script:ServerEnvFile = $defaultServerEnvFile }
  else { $script:ServerEnvFile = (Resolve-Path $ServerEnvFile).Path }

  $script:RepoRoot = $repoRoot
  $script:RunDir = Join-Path $repoRoot ".run"
  $script:PidDir = Join-Path $script:RunDir "pids"
  $script:LogDir = Join-Path $script:RunDir "logs"
}

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $script:PidDir | Out-Null
  New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
}

function Test-PortListening([int]$Port) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
    return $null -ne $c
  } catch {
    return $false
  }
}

function Load-DotEnv([string]$filePath) {
  $map = @{}
  if (!(Test-Path -Path $filePath)) { return $map }
  $lines = Get-Content -Path $filePath -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    $s = ""
    if ($null -ne $line) { $s = [string]$line }
    $trim = $s.Trim()
    if ([string]::IsNullOrWhiteSpace($trim)) { continue }
    if ($trim.StartsWith("#")) { continue }
    $idx = $trim.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $trim.Substring(0, $idx).Trim()
    $val = $trim.Substring($idx + 1).Trim()
    # Strip inline comments for unquoted values.
    if (!($val.StartsWith('"') -or $val.StartsWith("'"))) {
      $hash = $val.IndexOf(" #")
      if ($hash -gt 0) { $val = $val.Substring(0, $hash).Trim() }
    }
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    if (![string]::IsNullOrWhiteSpace($key)) {
      $map[$key] = $val
    }
  }
  return $map
}

function Try-GetPortFromUrl([string]$url, [int]$fallback) {
  try {
    if ([string]::IsNullOrWhiteSpace($url)) { return $fallback }
    $u = [Uri]$url
    if ($u.Port -gt 0) { return $u.Port }
    return $fallback
  } catch {
    return $fallback
  }
}

function Start-ModelServer {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][int]$Port,
    [Parameter(Mandatory=$true)][string[]]$Args
  )

  function Quote-Arg([string]$a) {
    if ($null -eq $a) { return '""' }
    $s = [string]$a
    if ($s -match '[\s"]') {
      $escaped = $s -replace '"', '\"'
      return '"' + $escaped + '"'
    }
    return $s
  }

  if (Test-PortListening -Port $Port) {
    Write-Host "[$Name] Port $Port already listening; skipping start."
    return
  }

  $outLog = Join-Path $script:LogDir "$Name.out.log"
  $errLog = Join-Path $script:LogDir "$Name.err.log"
  $pidFile = Join-Path $script:PidDir "$Name.pid"

  Write-Host "[$Name] Starting on $BindHost`:$Port ..."
  Write-Host "[$Name] Logs: $outLog"

  $argLine = ($Args | ForEach-Object { Quote-Arg $_ }) -join ' '

  $p = Start-Process `
    -FilePath $script:LlamaServerExe `
    -ArgumentList $argLine `
    -PassThru `
    -WindowStyle Minimized `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

  Set-Content -Encoding ascii -NoNewline -Path $pidFile -Value $p.Id

  Start-Sleep -Milliseconds 350
  if (Test-PortListening -Port $Port) {
    Write-Host "[$Name] OK (pid $($p.Id))"
  } else {
    Write-Host "[$Name] Started (pid $($p.Id)) but port not listening yet. Check logs:"
    Write-Host "  $errLog"
  }
}

Resolve-RepoPaths
Ensure-Dirs

$envMap = Load-DotEnv -filePath $script:ServerEnvFile
if ($envMap.Count -gt 0) {
  $LlmPort = Try-GetPortFromUrl -url $envMap["LLAMA_URL"] -fallback $LlmPort
  $SlmPort = Try-GetPortFromUrl -url $envMap["SLM_URL"] -fallback $SlmPort
  $GuardianPort = Try-GetPortFromUrl -url $envMap["GUARDIAN_URL"] -fallback $GuardianPort
  $VisionPort = Try-GetPortFromUrl -url $envMap["VISION_URL"] -fallback $VisionPort

  if ([string]::IsNullOrWhiteSpace($LlmModelFile) -and $envMap.ContainsKey("LLM_MODEL_NAME")) {
    $LlmModelFile = $envMap["LLM_MODEL_NAME"]
  }
  if ($envMap.ContainsKey("VISION_MODEL") -and ![string]::IsNullOrWhiteSpace($envMap["VISION_MODEL"])) {
    $VisionModelFile = $envMap["VISION_MODEL"]
  }
}

$visionEnabled = -not $NoVision.IsPresent
$guardianEnabled = -not $NoGuardian.IsPresent
$slmEnabled = $Slm.IsPresent
$llmEnabled = -not $NoLlm.IsPresent

if (!(Test-Path -Path $script:LlamaServerExe)) {
  throw "llama-server.exe not found at: $script:LlamaServerExe"
}
if (!(Test-Path -Path $script:ModelsDir)) {
  throw "Models dir not found at: $script:ModelsDir"
}

$didStartAny = $false

if ($llmEnabled) {
  if ([string]::IsNullOrWhiteSpace($LlmModelFile)) {
    Write-Host "[llm] Skipping: LlmModelFile not set and LLM_MODEL_NAME not found in server/.env."
    Write-Host "[llm] Provide -LlmModelFile <gguf> or set LLM_MODEL_NAME in server/.env."
  } else {
    $llmModelPath = Join-Path $script:ModelsDir $LlmModelFile
    if (!(Test-Path $llmModelPath)) {
      Write-Host "[llm] Skipping: model not found: $llmModelPath"
    } else {
      Start-ModelServer `
        -Name "llm" `
        -Port $LlmPort `
        -Args @(
          "--host", $BindHost,
          "--port", "$LlmPort",
          "-m", $llmModelPath,
          "--ctx-size", "$LlmCtx",
          "--no-jinja"
        )
      $didStartAny = $true
    }
  }
}

if ($visionEnabled) {
  $visionModelPath = Join-Path $script:ModelsDir $VisionModelFile
  $visionMmprojPath = Join-Path $script:ModelsDir $VisionMmprojFile
  if (!(Test-Path $visionModelPath)) { throw "Vision model not found: $visionModelPath" }
  if (!(Test-Path $visionMmprojPath)) { throw "Vision mmproj not found: $visionMmprojPath" }

  Start-ModelServer `
    -Name "vision" `
    -Port $VisionPort `
    -Args @(
      "--host", $BindHost,
      "--port", "$VisionPort",
      "-m", $visionModelPath,
      "--mmproj", $visionMmprojPath
    )
  $didStartAny = $true
}

if ($guardianEnabled) {
  $guardianModelPath = Join-Path $script:ModelsDir $GuardianModelFile
  if (!(Test-Path $guardianModelPath)) { throw "Guardian model not found: $guardianModelPath" }

  Start-ModelServer `
    -Name "guardian" `
    -Port $GuardianPort `
    -Args @(
      "--host", $BindHost,
      "--port", "$GuardianPort",
      "-m", $guardianModelPath,
      "--ctx-size", "$GuardianCtx",
      "--no-jinja"
    )
  $didStartAny = $true
}

if ($slmEnabled) {
  $slmModelPath = Join-Path $script:ModelsDir $SlmModelFile
  if (!(Test-Path $slmModelPath)) { throw "SLM model not found: $slmModelPath" }

  Start-ModelServer `
    -Name "slm" `
    -Port $SlmPort `
    -Args @(
      "--host", $BindHost,
      "--port", "$SlmPort",
      "-m", $slmModelPath,
      "--ctx-size", "$SlmCtx",
      "--batch-size", "$SlmBatch",
      "--ubatch-size", "$SlmUBatch",
      "--no-jinja"
    )
  $didStartAny = $true
}

Write-Host ""
Write-Host "Done."
Write-Host "Health checks:"
if ($llmEnabled -and $didStartAny)      { Write-Host "  curl.exe http://localhost:$LlmPort/v1/models" }
if ($visionEnabled)   { Write-Host "  curl.exe http://localhost:$VisionPort/v1/models" }
if ($guardianEnabled) { Write-Host "  curl.exe http://localhost:$GuardianPort/v1/models" }
if ($slmEnabled)      { Write-Host "  curl.exe http://localhost:$SlmPort/v1/models" }
