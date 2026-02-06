# Classification Document Analyzer (Datathon)

Document classification pipeline with:

- Extraction via Docling (container) plus OCR fallback (if `tesseract` is installed)
- Guard signals + optional PII detection and redaction
- Local classification (heuristic or llama.cpp) with optional second-pass verification (llama.cpp or online provider)
- Static web UI served by the Node server

## Documentation

Open the documentation folder and find the following files:
- Start here: `START_HERE.md`
- First-time setup checklist: `CHECKLIST.md`
- Detailed setup and troubleshooting: `SETUP.md`
- Daily command reference: `QUICKREF.md`
- GPU notes: `GPU-SETUP-WINDOWS.md`, `GPU-SETUP.md`
- Implementation details: `AGENTS.md`
- Security posture: `SECURITY.md`

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
  - `VERIFIER_ENGINE=llama|openai` (`llama` => local default mode, non-`llama` => online default mode)
  - `ONLINE_PROVIDER=gemini|openai`
  - `GEMINI_API_KEY` and `GEMINI_MODEL` (if using Gemini)
  - `LLAMA_URL` (llama.cpp server URL)
  - `DOCLING_URL` (Docling REST URL; Docker Compose sets this to `http://docling:7000` inside the container)
  - `VERIFY_SECOND_PASS=true|false` (Docker Compose defaults this to true)
  - `REDACT_PII=true|false` and `REDACT_OUTPUT_PDF=true|false`
  - `OFFLINE_MODE=true|false`

## Online Deployment (Hosted LLM, no local model)

For public use, keep the same endpoints/UI and document workflow, but run verifier via an online provider (Gemini/OpenAI) instead of local llama.cpp:

1. Copy `server/.env.example` to `server/.env`.
2. Set:
   - `ONLINE_PROVIDER=gemini`
   - `GEMINI_API_KEY=<your key>`
   - `GEMINI_MODEL=gemini-3-flash-preview` (or your preferred Gemini model)
   - `GOOGLE_VISION_API_KEY=<your key>` (or reuse `GEMINI_API_KEY`)
   - `DOC_AI_PROJECT_ID=<gcp-project>`
   - `DOC_AI_LOCATION=us`
   - `DOC_AI_PROCESSOR_ID=<document-ai-ocr-processor-id>`
   - `DOC_AI_ACCESS_TOKEN=<oauth-access-token>` (or `GOOGLE_CLOUD_ACCESS_TOKEN`)
   - `VERIFIER_ENGINE=openai` (or any non-`llama` value to default to online mode)
   - `OFFLINE_MODE=false`
   - `LOCAL_CLASSIFIER=heuristic`
   - `VERIFY_SECOND_PASS=true`
3. Restrict web origins with `CORS_ORIGINS` to your portfolio domain(s).
4. Keep public throttling enabled:
   - `PUBLIC_API_RATE_LIMIT_ENABLED=true`
   - tune `PUBLIC_API_RATE_LIMIT_MAX_REQUESTS` and `PUBLIC_API_RATE_LIMIT_WINDOW_MS`

This keeps redaction output and citation checking behavior intact while removing the local model dependency for end users.
When `ONLINE_PROVIDER=gemini` and Developer Mode selects `Online API`, the streaming pipeline uses Gemini for chunk summarization, moderation scoring, and model-assisted PII extraction (merged with regex PII).
OCR routing rule:
- If user sets `no_images=true`, Document AI OCR is skipped.
- Otherwise, Cloud Vision runs a quick image-presence scan.
- If Cloud Vision reports no images, Document AI OCR is skipped.
- If Cloud Vision reports images, Document AI OCR is used (when Document AI env/token are configured).

Developer UI note: in website Developer Mode, `Model Mode` supports `Online API` and `Local / Offline` (offline is treated the same as local).

## Security Hardening

- API keys remain server-side only (`server/.env`); the browser never receives provider secrets.
- `.env` files are git-ignored; use `server/.env.example` as the template.
- API responses now use sanitized error details (secret-like tokens and keys are redacted).
- API endpoints default to `Cache-Control: no-store` (`API_NO_STORE=true`) to reduce sensitive response caching.
- Public throttling is supported via:
  - `PUBLIC_API_RATE_LIMIT_ENABLED=true`
  - `PUBLIC_API_RATE_LIMIT_MAX_REQUESTS`
  - `PUBLIC_API_RATE_LIMIT_WINDOW_MS`
- Uploaded/session/redacted PDF artifacts are auto-pruned:
  - `UPLOAD_RETENTION_MINUTES`
  - `UPLOAD_CLEANUP_INTERVAL_MINUTES`
- Keep verbose logs disabled in production:
  - `VERBOSE_SERVER_LOGS=false`
  - `LLAMA_DEBUG=false`

## API

- `GET /health` (and `GET /api/health`)
- `POST /api/process` (multipart `file=<pdf>`)
- `POST /api/process-batch` (multipart `files[]` or JSON `{"paths":[...]}`)
- `GET /api/redacted/:name` (download a generated redacted PDF, if enabled)

## Notes / Gotchas

- Renaming the repo folder changes Docker Compose’s default project name, which changes container names. If you rely on stable names, use `docker compose -p <name> ...` or set `COMPOSE_PROJECT_NAME`.
- `start-system.sh` is a WSL helper but currently has a hard-coded `PROJECT_DIR` that must match your local path.
