// PII detection with page-level citations and redaction suggestions.
// No external deps; regex-based heuristics. Intent: precise enough for TC2.

function splitIntoPages(text, meta) {
  if (!text) return [''];
  // Prefer form feed if present
  if (text.includes('\f')) return text.split('\f');
  const pages = Math.max(1, Number(meta?.pages || 0));
  if (pages <= 1) return [text];
  const per = Math.ceil(text.length / pages);
  const res = [];
  for (let i = 0; i < pages; i++) res.push(text.slice(i * per, (i + 1) * per));
  return res;
}

function calcPageByOffset(offset, pages) {
  let acc = 0;
  for (let i = 0; i < pages.length; i++) {
    const next = acc + pages[i].length;
    if (offset < next) return i + 1; // 1-based
    acc = next;
  }
  return pages.length;
}

function collectMatches(regex, text, type, pagesArr) {
  const items = [];
  if (!text) return items;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  for (const m of text.matchAll(re)) {
    const value = m[0];
    const start = m.index || 0;
    const end = start + value.length;
    const page = calcPageByOffset(start, pagesArr);
    items.push({ type, value, start, end, page });
  }
  return items;
}

export function detectPII(text, meta) {
  const pagesArr = splitIntoPages(text || '', meta);
  const results = [];
  // Core patterns
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const SSN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/; // 123-45-6789
  const PHONE = /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
  const CREDIT = /\b(?:\d[ -]*?){13,19}\b/; // loose credit/debit card pattern
  const ADDRESS = /\b\d{1,5}\s+[A-Za-z0-9.'\-\s]+\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Court|Ct|Way|Terrace|Ter|Place|Pl)\b/i;

  results.push(
    ...collectMatches(EMAIL, text, 'email', pagesArr),
    ...collectMatches(SSN, text, 'ssn', pagesArr),
    ...collectMatches(PHONE, text, 'phone', pagesArr),
    ...collectMatches(CREDIT, text, 'credit_card_like', pagesArr),
    ...collectMatches(ADDRESS, text, 'address_like', pagesArr),
  );

  // aggregate
  const summary = {
    counts: results.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
    total: results.length,
  };

  // redaction suggestions (indices)
  const redactions = results.map(r => ({ start: r.start, end: r.end, label: r.type }));

  return { items: results, summary, redactions };
}

export function redactWithItems(text, items) {
  if (!text || !Array.isArray(items) || !items.length) return text || '';
  // Redact longest spans first to preserve offsets
  const spans = items.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start));
  let out = text;
  for (const s of spans) {
    const mask = `[REDACTED_${String(s.label || s.type || 'PII').toUpperCase()}]`;
    out = out.slice(0, s.start) + mask + out.slice(s.end);
  }
  return out;
}

