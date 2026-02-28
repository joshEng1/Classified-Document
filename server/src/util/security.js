export function redactSecrets(input, { maxLen = 600 } = {}) {
  let s = String(input ?? '');
  if (!s) return '';

  // URL query params often carry API keys/tokens.
  s = s.replace(
    /([?&](?:key|api_key|token|access_token|client_secret)=)([^&\s]+)/gi,
    '$1[REDACTED]'
  );

  // Bearer tokens in headers/messages.
  s = s.replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');

  // Common key/value header-style leaks.
  s = s.replace(
    /\b(x-goog-api-key|authorization|api[-_ ]?key|access[-_ ]?token)\b\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{8,})["']?/gi,
    '$1:[REDACTED]'
  );

  // Google-style API keys.
  s = s.replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, '[REDACTED]');

  // JWT-like tokens.
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, '[REDACTED]');

  // Env-style secret assignments.
  s = s.replace(
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/g,
    '$1=[REDACTED]'
  );

  s = s.replace(/[\r\n\t]+/g, ' ').trim();
  if (s.length > maxLen) return `${s.slice(0, maxLen)}...`;
  return s;
}

export function safeErrorDetail(err, fallback = 'internal_error') {
  if (!err) return fallback;

  let raw = '';
  if (typeof err === 'string') {
    raw = err;
  } else if (typeof err?.message === 'string' && err.message) {
    raw = err.message;
  } else if (typeof err?.response?.data === 'string' && err.response.data) {
    raw = err.response.data;
  } else if (err?.response?.data && typeof err.response.data === 'object') {
    try { raw = JSON.stringify(err.response.data); } catch { raw = String(err); }
  } else {
    try { raw = JSON.stringify(err); } catch { raw = String(err); }
  }

  const safe = redactSecrets(raw);
  return safe || fallback;
}
