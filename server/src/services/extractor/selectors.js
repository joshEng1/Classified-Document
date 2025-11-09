// Build minimal evidence from text for GPT/LLM verification.
// Headings, snippets, links, branding, layout signals (heuristic only here).

const MARKETING_TERMS = [
  'solution', 'platform', 'features', 'benefits', 'customer', 'case study',
  'partner', 'roi', 'learn more', 'contact', 'download', 'webinar', 'whitepaper',
  'request demo', 'demo', 'sales'
];

const MEMO_CUES = ['memo', 'to:', 'from:', 'subject:', 're:', 'cc:', 'date:'];
const APPLICATION_CUES = ['application for employment', 'employment application', 'previous employer', 'position applied', 'signature'];
const INVOICE_CUES = ['invoice', 'bill to', 'ship to', 'subtotal', 'total', 'balance due', '$'];

export function buildEvidence({ text, meta }) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const headings = lines.filter(l => l === l.toUpperCase() && l.length >= 4 && l.length <= 80).slice(0, 8);
  const marketingSnippets = lines.filter(l => containsAny(l.toLowerCase(), MARKETING_TERMS)).slice(0, 8);
  const memoSnippets = lines.filter(l => containsAny(l.toLowerCase(), MEMO_CUES)).slice(0, 8);
  const appSnippets = lines.filter(l => containsAny(l.toLowerCase(), APPLICATION_CUES)).slice(0, 8);
  const invoiceSnippets = lines.filter(l => containsAny(l.toLowerCase(), INVOICE_CUES)).slice(0, 8);

  const urlRegex = /https?:\/\/[^\s)]+/gi;
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const links = Array.from(new Set((text.match(urlRegex) || []).concat(text.match(emailRegex) || []))).slice(0, 12);

  // crude brand extraction: domain-like words and copyright lines
  const branding = Array.from(new Set(lines
    .filter(l => /©|copyright|all rights reserved|\binc\b|\bcorp\b|\bllc\b|\b(labs|technologies|systems)\b/i.test(l))
    .concat(lines.filter(l => /\b(www\.[^\s]+|\.[A-Za-z]{2,})\b/.test(l))))).slice(0, 8);

  const layout_signals = [];
  if (avgLineLength(lines) < 40 && lines.length > 20) layout_signals.push('multi-column_hint');

  return {
    headings,
    snippets: Array.from(new Set([ ...marketingSnippets, ...memoSnippets, ...appSnippets, ...invoiceSnippets ])).slice(0, 12),
    links,
    branding,
    layout_signals,
  };
}

function containsAny(line, arr) {
  return arr.some(k => line.includes(k));
}

function avgLineLength(lines) {
  if (!lines.length) return 0;
  const total = lines.reduce((a, b) => a + b.length, 0);
  return total / lines.length;
}

export const CUES = { MARKETING_TERMS, MEMO_CUES, APPLICATION_CUES, INVOICE_CUES };

