# Windows Migration Quick Reference

## ✅ Migration Complete!

Your project is now configured to run natively on Windows with AMD GPU Vulkan acceleration.

---

## 🚀 How to Use

### Start Everything (Easiest)
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon
.\start-all.ps1
```

### Stop Everything
```powershell
.\stop-all.ps1
```

### Open Web Interface
```powershell
# Double-click or run:
Start-Process "C:\TamuDatathon\Classification-Document-Analyzer-Datathon\web\index.html"
```

---

## 📁 New Files Created

### PowerShell Scripts (replacements for bash scripts)
- `start-all.ps1` - Start everything in one command (NEW!)
- `start-system.ps1` - Start Docker services only (replaces start-system.sh)
- `start-gpu-server.ps1` - Start GPU server with Vulkan (NEW!)
- `stop-all.ps1` - Stop all services (NEW!)

### Documentation
- `GPU-SETUP-WINDOWS.md` - Complete Windows setup guide (NEW!)
- `WINDOWS-MIGRATION.md` - This file

---

## 🔧 Configuration Changes

### Docker Compose (`docker-compose.yml`)
- ✅ Changed `LLAMA_URL` to use `host.docker.internal:8080`
- ✅ Added `LOCAL_CLASSIFIER=llama` environment variable
- ✅ Added `VERIFY_SECOND_PASS=true` environment variable
- ✅ Added `LOCAL_DEFAULT_CONF=0.92` environment variable
- ✅ Changed default `VERIFIER_ENGINE` to `llama`
- ✅ Added `extra_hosts` for better Windows compatibility

### Environment Variables (`server\.env.example`)
- ✅ Updated comments for Windows paths
- ✅ Added Docker-specific URL instructions

### README.md
- ✅ Added Windows-specific quick start section
- ✅ Added references to new PowerShell scripts

---

## 🎮 GPU Setup Steps

### 1. Install Prerequisites
- ✅ Windows 10/11
- ✅ Docker Desktop (running)
- ✅ AMD GPU drivers (latest from AMD.com)
- ⬜ **Vulkan SDK** - Download from: https://vulkan.lunarg.com/

### 2. Get Llama.cpp with Vulkan
Choose one:

**Option A: Pre-built Binary (Easier)**
1. Download: https://github.com/ggerganov/llama.cpp/releases
2. Look for: `llama-*-bin-win-vulkan-x64.zip`
3. Extract to: `tools\llama\build\bin\`

**Option B: Build from Source**
```powershell
cd tools
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
mkdir build
cd build
cmake .. -DLLAMA_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
# Copy build\bin\Release\* to tools\llama\build\bin\
```

### 3. Download a Model
1. Visit: https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF
2. Download: `Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf` (or similar)
3. Place in: `models\` folder
4. Update model name in `start-gpu-server.ps1` if different

### 4. Configure Environment
1. Copy `server\.env.example` to `server\.env`
2. Edit if needed (defaults should work)

### 5. Test It!
```powershell
.\start-all.ps1
# Wait for services to start (30-60 seconds)
# Open web\index.html
# Upload a PDF and test!
```

---

## 🆚 WSL vs Windows Native

| Feature | WSL (Old) | Windows Native (New) |
|---------|-----------|----------------------|
| **Setup** | Complex, dual-environment | Simple, single environment |
| **Performance** | ~8 tok/s (CPU only) | ~80-150 tok/s (GPU) |
| **GPU Support** | Limited Vulkan | Full Vulkan support |
| **Startup** | Manual coordination | One-command startup |
| **Scripts** | Bash (start-system.sh) | PowerShell (.ps1) |
| **Networking** | localhost confusion | host.docker.internal |
| **Maintenance** | Two environments | One environment |

---

## 🔍 File Mapping (Old → New)

| Old (WSL) | New (Windows) | Status |
|-----------|---------------|--------|
| start-system.sh | start-system.ps1 | ✅ Migrated |
| N/A | start-gpu-server.ps1 | ✅ New |
| N/A | start-all.ps1 | ✅ New |
| N/A | stop-all.ps1 | ✅ New |
| GPU-SETUP.md | GPU-SETUP-WINDOWS.md | ✅ Updated |

**Note:** Old bash scripts are kept for reference but not used on Windows.

---

## 🐛 Common Issues & Solutions

### Issue: "llama-server.exe not found"
```powershell
# Solution: Download or build llama.cpp with Vulkan
# See GPU-SETUP-WINDOWS.md → Building Llama.cpp section
```

### Issue: "Model not found"
```powershell
# Solution: Download a GGUF model and place in models\ folder
# Update $MODEL_NAME in start-gpu-server.ps1
```

### Issue: Docker can't reach GPU server
```powershell
# Solution 1: Already configured in docker-compose.yml
# It uses host.docker.internal:8080

