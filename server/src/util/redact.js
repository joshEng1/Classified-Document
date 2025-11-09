// Simple PII redaction for emails, phones, SSN-like patterns.
export function redactPII(text) {
  if (!text) return '';
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[REDACTED_SSN]')
    .replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[REDACTED_PHONE]');
}

