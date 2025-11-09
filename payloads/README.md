Payloads folder

Purpose
- Stores evidence JSON payloads consumed by the routed GPT classification/verification step.

Schema (keys)
- `document_path`: relative path to the source PDF.
- `class_set`: fixed list of labels used across the app.
- `routed_reason`: why this doc was routed away from the local transformer.
- `extraction_status`: status and notes from the extraction step.
- `evidence`: minimal, high-signal fields sent to GPT (`headings`, `snippets`, `links`, `branding`, `layout_signals`).
- `guards_summary`: quick counts/booleans for preflight guards.
- `gpt_classifier_prompt` / `gpt_verifier_prompt`: templates used by the backend to call GPT.

Generating real payloads
1) Install text/OCR tools locally:
   - Poppler (`pdftotext`, `pdftoppm`) and optionally `tesseract` or `ocrmypdf` for scanned PDFs.
2) Extract text:
   - `pdftotext -layout -nopgbrk <pdf> <out.txt>`
3) Build evidence (pseudo):
   - Headings: top lines in ALL CAPS or large-font heuristics (if available) or heading cue words.
   - Snippets: lines matching marketing cues (solution/platform/features/benefits/customer/demo/contact/etc.).
   - Links: regex for URLs/emails and CTA phrases.
   - Branding: company/product names from headers/footers/body.
   - Layout: detect multi-column by measuring line indent variance.
4) Fill the JSON and save as `payloads/<basename>.evidence.json`.

Frontend integration (React)
- Treat payload as a typed object; render evidence sections and allow quick redaction preview.
- Provide a button to trigger backend GPT classify/verify using the embedded prompt templates.

