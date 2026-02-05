# Getting Started

This repo contains a document classification system with a Node/Express API, a static web UI, and a Docling-compatible extraction service (Docker). Local model inference is provided by `llama.cpp` (typically running on the Windows host).

## Quick Start (recommended)

1) Create config:

```powershell
Copy-Item server\.env.example server\.env
```

2) Put a GGUF model in `models/` and set `LLM_MODEL_NAME` in `server\.env` to the filename.

3) Start a local llama.cpp server (Windows host):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

4) Start the containers (Docling + API/server):

```powershell
docker compose up -d --build
```

5) Open the UI at `http://localhost:5055/` and upload a PDF.

## Common Developer Workflows

### Run the server locally (fast iteration)

```powershell
docker compose up -d docling
cd server
npm install
Copy-Item .env.example .env
npm run dev
```

### Run the integration testcases

```powershell
cd server
npm run test:cases
```

Results are written under `.run/testcases/`.

## Where to Look Next

- Setup and troubleshooting: `SETUP.md`
- First-time checklist: `CHECKLIST.md`
- Quick command reference: `QUICKREF.md`
- Architecture and design notes: `AGENTS.md`
- GPU/model server notes: `GPU-SETUP-WINDOWS.md`
