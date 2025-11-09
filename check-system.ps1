# System Health Check and Verification Script

$ErrorActionPreference = "Continue"

$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Document Classification System Health Check" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check 1: PowerShell version
Write-Host "1. Checking PowerShell version..." -ForegroundColor Yellow
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -ge 5) {
    Write-Host "   ✅ PowerShell $($psVersion.Major).$($psVersion.Minor) - OK" -ForegroundColor Green
}
else {
    Write-Host "   ❌ PowerShell $($psVersion.Major).$($psVersion.Minor) - Upgrade to 5.1+" -ForegroundColor Red
    $allGood = $false
}

# Check 2: Docker
Write-Host "2. Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "   ✅ $dockerVersion" -ForegroundColor Green
    
    # Check if Docker is running
    $null = docker ps 2>&1
    Write-Host "   ✅ Docker is running" -ForegroundColor Green
}
catch {
    Write-Host "   ❌ Docker not found or not running" -ForegroundColor Red
    Write-Host "      Install Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    $allGood = $false
}

# Check 3: AMD GPU
Write-Host "3. Checking AMD GPU..." -ForegroundColor Yellow
try {
    $gpu = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match "AMD|Radeon" } | Select-Object -First 1
    if ($gpu) {
        Write-Host "   ✅ GPU: $($gpu.Name)" -ForegroundColor Green
        $vramGB = [math]::Round($gpu.AdapterRAM / 1GB, 2)
        Write-Host "   ✅ VRAM: $vramGB GB" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠️  No AMD GPU detected (will use CPU)" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   ⚠️  Could not detect GPU info" -ForegroundColor Yellow
}

# Check 4: Vulkan
Write-Host "4. Checking Vulkan..." -ForegroundColor Yellow
if (Test-Path "C:\Windows\System32\vulkan-1.dll") {
    Write-Host "   ✅ Vulkan DLL found" -ForegroundColor Green
}
else {
    Write-Host "   ⚠️  Vulkan DLL not found" -ForegroundColor Yellow
    Write-Host "      Download Vulkan SDK: https://vulkan.lunarg.com/" -ForegroundColor Yellow
}

# Check 5: Llama.cpp
Write-Host "5. Checking llama.cpp..." -ForegroundColor Yellow
$llamaPath = "$PROJECT_DIR\tools\llama\build\bin\llama-server.exe"
if (Test-Path $llamaPath) {
    Write-Host "   ✅ llama-server.exe found" -ForegroundColor Green
    
    # Try to get version
    try {
        Set-Location "$PROJECT_DIR\tools\llama\build\bin"
        $version = & ".\llama-server.exe" --version 2>&1 | Select-Object -First 5
        if ($version -match "vulkan|VULKAN") {
            Write-Host "   ✅ Vulkan support detected" -ForegroundColor Green
        }
        else {
            Write-Host "   ⚠️  Vulkan support not confirmed in build" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "   ⚠️  Could not verify version" -ForegroundColor Yellow
    }
}
else {
    Write-Host "   ❌ llama-server.exe not found at:" -ForegroundColor Red
    Write-Host "      $llamaPath" -ForegroundColor Gray
    Write-Host "      Download from: https://github.com/ggerganov/llama.cpp/releases" -ForegroundColor Yellow
    $allGood = $false
}

# Check 6: Models
Write-Host "6. Checking models..." -ForegroundColor Yellow
$modelsDir = "$PROJECT_DIR\models"
if (Test-Path $modelsDir) {
    $models = Get-ChildItem -Path $modelsDir -Filter "*.gguf" -ErrorAction SilentlyContinue
    if ($models) {
        Write-Host "   ✅ Found $($models.Count) GGUF model(s):" -ForegroundColor Green
        foreach ($model in $models) {
            $sizeMB = [math]::Round($model.Length / 1MB, 0)
            Write-Host "      - $($model.Name) ($sizeMB MB)" -ForegroundColor Gray
        }
    }
    else {
        Write-Host "   ⚠️  No GGUF models found in models\" -ForegroundColor Yellow
        Write-Host "      Download from: https://huggingface.co/models?library=gguf" -ForegroundColor Yellow
        $allGood = $false
    }
}
else {
    Write-Host "   ⚠️  Models directory not found" -ForegroundColor Yellow
    $allGood = $false
}

# Check 7: Node.js
Write-Host "7. Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "   ✅ Node.js $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "   ⚠️  Node.js not found (only needed for native server)" -ForegroundColor Yellow
}

# Check 8: Configuration files
Write-Host "8. Checking configuration..." -ForegroundColor Yellow
$envFile = "$PROJECT_DIR\server\.env"
$envExample = "$PROJECT_DIR\server\.env.example"

if (Test-Path $envFile) {
    Write-Host "   ✅ server\.env exists" -ForegroundColor Green
}
else {
    if (Test-Path $envExample) {
        Write-Host "   ⚠️  server\.env not found, but .env.example exists" -ForegroundColor Yellow
        Write-Host "      Run: Copy-Item '$envExample' '$envFile'" -ForegroundColor Yellow
    }
    else {
        Write-Host "   ❌ No .env files found" -ForegroundColor Red
        $allGood = $false
    }
}

# Check 9: Required directories
Write-Host "9. Checking directories..." -ForegroundColor Yellow
$dirs = @("server", "web", "docling-service", "uploads", "tools")
foreach ($dir in $dirs) {
    if (Test-Path "$PROJECT_DIR\$dir") {
        Write-Host "   ✅ $dir\" -ForegroundColor Green
    }
    else {
        Write-Host "   ❌ $dir\ not found" -ForegroundColor Red
        $allGood = $false
    }
}

# Check 10: Port availability
Write-Host "10. Checking ports..." -ForegroundColor Yellow
$ports = @(5055, 7000, 8080)
foreach ($port in $ports) {
    $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Host "   ⚠️  Port $port is in use (services may be running)" -ForegroundColor Yellow
    }
    else {
        Write-Host "   ✅ Port $port available" -ForegroundColor Green
    }
}

# Summary
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

if ($allGood) {
    Write-Host ""
    Write-Host "✅ System is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Ensure you have a .env file: Copy-Item 'server\.env.example' 'server\.env'" -ForegroundColor White
    Write-Host "2. Start the system: .\start-all.ps1" -ForegroundColor White
    Write-Host "3. Open web interface: Start-Process 'web\index.html'" -ForegroundColor White
}
else {
    Write-Host ""
    Write-Host "⚠️  Some issues found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please address the issues marked with ❌ above." -ForegroundColor Yellow
    Write-Host "See GPU-SETUP-WINDOWS.md for detailed setup instructions." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "For detailed setup: GPU-SETUP-WINDOWS.md" -ForegroundColor Cyan
Write-Host "For migration info: WINDOWS-MIGRATION.md" -ForegroundColor Cyan
Write-Host ""

# Return to project directory
Set-Location $PROJECT_DIR
