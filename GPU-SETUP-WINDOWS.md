# GPU Setup Guide for Windows (AMD Vulkan)

## 🚀 Quick Start - Windows Native

### Prerequisites
- Windows 10/11
- Docker Desktop for Windows (running)
- AMD GPU with latest drivers
- PowerShell 5.1 or later

### One-Command Startup (Recommended)
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon
.\start-all.ps1
```

This will:
1. Start Docker services (Docling + Classification Server)
2. Open GPU server in a new window with Vulkan acceleration
3. Verify all services are running

### Manual Startup (Step by Step)

**1. Start Docker Services:**
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon
.\start-system.ps1
```

**2. Start GPU-Accelerated LLM (in another window):**
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon
.\start-gpu-server.ps1
```

**3. Open Web Interface:**
- Open: `C:\TamuDatathon\Classification-Document-Analyzer-Datathon\web\index.html`
- Or run: `Start-Process "C:\TamuDatathon\Classification-Document-Analyzer-Datathon\web\index.html"`

---

## 📊 Performance Comparison

### CPU-only (WSL):
- **Speed:** ~8 tokens/second
- **6.5MB PDF:** ~125 seconds (2+ minutes)

### GPU-accelerated (Windows + AMD Vulkan):
- **Speed:** ~80-150 tokens/second (10-20x faster!)
- **6.5MB PDF:** ~15-20 seconds
- **GPU:** AMD Radeon RX 6700S or similar (4GB+ VRAM recommended)

---

## 🏗️ Architecture (Windows Native)

```
┌─────────────────────────────────────┐
│   Web Frontend (HTML/JS)           │
│   Windows File System               │
└─────────────────┬───────────────────┘
                  │
                  ↓
┌─────────────────────────────────────┐
│   Classification Server (Node.js)  │
│   Port: 5055 (Docker/Windows)      │
│   Connects to host.docker.internal │
└──────┬──────────────────────┬───────┘
       │                      │
       ↓                      ↓
┌──────────────┐    ┌─────────────────┐
│   Docling    │    │  Llama Server   │
│   Port: 7000 │    │  Port: 8080     │
│   (Docker)   │    │  (Windows+GPU)  │
└──────────────┘    └─────────────────┘
                           ↓
                    ┌──────────────┐
                    │   AMD GPU    │
                    │   (Vulkan)   │
                    └──────────────┘
```

---

## 🛠️ Building Llama.cpp with Vulkan Support

### Option 1: Pre-built Binary (Easiest)
Download the latest release with Vulkan support from:
https://github.com/ggerganov/llama.cpp/releases

Look for: `llama-*-bin-win-vulkan-x64.zip`

Extract to: `C:\TamuDatathon\Classification-Document-Analyzer-Datathon\tools\llama\build\bin\`

### Option 2: Build from Source (Advanced)

**Requirements:**
- Visual Studio 2022 with C++ tools
- CMake 3.12 or newer
- Vulkan SDK (https://vulkan.lunarg.com/)

**Build Steps:**

1. Install Vulkan SDK:
```powershell
# Download and install from https://vulkan.lunarg.com/
# Make sure to add Vulkan SDK to PATH during installation
```

2. Clone llama.cpp:
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon\tools
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
```

3. Build with Vulkan:
```powershell
mkdir build
cd build
cmake .. -DLLAMA_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
```

4. Copy binaries:
```powershell
# Binaries will be in: build\bin\Release\
# Copy them to: C:\TamuDatathon\Classification-Document-Analyzer-Datathon\tools\llama\build\bin\
```

### Verify Vulkan Build

```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon\tools\llama\build\bin
.\llama-server.exe --version
# Should show "LLAMA_VULKAN" or "Vulkan" in build info
```

---

## 📥 Download Models

### Recommended Models (GGUF format)

**For 4GB VRAM:**
- Llama 3.1 8B Q4_K_M (~4.9 GB)
- Llama 3.2 3B Q5_K_M (~2.3 GB)

