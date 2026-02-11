# Doc Classifier Service (`server/`)

Node/Express API server that orchestrates extraction, guard signals, PII detection, and classification/verification. It also serves the static UI from the repo’s `public/` directory when running from Docker or locally.

## Pipeline (high level)

- Extraction (Docling REST; optional OCR fallback)
- Guard signals
- PII detection and optional redaction
- Local classification (heuristic or llama.cpp)
- Optional second-pass verification (llama.cpp or online provider)

Architecture and design notes live in `AGENTS.md` at the repo root.

## Run Locally

```powershell
cd server
npm install
Copy-Item .env.example .env
npm run dev
```

When running locally, you usually still run Docling via Docker:

```powershell
docker compose up -d docling
```

## Run with Docker Compose

From the repo root:

```powershell
docker compose up -d --build
```

Then open `http://localhost:5055/`.

## API

- `GET /health` (and `GET /api/health`)
- `POST /api/process` (multipart/form-data)
  - field: `file` (PDF)
- `POST /api/process-batch`
  - multipart `files[]`, or (optional) JSON `{"paths":[...]}` when enabled via `ALLOW_BATCH_PATHS=true`

## Public Portfolio Mode (No local LLM required)

To keep the same document analysis behavior but run model inference via hosted API calls:

1. Copy `.env.example` to `.env`.
2. Set `ONLINE_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `VERIFIER_ENGINE=openai` (or any non-`llama`), and `OFFLINE_MODE=false`.
   Also set Azure OCR vars for online extraction:
   - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`
   - `AZURE_DOCUMENT_INTELLIGENCE_KEY`
   - Optional: `AZURE_DOCUMENT_INTELLIGENCE_MODEL=prebuilt-read`
3. Set `LOCAL_CLASSIFIER=heuristic` and keep `VERIFY_SECOND_PASS=true`.
4. Set `CORS_ORIGINS` to your deployed frontend domain.
5. Keep `PUBLIC_API_RATE_LIMIT_*` enabled/tuned for abuse control.

Your existing endpoints stay the same, including redacted PDF output and citation evidence in results.
With `ONLINE_PROVIDER=gemini` and request `model_mode=online`, streaming chunk summarization/moderation/PII-assist run through Gemini, while regex PII and manual redaction workflows remain active.
OCR routing:
- `model_mode=online`: Azure Document Intelligence OCR is the extractor (Docling is not used).
- `model_mode=local` (or `offline`): Docling is used for extraction and optional Cloud Vision quick-scan can run.
- `no_images=true` only applies to local/offline mode. In online mode it is ignored.
- Online OCR uses Azure analyze + polling with a bounded timeout and fails fast on OCR errors.
In website Developer Mode, `Model Mode` can be switched per request: `online` or `local` (`offline` is treated as `local`).

## Security Notes

- Keep secrets only in `server/.env`; never place provider keys in frontend code.
- `.env` is ignored by git; commit only `.env.example`.
- Keep `CORS_ALLOW_ALL=false` and explicitly set `CORS_ORIGINS`.
- Keep `PUBLIC_API_RATE_LIMIT_ENABLED=true` for public deployments.
- Keep `API_NO_STORE=true` to avoid caching sensitive API responses.
- Keep verbose logging off in production:
  - `VERBOSE_SERVER_LOGS=false`
  - `LLAMA_DEBUG=false`
- Auto-clean sensitive artifacts from disk:
  - `UPLOAD_RETENTION_MINUTES`
  - `UPLOAD_CLEANUP_INTERVAL_MINUTES`

## Models

### llama.cpp (recommended)

Run a compatible OpenAI-style server locally (default port 8080) and set:

- `VERIFIER_ENGINE=llama`
- `LLAMA_URL=http://localhost:8080` (local dev) or `http://host.docker.internal:8080` (Docker)

### Optional linear model

An optional TF-IDF linear model can be placed at `server/models/tfidf_svm.json`:

- `classes`: string[]
- `vocab`: string[]
- `W`: number[][] (numClasses x vocabSize)
- `b`: number[] (numClasses)

If absent, a heuristic classifier is used.

## Docling Integration

Configure `DOCLING_URL` to a REST service that accepts multipart upload at `/extract` and returns JSON containing `text` and `pages` (and optionally `blocks[]`).

## OCR

If `tesseract` is available in `PATH`, OCR is attempted for scanned/empty PDFs.

In online mode, PDF OCR is performed by Azure Document Intelligence (`prebuilt-read`) with inline polling.
