import { CUES } from './selectors.js';

export function runGuards({ text, meta }) {
  const t = (text || '').toLowerCase();

  const hasMarketing = countMatches(t, CUES.MARKETING_TERMS) >= 2;
  const hasMemo = countMatches(t, CUES.MEMO_CUES) >= 2;
  const hasApplication = countMatches(t, CUES.APPLICATION_CUES) >= 2;
  const hasInvoice = countMatches(t, CUES.INVOICE_CUES) >= 2;

  const links = (t.match(/https?:\/\/[^\s)]+/g) || []).length + (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).length;
  const currency = (t.match(/\$[\s\d,.]+/g) || []).length;
  const signature = /signature|signed by|\bdate:\b/i.test(text);

  const memoGuards = hasMemo && /\bto:\b.*\bfrom:\b/i.test(text);
  const appGuards = hasApplication && signature;
  const invoiceGuards = hasInvoice && currency >= 1;
  const marketingGuards = hasMarketing && links >= 1;

  return {
    hasMarketing,
    hasMemo,
    hasApplication,
    hasInvoice,
    links,
    currency,
    signature,
    memoGuards,
    appGuards,
    invoiceGuards,
    marketingGuards,
    pages: meta.pages || 0,
  };
}

function countMatches(t, terms) {
  let c = 0;
  for (const k of terms) if (t.includes(k)) c++;
  return c;
}