**For 8GB+ VRAM:**
- Llama 3.1 8B Q5_K_M (~5.9 GB)
- Llama 3.1 8B Q6_K (~7.2 GB)

**Download Sources:**
- HuggingFace: https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF
- TheBloke: https://huggingface.co/TheBloke

**Installation:**
1. Download `.gguf` file
2. Place in: `C:\TamuDatathon\Classification-Document-Analyzer-Datathon\models\`
3. Update model name in `start-gpu-server.ps1` if different

---

## ⚙️ Configuration

### Environment Variables

Edit `server\.env`:
```bash
PORT=5055
VERIFIER_ENGINE=llama              # Use llama.cpp
LLAMA_URL=http://localhost:8080    # GPU server URL
DOCLING_URL=http://localhost:7000  # Docling service
LOCAL_CLASSIFIER=llama             # Use llama for local classification
VERIFY_SECOND_PASS=true            # Double-check with verifier
ROUTE_LOW=0.5                      # Confidence threshold for routing
AUTO_ACCEPT=0.9                    # Auto-accept threshold
LOCAL_DEFAULT_CONF=0.92            # Default llama confidence
```

### GPU Server Configuration

Edit `start-gpu-server.ps1`:

```powershell
$CONTEXT_SIZE = 8192      # Increase for larger documents (uses more VRAM)
$N_GPU_LAYERS = 99        # 99 = all layers, -1 = auto, 0 = CPU only
$THREADS = 8              # CPU threads (adjust to your CPU)
$BATCH_SIZE = 512         # Larger = faster but more VRAM
$PARALLEL = 4             # Concurrent requests
```

**VRAM Usage Guidelines:**
- Context 2048, Q4 model: ~3-4 GB
- Context 4096, Q4 model: ~4-5 GB
- Context 8192, Q4 model: ~5-6 GB
- Context 16384, Q4 model: ~7-8 GB

### Docker Configuration

If Docker can't reach `localhost:8080`, update `docker-compose.yml`:

```yaml
services:
  server:
    environment:
      - LLAMA_URL=http://host.docker.internal:8080
```

Or on Windows, use your machine's IP:
```powershell
# Get your IP
Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*" | Select-Object IPAddress
```

---

## 🛠️ Manual Control

### Start Services Individually

```powershell
# Start Docker services only
.\start-system.ps1

# Start GPU server only
.\start-gpu-server.ps1

# Start everything
.\start-all.ps1
```

### Stop Services

```powershell
# Stop everything
.\stop-all.ps1

# Or manually:
docker compose down
# Then close GPU server window or Ctrl+C
```

### Check Service Status

```powershell
# Docker containers
docker ps

# GPU server
Invoke-WebRequest http://localhost:8080/health

# Classification server
Invoke-WebRequest http://localhost:5055/health

# Docling
Invoke-WebRequest http://localhost:7000/health
```

### View Logs

```powershell
# Docker logs
docker compose logs -f

# Docker logs for specific service
docker compose logs -f server
docker compose logs -f docling

# GPU server logs - visible in the PowerShell window
```

---

## 🐛 Troubleshooting

### GPU Not Being Used

1. **Verify Vulkan is available:**
```powershell
# Check for Vulkan DLLs
Get-ChildItem "C:\Windows\System32\vulkan-1.dll"
```

2. **Check AMD drivers:**
- Update to latest Radeon Software
- Verify GPU is detected: Device Manager > Display adapters

3. **Test Vulkan:**
```powershell
# Download VulkanCapsViewer from https://vulkan.gpuinfo.org/
# Run to verify Vulkan support
```

4. **Check llama-server build:**
```powershell
cd C:\TamuDatathon\Classification-Document-Analyzer-Datathon\tools\llama\build\bin
.\llama-server.exe --version
# Should mention Vulkan in the output
```

### Docker Can't Reach GPU Server

**Symptom:** Classification server can't connect to `localhost:8080`

**Solution 1:** Use `host.docker.internal`
```powershell
# In server\.env or docker-compose.yml:
LLAMA_URL=http://host.docker.internal:8080
```

**Solution 2:** Use machine IP
```powershell
# Get your IP
ipconfig
# Update LLAMA_URL with your IP:
# LLAMA_URL=http://192.168.1.100:8080
```

**Solution 3:** Run server outside Docker
```powershell
# Stop Docker server
docker compose down

