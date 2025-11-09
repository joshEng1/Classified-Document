# Build llama.cpp with Vulkan support on Windows
# This script automates the build process

$ErrorActionPreference = "Stop"

$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"
$TOOLS_DIR = "$PROJECT_DIR\tools"
$LLAMA_SRC = "$TOOLS_DIR\llama.cpp"
$LLAMA_BUILD = "$LLAMA_SRC\build"
$LLAMA_DEST = "$TOOLS_DIR\llama\build\bin"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Llama.cpp Build Script (Windows + Vulkan)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check for CMake
Write-Host "1. Checking prerequisites..." -ForegroundColor Yellow
try {
    $cmakeVersion = cmake --version | Select-Object -First 1
    Write-Host "   ✅ $cmakeVersion" -ForegroundColor Green
}
catch {
    Write-Host "   ❌ CMake not found" -ForegroundColor Red
    Write-Host "      Install from: https://cmake.org/download/" -ForegroundColor Yellow
    exit 1
}

# Check for Visual Studio
try {
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $vsPath = & $vsWhere -latest -property installationPath
        Write-Host "   ✅ Visual Studio found at: $vsPath" -ForegroundColor Green
    }
    else {
        throw "vswhere not found"
    }
}
catch {
    Write-Host "   ⚠️  Visual Studio not detected" -ForegroundColor Yellow
    Write-Host "      Install Visual Studio 2022 with C++ tools" -ForegroundColor Yellow
    Write-Host "      Or continue with another C++ compiler" -ForegroundColor Yellow
}

# Check for Vulkan SDK
if ($env:VULKAN_SDK) {
    Write-Host "   ✅ Vulkan SDK found: $env:VULKAN_SDK" -ForegroundColor Green
}
else {
    Write-Host "   ⚠️  VULKAN_SDK environment variable not set" -ForegroundColor Yellow
    Write-Host "      Install from: https://vulkan.lunarg.com/" -ForegroundColor Yellow
    Write-Host "      Make sure to add to PATH during installation" -ForegroundColor Yellow
    
    $response = Read-Host "Continue anyway? (y/n)"
    if ($response -ne 'y') {
        exit 1
    }
}

Write-Host ""

# Clone or update llama.cpp
Write-Host "2. Setting up llama.cpp source..." -ForegroundColor Yellow
if (Test-Path $LLAMA_SRC) {
    Write-Host "   Llama.cpp already exists, updating..." -ForegroundColor Gray
    Set-Location $LLAMA_SRC
    git pull
}
else {
    Write-Host "   Cloning llama.cpp..." -ForegroundColor Gray
    Set-Location $TOOLS_DIR
    git clone https://github.com/ggerganov/llama.cpp.git
    Set-Location $LLAMA_SRC
}

Write-Host "   ✅ Source ready" -ForegroundColor Green
Write-Host ""

# Create build directory
Write-Host "3. Configuring build..." -ForegroundColor Yellow
if (Test-Path $LLAMA_BUILD) {
    Write-Host "   Cleaning old build directory..." -ForegroundColor Gray
    Remove-Item -Recurse -Force $LLAMA_BUILD
}

New-Item -ItemType Directory -Path $LLAMA_BUILD | Out-Null
Set-Location $LLAMA_BUILD

Write-Host "   Running CMake with Vulkan support..." -ForegroundColor Gray
cmake .. -DLLAMA_VULKAN=ON -DCMAKE_BUILD_TYPE=Release

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ CMake configuration failed" -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Configuration complete" -ForegroundColor Green
Write-Host ""

# Build
Write-Host "4. Building (this may take several minutes)..." -ForegroundColor Yellow
cmake --build . --config Release

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Build complete" -ForegroundColor Green
Write-Host ""

# Copy binaries
Write-Host "5. Installing binaries..." -ForegroundColor Yellow

$buildBinDir = "$LLAMA_BUILD\bin\Release"
if (-not (Test-Path $buildBinDir)) {
    $buildBinDir = "$LLAMA_BUILD\bin"
}

if (Test-Path $buildBinDir) {
    New-Item -ItemType Directory -Path $LLAMA_DEST -Force | Out-Null
    
    Write-Host "   Copying executables..." -ForegroundColor Gray
    Copy-Item "$buildBinDir\*.exe" $LLAMA_DEST -Force
    Copy-Item "$buildBinDir\*.dll" $LLAMA_DEST -Force -ErrorAction SilentlyContinue
    
    Write-Host "   ✅ Binaries installed to: $LLAMA_DEST" -ForegroundColor Green
}
else {
    Write-Host "   ❌ Build output not found at: $buildBinDir" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Verify
Write-Host "6. Verifying installation..." -ForegroundColor Yellow
Set-Location $LLAMA_DEST

if (Test-Path ".\llama-server.exe") {
    Write-Host "   ✅ llama-server.exe found" -ForegroundColor Green
    
    # Check version
    $version = & ".\llama-server.exe" --version 2>&1 | Select-Object -First 10
    
    if ($version -match "vulkan|VULKAN|LLAMA_VULKAN") {
        Write-Host "   ✅ Vulkan support confirmed!" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠️  Vulkan support not detected in build" -ForegroundColor Yellow
        Write-Host "      Build may still work, but GPU acceleration uncertain" -ForegroundColor Yellow
    }
}
else {
    Write-Host "   ❌ llama-server.exe not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "✅ Build Complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Llama.cpp with Vulkan support is ready." -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Download a GGUF model to the models\ folder" -ForegroundColor White
Write-Host "2. Update model name in start-gpu-server.ps1" -ForegroundColor White
Write-Host "3. Run: .\start-gpu-server.ps1" -ForegroundColor White
Write-Host ""

Set-Location $PROJECT_DIR
