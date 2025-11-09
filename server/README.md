Doc Classifier Service

Overview
- End-to-end pipeline per AGENTS.md:
  - Preprocessing checks (legibility, page count).
  - Extraction: Docling REST (if configured), pdf-parse, OCR fallback.
  - Guards: class-specific cues.
  - Local classifier: TF-IDF linear model (optional) with heuristic fallback.
  - Routing: decide whether to call verifier.
  - Verifier: OpenAI or llama.cpp (GGUF) via HTTP with dynamic prompts.
  - Evidence + citations (basic heuristics, expand via Docling when available).
- Simple React (CDN) UI at `/` for upload and viewing results.

Run (after npm install)
1) cd server && cp .env.example .env
2) Set `OPENAI_API_KEY` or `LLAMA_URL` and choose `VERIFIER_ENGINE=openai|llama`.
3) npm install
4) npm start (serves UI and API on PORT, default 5055)

Run with Docker Compose (includes Docling service)
1) Ensure Docker is installed.
2) From repo root: `docker compose up --build`
3) Open http://localhost:5055 and upload a PDF.
   - The server uses the bundled Docling-compatible service at http://docling:7000 automatically.

API
- POST `/api/process` (multipart/form-data):
  - `file`: PDF file
  - Response: JSON with `meta`, `guards`, `evidence`, `local`, `routed`, `verifier`, `final`.

Models
- Optional linear model at `server/models/tfidf_svm.json` with fields:
  - `classes`: ["Internal Memo", "Employee Application", "Invoice", "Public Marketing Document", "Other"]
  - `vocab`: ["token1", ...]
  - `W`: 2D weight array (numClasses x vocabSize)
  - `b`: bias array (numClasses)
If absent, heuristic classifier is used.

Docling integration
- Configure `DOCLING_URL` to a REST service that accepts multipart file upload at `/extract` and returns JSON with `text` (or `blocks[].text`) and `pages`.

OCR
- If `tesseract` CLI is available in PATH, OCR is attempted for scanned/empty PDFs.

llama.cpp
- Start server: `./server -m model.Q4_K_M.gguf --ctx-size 2048 --port 8080`
- Set `VERIFIER_ENGINE=llama` and `LLAMA_URL=http://localhost:8080`.

Frontend (no build)
- Static files in `/web` use React via CDNs. Upload a PDF and review pipeline outputs.

Dataset distillation (optional)
- Convert evidence payloads to instruction JSONL for fine-tuning a small LLM:
  - `node server/scripts/build-dataset.js payloads out.jsonl`
  - Use your SFT tool (Axolotl/Unsloth) to train and then convert to GGUF for llama.cpp.

Notes
- For robust citations (bbox/page spans), prefer Docling or PDF engines that return positional data and map selected evidence to page indices.
