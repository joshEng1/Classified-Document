Docling-compatible Extraction Service

Purpose
- Provide a simple HTTP endpoint `/extract` that the Node server can call via `DOCLING_URL`.
- Uses Docling if available; otherwise falls back to PyMuPDF/PDFMiner.

Endpoints
- POST /extract (multipart/form-data)
  - field: `file` (PDF)
  - returns JSON: `{ pages: number, text: string, blocks: [{text:string}] }`
- GET /health

Run (standalone)
- `pip install -r requirements.txt && pip install docling || true`
- `uvicorn main:app --host 0.0.0.0 --port 7000`

Docker
- Built and run via repo root `docker compose up --build`.

Notes
- This service aims to be API-compatible with the Node adapter. For full Docling layout/markdown fidelity, ensure the `docling` package installs successfully in the image.

