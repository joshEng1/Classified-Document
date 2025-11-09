import fs from 'fs';
import path from 'path';
import { extractWithDocling } from './doclingAdapter.js';
import { buildEvidence } from './selectors.js';
import { mapCitations } from '../citations.js';

function basicLegibility({ text, numPages }) {
  const charCount = (text || '').length;
  const avgChars = numPages ? charCount / numPages : charCount;
  return {
    hasText: charCount > 50,
    avgCharsPerPage: Math.round(avgChars),
    isLikelyScanned: charCount < 100 && numPages > 0,
  };
}

export async function extractDocument({ filePath, originalName, providedText, preferDocling = true }) {
  let meta = { pages: 0, images: 0, source: 'unknown', originalName };
  let text = '';
  let ocrText = '';
  let raw = null;
  let blocks = [];  // Add blocks for page-level PII detection
  let used = 'none';
  const status = [];
  function mark(phase, extra) {
    try { status.push({ phase, at: new Date().toISOString(), ...(extra || {}) }); } catch { }
  }

  // Estimate image count early to decide extraction strategy
  if (filePath) {
    try {
      const buf = fs.readFileSync(filePath);
      const str = buf.toString('latin1');
      const matches = str.match(/\/Subtype\s*\/Image/g);
      meta.images = matches ? matches.length : 0;
    } catch { }
  }

  // 1) Docling (required) for structured text
  if (preferDocling && filePath) {
    const dl = await extractWithDocling({ filePath });
    if (!dl || !dl.text) {
      throw new Error('docling_required_failed');
    }
    text = dl.text;
    meta = { ...meta, ...dl.meta, source: 'docling' };
    raw = dl.raw;
    blocks = dl.blocks || [];  // Get blocks with page info
    used = 'docling';
    mark('docling_ok', { pages: meta.pages });
  }

  // 2) No OCR/pdf-parse fallbacks here; Docling CLI handles OCR internally via --ocr.

  // 3) Provided text (debug/testing) only when no file path
  if (!filePath && providedText) {
    text = providedText;
    meta = { ...meta, source: 'provided' };
    used = 'provided';
    mark('provided_text');
  }

  // 4) No pdf-parse fallback

  // 5) Legibility assessment
  const leg = basicLegibility({ text, numPages: meta.pages || 0 });
  meta = { ...meta, ...leg, pipeline: used };

  // 6) Evidence selection for verification
  const evidenceRaw = buildEvidence({ text, meta });
  const evidence = mapCitations({ text, evidence: evidenceRaw, meta });

  console.log(`[extractor] Extraction complete - source: ${used}, text length: ${text.length}, images: ${meta.images}, blocks: ${blocks.length}`);
  return { text, meta, evidence, raw, status, blocks };
}