# Solution 2: If still issues, get your IP:
ipconfig
# Update LLAMA_URL in .env to: http://YOUR_IP:8080
```

### Issue: GPU not being used
```powershell
# Check if Vulkan is available:
Get-ChildItem "C:\Windows\System32\vulkan-1.dll"

# Verify llama.cpp has Vulkan:
cd tools\llama\build\bin
.\llama-server.exe --version
# Should show "LLAMA_VULKAN" or similar

# Check AMD drivers are latest:
# Visit: https://www.amd.com/en/support
```

### Issue: Out of VRAM
```powershell
# Edit start-gpu-server.ps1:
$CONTEXT_SIZE = 4096  # Reduce from 8192
$N_GPU_LAYERS = 30    # Reduce from 99
# Or use a smaller model (Q3_K_M instead of Q4_K_M)
```

---

## 📊 Performance Verification

After starting services, verify GPU is being used:

1. **Open Task Manager** → Performance → GPU
2. **Start a document classification**
3. **Watch GPU usage** - should spike during inference
4. **Check GPU server logs** - should show "offload: X/X layers"

Expected performance:
- **CPU only:** 8-15 tokens/second
- **GPU (Vulkan):** 80-150 tokens/second

---

## 📋 Checklist

Before first run:
- [ ] Docker Desktop installed and running
- [ ] AMD GPU drivers updated
- [ ] Vulkan SDK installed (optional but recommended)
- [ ] llama-server.exe in `tools\llama\build\bin\`
- [ ] Model (.gguf) in `models\` folder
- [ ] `server\.env` file created (copy from .env.example)
- [ ] Model name in `start-gpu-server.ps1` matches your model file

First run:
- [ ] Run `.\start-all.ps1`
- [ ] Wait for services (30-60 seconds)
- [ ] Check Task Manager → GPU usage during inference
- [ ] Test with a sample PDF

---

## 🎯 Next Steps

1. **Verify everything works:**
   ```powershell
   .\start-all.ps1
   # Open web\index.html
   # Upload a test PDF
   ```

2. **Tune performance:**
   - Edit `start-gpu-server.ps1` for your GPU's VRAM
   - See GPU-SETUP-WINDOWS.md → Performance Tuning section

3. **Add to startup (optional):**
   ```powershell
   # Create a shortcut to start-all.ps1
   # Place in: shell:startup
   ```

4. **Clean up old WSL references (optional):**
   - Old bash scripts can be deleted or moved to `archive\`
   - `GPU-SETUP.md` can be archived

---

## 📚 Documentation

- **GPU-SETUP-WINDOWS.md** - Complete setup, configuration, and troubleshooting
- **README.md** - Project overview and quick start
- **AGENTS.md** - Architecture and design decisions
- **server\README.md** - Server-specific documentation

---

## 🤝 Getting Help

1. **Read GPU-SETUP-WINDOWS.md** - Most issues are covered
2. **Check troubleshooting section** - Common solutions
3. **Verify prerequisites** - Windows, Docker, GPU, Vulkan
4. **Check logs:**
   ```powershell
   docker compose logs -f server  # Server logs
   # GPU server logs in its window
   ```

---

## ✨ Benefits of Windows Native

- **10-20x faster inference** with AMD GPU Vulkan
- **Single environment** - no WSL/Windows coordination
- **One-command startup** - `start-all.ps1`
- **Better GPU support** - Native Vulkan drivers
- **Easier maintenance** - PowerShell scripts
- **Simpler networking** - No localhost confusion

---

**Migration complete! Run `.\start-all.ps1` to get started. 🚀**
