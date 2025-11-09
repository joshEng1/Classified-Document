# Common Tasks Helper Script
# Quick access to frequently used operations

param(
    [Parameter(Position = 0)]
    [string]$Task = "menu"
)

$ErrorActionPreference = "Stop"
$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"

function Show-Menu {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "Document Classification System - Quick Tasks" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Available tasks:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. check       - Run system health check" -ForegroundColor White
    Write-Host "  2. start       - Start all services" -ForegroundColor White
    Write-Host "  3. stop        - Stop all services" -ForegroundColor White
    Write-Host "  4. restart     - Restart all services" -ForegroundColor White
    Write-Host "  5. status      - Check service status" -ForegroundColor White
    Write-Host "  6. logs        - View Docker logs" -ForegroundColor White
    Write-Host "  7. open        - Open web interface" -ForegroundColor White
    Write-Host "  8. gpu         - Check GPU status" -ForegroundColor White
    Write-Host "  9. build       - Build llama.cpp with Vulkan" -ForegroundColor White
    Write-Host "  10. env        - Create .env from example" -ForegroundColor White
    Write-Host "  11. clean      - Clean up Docker resources" -ForegroundColor White
    Write-Host "  12. docs       - Open documentation" -ForegroundColor White
    Write-Host ""
    Write-Host "Usage: .\tasks.ps1 <task>" -ForegroundColor Gray
    Write-Host "Example: .\tasks.ps1 start" -ForegroundColor Gray
    Write-Host ""
}

function Invoke-Check {
    Write-Host "Running system health check..." -ForegroundColor Yellow
    & "$PROJECT_DIR\check-system.ps1"
}

function Invoke-Start {
    Write-Host "Starting all services..." -ForegroundColor Yellow
    & "$PROJECT_DIR\start-all.ps1"
}

function Invoke-Stop {
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    & "$PROJECT_DIR\stop-all.ps1"
}

function Invoke-Restart {
    Write-Host "Restarting all services..." -ForegroundColor Yellow
    Invoke-Stop
    Start-Sleep -Seconds 3
    Invoke-Start
}

function Invoke-Status {
    Write-Host ""
    Write-Host "Service Status:" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    
    # Docker containers
    Write-Host ""
    Write-Host "Docker Containers:" -ForegroundColor Yellow
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | Write-Host
    
    # Check ports
    Write-Host ""
    Write-Host "Port Status:" -ForegroundColor Yellow
    $ports = @(
        @{Port = 5055; Service = "Classification Server" },
        @{Port = 7000; Service = "Docling Service" },
        @{Port = 8080; Service = "GPU Server" }
    )
    
    foreach ($p in $ports) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$($p.Port)/health" -TimeoutSec 2 -ErrorAction Stop
            Write-Host "  ✅ $($p.Service) (port $($p.Port)) - RUNNING" -ForegroundColor Green
        }
        catch {
            Write-Host "  ❌ $($p.Service) (port $($p.Port)) - NOT RESPONDING" -ForegroundColor Red
        }
    }
    
    # GPU process
    Write-Host ""
    Write-Host "GPU Server Process:" -ForegroundColor Yellow
    $llamaProc = Get-Process -Name "llama-server" -ErrorAction SilentlyContinue
    if ($llamaProc) {
        Write-Host "  ✅ Running (PID: $($llamaProc.Id))" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ Not running" -ForegroundColor Red
    }
    
    Write-Host ""
}

function Invoke-Logs {
    Write-Host "Viewing Docker logs (Ctrl+C to exit)..." -ForegroundColor Yellow
    Set-Location $PROJECT_DIR
    docker compose logs -f
}

function Invoke-OpenWeb {
    Write-Host "Opening web interface..." -ForegroundColor Yellow
    $webPath = "$PROJECT_DIR\web\index.html"
    if (Test-Path $webPath) {
        Start-Process $webPath
        Write-Host "✅ Web interface opened in browser" -ForegroundColor Green
    }
    else {
        Write-Host "❌ Web interface not found at: $webPath" -ForegroundColor Red
    }
}

