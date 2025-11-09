// Policy-level classification for sensitivity: Public, Confidential, Highly Sensitive + Safety.
// Uses outputs from PII, Safety, and optional Equipment detectors.

const INTERNAL_ONLY_CUES = [
  /\bconfidential\b/i,
  /\binternal\s+use\s+only\b/i,
  /\bproprietary\b/i,
  /\bdo\s+not\s+distribute\b/i,
  /\bnda\b|non[-\s]?disclosure/i,
];

const EQUIPMENT_CUES = [
  /\bstealth\s+fighter\b/i,
  /\bF[-\s]?(22|35)\b/i,
  /\bserial\s*(no\.|#|number)\b/i,
  /\bpart\s+name\b|\bcomponent\b/i,
];

function containsAny(text, cues) {
  return cues.some((r) => r.test(text));
}

export function classifyPolicy({ text, meta, pii, safety, equipment }) {
  const t = (text || '').toLowerCase();
  const citations = [];
  const unsafe = Boolean(safety?.unsafe);
  const safety_categories = Array.isArray(safety?.categories) ? safety.categories : [];
  let sensitivity = 'Public';
  let rationale = 'No PII, unsafe, or internal-only indicators detected.';

  if (unsafe) {
    if (safety.matches?.length) citations.push({ type: 'unsafe', page: safety.matches[0].page, text: safety.matches[0].snippet });
  }

  if ((pii?.summary?.total || 0) > 0) {
    sensitivity = 'Highly Sensitive';
    rationale = 'Contains PII fields (e.g., SSN, email, phone, address).';
    // cite top PII items
    for (const it of (pii.items || []).slice(0, 3)) citations.push({ type: it.type, page: it.page, text: it.value });
    // continue; unsafe may also apply
  }

  const internalOnly = containsAny(t, INTERNAL_ONLY_CUES);
  const equipmentFlag = containsAny(t, EQUIPMENT_CUES) || Boolean(equipment?.items?.length);
  if (internalOnly || equipmentFlag) {
    sensitivity = (sensitivity === 'Highly Sensitive') ? sensitivity : 'Confidential';
    rationale = equipmentFlag ? 'Sensitive equipment indicators present.' : 'Internal-only indicators present.';
    if (equipment?.items?.length) {
      const hit = equipment.items[0];
      citations.push({ type: 'equipment', page: hit.page, text: hit.text });
    }
  }

  // If marketing cues and many links, still Public
  const overall = unsafe ? `${sensitivity} and Unsafe` : sensitivity;
  return { sensitivity, unsafe, safety_categories, overall, rationale, citations };
}
