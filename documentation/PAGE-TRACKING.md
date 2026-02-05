# Page Number Tracking for PII Evidence

## Goal

Expose page numbers end-to-end so PII findings can be cited as `(Page N)` and validated against TC2 requirements.

## Data Flow

1) Docling extraction returns `blocks[]` with `{ text, page }` (1-indexed pages).
2) The Node extractor propagates `blocks` along with `text` and `meta`.
3) The PII detector runs per-block when block page metadata is available.
4) The API response includes page-aware PII evidence that the UI can render.

## Implementation Summary

- Docling service page provenance:
  - `docling-service/main.py` includes page numbers in extracted blocks where available.
- Docling adapter passthrough:
  - `server/src/services/extractor/doclingAdapter.js` forwards `blocks` from the Docling JSON response.
- Main extractor propagation:
  - `server/src/services/extractor/index.js` returns `blocks` on the extraction object.
- PII detection:
  - `server/src/services/pii/piiDetector.js` supports block-based detection (`detectPIIFromBlocks`).
- Server integration:
  - `server/src/index.js` prefers block-based detection when `extraction.blocks` exists.

## Verification Checklist

Upload the TC2 employment application and confirm:

- Each PII item includes a 1-indexed `page` number (Page 1, Page 2, ...).
- Evidence strings include page citations, e.g. `"Field Name" (Page N): "value" -> "redacted"`.
- Multiple PII items on the same page are distinguishable (field name + value context).
