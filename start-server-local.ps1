#!/usr/bin/env pwsh
# Run Classification Server Locally (without Docker)
# This script runs the Node.js server directly on Windows

param(
    [string]$Port = "5055",
    [switch]$NoBuild
)

Write-Host "`n╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Starting Classification Server Locally (Port $Port)          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Check prerequisites
Write-Host "🔍 Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  ✅ Node.js: $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ❌ Node.js not found. Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Check if GPU server is running
try {
    $null = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  ✅ GPU Server (port 8080): Running" -ForegroundColor Green
}
catch {
    Write-Host "  ⚠️  GPU Server (port 8080): Not responding" -ForegroundColor Yellow
    Write-Host "     The server will start but classification won't work without the GPU server." -ForegroundColor Yellow
    Write-Host "     Run: .\start-gpu-server.ps1" -ForegroundColor Gray
}

# Check if Docling service is running
try {
    $null = Invoke-WebRequest -Uri "http://localhost:7000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  ✅ Docling Service (port 7000): Running" -ForegroundColor Green
}
catch {
    Write-Host "  ⚠️  Docling Service (port 7000): Not responding" -ForegroundColor Yellow
    Write-Host "     The server will start but document extraction may be limited." -ForegroundColor Yellow
    Write-Host "     Run: docker compose up docling -d" -ForegroundColor Gray
}

# Navigate to server directory
$serverDir = Join-Path $PSScriptRoot "server"
Set-Location $serverDir

# Install dependencies if needed
if (-not $NoBuild) {
    if (-not (Test-Path "node_modules")) {
        Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
        npm install
    }
    else {
        Write-Host "  ✅ Dependencies already installed" -ForegroundColor Green
    }
}

# Check for .env file
if (-not (Test-Path ".env")) {
    Write-Host "`n⚙️  Creating .env file from .env.example..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  ✅ Created .env file" -ForegroundColor Green
    }
}

# Set environment variables
$env:PORT = $Port
$env:LLAMA_URL = "http://localhost:8080"
$env:DOCLING_URL = "http://localhost:7000"
$env:LOCAL_CLASSIFIER = "llama"
$env:VERIFIER_ENGINE = "llama"
$env:VERIFY_SECOND_PASS = "true"
$env:REDACT_PII = "true"
$env:CROSS_VERIFY = "false"
$env:OFFLINE_MODE = "true"

Write-Host "`n🚀 Starting server..." -ForegroundColor Green
Write-Host "   Server will be available at: http://localhost:$Port" -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop the server`n" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

# Start the server
node src/index.js
