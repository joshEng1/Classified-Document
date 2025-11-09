# NVIDIA GPU Setup Guide

This guide is for setting up the Document Classification System with **NVIDIA GPUs using CUDA**.

## Prerequisites

### 1. NVIDIA GPU Requirements
- NVIDIA GPU with CUDA Compute Capability 6.0 or higher
- Minimum 6GB VRAM (8GB+ recommended for the 8B model)
- Windows 10/11

### 2. Install NVIDIA CUDA Toolkit
1. Download CUDA Toolkit 12.x from: https://developer.nvidia.com/cuda-downloads
2. Run the installer and select:
   - [x] CUDA Toolkit
   - [x] CUDA Runtime
   - [x] Display Driver (if needed)
3. Verify installation:
   ```powershell
   nvcc --version
   nvidia-smi  # Should show your GPU
   ```

### 3. Install Required Software
- **Node.js 18+**: https://nodejs.org/
- **Python 3.10+**: https://www.python.org/
- **Docker Desktop**: https://www.docker.com/products/docker-desktop/
- **Git**: https://git-scm.com/
- **PowerShell 7+**: https://github.com/PowerShell/PowerShell/releases
- **Visual Studio 2022 Build Tools** (for CMake): https://visualstudio.microsoft.com/downloads/

## Step 1: Clone the Repository

```powershell
git clone https://github.com/joshEng1/Classification-Document-Analyzer-Datathon.git
cd Classification-Document-Analyzer-Datathon
```

## Step 2: Download the Model

Download the LFM2-8B model (GGUF format):
```powershell
# Create models directory
New-Item -ItemType Directory -Force -Path "models"

# Download using Hugging Face CLI (recommended)
pip install huggingface-hub
huggingface-cli download TheBloke/LFM2-8B-GGUF LFM2-8B-A1B-Q4_K_M.gguf --local-dir models
```

## Step 3: Build llama.cpp with CUDA Support

The existing build uses Vulkan (for AMD). You need to rebuild for NVIDIA CUDA:

```powershell
# Navigate to llama.cpp directory
cd tools\llama

# Clean any existing build
if (Test-Path "build") { Remove-Item -Recurse -Force build }

# Build with CUDA support
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release

# Verify CUDA build
.\build\bin\Release\llama-server.exe --version
# Should show: "CUDA = 1" or "ggml_cuda_init: found X CUDA devices"
```

### Troubleshooting CUDA Build

If you get CUDA errors:
1. Make sure CUDA is in your PATH: `$env:PATH` should include `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.x\bin`
2. Try specifying CUDA path explicitly:
   ```powershell
   cmake -B build -DGGML_CUDA=ON -DCUDA_TOOLKIT_ROOT_DIR="C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5"
   ```
3. If CMake can't find CUDA, install Visual Studio 2022 Build Tools

## Step 4: Configure Environment

Copy the example environment file:
```powershell
cd ..\..  # Back to project root
Copy-Item "server\.env.example" "server\.env"
```

Edit `server\.env` and update these settings:
```properties
PORT=5055
LLAMA_URL=http://localhost:8080
DOCLING_URL=http://localhost:7000
LOCAL_CLASSIFIER=llama
VERIFIER_ENGINE=llama
VERIFY_SECOND_PASS=true
```

**Important**: Remove any API keys from `.env` before committing! The `.gitignore` file already excludes `.env` files.

## Step 5: Install Dependencies

### Server Dependencies
```powershell
cd server
npm install
cd ..
```

### Docling Dependencies (Python)
```powershell
cd docling-service
pip install -r requirements.txt
cd ..
```

## Step 6: Start the System

### Option A: Using Docker (Recommended)

Start Docling service:
```powershell
docker compose up docling -d
```

Start GPU server in a separate terminal:
```powershell
cd tools\llama\build\bin\Release
..\..\..\..\start-gpu-server-nvidia.ps1
```

Start classification server:
```powershell
# In another terminal
docker compose up server -d
# OR run locally:
.\start-server-local.ps1
```

### Option B: All Local (No Docker)

1. **Terminal 1 - GPU Server**:
   ```powershell
   cd tools\llama\build\bin\Release
   ..\..\..\..\start-gpu-server-nvidia.ps1
   ```

2. **Terminal 2 - Docling Service**:
   ```powershell
   cd docling-service
   python main.py
   ```

