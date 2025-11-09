# GPU-Accelerated Setup Guide

## 🚀 Quick Start

### Start the System

**1. Start Docker Services (in WSL/Linux terminal):**
```bash
cd /mnt/c/TamuDatathon/Classification-Document-Analyzer-Datathon
./start-system.sh
```

**2. Start GPU-Accelerated LLM (in Windows PowerShell):**
```powershell
cd C:\Users\joshe\llama-gpu
.\start-gpu-server.ps1
```

**3. Open Web Interface:**
- Open: `C:\TamuDatathon\Classification-Document-Analyzer-Datathon\web\index.html`

---

## 📊 Performance Comparison

### Before (CPU-only in WSL):
- **Speed:** ~8 tokens/second
- **6.5MB PDF:** ~125 seconds (2+ minutes)

### After (GPU-accelerated on Windows):
- **Speed:** ~80-150 tokens/second (10-20x faster!)
- **6.5MB PDF:** ~15-20 seconds
- **GPU:** AMD Radeon RX 6700S (4GB VRAM)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│   Web Frontend (HTML/JS)           │
│   Port: File System                │
└─────────────────┬───────────────────┘
                  │
                  ↓
┌─────────────────────────────────────┐
│   Classification Server (Node.js)  │
│   Port: 5055 (Docker/WSL)          │
└──────┬──────────────────────┬───────┘
       │                      │
       ↓                      ↓
┌──────────────┐    ┌─────────────────┐
│   Docling    │    │  Llama Server   │
│   Port: 7000 │    │  Port: 8080     │
│  (Docker/WSL)│    │  (Windows+GPU)  │
└──────────────┘    └─────────────────┘
```

---

## 🛠️ Manual Control

### Stop Services:
```bash
# Docker services
cd /mnt/c/TamuDatathon/Classification-Document-Analyzer-Datathon
docker compose down

# GPU server - press Ctrl+C in PowerShell window
```

### Check Service Status:
```bash
# Docker containers
docker ps

# GPU server
curl http://localhost:8080/health
```

### View Logs:
```bash
# Docker logs
docker compose logs -f

# GPU server logs - visible in PowerShell window
```

---

## ⚙️ Configuration

### Change Context Size:
Edit `start-gpu-server.ps1`:
```powershell
--ctx-size 8192  # Increase for larger documents (uses more VRAM)
```

### Adjust GPU Usage:
```powershell
-ngl 99   # Number of layers on GPU (99 = all layers)
-ngl 24   # Reduce if you have VRAM issues
```

### Change Threads:
```powershell
--threads 8  # CPU threads for processing
```

---

## 🐛 Troubleshooting

### "Connection refused" on port 8080:
- Make sure GPU server is running in PowerShell
- Check: `curl http://localhost:8080/health`

### Slow performance on GPU:
- Verify `-ngl 99` is in the command (offload to GPU)
- Check Windows Task Manager → Performance → GPU to see utilization

### Docker containers won't start:
- Ensure Docker Desktop is running
- Run: `docker compose down` then try again
- Check: `docker ps` to see running containers

### Model file not found:
- Update path in `start-gpu-server.ps1`
- Current path: `C:\Users\joshe\Downloads\Qwen3-1.7B-IQ4_NL.gguf`

---

## 📝 Notes

- The GPU server runs on Windows to access your RX 6700S
- Docker services run in WSL for easy container management
- All services communicate via `localhost` network
- WSL Vulkan support is limited, hence Windows-native GPU server
