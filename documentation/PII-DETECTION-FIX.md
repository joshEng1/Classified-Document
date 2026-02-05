# PII Detection Fix (TC2)

## Problem

LLM-based PII detection was producing false negatives on TC2 employment application documents. This created compliance risk for required TC2 fields (SSN, phone numbers, addresses, emails, ZIP codes, DOB).

## Root Cause

- Smaller/strict moderation models are not reliable PII detectors.
- JSON parsing and prompt variability can further reduce recall.
- PII detection is a better fit for deterministic pattern matching.

## Solution

Use a hybrid approach:

1) Pattern-based PII detector for reliable recall
2) LLM moderation models for safety/toxicity (not PII)

### Pattern-Based PII Detector

File: `server/src/services/pii/piiDetector.js`

Implemented regex-based detection for:

- SSN formats
- Phone numbers
- Email addresses
- ZIP codes
- Address-like strings
- Date-of-birth-like strings

The detector also includes:

- Field-name context extraction (label-style heuristics)
- Severity levels
- Redaction suggestions
- Page-aware citations when block/page metadata is available (see `PAGE-TRACKING.md`)

### Integration

- Server wiring: `server/src/index.js`
- UI display: `public/app.js` (or legacy `js/index.js` if used)

## How to Validate

1) Upload the TC2 document via `http://localhost:5055/`
2) Confirm PII results include:
   - Non-zero counts for expected types
   - Evidence strings with field name + value + redaction guidance
   - `(Page N)` citations when page tracking is available
