# Complete System Startup Script (All Services)
# Starts Docker services AND GPU-accelerated Llama server in separate windows

$ErrorActionPreference = "Stop"

$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Starting Complete Document Classification System" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Start Docker services
Write-Host "📦 Starting Docker services..." -ForegroundColor Yellow
& "$PROJECT_DIR\start-system.ps1"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start Docker services" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "🎮 Starting GPU Server in New Window..." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Start GPU server in a new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PROJECT_DIR'; .\start-gpu-server.ps1"

Write-Host "✅ GPU server window opened" -ForegroundColor Green
Write-Host ""

# Wait a moment for GPU server to start
Write-Host "⏳ Waiting for GPU server to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test if GPU server is responding
$maxAttempts = 12
$attempt = 0
$gpuReady = $false

while ($attempt -lt $maxAttempts -and -not $gpuReady) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $gpuReady = $true
        }
    }
    catch {
        # Server not ready yet
    }
    
    if (-not $gpuReady) {
        $attempt++
        Write-Host "  Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "🎉 System Ready!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan

if ($gpuReady) {
    Write-Host "✅ GPU Server:             http://localhost:8080" -ForegroundColor Green
}
else {
    Write-Host "⏳ GPU Server:             http://localhost:8080 (still starting...)" -ForegroundColor Yellow
}

Write-Host "✅ Classification Server:  http://localhost:5055" -ForegroundColor Green
Write-Host "✅ Docling Service:        http://localhost:7000" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Open Web Interface:" -ForegroundColor Cyan
Write-Host "   file:///$PROJECT_DIR/web/index.html" -ForegroundColor White
Write-Host ""
Write-Host "To stop all services:" -ForegroundColor Cyan
Write-Host "  Run: .\stop-all.ps1" -ForegroundColor White
Write-Host "  Or manually:" -ForegroundColor White
Write-Host "    - Docker: docker compose down" -ForegroundColor Gray
Write-Host "    - GPU:    Close the GPU server window" -ForegroundColor Gray
Write-Host ""
