import fs from 'fs';
import path from 'path';
import { extractWithDocling } from './doclingAdapter.js';
import { buildEvidence } from './selectors.js';
import { mapCitations } from '../citations.js';
import { augmentWithVision } from './visionRouting.js';
import { quickDetectImagesWithCloudVision } from '../google/cloudVisionClient.js';
import { extractWithDocumentAI } from '../google/documentAIClient.js';
import { safeErrorDetail } from '../../util/security.js';

function basicLegibility({ text, numPages }) {
  const charCount = (text || '').length;
  const avgChars = numPages ? charCount / numPages : charCount;
  return {
    hasText: charCount > 50,
    avgCharsPerPage: Math.round(avgChars),
    isLikelyScanned: charCount < 100 && numPages > 0,
  };
}

export async function extractDocument({ filePath, originalName, providedText, preferDocling = true, disableVision = false }) {
  let meta = { pages: 0, images: 0, source: 'unknown', originalName };
  let text = '';
  let raw = null;
  let blocks = [];  // Add blocks for page-level PII detection
  let multimodal = {
    vision: null,
    redaction_boxes: [],
    page_signals: [],
    google: {
      cloud_vision_quick: null,
      documentai_ocr: { attempted: false, used: false, reason: 'not_needed' },
    },
  };
  let used = 'none';
  const status = [];
  const userSaysNoImages = Boolean(disableVision);
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

  let quickVision = { enabled: false, has_images: false, reason: 'not_applicable', sampled_pages: [], detections: [] };
  const isPdf = filePath && isProbablyPdf({ filePath, originalName });
  if (isPdf) {
    if (userSaysNoImages) {
      quickVision = { enabled: false, has_images: false, reason: 'user_no_images', sampled_pages: [], detections: [] };
      mark('cloud_vision_quick_skip', { reason: 'user_no_images' });
    } else {
      try {
        quickVision = await quickDetectImagesWithCloudVision({ filePath });
        mark('cloud_vision_quick_done', {
          enabled: quickVision.enabled,
          has_images: quickVision.has_images,
          sampled_pages: (quickVision.sampled_pages || []).length,
          reason: quickVision.reason || 'ok',
        });
      } catch (e) {
        quickVision = { enabled: false, has_images: false, reason: 'cloud_vision_error', sampled_pages: [], detections: [] };
        mark('cloud_vision_quick_error', { error: safeErrorDetail(e) });
      }
    }
  }
  multimodal.google.cloud_vision_quick = quickVision;

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

  const shouldUseDocumentAiOcr = Boolean(
    isPdf &&
    !userSaysNoImages &&
    quickVision?.has_images
  );

  if (shouldUseDocumentAiOcr && filePath) {
    multimodal.google.documentai_ocr.attempted = true;
    try {
      const docAi = await extractWithDocumentAI({ filePath, mimeType: 'application/pdf' });
      if (docAi?.text) {
        const mergedText = chooseOcrText({ baselineText: text, docAiText: docAi.text });
        text = mergedText;
        if (Array.isArray(docAi.blocks) && docAi.blocks.length > blocks.length) {
          blocks = docAi.blocks;
        }
        meta = {
          ...meta,
          pages: Number(docAi?.meta?.pages || meta.pages || 0) || meta.pages,
          source: `${meta.source}+documentai_ocr`,
          ocr_engine: 'documentai',
        };
        raw = { docling: raw, documentai: docAi.raw };
        used = `${used}+documentai_ocr`;
        multimodal.google.documentai_ocr = { attempted: true, used: true, reason: 'applied' };
        mark('documentai_ocr_ok', { pages: meta.pages, text_len: text.length });
      } else {
        multimodal.google.documentai_ocr = { attempted: true, used: false, reason: 'empty_or_unavailable' };
        mark('documentai_ocr_skip', { reason: 'empty_or_unavailable' });
      }
    } catch (e) {
      multimodal.google.documentai_ocr = { attempted: true, used: false, reason: 'error' };
      mark('documentai_ocr_error', { error: safeErrorDetail(e) });
    }
  } else {
    const reason = userSaysNoImages
      ? 'user_no_images'
      : quickVision?.has_images
        ? 'not_pdf'
        : 'cloud_vision_no_images';
    multimodal.google.documentai_ocr = { attempted: false, used: false, reason };
    mark('documentai_ocr_not_needed', { reason });
  }

  // 1b) Hybrid multimodal routing: only for PDFs, only for figure-heavy pages
  if (!userSaysNoImages && filePath && isPdf) {
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
        google: multimodal.google,
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
      mark('vision_supplement_error', { error: safeErrorDetail(e) });
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

function chooseOcrText({ baselineText, docAiText }) {
  const base = String(baselineText || '').trim();
  const dai = String(docAiText || '').trim();
  if (!dai) return base;
  if (!base) return dai;
  if (dai.includes(base)) return dai;
  if (base.includes(dai)) return base;
  if (dai.length >= Math.floor(base.length * 0.75)) return dai;
  return `${base}\n\n${dai}`.trim();
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
