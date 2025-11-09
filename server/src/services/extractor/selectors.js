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

const MAX_HEADINGS = 6;
const MAX_SNIPPETS = 10;
const MAX_LINKS = 8;
const MAX_BRANDING = 6;
const TRIM_LENGTH = 220;

export function buildEvidence({ text }) {
  const rawLines = (text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const truncated = rawLines.map(truncateLine);

  const headings = limitUnique(
    truncated.filter((l, idx) => rawLines[idx] === rawLines[idx].toUpperCase() && l.length >= 4 && l.length <= 80),
    MAX_HEADINGS
  );

  const marketingSnippets = truncated.filter((l, idx) => containsAny(rawLines[idx].toLowerCase(), MARKETING_TERMS));
  const memoSnippets = truncated.filter((l, idx) => containsAny(rawLines[idx].toLowerCase(), MEMO_CUES));
  const appSnippets = truncated.filter((l, idx) => containsAny(rawLines[idx].toLowerCase(), APPLICATION_CUES));
  const invoiceSnippets = truncated.filter((l, idx) => containsAny(rawLines[idx].toLowerCase(), INVOICE_CUES));

  const urlRegex = /https?:\/\/[^\s)]+/gi;
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const links = Array.from(new Set((text.match(urlRegex) || []).concat(text.match(emailRegex) || []))).slice(0, MAX_LINKS);

  // crude brand extraction: domain-like words and copyright lines
  const branding = limitUnique(truncated.filter((l, idx) =>
    /copyright|all rights reserved|\binc\b|\bcorp\b|\bllc\b|\b(labs|technologies|systems)\b/i.test(rawLines[idx]) ||
    /\b(www\.[^\s]+|\.[A-Za-z]{2,})\b/.test(rawLines[idx])
  ), MAX_BRANDING);

  const layout_signals = [];
  if (avgLineLength(rawLines) < 40 && rawLines.length > 20) layout_signals.push('multi-column_hint');

  return {
    headings,
    snippets: limitUnique([ ...marketingSnippets, ...memoSnippets, ...appSnippets, ...invoiceSnippets ], MAX_SNIPPETS),
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

function truncateLine(line) {
  if (!line) return line;
  return line.length > TRIM_LENGTH ? `${line.slice(0, TRIM_LENGTH).trim()}…` : line;
}

function limitUnique(arr, max) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export const CUES = { MARKETING_TERMS, MEMO_CUES, APPLICATION_CUES, INVOICE_CUES };

