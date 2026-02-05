# Docling-Compatible Extraction Service

This service provides a Docling-compatible HTTP API that the Node server calls via `DOCLING_URL`.

## Purpose

- Provide a simple `/extract` endpoint for text + metadata extraction
- Provide layout/signal endpoints used for optional vision routing and redaction workflows
- Prefer Docling when available; fall back to other PDF tooling as needed

## Endpoints

- `POST /extract` (multipart/form-data)
  - field: `file` (PDF)
  - returns JSON: `{ pages: number, text: string, blocks: [{ text: string, page?: number }] }`
- `POST /signals` (multipart/form-data)
  - field: `file` (PDF)
  - returns per-page layout signals (text/image coverage + figure bounding boxes)
- `POST /render-pages` (multipart/form-data)
  - field: `file` (PDF)
  - fields:
    - `pages` (JSON array, 1-based)
    - `dpi` (int)
  - returns JSON with base64 PNGs for requested pages
- `POST /render-regions` (multipart/form-data)
  - field: `file` (PDF)
  - fields:
    - `regions` (JSON array of `{ id, page, bbox }`)
    - `dpi` (int)
  - returns JSON with base64 PNGs for requested regions
- `POST /redact` (multipart/form-data)
  - field: `file` (PDF)
  - fields:
    - `detect_pii` (true/false): auto-detect common PII tokens and redact them
    - `boxes` (JSON array): `{ page, bbox, label }` redaction regions (e.g., sensitive figures)
    - `search_texts` (JSON array): `{ page, text, label }` exact-text redaction (best effort)
  - returns a redacted PDF (content-type `application/pdf`)
- `GET /health`

## Configuration (environment)

- `EXTRACT_PIPELINE=docling_cli|python|vlm_cli` (default: `docling_cli`)
- If using `docling_cli`, these are forwarded to the Docling CLI:
  - `DOCLING_TO=md|json|html|text` (default: `md`)
  - `DOCLING_PIPELINE=standard|vlm|asr` (default: `standard`)
  - `DOCLING_OCR=1|0` (default: `1`)
  - `DOCLING_TABLES=1|0` (default: `1`)
  - `DOCLING_PDF_BACKEND=pypdfium2|dlparse_v1|dlparse_v2|dlparse_v4` (optional)

## Run (standalone)

```bash
pip install -r requirements.txt
pip install docling || true
uvicorn main:app --host 0.0.0.0 --port 7000
```

## Docker

Built and run via repo root:

```powershell
docker compose up -d --build docling
```

## Notes

For maximum Docling fidelity, ensure the `docling` package installs successfully in the image.
