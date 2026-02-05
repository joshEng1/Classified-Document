// Equipment detector: finds mentions of stealth fighter, parts, and serial numbers
// Returns items with page and snippet for evidence/citations

function splitPages(text, meta) {
  if (!text) return [''];
  if (text.includes('\f')) return text.split('\f');
  const pages = Math.max(1, Number(meta?.pages || 0));
  if (pages <= 1) return [text];
  const per = Math.ceil(text.length / pages);
  return Array.from({ length: pages }, (_v, i) => text.slice(i * per, (i + 1) * per));
}

function pageAt(offset, pagesArr) {
  let acc = 0;
  for (let i = 0; i < pagesArr.length; i++) {
    acc += pagesArr[i].length;
    if (offset < acc) return i + 1;
  }
  return pagesArr.length;
}

function stripEmbeddedBase64Images(text) {
  // Docling Markdown often embeds images as data URIs, which can contain many false-positive cue matches
  // (e.g., "F22" inside base64). Strip these before running regex detectors.
  const t = String(text || '');
  return t.replace(/\(data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+\)/g, '(data:image;base64,...)');
}

export function detectEquipment(text, meta) {
  const t = stripEmbeddedBase64Images(text || '');
  const pagesArr = splitPages(t, meta);
  const items = [];
  const cues = [
    { type: 'aircraft', re: /\bstealth\s+fighter\b|\bF[-\s]?(22|35)\b/gi },
    { type: 'part', re: /\b(part|component|assembly|airframe|wing|fuselage|engine)\b/gi },
    { type: 'serial', re: /\bserial\s*(?:no\.|#|number)?\s*[:\-]?\s*([A-Za-z0-9\-]{4,})\b/gi },
  ];
  for (const c of cues) {
    const re = c.re;
    for (const m of t.matchAll(re)) {
      const start = m.index || 0; const snippet = t.slice(Math.max(0, start - 40), Math.min(t.length, start + 80));
      items.push({ kind: c.type, page: pageAt(start, pagesArr), text: (m[0] || '').slice(0, 160), snippet });
    }
  }
  const summary = items.reduce((acc, it) => { acc[it.kind] = (acc[it.kind] || 0) + 1; return acc; }, {});
  const present = Object.keys(summary);
  return { items, summary, present };
}

