// Safety monitoring: detect content categories deemed unsafe for kids
// Heuristic keyword-based, offline, no network.

const LISTS = {
  hate: [
    /\b(?:racist|white\s+power|inferior\s+races|supremacy|gas\s+the\s+\w+)/i,
  ],
  exploitative: [
    /\b(?:sexual\s+exploitation|nonconsensual|child\s+sexual|csam)\b/i,
  ],
  violent: [
    /\b(?:kill\b|murder\b|lynch\b|behead\b|assassinate\b|massacre\b)/i,
  ],
  criminal: [
    /\b(?:how\s+to\s+make\s+bomb|buy\s+illegal\s+\w+|credit\s+card\s+dumps|counterfeit\s+money)/i,
  ],
  political_news: [
    /\b(?:election\s+results|breaking\s+news|primaries|poll\s+numbers|senate\s+race)\b/i,
  ],
  cyber_threat: [
    /\b(?:zero\s+day|exploit\s+code|ransomware\s+guide|d0x|credential\s+stuffing|sql\s+injection\s+payload)\b/i,
  ],
};

function findMatches(text, pagesArr, label, regexArr) {
  const res = [];
  if (!text) return res;
  for (const r of regexArr) {
    const re = new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');
    for (const m of text.matchAll(re)) {
      const start = m.index || 0; const value = m[0];
      // page inference by cumulative length
      let acc = 0; let page = 1;
      for (let i = 0; i < pagesArr.length; i++) { acc += pagesArr[i].length; if (start < acc) { page = i + 1; break; } }
      res.push({ category: label, snippet: value.slice(0, 120), page });
    }
  }
  return res;
}

function splitPages(text, meta) {
  if (!text) return [''];
  if (text.includes('\f')) return text.split('\f');
  const pages = Math.max(1, Number(meta?.pages || 0));
  if (pages <= 1) return [text];
  const per = Math.ceil(text.length / pages);
  return Array.from({ length: pages }, (_v, i) => text.slice(i * per, (i + 1) * per));
}

export function assessSafety({ text, meta }) {
  const pagesArr = splitPages(text || '', meta);
  const matches = [];
  for (const [label, regs] of Object.entries(LISTS)) {
    matches.push(...findMatches(text || '', pagesArr, label, regs));
  }
  const categories = Array.from(new Set(matches.map(m => m.category)));
  const unsafe = categories.length > 0;
  return {
    unsafe,
    categories,
    matches,
    kid_safe: !unsafe,
  };
}

