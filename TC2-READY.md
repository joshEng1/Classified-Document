# TC2 Readiness Notes

This document is a short checklist for TC2-specific requirements, focused on PII evidence and page citations.

## Requirements

- Page count and image count extracted from the document
- PII detection for common fields (SSN, phone, email, address, ZIP, DOB)
- Evidence strings include field context and redaction guidance
- Page numbers are 1-indexed and shown as `(Page N)` when available

## Where to Look

- Page tracking: `PAGE-TRACKING.md`
- PII detector design: `PII-DETECTION-FIX.md`
- Key files:
  - `docling-service/main.py`
  - `server/src/services/extractor/doclingAdapter.js`
  - `server/src/services/extractor/index.js`
  - `server/src/services/pii/piiDetector.js`
  - `server/src/index.js`

## How to Test

1) Start services (see `SETUP.md`).
2) Upload the TC2 employment application via `http://localhost:5055/`.
3) Verify PII evidence includes `(Page N)` and is consistent with the PDF content.
