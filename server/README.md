# Doc Classifier Service (`server/`)

Node/Express API server that orchestrates extraction, guard signals, PII detection, and classification/verification. It also serves the static UI from the repo’s `public/` directory when running from Docker or locally.

## Pipeline (high level)

- Extraction (Docling REST; optional OCR fallback)
- Guard signals
- PII detection and optional redaction
- Local classification (heuristic or llama.cpp)
- Optional second-pass verification (llama.cpp or OpenAI)

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
