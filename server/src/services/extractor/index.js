import fs from 'fs';
import path from 'path';
import { extractWithDocling } from './doclingAdapter.js';
import { buildEvidence } from './selectors.js';
import { mapCitations } from '../citations.js';
import { augmentWithVision } from './visionRouting.js';

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
  let multimodal = { vision: null, redaction_boxes: [], page_signals: [] };
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

  // 1b) Hybrid multimodal routing: only for PDFs, only for figure-heavy pages
  if (filePath && isProbablyPdf({ filePath, originalName })) {
    try {
      const vision = await augmentWithVision({ filePath, blocks, meta });
      multimodal = {
        vision: {
          enabled: vision.enabled,
          routed: vision.routed || [],
          regions: vision.regions || [],
        },
        redaction_boxes: vision.redaction_boxes || [],
        page_signals: vision.page_signals || [],
      };

      if (vision?.markdown) {
        text = `${text}${vision.markdown}`;
        mark('vision_supplement_ok', {
          routed_pages: (vision.routed || []).map(r => r.page),
          regions: (vision.regions || []).length,
        });
      } else {
        mark('vision_supplement_skip', { reason: (vision?.enabled ? 'no_routed_pages' : 'disabled') });
      }
    } catch (e) {
      mark('vision_supplement_error', { error: String(e?.message || e) });
    }
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
  return { text, meta, evidence, raw, status, blocks, multimodal };
}

function isProbablyPdf({ filePath, originalName }) {
  const nameHint = String(originalName || '').toLowerCase();
  if (nameHint.endsWith('.pdf')) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.toString('utf8') === '%PDF';
  } catch {
    return false;
  }
}
