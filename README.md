# Classification Document Analyzer - Datathon

## 📚 Documentation

### 🆕 New Users - Start Here!
- **[QUICK-START-NVIDIA.md](QUICK-START-NVIDIA.md)** - **NVIDIA GPU users** (most common) - 30 min setup
- **[QUICK-START-AMD.md](QUICK-START-AMD.md)** - AMD GPU users - 30 min setup

### 📖 Detailed Guides
- **[NVIDIA-SETUP.md](NVIDIA-SETUP.md)** - Complete NVIDIA CUDA setup guide
- **[GPU-SETUP.md](GPU-SETUP.md)** - AMD Vulkan setup guide (original)
- **[AGENTS.md](AGENTS.md)** - AI agent implementation details and requirements

### 🔧 Reference
- **[QUICKREF.md](QUICKREF.md)** - Quick command reference
- **[SETUP.md](SETUP.md)** - General setup documentation

## 🚀 Quick Start

### For New Developers

**Have an NVIDIA GPU?** (RTX 20/30/40 series, Tesla, etc.)
```powershell
# Check what you need to install
.\setup-nvidia.ps1

# Then follow: QUICK-START-NVIDIA.md
```

**Have an AMD GPU?** (Radeon RX 6000/7000 series)
```powershell
# Use AMD Vulkan setup
# See: GPU-SETUP.md
```

### For Existing Users

```powershell
# NVIDIA GPU users:
.\start-gpu-server-nvidia.ps1    # Terminal 1: GPU server
docker compose up                 # Terminal 2: Other services

# AMD GPU users:
.\start-gpu-server.ps1            # Terminal 1: GPU server  
docker compose up                 # Terminal 2: Other services

# Test everything
.\test-classification.ps1

# Stop everything
docker compose down
# Then Ctrl+C in GPU terminal
```

## 📖 Overview

End-to-end document classification system with:
- **Pre-processing checks** (legibility, page/image count)
- **Extraction** via Docling + OCR for documents with images
- **Guard rules** and PII detection with redaction
- **Local GPU-accelerated LLM** (AMD Vulkan) for classification
- **Verifier** for second-pass validation
- **Citation-based evidence** for audit trails
- **Web UI** for easy document upload and results
- **Safety monitoring** for unsafe content detection

## 🏗️ Architecture

```
Web UI (port: file://) 
    ↓
Classification Server (port: 5055)
    ↓
GPU Server - llama.cpp (port: 8080) + Docling (port: 7000)
```

## ⚙️ Configuration
- Prompts: `server/src/config/prompts.json` (classifier/verifier and class rules).
- Thresholds: `ROUTE_LOW`, `AUTO_ACCEPT` in `.env`.
- Verifier engine: `VERIFIER_ENGINE=openai|llama`. For llama.cpp, set `LLAMA_URL`.
- Docling REST (optional): set `DOCLING_URL` if you have a Docling server.
 - PII Redaction: `REDACT_PII=true|false`.
 - Cross-verify with two LLMs: `CROSS_VERIFY=true` (requires both engines configured).
 - Offline mode: `OFFLINE_MODE=true` to avoid any external network.

Local classifier
- Optional linear TF-IDF model can be placed at `server/models/tfidf_svm.json`.
- If missing, a heuristic classifier based on guard signals is used.

Front end
- Static React (CDN) in `web/`. No build tooling required.
 - Accepts PDF and common image formats; displays safety, PII, policy, and status updates.

Notes
- For robust citations (page/bbox), integrate Docling or PDF engines with positional data in `extractor/doclingAdapter.js` and adjust `citations.js`.
- For multimodal verification with GGUF, run llama.cpp server locally and set `VERIFIER_ENGINE=llama`.
 - Batch API: POST `/api/process-batch` with multipart `files[]` or JSON `{ paths: [...] }` returns per-file results.
