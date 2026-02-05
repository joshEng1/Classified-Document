# Classification Document Analyzer (Datathon)

Document classification pipeline with:

- Extraction via Docling (container) plus OCR fallback (if `tesseract` is installed)
- Guard signals + optional PII detection and redaction
- Local classification (heuristic or llama.cpp) with optional second-pass verification (llama.cpp or OpenAI)
- Static web UI served by the Node server

## Documentation

Open the documentation folder and find the following files:
- Start here: `START_HERE.md`
- First-time setup checklist: `CHECKLIST.md`
- Detailed setup and troubleshooting: `SETUP.md`
- Daily command reference: `QUICKREF.md`
- GPU notes: `GPU-SETUP-WINDOWS.md`, `GPU-SETUP.md`
- Implementation details: `AGENTS.md`

## Quick Start (Docker + local llama.cpp)

Prereqs: Docker Desktop, Node.js 18+ (for local dev), and a GGUF model file in `models/`.

1) Create config:

```powershell
Copy-Item server\.env.example server\.env
```

2) Edit `server\.env` and set at least `LLM_MODEL_NAME` to the GGUF filename you placed in `models\`.

3) Start llama.cpp on the host (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

Or start it manually (no helper script):

```powershell
.\llamacpp\llama-server.exe --host 0.0.0.0 --port 8080 -m .\models\<your-model>.gguf --ctx-size 8192 --no-jinja
```

4) Start the Docling + server containers:

```powershell
docker compose up -d --build
```

5) Open: `http://localhost:5055/`

## Architecture

```
Browser
  -> http://localhost:5055/        (web UI + API)
  -> server (Docker or local)
      -> Docling http://localhost:7000 (Docker)
      -> llama.cpp http://localhost:8080 (host)
```

## Development

- Run the server locally (fast restart, still uses Docker Docling):

```powershell
docker compose up -d docling
cd server
npm install
Copy-Item .env.example .env
npm run dev
```

- Docker bind-mount dev mode (auto-reload):

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Configuration

- Environment: `server/.env` (copy from `server/.env.example`)
- Prompts/rules: `server/src/config/prompts.json`
- Common env vars:
  - `PORT` (server port, default 5055)
  - `VERIFIER_ENGINE=llama|openai`
  - `LLAMA_URL` (llama.cpp server URL)
  - `DOCLING_URL` (Docling REST URL; Docker Compose sets this to `http://docling:7000` inside the container)
  - `VERIFY_SECOND_PASS=true|false` (Docker Compose defaults this to true)
  - `REDACT_PII=true|false` and `REDACT_OUTPUT_PDF=true|false`
  - `OFFLINE_MODE=true|false`

## API

- `GET /health` (and `GET /api/health`)
- `POST /api/process` (multipart `file=<pdf>`)
- `POST /api/process-batch` (multipart `files[]` or JSON `{"paths":[...]}`)
- `GET /api/redacted/:name` (download a generated redacted PDF, if enabled)

## Notes / Gotchas

- Renaming the repo folder changes Docker Compose’s default project name, which changes container names. If you rely on stable names, use `docker compose -p <name> ...` or set `COMPOSE_PROJECT_NAME`.
- `start-system.sh` is a WSL helper but currently has a hard-coded `PROJECT_DIR` that must match your local path.
