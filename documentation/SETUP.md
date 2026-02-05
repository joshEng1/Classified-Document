# Setup and Troubleshooting

This guide documents how to run the system locally on Windows using Docker Compose for the Docling + API server and `llama.cpp` on the host for local inference.

## Prerequisites

- Windows 10/11
- PowerShell 7+
- Node.js 18+ (for local development)
- Docker Desktop (for Docling + server containers)

Optional:

- `tesseract` for OCR fallback on scanned PDFs

## Install

1) Install Node dependencies:

```powershell
cd server
npm install
cd ..
```

2) Create config:

```powershell
Copy-Item server\.env.example server\.env
```

3) Add a model:

- Put a GGUF file in `models/`
- Set `LLM_MODEL_NAME=<filename>.gguf` in `server/.env`

## Run (Docker)

1) Start llama.cpp on the host (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

2) Start containers:

```powershell
docker compose up -d --build
```

3) Open the UI:

- `http://localhost:5055/`

## Run (server locally, Docling in Docker)

```powershell
docker compose up -d docling
cd server
Copy-Item .env.example .env
npm run dev
```

## Health Checks

```powershell
Invoke-WebRequest http://localhost:5055/health
Invoke-WebRequest http://localhost:7000/health
Invoke-WebRequest http://localhost:8080/v1/models
```

## Testcases

```powershell
cd server
npm run test:cases
```

Results are written under `.run/testcases/`.

## Troubleshooting

### Docker containers fail to start

```powershell
docker compose ps
docker compose logs -f server
docker compose logs -f docling
```

### Port already in use

```powershell
Get-NetTCPConnection -LocalPort 5055,7000,8080
```

### Model not found

- Confirm the model exists at `models/<file>.gguf`
- Confirm `LLM_MODEL_NAME` in `server/.env` matches the filename exactly
- If running the server in Docker, keep `LLAMA_URL` as `http://host.docker.internal:8080`

### OCR not working

OCR is optional and only used when needed.

```powershell
choco install tesseract
```

## Reference

- Main overview: `README.md`
- GPU details: `GPU-SETUP-WINDOWS.md`
