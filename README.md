Classification-Document-Analyzer-Datathon

Overview
- End-to-end document classifier aligned with AGENTS.md:
  - Pre-processing checks (legibility, page/image count proxy).
- Extraction via Docling (optional), pdf-parse, OCR fallback.
- Guard rules, PII detection + redaction (with citations).
- Local classifier first; route hard cases to a verifier (OpenAI or llama.cpp GGUF).
- Dynamic prompt library and citation-based evidence.
- Minimal React UI (no build) served by the Node server.
- Safety monitoring and policy classification (Public/Confidential/Highly Sensitive/Unsafe).
 - Equipment detection for serial/aircraft/parts with page citations (TC4/TC5).
- Batch processing endpoint and status updates in responses.

Quick Start (Windows Native with AMD GPU)
- **One-command startup:** `.\start-all.ps1` (starts everything)
- **Manual startup:**
  1. `.\start-system.ps1` (Docker services)
  2. `.\start-gpu-server.ps1` (GPU-accelerated LLM)
- **Open Web Interface:** `web\index.html`
- **Stop everything:** `.\stop-all.ps1`
- See `GPU-SETUP-WINDOWS.md` for detailed setup and troubleshooting

Quick Start (Linux/WSL)
- Edit `server/.env` from `server/.env.example`.
- Install dependencies: `cd server && npm install`.
- Start server: `npm start` (serves UI at `/`).
- Upload a sample PDF from `HitachiDS_Datathon_Challenges_Package` and inspect results.

Docker Compose (with Docling-compatible extraction)
- Windows: `.\start-system.ps1` or `docker compose up --build`
- Linux: `./start-system.sh` or `docker compose up --build`
- Server at http://localhost:5055, Docling service at http://localhost:7000
- GPU server runs natively on Windows (see GPU-SETUP-WINDOWS.md)
- The server is preconfigured to call the docling service via `DOCLING_URL=http://docling:7000`

Config
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
