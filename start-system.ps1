# Master startup script for Document Classification System (Windows Native)
# Starts Docker services and coordinates with Windows GPU llama-server

$ErrorActionPreference = "Stop"

$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Document Classification System Startup (Windows)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is accessible
try {
    $null = docker ps 2>&1
    Write-Host "✅ Docker is accessible" -ForegroundColor Green
}
catch {
    Write-Host "❌ ERROR: Docker is not accessible" -ForegroundColor Red
    Write-Host "Please make sure Docker Desktop is running" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Start Docker services
Write-Host "📦 Starting Docker services (docling + classification server)..." -ForegroundColor Yellow
Set-Location $PROJECT_DIR
$env:DOCKER_HOST = $null

docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start Docker services" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check if services are running
$dockerPs = docker ps

if ($dockerPs -match "docling") {
    Write-Host "✅ Docling service is running on port 7000" -ForegroundColor Green
}
else {
    Write-Host "⚠️  Warning: Docling service may not be running" -ForegroundColor Yellow
}

if ($dockerPs -match "server") {
    Write-Host "✅ Classification server is running on port 5055" -ForegroundColor Green
}
else {
    Write-Host "⚠️  Warning: Classification server may not be running" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "🚀 System Status:" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "✅ Docling Service:        http://localhost:7000" -ForegroundColor Green
Write-Host "✅ Classification Server:  http://localhost:5055" -ForegroundColor Green
Write-Host "⏳ Llama Server:           http://localhost:8080 (start with start-gpu-server.ps1)" -ForegroundColor Yellow
Write-Host "🌐 Web Interface:          file:///$PROJECT_DIR/web/index.html" -ForegroundColor Green
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "1. Open another PowerShell window" -ForegroundColor White
Write-Host "2. Run: cd $PROJECT_DIR" -ForegroundColor White
Write-Host "3. Run: .\start-gpu-server.ps1" -ForegroundColor White
Write-Host ""
Write-Host "This will start the GPU-accelerated LLM with AMD Vulkan (10-20x faster!)" -ForegroundColor Yellow
Write-Host ""
Write-Host "To stop services:" -ForegroundColor Cyan
Write-Host "  - Docker: docker compose down" -ForegroundColor White
Write-Host "  - Llama:  Press Ctrl+C in the GPU server window" -ForegroundColor White
Write-Host ""
