# First-Time Setup Checklist

Use this checklist to get a clean local environment and verify the system end-to-end.

## Prerequisites

- [ ] Windows 10/11
- [ ] PowerShell 7+ (`$PSVersionTable.PSVersion`)
- [ ] Node.js 18+ (`node --version`)
- [ ] Docker Desktop (`docker --version`) and running
- [ ] Git (recommended)

## Repo Setup

- [ ] Clone the repo and `cd` into it
- [ ] Install server dependencies:

```powershell
cd server
npm install
cd ..
```

## Configuration

- [ ] Copy `server/.env.example` to `server/.env`:

```powershell
Copy-Item server\.env.example server\.env
```

- [ ] Put a GGUF model file in `models/`
- [ ] Set `LLM_MODEL_NAME` in `server/.env` to the GGUF filename

## Optional: OCR Support

OCR fallback is used only if `tesseract` is installed and available in `PATH`.

- [ ] Install Tesseract (optional):

```powershell
choco install tesseract
```

## Start the System

- [ ] Start llama.cpp on the host:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

- [ ] Start Docling + API server:

```powershell
docker compose up -d --build
```

- [ ] Open `http://localhost:5055/` and upload a PDF

## Validate

- [ ] Server health:
  - [ ] `http://localhost:5055/health`
  - [ ] `http://localhost:7000/health`
  - [ ] `http://localhost:8080/v1/models`

- [ ] Run integration testcases:

```powershell
cd server
npm run test:cases
```

Results are written under `.run/testcases/`.

## Troubleshooting Quick Checks

- [ ] Docker logs: `docker compose logs -f server`
- [ ] Port conflicts: `Get-NetTCPConnection -LocalPort 5055,7000,8080`
- [ ] Model not found: confirm `models/<file>.gguf` exists and `LLM_MODEL_NAME` matches exactly
