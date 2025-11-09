// Naive citation mapper: if page separators present, map lines to page index.
// Otherwise, chunk by average length per page.

export function mapCitations({ text, evidence, meta }) {
  const pages = splitPages(text, meta);
  const mapLineToPage = indexLines(pages);

  function citeLine(line) {
    const idx = mapLineToPage.get(line) ?? findApprox(line, pages);
    return (typeof idx === 'number' && idx >= 0) ? (idx + 1) : null; // 1-based
  }

  const cited = {
    headings: evidence.headings.map(l => ({ text: l, page: citeLine(l) })),
    snippets: evidence.snippets.map(l => ({ text: l, page: citeLine(l) })),
    links: evidence.links.map(l => ({ text: l, page: citeLine(l) })),
    branding: evidence.branding.map(l => ({ text: l, page: citeLine(l) })),
    layout_signals: evidence.layout_signals,
  };
  return cited;
}

function splitPages(text, meta) {
  if (!text) return [['']];
  // Prefer explicit page breaks
  if (text.includes('\f')) {
    return text.split('\f').map(p => p.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  }
  const num = Number(meta?.pages || 0);
  if (num && num > 1) {
    // Evenly chunk by character length when page breaks are missing
    const len = text.length;
    const per = Math.max(1, Math.floor(len / num));
    const arr = [];
    for (let i = 0; i < num; i++) {
      const slice = text.slice(i * per, i === num - 1 ? undefined : (i + 1) * per);
      arr.push(slice.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    }
    return arr;
  }
  // Coarse fallback
  const parts = text.split(/\r?\n\r?\n(?=\r?\n)/g);
  return parts.map(p => p.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
}

function indexLines(pages) {
  const map = new Map();
  pages.forEach((lines, idx) => {
    lines.forEach(l => { if (!map.has(l)) map.set(l, idx); });
  });
  return map;
}

function findApprox(line, pages) {
  if (!line) return null;
  let best = { score: 0, page: null };
  const lc = line.toLowerCase();
  pages.forEach((lines, idx) => {
    for (const l of lines) {
      const s = jaccard(lc, l.toLowerCase());
      if (s > best.score) best = { score: s, page: idx };
    }
  });
  return best.score > 0.6 ? best.page : null;
}

function jaccard(a, b) {
  const sa = new Set(a.split(/\s+/));
  const sb = new Set(b.split(/\s+/));
  const inter = new Set([...sa].filter(x => sb.has(x))).size;
  const uni = sa.size + sb.size - inter;
  return uni ? inter / uni : 0;
}
