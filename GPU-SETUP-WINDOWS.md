# GPU Setup (Windows / Vulkan)

This project uses `llama.cpp` for local LLM inference. On Windows, the Vulkan backend enables GPU acceleration on supported AMD/NVIDIA hardware.

## Prerequisites

- Windows 10/11
- Docker Desktop (for Docling + API/server containers)
- Recent GPU drivers
- A GGUF model file in `models/`

## Quick Start

1) Create config:

```powershell
Copy-Item server\.env.example server\.env
```

2) Put a GGUF in `models/` and set `LLM_MODEL_NAME` in `server/.env` to the filename.

3) Start a local llama.cpp server (host):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

By default this script uses `llamacpp/llama-server.exe` and ports from `server/.env`.

4) Start containers:

```powershell
docker compose up -d --build
```

5) Open `http://localhost:5055/`.

## Verifying GPU / Connectivity

Check that the model server is reachable:

```powershell
Invoke-WebRequest http://localhost:8080/v1/models
```

If you run the API server in Docker (default), it should use `LLAMA_URL=http://host.docker.internal:8080`.

## Tuning

The helper script supports parameters (examples):

```powershell
# Use a different model file
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -LlmModelFile "my-model.gguf" -NoVision -NoGuardian

# Change context size and port
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -LlmCtx 4096 -LlmPort 8080 -NoVision -NoGuardian
```

## Troubleshooting

- Port already in use:

```powershell
Get-NetTCPConnection -LocalPort 8080
```

- Stop model servers:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-model-servers.ps1
```

- Docker cannot reach the host model server:
  - Ensure `LLAMA_URL` in `docker-compose.yml` (or `server/.env`) uses `http://host.docker.internal:8080`.

- Vulkan not available:
  - Update drivers first. If needed, replace `llamacpp/llama-server.exe` with a Vulkan-enabled build from the upstream `llama.cpp` releases.
