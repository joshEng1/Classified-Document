// Simple PII redaction for the verifier/guard pipeline.
// This is text-only masking (not PDF redaction). PDF redaction is handled via docling-service `/redact`.
export function redactPII(text) {
  if (!text) return '';
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[REDACTED_SSN]')
    .replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '[REDACTED_ZIP]')
    .replace(/\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g, '[REDACTED_DOB]')
    // Loose credit/debit card pattern (13-19 digits allowing spaces/dashes)
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
    // Address-like (conservative): leading street number + common suffixes
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.'\-\s]+\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Lane|Ln|Dr|Drive|Court|Ct|Way|Terrace|Ter|Place|Pl)\b/gi, '[REDACTED_ADDRESS]')
    // Names (conservative): common form patterns like "Name: John Doe" or "Simmons, Susan J."
    .replace(/\b(?:name|applicant|employee|customer)\s*[:\-]\s*[A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24}){1,3}\b/g, '[REDACTED_NAME]')
    .replace(/\b[A-Z][a-z]{1,24},\s*[A-Z][a-z]{1,24}(?:\s+[A-Z]\.)?\b/g, '[REDACTED_NAME]');
}

