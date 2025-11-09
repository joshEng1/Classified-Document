# 🚀 Quick Start Guide - Document Classification System

This guide will help you get the Document Classification System running on your Windows machine from scratch.

## 📋 Prerequisites

Before you begin, make sure you have:

### Required Software
- **Windows 10/11** (tested on Windows 11)
- **PowerShell 7+** (comes with Windows 11, or download from [Microsoft](https://github.com/PowerShell/PowerShell/releases))
- **Git** - [Download](https://git-scm.com/download/win)
- **Node.js v18+** - [Download](https://nodejs.org/) (LTS version recommended)
- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop/)
- **Python 3.9+** - [Download](https://www.python.org/downloads/) (for Docling service)

### Optional but Recommended
- **Visual Studio Code** - [Download](https://code.visualstudio.com/)
- **AMD GPU with Vulkan support** (for GPU acceleration) or CPU will work too

## 📥 Installation Steps

### Step 1: Clone the Repository

```powershell
# Clone the repo
git clone https://github.com/joshEng1/Classification-Document-Analyzer-Datathon.git
cd Classification-Document-Analyzer-Datathon
```

### Step 2: Install Node.js Dependencies

```powershell
# Navigate to server directory and install dependencies
cd server
npm install
cd ..
```

### Step 3: Set Up Environment Variables

```powershell
# Copy the example environment file
cd server
Copy-Item .env.example .env

# The default settings should work for local development
# Edit .env if you need to change ports or settings
cd ..
```

### Step 4: Download the LLM Model

The system uses the **Qwen3-1.7B-IQ4** model (lightweight for mobile/offline use). Download it to the `models/` directory:

```powershell
# Create models directory if it doesn't exist
New-Item -ItemType Directory -Force -Path models

# Download the model (you'll need to get the download link)
# Place the .gguf file in: models/Qwen3-1.7B-IQ4_NL.gguf
```

> **Note**: The model file is not included in the repository due to its size. Contact the project owner for the download link or use your own GGUF model.

### Step 5: Build llama.cpp (if needed)

The pre-built binaries should work on most Windows systems with AMD GPUs. If you need to rebuild:

```powershell
# Build llama.cpp with Vulkan support
.\build-llama.ps1
```

This will compile llama.cpp with Vulkan backend for AMD GPU support.

## 🎯 Running the System

### Option A: Run Everything with One Command (Easiest)

```powershell
# Start all services (GPU server + Docker containers)
.\start-all.ps1
```

This script will:
1. ✅ Start the GPU server (llama.cpp with your AMD GPU)
2. ✅ Start Docker containers (classification server + Docling)
3. ✅ Verify all services are running
4. ✅ Open the web interface

### Option B: Run Services Individually

If you prefer more control or want to debug:

```powershell
# Terminal 1: Start GPU Server
.\start-gpu-server.ps1

# Terminal 2: Start Docker Services
docker compose up -d

# Terminal 3 (Optional): Run server locally instead of Docker
.\start-server-local.ps1
```

### Option C: Check System Status

```powershell
# Check if all services are running correctly
.\check-system.ps1
```

## 🧪 Testing the System

### Run Automated Tests

```powershell
# Test all sample documents
.\test-classification.ps1

# Show detailed results
.\test-classification.ps1 -Detailed

# Show detailed results + server logs
.\test-classification.ps1 -Detailed -ShowLogs
```

### Test via Web Interface

1. Open your browser to: `http://localhost:5055` or open `web/index.html`
2. Upload a PDF document
3. View the classification results

### Test via API

```powershell
# Test with a sample document
$file = "HitachiDS_Datathon_Challenges_Package\TC1_Sample_Public_Marketing_Document.pdf"
$form = @{ file = Get-Item $file }
$result = Invoke-RestMethod -Uri "http://localhost:5055/api/process" -Method Post -Form $form
$result | ConvertTo-Json -Depth 5
```

## 🛠️ Development Workflow

### Making Code Changes

1. **Stop the services**:
   ```powershell
   .\stop-all.ps1
   ```

2. **Make your code changes** in:
   - `server/src/` - Backend logic
   - `web/` - Frontend UI
   - `server/src/config/prompts.json` - Classification prompts

3. **Rebuild and restart**:
   ```powershell
   # If you changed server code
   docker compose build server
   docker compose up -d
   
   # Or run locally for faster iteration
   .\start-server-local.ps1
   ```

4. **Test your changes**:
   ```powershell
   .\test-classification.ps1
   ```

### Running Server Locally (No Docker)

For faster development iteration:

```powershell
# Start GPU server
.\start-gpu-server.ps1

# Start Docling service (still needs Docker)
docker compose up docling -d

# Run classification server locally
.\start-server-local.ps1
```

Benefits:
- ✅ Faster restart after code changes
- ✅ Direct access to console logs
- ✅ Easier debugging with breakpoints

## 📊 System Architecture

```
┌─────────────────┐
│   Web Browser   │
│  (index.html)   │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│ Classification  │ ◄──┐
│    Server       │    │ localhost:7000
│  (Node.js)      │    │ (Docling - PDF extraction)
│  Port: 5055     │ ───┘
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│   GPU Server    │
│   (llama.cpp)   │
│  Port: 8080     │
│  AMD Vulkan GPU │
└─────────────────┘
```

## 🔧 Troubleshooting

### GPU Server Won't Start

```powershell
# Check if Vulkan is working
.\tools\llama\build\bin\llama-server.exe --version

# Look for "ggml_vulkan: Found X Vulkan devices"
```

If Vulkan isn't working:
- Update your AMD GPU drivers
- Make sure Vulkan runtime is installed

### Docker Services Won't Start

```powershell
# Check Docker Desktop is running
docker --version

# Restart Docker Desktop
# Then try again:
docker compose up -d
```

### Port Already in Use

```powershell
# Find what's using the port
Get-NetTCPConnection -LocalPort 5055

# Stop the conflicting process or change the port in .env
```

### OCR Not Working

OCR requires Tesseract to be installed:

```powershell
# Install via Chocolatey
choco install tesseract

# Or download from: https://github.com/UB-Mannheim/tesseract/wiki
```

### Model Not Found

Make sure the model file is at:
```
models/Qwen3-1.7B-IQ4_NL.gguf
```

Check the path in `start-gpu-server.ps1`:
```powershell
$MODEL_PATH = "..\..\..\..\models\Qwen3-1.7B-IQ4_NL.gguf"
```

## 📝 Configuration

### Key Environment Variables (server/.env)

```properties
PORT=5055                          # Classification server port
LLAMA_URL=http://localhost:8080    # GPU server URL
DOCLING_URL=http://localhost:7000  # Docling service URL
LOCAL_CLASSIFIER=llama             # Use llama for classification
VERIFIER_ENGINE=llama              # Use llama for verification
VERIFY_SECOND_PASS=false           # Enable double-verification
```

### Model Settings (start-gpu-server.ps1)

```powershell
$MODEL_PATH = "path\to\your\model.gguf"
$CTX_SIZE = 8192                   # Context window size
$N_GPU_LAYERS = 99                 # Offload all layers to GPU
$THREADS = 8                       # CPU threads for processing
```

## 🎓 Next Steps

1. **Read the main README.md** for more detailed information
2. **Check AGENTS.md** for AI agent implementation details
3. **Explore the test cases** in `HitachiDS_Datathon_Challenges_Package/`
4. **Review the code** in `server/src/` to understand the classification logic

## 💡 Tips for Development

- Use `.\start-server-local.ps1` for faster iteration
- Check logs with `docker logs classification-document-analyzer-datathon-server-1`
- Monitor GPU usage with GPU-Z or Radeon Software
- Use VS Code with the PowerShell extension for better script editing
- Test with the provided sample PDFs before using your own documents

## 🆘 Getting Help

If you run into issues:

1. Run `.\check-system.ps1` to verify all services
2. Check the logs: `docker logs classification-document-analyzer-datathon-server-1 --tail 50`
3. Verify GPU server is working: `curl http://localhost:8080/health`
4. Review this guide and the main README.md
5. Contact the project maintainer

## 📚 Additional Resources

- [llama.cpp Documentation](https://github.com/ggerganov/llama.cpp)
- [Docling Documentation](https://github.com/DS4SD/docling)
- [Node.js Documentation](https://nodejs.org/docs/latest/api/)
- [Docker Documentation](https://docs.docker.com/)
- [AMD GPU Guide](./GPU-SETUP.md)

---

**Happy Coding! 🚀**
