import fs from 'fs';
import path from 'path';
import { extractWithDocling } from './doclingAdapter.js';
import { extractWithPdfParse } from './pdfText.js';
import { buildEvidence } from './selectors.js';
import { mapCitations } from '../citations.js';
import { augmentWithVision } from './visionRouting.js';
import { quickDetectImagesWithCloudVision, extractTextWithCloudVisionPdf } from '../google/cloudVisionClient.js';
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

export async function extractDocument({
  filePath,
  originalName,
  providedText,
  preferDocling = true,
  disableVision = false,
  onlineVisionOnly = false,
}) {
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
  if (isPdf && !onlineVisionOnly) {
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

  // 1) Online-only extraction path: Cloud Vision OCR (no Docling dependency)
  if (onlineVisionOnly && filePath && isPdf) {
    const cv = await extractTextWithCloudVisionPdf({
      filePath,
      maxPages: Number(process.env.CLOUD_VISION_OCR_MAX_PAGES || 0) || 0,
    });
    if (!cv || !cv.text) {
      throw new Error('cloud_vision_required_failed');
    }
    text = cv.text;
    meta = { ...meta, ...cv.meta, source: 'cloud_vision' };
    raw = cv.raw;
    blocks = cv.blocks || [];
    used = 'cloud_vision';
    multimodal.google.cloud_vision_quick = {
      enabled: true,
      has_images: null,
      reason: 'online_cloud_vision_only',
      sampled_pages: [],
      detections: [],
    };
    mark('cloud_vision_ocr_ok', { pages: meta.pages, text_len: text.length });
  }

  // 2) Local/offline extraction path: Docling first, pdf-parse fallback
  if (!onlineVisionOnly && preferDocling && filePath) {
    const dl = await extractWithDocling({ filePath });
    if (!dl || !dl.text) {
      const parsed = await extractWithPdfParse({ filePath }).catch(() => null);
      if (!parsed || !parsed.text) throw new Error('docling_required_failed');
      text = parsed.text;
      meta = { ...meta, ...parsed.meta, source: 'pdf_parse' };
      raw = parsed;
      blocks = [];
      used = 'pdf_parse';
      mark('pdf_parse_fallback_ok', { pages: meta.pages, text_len: text.length });
    } else {
      text = dl.text;
      meta = { ...meta, ...dl.meta, source: 'docling' };
      raw = dl.raw;
      blocks = dl.blocks || [];  // Get blocks with page info
      used = 'docling';
      mark('docling_ok', { pages: meta.pages });
    }
  }

  // Vision-only mode: Cloud Vision quick scan is retained for local/offline mode only.
  if (isPdf && !onlineVisionOnly) {
    const reason = userSaysNoImages
      ? 'user_no_images'
      : (quickVision?.enabled ? (quickVision?.has_images ? 'images_detected' : 'cloud_vision_no_images') : 'cloud_vision_unavailable');
    mark('cloud_vision_decision', { reason });
  }

  // 3) Hybrid multimodal routing (local/offline only)
  if (!onlineVisionOnly && !userSaysNoImages && filePath && isPdf) {
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

  // 4) Provided text (debug/testing) only when no file path
  if (!filePath && providedText) {
    text = providedText;
    meta = { ...meta, source: 'provided' };
    used = 'provided';
    mark('provided_text');
  }

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
