// Simple document chunker with page awareness and character-based limits.
// Produces chunks suitable for per-chunk SLM analysis and moderation.
// Each chunk has: { id, page, start, end, text }

function splitPages(text, meta) {
  if (!text) return [''];
  if (text.includes('\f')) return text.split('\f');
  const pages = Math.max(1, Number(meta?.pages || 0));
  if (pages <= 1) return [text];
  const per = Math.ceil(text.length / pages);
  const arr = [];
  for (let i = 0; i < pages; i++) arr.push(text.slice(i * per, (i + 1) * per));
  return arr;
}

export function chunkDocument(text, meta, opts = {}) {
  const maxChars = Number(opts.maxChars || 1600); // ~400 tokens
  const minChars = Number(opts.minChars || 600);
  const pages = splitPages(text || '', meta);
  const chunks = [];
  let id = 0;
  for (let p = 0; p < pages.length; p++) {
    const pageText = pages[p];
    if (!pageText || !pageText.trim()) continue;
    // Prefer splitting by paragraphs to keep semantic integrity
    const paras = pageText.split(/\r?\n\s*\r?\n+/g).filter(Boolean);
    let buf = '';
    let pageStart = 0;
    let localIndex = 0;
    for (const para of paras) {
      const add = (buf ? '\n\n' : '') + para.trim();
      if ((buf + add).length <= maxChars) {
        buf += add;
      } else {
        if (buf.length >= minChars) {
          chunks.push({ id: id++, page: p + 1, start: pageStart, end: pageStart + buf.length, text: buf });
          pageStart += buf.length;
          buf = para.trim();
        } else {
          // Hard split long paragraph if it alone exceeds max
          const paraChunks = hardSplit(para.trim(), maxChars);
          for (const pc of paraChunks) {
            if (pc.length < minChars && buf) {
              const merged = (buf + '\n\n' + pc).slice(0, maxChars);
              chunks.push({ id: id++, page: p + 1, start: pageStart, end: pageStart + merged.length, text: merged });
              pageStart += merged.length;
              buf = '';
            } else if (pc.length >= minChars) {
              chunks.push({ id: id++, page: p + 1, start: pageStart, end: pageStart + pc.length, text: pc });
              pageStart += pc.length;
              buf = '';
            } else {
              buf = pc; // carry small remainder
            }
          }
        }
      }
      localIndex++;
    }
    if (buf && buf.trim()) {
      chunks.push({ id: id++, page: p + 1, start: pageStart, end: pageStart + buf.length, text: buf });
    }
  }
  return chunks;
}

function hardSplit(s, max) {
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}

