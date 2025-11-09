# GPU-Accelerated Llama Server Startup Script (Windows + AMD Vulkan)
# Optimized for AMD Radeon GPUs using Vulkan backend

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_DIR = "C:\TamuDatathon\Classification-Document-Analyzer-Datathon"
$LLAMA_DIR = "$PROJECT_DIR\tools\llama\build\bin"
$MODELS_DIR = "$PROJECT_DIR\models"
$MODEL_NAME = "LFM2-8B-A1B-Q4_K_M.gguf"  # Adjust to your model filename
$MODEL_PATH = "$MODELS_DIR\$MODEL_NAME"

# Server Configuration
$PORT = 8080
$SERVER_HOST = "127.0.0.1"  # Localhost - host networking mode will allow Docker access
$CONTEXT_SIZE = 8192      # Context window size (adjust based on VRAM)
$N_GPU_LAYERS = 99        # Offload all layers to GPU (-1 for auto, 99 for all)
$THREADS = 8              # CPU threads for non-GPU operations
$BATCH_SIZE = 512         # Batch size for prompt processing
$PARALLEL = 4             # Number of parallel requests

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "GPU-Accelerated Llama Server (AMD Vulkan)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if llama-server exists
if (-not (Test-Path "$LLAMA_DIR\llama-server.exe")) {
    Write-Host "❌ ERROR: llama-server.exe not found at $LLAMA_DIR" -ForegroundColor Red
    Write-Host "Please build llama.cpp with Vulkan support first." -ForegroundColor Yellow
    Write-Host "See build instructions in GPU-SETUP-WINDOWS.md" -ForegroundColor Yellow
    exit 1
}

# Check if model exists
if (-not (Test-Path $MODEL_PATH)) {
    Write-Host "❌ ERROR: Model not found at $MODEL_PATH" -ForegroundColor Red
    Write-Host "Please download a GGUF model and place it in the models directory." -ForegroundColor Yellow
    Write-Host "Example: https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Llama server executable found" -ForegroundColor Green
Write-Host "✅ Model found: $MODEL_NAME" -ForegroundColor Green
Write-Host ""

# Display GPU information
Write-Host "🎮 Detecting AMD GPU..." -ForegroundColor Yellow
try {
    $gpu = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match "AMD|Radeon" } | Select-Object -First 1
    if ($gpu) {
        Write-Host "✅ GPU: $($gpu.Name)" -ForegroundColor Green
        Write-Host "   VRAM: $([math]::Round($gpu.AdapterRAM / 1GB, 2)) GB" -ForegroundColor Green
    }
}
catch {
    Write-Host "⚠️  Could not detect GPU info, continuing anyway..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Server Configuration:" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Port:          $PORT" -ForegroundColor White
Write-Host "Host:          $SERVER_HOST" -ForegroundColor White
Write-Host "Context Size:  $CONTEXT_SIZE" -ForegroundColor White
Write-Host "GPU Layers:    $N_GPU_LAYERS" -ForegroundColor White
Write-Host "Threads:       $THREADS" -ForegroundColor White
Write-Host "Batch Size:    $BATCH_SIZE" -ForegroundColor White
Write-Host "Backend:       Vulkan (AMD GPU)" -ForegroundColor Green
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "🚀 Starting llama-server with Vulkan backend..." -ForegroundColor Yellow
Write-Host ""

# Change to llama directory
Set-Location $LLAMA_DIR

# Start llama-server with Vulkan
# Note: The --n-gpu-layers flag will use Vulkan if llama.cpp was built with Vulkan support
& ".\llama-server.exe" `
    --model $MODEL_PATH `
    --host $SERVER_HOST `
    --port $PORT `
    --ctx-size $CONTEXT_SIZE `
    --n-gpu-layers $N_GPU_LAYERS `
    --threads $THREADS `
    --batch-size $BATCH_SIZE `
    --parallel $PARALLEL `
    --verbose

# Note: Press Ctrl+C to stop the server