function Invoke-GPU {
    Write-Host ""
    Write-Host "GPU Status:" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    
    # GPU info
    try {
        $gpu = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match "AMD|Radeon" } | Select-Object -First 1
        if ($gpu) {
            Write-Host ""
            Write-Host "GPU:" -ForegroundColor Yellow
            Write-Host "  Name: $($gpu.Name)" -ForegroundColor White
            Write-Host "  VRAM: $([math]::Round($gpu.AdapterRAM / 1GB, 2)) GB" -ForegroundColor White
            Write-Host "  Driver: $($gpu.DriverVersion)" -ForegroundColor White
        }
    }
    catch {
        Write-Host "❌ Could not retrieve GPU info" -ForegroundColor Red
    }
    
    # Vulkan
    Write-Host ""
    Write-Host "Vulkan:" -ForegroundColor Yellow
    if (Test-Path "C:\Windows\System32\vulkan-1.dll") {
        Write-Host "  ✅ vulkan-1.dll found" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ vulkan-1.dll not found" -ForegroundColor Red
    }
    
    # GPU Server
    Write-Host ""
    Write-Host "GPU Server:" -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -TimeoutSec 2
        Write-Host "  ✅ Running and responding" -ForegroundColor Green
    }
    catch {
        Write-Host "  ❌ Not responding" -ForegroundColor Red
    }
    
    Write-Host ""
}

function Invoke-Build {
    Write-Host "Building llama.cpp with Vulkan..." -ForegroundColor Yellow
    & "$PROJECT_DIR\build-llama.ps1"
}

function Invoke-CreateEnv {
    $envFile = "$PROJECT_DIR\server\.env"
    $envExample = "$PROJECT_DIR\server\.env.example"
    
    if (Test-Path $envFile) {
        Write-Host "⚠️  .env file already exists" -ForegroundColor Yellow
        $response = Read-Host "Overwrite? (y/n)"
        if ($response -ne 'y') {
            Write-Host "Cancelled" -ForegroundColor Gray
            return
        }
    }
    
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "✅ Created server\.env from .env.example" -ForegroundColor Green
        Write-Host "Edit $envFile to configure" -ForegroundColor Gray
    }
    else {
        Write-Host "❌ .env.example not found" -ForegroundColor Red
    }
}

function Invoke-Clean {
    Write-Host "Cleaning Docker resources..." -ForegroundColor Yellow
    Set-Location $PROJECT_DIR
    
    Write-Host "  Stopping containers..." -ForegroundColor Gray
    docker compose down
    
    Write-Host "  Removing unused containers..." -ForegroundColor Gray
    docker container prune -f
    
    Write-Host "  Removing unused images..." -ForegroundColor Gray
    docker image prune -f
    
    Write-Host "✅ Cleanup complete" -ForegroundColor Green
}

function Invoke-Docs {
    Write-Host ""
    Write-Host "Documentation:" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. WINDOWS-MIGRATION.md    - Quick reference" -ForegroundColor White
    Write-Host "  2. GPU-SETUP-WINDOWS.md    - Complete setup guide" -ForegroundColor White
    Write-Host "  3. MIGRATION-SUMMARY.md    - Technical details" -ForegroundColor White
    Write-Host "  4. README.md               - Project overview" -ForegroundColor White
    Write-Host "  5. AGENTS.md               - Architecture" -ForegroundColor White
    Write-Host ""
    
    $choice = Read-Host "Open which document? (1-5, or Enter to skip)"
    
    $docs = @(
        "WINDOWS-MIGRATION.md",
        "GPU-SETUP-WINDOWS.md",
        "MIGRATION-SUMMARY.md",
        "README.md",
        "AGENTS.md"
    )
    
    if ($choice -ge 1 -and $choice -le 5) {
        $docPath = "$PROJECT_DIR\$($docs[$choice-1])"
        if (Test-Path $docPath) {
            Start-Process $docPath
            Write-Host "✅ Opened $($docs[$choice-1])" -ForegroundColor Green
        }
        else {
            Write-Host "❌ Document not found" -ForegroundColor Red
        }
    }
}

# Main task router
Set-Location $PROJECT_DIR

switch ($Task.ToLower()) {
    "menu" { Show-Menu }
    "check" { Invoke-Check }
    "start" { Invoke-Start }
    "stop" { Invoke-Stop }
    "restart" { Invoke-Restart }
    "status" { Invoke-Status }
    "logs" { Invoke-Logs }
    "open" { Invoke-OpenWeb }
    "gpu" { Invoke-GPU }
    "build" { Invoke-Build }
    "env" { Invoke-CreateEnv }
    "clean" { Invoke-Clean }
    "docs" { Invoke-Docs }
    default {
        Write-Host "Unknown task: $Task" -ForegroundColor Red
        Show-Menu
    }
}
