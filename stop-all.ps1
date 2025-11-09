# Stop all services (Docker + GPU server)

$ErrorActionPreference = "Continue"

$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Stopping Document Classification System" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Stop Docker services
Write-Host "📦 Stopping Docker services..." -ForegroundColor Yellow
Set-Location $PROJECT_DIR
docker compose down

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker services stopped" -ForegroundColor Green
}
else {
    Write-Host "⚠️  Error stopping Docker services (may already be stopped)" -ForegroundColor Yellow
}

Write-Host ""

# Try to stop llama-server processes
Write-Host "🎮 Stopping GPU server processes..." -ForegroundColor Yellow
$llamaProcesses = Get-Process -Name "llama-server" -ErrorAction SilentlyContinue

if ($llamaProcesses) {
    $llamaProcesses | ForEach-Object {
        Write-Host "  Stopping llama-server (PID: $($_.Id))..." -ForegroundColor Gray
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "✅ GPU server processes stopped" -ForegroundColor Green
}
else {
    Write-Host "✅ No GPU server processes running" -ForegroundColor Green
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "✅ All services stopped" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
