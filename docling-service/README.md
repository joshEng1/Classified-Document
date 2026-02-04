Docling-compatible Extraction Service

Purpose
- Provide a simple HTTP endpoint `/extract` that the Node server can call via `DOCLING_URL`.
- Uses Docling if available; otherwise falls back to PyMuPDF/PDFMiner.

Endpoints
- POST /extract (multipart/form-data)
  - field: `file` (PDF)
  - returns JSON: `{ pages: number, text: string, blocks: [{text:string}] }`
- POST /signals (multipart/form-data)
  - field: `file` (PDF)
  - returns JSON with per-page layout signals (text/image coverage + figure bboxes) for hybrid VLM routing
- POST /render-pages (multipart/form-data)
  - field: `file` (PDF)
  - fields: `pages` (JSON array, 1-based), `dpi` (int)
  - returns JSON with base64 PNGs for requested pages
- POST /render-regions (multipart/form-data)
  - field: `file` (PDF)
  - fields: `regions` (JSON array of {id,page,bbox}), `dpi` (int)
  - returns JSON with base64 PNGs for requested regions
- POST /redact (multipart/form-data)
  - field: `file` (PDF)
  - fields:
    - `detect_pii` (true/false) to auto-detect common PII tokens and redact them
    - `boxes` (JSON array of {page,bbox,label}) for caller-provided redaction regions (e.g., sensitive figures)
    - `search_texts` (JSON array of {page,text,label}) to locate and redact exact text snippets (best-effort)
  - returns redacted PDF bytes (application/pdf)
- GET /health

Run (standalone)
- `pip install -r requirements.txt && pip install docling || true`
- `uvicorn main:app --host 0.0.0.0 --port 7000`

Docker
- Built and run via repo root `docker compose up --build`.

Notes
- This service aims to be API-compatible with the Node adapter. For full Docling layout/markdown fidelity, ensure the `docling` package installs successfully in the image.
