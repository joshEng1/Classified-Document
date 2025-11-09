export function shouldRoute({ local, guards, meta }) {
  const low = Number(process.env.ROUTE_LOW) || 0.5;
  const auto = Number(process.env.AUTO_ACCEPT) || 0.9;

  if (local.confidence >= auto) return { routed: false, reason: 'local_high_confidence' };

  // Guard failures that contradict a class → route
  if (local.label === 'Invoice' && guards.currency === 0) return { routed: true, reason: 'invoice_no_currency' };
  if (local.label === 'Employee Application' && !guards.signature) return { routed: true, reason: 'application_no_signature' };
  if (local.label === 'Internal Memo' && !guards.memoGuards) return { routed: true, reason: 'memo_missing_to_from' };
  if (local.label === 'Public Marketing Document' && !(guards.hasMarketing && guards.links >= 1)) return { routed: true, reason: 'marketing_no_links_or_terms' };

  // Low confidence route
  if (local.confidence < low) return { routed: true, reason: 'local_low_confidence' };

  // Scanned/low text pages
  if (meta.isLikelyScanned && !guards.hasMarketing && !guards.hasMemo && !guards.hasApplication && !guards.hasInvoice) {
    return { routed: true, reason: 'scanned_uncertain' };
  }

  return { routed: false, reason: 'default' };
}