3. **Terminal 3 - Classification Server**:
   ```powershell
   .\start-server-local.ps1
   ```

## Step 7: Verify Installation

Run the system check:
```powershell
.\check-system.ps1
```

Expected output:
```
✅ GPU Server (port 8080): Running
✅ Classification Server (port 5055): Running  
✅ Docling Service (port 7000): Running
✅ NVIDIA GPU: Detected
```

## Step 8: Test Classification

Open the web interface:
```powershell
Start-Process ".\web\index.html"
```

Or run automated tests:
```powershell
.\test-classification.ps1
```

## NVIDIA-Specific Performance Tips

### 1. Check GPU Usage
Monitor GPU utilization during classification:
```powershell
nvidia-smi -l 1  # Updates every 1 second
```

### 2. Optimize Batch Size
For NVIDIA GPUs, you can often increase batch size for better throughput:
- Edit `start-gpu-server-nvidia.ps1`
- Increase `--batch-size` from 512 to 1024 or 2048
- Monitor VRAM usage with `nvidia-smi`

### 3. Tensor Cores
If you have an RTX GPU (with Tensor Cores), the CUDA build automatically uses them for better performance.

### 4. Multiple GPU Support
If you have multiple NVIDIA GPUs:
```powershell
# Set which GPU to use (0, 1, 2, etc.)
$env:CUDA_VISIBLE_DEVICES = "0"
.\start-gpu-server-nvidia.ps1
```

## Troubleshooting

### Issue: "CUDA not detected" or CPU-only inference

**Solution**:
1. Verify CUDA installation: `nvcc --version`
2. Check PATH includes CUDA binaries
3. Rebuild llama.cpp with CUDA:
   ```powershell
   cd tools\llama
   Remove-Item -Recurse -Force build
   cmake -B build -DGGML_CUDA=ON
   cmake --build build --config Release
   ```

### Issue: "Out of memory" errors

**Solution**:
1. Reduce `--n-gpu-layers` in `start-gpu-server-nvidia.ps1`
2. Reduce `--ctx-size` to 4096 or lower
3. Use a smaller quantized model (Q4_K_S instead of Q4_K_M)

### Issue: Slow inference speed

**Solution**:
1. Verify all layers are on GPU: Look for "offloaded 25/25 layers" in server output
2. Increase `--batch-size` if you have VRAM headroom
3. Enable Flash Attention (usually automatic with CUDA)

### Issue: Docker containers can't reach GPU server

**Solution**:
The setup uses `network_mode: "host"` in docker-compose.yml which should work.
If it doesn't:
1. Run classification server locally: `.\start-server-local.ps1`
2. OR check Windows Firewall settings

## Performance Comparison

Expected performance on NVIDIA GPUs:

| GPU | VRAM | Tokens/sec | Full Doc Time |
|-----|------|------------|---------------|
| RTX 4090 | 24GB | 100-150 | ~3-5 sec |
| RTX 4080 | 16GB | 80-120 | ~4-6 sec |
| RTX 4070 | 12GB | 60-90 | ~5-8 sec |
| RTX 3090 | 24GB | 70-100 | ~5-7 sec |
| RTX 3080 | 10GB | 50-80 | ~6-10 sec |

## Next Steps

1. Read [README.md](README.md) for architecture details
2. Test with sample documents in `HitachiDS_Datathon_Challenges_Package/`
3. Customize prompts in `server/src/config/prompts.json`

## Getting Help

If you encounter issues:
1. Check `nvidia-smi` output
2. Review server logs: `docker logs classification-document-analyzer-datathon-server-1`
3. Run diagnostics: `.\check-system.ps1 -Detailed`
4. Open an issue on GitHub with error logs

## AMD Vulkan vs NVIDIA CUDA

This project originally used AMD Vulkan. Key differences:

| Feature | AMD Vulkan | NVIDIA CUDA |
|---------|------------|-------------|
| Build Flag | `-DGGML_VULKAN=ON` | `-DGGML_CUDA=ON` |
| Performance | Good | Excellent |
| Compatibility | Broader | NVIDIA only |
| Startup Script | `start-gpu-server.ps1` | `start-gpu-server-nvidia.ps1` |

Both work well, but CUDA generally offers better performance on NVIDIA GPUs.
