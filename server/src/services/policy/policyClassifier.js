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

function stripEmbeddedBase64Images(text) {
  // Avoid heuristic false positives from huge embedded data URIs (Docling Markdown embeds images as base64).
  return String(text || '').replace(/\(data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+\)/g, '(data:image;base64,...)');
}

export function classifyPolicy({ text, meta, pii, safety, equipment, multimodal }) {
  const textForHeuristics = stripEmbeddedBase64Images(text || '');
  const t = textForHeuristics.toLowerCase();
  const citations = [];
  const unsafe = Boolean(safety?.unsafe);
  const safety_categories = Array.isArray(safety?.categories) ? safety.categories : [];
  let sensitivity = 'Public';
  let rationale = 'No PII, unsafe, or internal-only indicators detected.';

  if (unsafe) {
    if (safety.matches?.length) citations.push({ type: 'unsafe', page: safety.matches[0].page, text: safety.matches[0].snippet });
  }

  const piiItems = Array.isArray(pii?.items) ? pii.items : [];
  const piiTypes = new Set(piiItems.map((it) => String(it?.type || '').toLowerCase()).filter(Boolean));

  // Only treat truly sensitive PII as "Highly Sensitive".
  // Public marketing brochures often contain generic contact info (email/phone/address),
  // which should not automatically elevate to "Highly Sensitive" for this datathon's rubric.
  const HIGH_RISK_PII = new Set(['ssn', 'credit_card_like', 'dob', 'account_number_like']);
  const MED_RISK_PII = new Set(['address_like']);
  const LOW_RISK_PII = new Set(['email', 'phone']);

  const hasHighRisk = Array.from(HIGH_RISK_PII).some((k) => piiTypes.has(k));
  const hasMedRisk = Array.from(MED_RISK_PII).some((k) => piiTypes.has(k));
  const hasAnyPii = piiTypes.size > 0;
  const hasOnlyLowRisk = hasAnyPii && !hasHighRisk && !hasMedRisk && Array.from(piiTypes).every((k) => LOW_RISK_PII.has(k));
  const hasOnlyLowOrAddress = hasAnyPii && !hasHighRisk && Array.from(piiTypes).every((k) => LOW_RISK_PII.has(k) || MED_RISK_PII.has(k));

  // If OCR misses filled values, still treat documents containing explicit PII field labels as sensitive.
  const PII_FIELD_LABELS = [
    /\bsocial\s+security\s+(?:number|no\.|#)?\b/i,
    /\bssn\b/i,
    /\bdate\s+of\s+birth\b/i,
    /\bdob\b/i,
    /\bcredit\s+card\b/i,
    /\baccount\s+number\b/i,
    /\brouting\s+number\b/i,
  ];
  const hasPiiFieldLabels = PII_FIELD_LABELS.some((re) => re.test(text || ''));

  // Marketing heuristic: treat public contact info on a marketing doc as Public.
  const linkCount =
    ((text || '').match(/\bhttps?:\/\/[^\s)]+/gi) || []).length +
    ((text || '').match(/\bwww\.[^\s)]+/gi) || []).length +
    ((text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).length;
  const marketingLikely = linkCount >= 2 || /\b(brochure|viewbook|program|solutions?|platform|features?|benefits?|case\s+study|contact\s+us|visit\s+us)\b/i.test(textForHeuristics);

  // Form/application heuristic: treat filled applications as Highly Sensitive even if OCR misses SSNs.
  const applicationLikely =
    /\bemployment\s+application\b/i.test(text || '') ||
    /\bapplication\s+for\s+employment\b/i.test(text || '') ||
    (/\bapplicant\b/i.test(text || '') && /\bemployer\b/i.test(text || ''));

  // Multimodal (Vision) signals: use these for image-heavy PDFs where OCR misses details.
  const visionRegions = Array.isArray(multimodal?.vision?.regions) ? multimodal.vision.regions : [];
  const visionFlags = {
    pii: false,
    proprietary_schematic: false,
    defense_equipment: false,
    serial_or_part_names: false,
    customer_details: false,
    internal_business: false,
    non_public_ops: false,
  };
  const visionEvidence = [];

  for (const r of visionRegions) {
    const a = r?.analysis || {};
    const flags = a?.flags && typeof a.flags === 'object' ? a.flags : {};
    const page = Number(r?.page || 0) || 1;
    const bbox = Array.isArray(r?.bbox) && r.bbox.length === 4 ? r.bbox : undefined;
    const snippet = String(a?.summary || a?.rationale || a?.extracted_text || '').slice(0, 200);

    for (const k of Object.keys(visionFlags)) {
      if (flags?.[k]) visionFlags[k] = true;
    }

    if (flags?.proprietary_schematic) visionEvidence.push({ type: 'vision_proprietary_schematic', page, bbox, text: snippet || 'vision_proprietary_schematic' });
    if (flags?.defense_equipment || flags?.serial_or_part_names) visionEvidence.push({ type: 'vision_equipment', page, bbox, text: snippet || 'vision_equipment' });
    if (flags?.pii) visionEvidence.push({ type: 'vision_pii', page, bbox, text: snippet || 'vision_pii' });
    if (flags?.customer_details) visionEvidence.push({ type: 'vision_customer_details', page, bbox, text: snippet || 'vision_customer_details' });
    if (flags?.internal_business || flags?.non_public_ops) visionEvidence.push({ type: 'vision_internal', page, bbox, text: snippet || 'vision_internal' });

    const serials = Array.isArray(a?.detected_serials) ? a.detected_serials : [];
    if (serials.length) {
      visionFlags.serial_or_part_names = true;
      visionEvidence.push({ type: 'vision_serial', page, bbox, text: String(serials.slice(0, 5).join(', ')).slice(0, 180) });
    }
  }

  if (hasHighRisk || hasPiiFieldLabels || visionFlags.pii || visionFlags.proprietary_schematic) {
    sensitivity = 'Highly Sensitive';
    rationale = hasHighRisk
      ? 'Contains high-risk PII (e.g., SSN, credit card-like numbers, DOB).'
      : (visionFlags.pii || visionFlags.proprietary_schematic)
        ? 'Multimodal analysis indicates PII or proprietary schematic content.'
        : 'Contains explicit PII field labels (e.g., SSN/DOB), treat as Highly Sensitive even if OCR missed values.';
    for (const it of piiItems.slice(0, 3)) citations.push({ type: it.type, page: it.page, text: it.value });
    citations.push(...visionEvidence.slice(0, 3));
  } else if (applicationLikely && hasAnyPii && !marketingLikely) {
    sensitivity = 'Highly Sensitive';
    rationale = 'Appears to be a filled employment application containing personal details (treat as Highly Sensitive).';
    for (const it of piiItems.slice(0, 3)) citations.push({ type: it.type, page: it.page, text: it.value });
    citations.push(...visionEvidence.slice(0, 3));
  } else if (hasMedRisk && !hasOnlyLowRisk) {
    if (marketingLikely && hasOnlyLowOrAddress) {
      sensitivity = 'Public';
      rationale = 'Appears to be a public marketing document; detected contact/address info is likely public-facing.';
    } else {
      sensitivity = 'Confidential';
      rationale = 'Contains potentially identifying address-like content.';
      for (const it of piiItems.slice(0, 3)) citations.push({ type: it.type, page: it.page, text: it.value });
      citations.push(...visionEvidence.slice(0, 2));
    }
  } else if (hasAnyPii && !hasOnlyLowRisk) {
    // If we detected other PII-like types (future expansion), treat as Confidential by default.
    sensitivity = 'Confidential';
    rationale = 'Contains personal or customer-detail indicators.';
    for (const it of piiItems.slice(0, 3)) citations.push({ type: it.type, page: it.page, text: it.value });
    citations.push(...visionEvidence.slice(0, 2));
  } else if ((visionFlags.customer_details || visionFlags.internal_business || visionFlags.non_public_ops) && !marketingLikely) {
    sensitivity = 'Confidential';
    rationale = visionFlags.customer_details
      ? 'Multimodal analysis indicates customer details.'
      : 'Multimodal analysis indicates internal or non-public operational content.';
    citations.push(...visionEvidence.slice(0, 3));
  }

  const internalOnly = containsAny(t, INTERNAL_ONLY_CUES);
  const equipmentFlag = containsAny(t, EQUIPMENT_CUES) || Boolean(equipment?.items?.length) || visionFlags.defense_equipment || visionFlags.serial_or_part_names;
  if (internalOnly || equipmentFlag) {
    sensitivity = (sensitivity === 'Highly Sensitive') ? sensitivity : 'Confidential';
    rationale = equipmentFlag ? 'Sensitive equipment indicators present.' : 'Internal-only indicators present.';
    if (equipment?.items?.length) {
      const hit = equipment.items[0];
      citations.push({ type: 'equipment', page: hit.page, text: hit.text });
    }
    if (!equipment?.items?.length && equipmentFlag && visionEvidence.length) {
      citations.push(...visionEvidence.filter(c => c.type.startsWith('vision_')).slice(0, 2));
    }
  }

  // If marketing cues and many links, still Public
  const overall = unsafe ? `${sensitivity} and Unsafe` : sensitivity;
  return { sensitivity, unsafe, safety_categories, overall, rationale, citations };
}
