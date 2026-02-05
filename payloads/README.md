# Payloads

This folder holds JSON evidence payloads that can be sent to a routed classifier/verifier step.

## Purpose

- Store intermediate evidence objects (high-signal snippets, cues, and extracted metadata)
- Support repeatable debugging of prompts and routing decisions

## Suggested Schema (keys)

- `document_path`: relative path to the source PDF
- `class_set`: list of labels used across the app
- `routed_reason`: why this doc was routed away from local classification
- `extraction_status`: notes/status from extraction
- `evidence`: minimal, high-signal fields (`headings`, `snippets`, `links`, `branding`, `layout_signals`)
- `guards_summary`: guard counts/flags
- `gpt_classifier_prompt` / `gpt_verifier_prompt`: prompt templates used by the backend

## Generating Payloads

1) Install text/OCR tooling (optional):
   - Poppler (`pdftotext`, `pdftoppm`)
   - Optional: `tesseract` or `ocrmypdf` for scanned PDFs
2) Extract text:

```bash
pdftotext -layout -nopgbrk <pdf> <out.txt>
```

3) Build evidence fields (heuristics; adjust as needed):
   - Headings: prominent lines / cue words
   - Snippets: domain cues (e.g., marketing or invoice signals)
   - Links: URLs/emails and call-to-action phrases
   - Branding: company/product names
   - Layout: multi-column and image-heavy indicators
4) Save as `payloads/<basename>.evidence.json`.

