# 🚀 Quick Start for NVIDIA GPU Users

**For coworkers and contributors with NVIDIA GPUs wanting to run locally.**

## Prerequisites Check

Run this first to see what you need:

```powershell
.\setup-nvidia.ps1
```

This script checks everything and tells you exactly what to install.

## Fast Setup (30 minutes)

### Step 1: Install Prerequisites (15 min)

1. **NVIDIA Drivers** - Get latest from [NVIDIA](https://www.nvidia.com/Download/index.aspx)
2. **CUDA Toolkit 12.x** - Download from [NVIDIA CUDA](https://developer.nvidia.com/cuda-downloads)
3. **Node.js 18+** - Get from [nodejs.org](https://nodejs.org/)
4. **Python 3.9+** - Get from [python.org](https://www.python.org/)
5. **Docker Desktop** - Get from [docker.com](https://www.docker.com/products/docker-desktop/)
6. **Visual Studio Build Tools** - Install C++ build tools from [Visual Studio](https://visualstudio.microsoft.com/downloads/)

### Step 2: Clone & Download Model (10 min)

```powershell
# Clone repo
git clone <your-repo-url>
cd Classification-Document-Analyzer-Datathon

# Download model (~4.8 GB)
pip install huggingface-hub
huggingface-cli download TheBloke/LFM2-8B-GGUF LFM2-8B-A1B-Q4_K_M.gguf --local-dir models
```

### Step 3: Build llama.cpp with CUDA (5 min)

```powershell
cd tools\llama
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
cd ..\..
```

**Note:** Build takes 3-5 minutes. Coffee time ☕

### Step 4: Configure Environment (1 min)

```powershell
# Copy environment template
Copy-Item server\.env.example server\.env

# Install server dependencies
cd server
npm install
cd ..

# Install docling dependencies
cd docling-service
pip install -r requirements.txt
cd ..
```

## Running the System

You need 3 terminals (or use Docker):

### Option 1: All Docker (Easiest)

```powershell
# Terminal 1: Start GPU server (must be outside Docker)
cd tools\llama\build\bin\Release
..\..\..\..\start-gpu-server-nvidia.ps1

# Terminal 2: Start other services
docker compose up
```

### Option 2: All Local (Best for Development)

```powershell
# Terminal 1: GPU Server
cd tools\llama\build\bin\Release
..\..\..\..\start-gpu-server-nvidia.ps1

# Terminal 2: Docling Service
cd docling-service
python main.py

# Terminal 3: Classification Server
cd server
npm start
```

### Option 3: Hybrid (Recommended)

```powershell
# Terminal 1: GPU Server (local for best performance)
cd tools\llama\build\bin\Release
..\..\..\..\start-gpu-server-nvidia.ps1

# Terminal 2: Other services in Docker
docker compose up
```

## Testing

```powershell
# Quick health check
.\check-system.ps1

# Test classification on sample documents
.\test-classification.ps1
```

## Using the Web Interface

1. Start all services (see above)
2. Open `web\index.html` in browser
3. Upload a document
4. See classification results

## Performance Expectations

| GPU | Speed | Layer Offload |
|-----|-------|---------------|
| RTX 4090 | 100-150 tok/s | All layers |
| RTX 4080 | 80-120 tok/s | All layers |
| RTX 3090 | 70-100 tok/s | All layers |
| RTX 3080 | 50-80 tok/s | All layers |
| RTX 3070 | 40-60 tok/s | All layers |

## Common Issues

### "CUDA not detected"

```powershell
# Verify CUDA installation
nvcc --version
nvidia-smi

# Rebuild llama.cpp
cd tools\llama
Remove-Item -Recurse -Force build
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

### "Out of memory"

Reduce context size in `start-gpu-server-nvidia.ps1`:

```powershell
$CONTEXT_SIZE = 2048  # Reduce from 4096
```

### "Server not responding"

```powershell
# Check if GPU server is running
Get-Process llama-server

# Check health endpoint
Invoke-WebRequest http://localhost:8080/health
```

### "Docker can't connect to GPU server"

Make sure:
1. GPU server started FIRST
2. Using `network_mode: "host"` in docker-compose.yml
3. GPU server bound to localhost:8080

## Project Structure

```
📦 Classification-Document-Analyzer-Datathon
├─ 🖥️  tools/llama/                  # GPU inference engine
│   └─ build/bin/Release/            # llama-server.exe here
├─ 🤖 models/                        # 4.8GB GGUF model
├─ 🔧 server/                        # Node.js classification server (port 5055)
│   └─ src/services/
│       ├─ classifier/               # Routing + classification logic
│       ├─ extractor/                # Docling + OCR text extraction
│       └─ verifier/                 # LLM verification pass
├─ 🐳 docling-service/               # Python document parsing (port 7000)
├─ 🌐 web/                           # HTML/CSS/JS frontend
└─ 📝 scripts/                       # PowerShell helper scripts
```

## Architecture Flow

```
User uploads PDF
    ↓
Web UI (index.html)
    ↓
Classification Server (localhost:5055)
    ├→ Docling Service (localhost:7000) - Extract text structure
    ├→ OCR (Tesseract) - Extract text from images
    └→ GPU Server (localhost:8080) - LLM classification
    ↓
Results with citations
```

## Development Tips

1. **Logs**: GPU server shows token/s in console
2. **Debugging**: Use `check-system.ps1` to verify all services
3. **Testing**: Run `test-classification.ps1` after code changes
4. **Performance**: Monitor with `nvidia-smi` in separate terminal
5. **Hot Reload**: Server auto-restarts on code changes (nodemon)

## Adding Features

1. **New classification rules**: Edit `server/src/config/prompts.json`
2. **New extraction logic**: Edit `server/src/services/extractor/index.js`
3. **New LLM parameters**: Edit `start-gpu-server-nvidia.ps1`
4. **UI changes**: Edit `web/index.html`, `web/main.js`, `web/styles.css`

## Need Help?

1. Check `NVIDIA-SETUP.md` for detailed documentation
2. Run `.\setup-nvidia.ps1` to diagnose issues
3. Check GPU usage: `nvidia-smi -l 1`
4. View logs in console windows
5. Test with: `.\test-classification.ps1`

## Differences from AMD Setup

If you see references to Vulkan in old docs, ignore them. The NVIDIA setup:
- Uses **CUDA** instead of Vulkan
- Uses `start-gpu-server-nvidia.ps1` instead of `start-gpu-server.ps1`
- Requires CUDA Toolkit instead of Vulkan SDK
- Generally **faster** than AMD Vulkan setup

Everything else is identical!

---

**Quick Commands Reference:**

```powershell
# Check setup status
.\setup-nvidia.ps1

# Start system (3 terminals)
cd tools\llama\build\bin\Release; ..\..\..\..\start-gpu-server-nvidia.ps1  # Terminal 1
docker compose up                                                            # Terminal 2

# Test everything
.\test-classification.ps1

# Monitor GPU
nvidia-smi -l 1

# Stop everything
docker compose down
# Then Ctrl+C in GPU server terminal
```

**That's it! You're ready to develop. 🎉**