# Run Node.js server natively
cd server
npm install
npm start
```

### Out of Memory (VRAM)

**Symptoms:**
- Server crashes
- "Out of memory" errors
- Slow performance

**Solutions:**

1. **Reduce context size:**
```powershell
# In start-gpu-server.ps1
$CONTEXT_SIZE = 4096  # or lower
```

2. **Use smaller quantization:**
- Q3_K_M instead of Q4_K_M
- Q4_K_M instead of Q5_K_M

3. **Reduce GPU layers:**
```powershell
$N_GPU_LAYERS = 30  # Only offload some layers
```

4. **Use smaller model:**
- Llama 3.2 3B instead of 8B
- Phi-3 Mini

### Slow Performance

1. **Check GPU is being used:**
- Watch GPU usage in Task Manager > Performance > GPU
- Should show "Compute" or "3D" activity during inference

2. **Optimize batch size:**
```powershell
$BATCH_SIZE = 512  # Try different values: 256, 512, 1024
```

3. **Check thermal throttling:**
- Monitor GPU temperature
- Ensure good cooling/ventilation

4. **Verify all layers on GPU:**
```powershell
# In GPU server window, look for:
# "offload: 33/33 layers" or similar
```

### Port Conflicts

**Symptom:** "Port already in use" errors

**Check ports:**
```powershell
# Check what's using port 8080
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue

# Check Docker ports
Get-NetTCPConnection -LocalPort 5055,7000 -ErrorAction SilentlyContinue
```

**Solutions:**
- Stop conflicting services
- Change ports in configuration files

---

## 📋 System Requirements

### Minimum:
- Windows 10/11 (64-bit)
- AMD GPU with 4GB VRAM (RX 5000 series or newer)
- 8GB System RAM
- 20GB free disk space
- Docker Desktop

### Recommended:
- Windows 11
- AMD GPU with 8GB+ VRAM (RX 6000/7000 series)
- 16GB+ System RAM
- SSD with 50GB+ free space
- Docker Desktop (latest)

### Verified Working:
- AMD Radeon RX 6700S (4GB)
- AMD Radeon RX 6800 XT (16GB)
- AMD Radeon RX 7900 XTX (24GB)

---

## 🔗 Additional Resources

- **Llama.cpp:** https://github.com/ggerganov/llama.cpp
- **Vulkan SDK:** https://vulkan.lunarg.com/
- **GGUF Models:** https://huggingface.co/models?library=gguf
- **AMD GPU Drivers:** https://www.amd.com/en/support
- **Docker Desktop:** https://www.docker.com/products/docker-desktop

---

## 📝 Notes

- **Windows Native vs WSL:** Running natively on Windows provides better Vulkan support for AMD GPUs
- **Performance:** Expect 10-20x speedup vs CPU-only processing
- **Memory:** Context size directly impacts VRAM usage
- **Models:** Use Q4_K_M quantization for best quality/size ratio
- **Updates:** Keep AMD drivers and Vulkan SDK updated for best performance

---

## 🎯 Performance Tuning Tips

1. **Start with defaults** - Let the system auto-detect optimal settings
2. **Monitor VRAM** - Keep usage under 90% for stability
3. **Batch size** - Larger = faster but needs more VRAM
4. **Context size** - Only use what you need for your documents
5. **Quantization** - Q4_K_M is the sweet spot for most use cases
6. **Parallel requests** - Increase for multiple concurrent documents
7. **GPU layers** - Always use 99 (all) if VRAM allows

---

**For issues or questions, check the troubleshooting section or open an issue on GitHub.**
