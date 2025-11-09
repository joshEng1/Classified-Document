import fs from 'fs';
import path from 'path';
import { extractWithPdfParse } from './pdfText.js';
import { extractWithDocling } from './doclingAdapter.js';
import { runOCR } from './ocr.js';
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
  let used = 'none';
  const status = [];
  function mark(phase, extra) {
    try { status.push({ phase, at: new Date().toISOString(), ...(extra || {}) }); } catch {}
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

  // 1) Docling if available (for structured text)
  if (preferDocling && filePath) {
    try {
      const dl = await extractWithDocling({ filePath });
      if (dl?.text) {
        text = dl.text;
        meta = { ...meta, ...dl.meta, source: 'docling' };
        raw = dl.raw;
        used = 'docling';
        mark('docling_ok', { pages: meta.pages });
      }
    } catch (e) {
      console.error('[extractor] Docling failed:', e.message);
      mark('docling_fail', { error: e?.message || String(e) });
    }
  }

  // 2) OCR in parallel for documents with images (to extract text from embedded images)
  const hasSignificantImages = meta.images >= 5; // Documents with 5+ images likely have text in images
  const hasMinimalText = text.trim().length < 500; // Less than 500 chars suggests scanned/minimal text
  const ext = (filePath ? path.extname(filePath).toLowerCase() : '');
  const isImageFile = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.webp'].includes(ext);

  if (filePath && (hasSignificantImages || hasMinimalText || isImageFile)) {
    try {
      console.log(`[extractor] Running OCR - images: ${meta.images}, text length: ${text.length}, reason: ${hasSignificantImages ? 'significant images' : (isImageFile ? 'image file' : 'minimal text')}`);
      const ocr = await runOCR({ filePath });
      if (ocr?.text) {
        ocrText = ocr.text;
        // Combine Docling + OCR text if both exist
        if (text && ocrText && ocrText.trim().length > 50) {
          text = `${text}\n\n[OCR EXTRACTED TEXT]\n${ocrText}`;
          meta.source = 'docling+ocr';
          used = 'docling+ocr';
          console.log(`[extractor] Combined Docling + OCR text, total length: ${text.length}`);
          mark('ocr_ok_combined', { length: text.length });
        } else if (ocrText) {
          text = ocrText;
          meta = { ...meta, ...ocr.meta, source: 'ocr' };
          used = 'ocr';
          mark('ocr_ok', { length: text.length });
        }
      }
    } catch (e) {
      console.error('[extractor] OCR failed:', e.message);
      mark('ocr_fail', { error: e?.message || String(e) });
    }
  }

  // 3) Provided text (debug/testing)
  if (!text && providedText) {
    text = providedText;
    meta = { ...meta, source: 'provided' };
    used = 'provided';
    mark('provided_text');
  }

  // 4) pdf-parse fallback if no text yet
  if (!text && filePath) {
    try {
      const pp = await extractWithPdfParse({ filePath });
      text = pp.text;
      meta = { ...meta, ...pp.meta, source: 'pdf-parse' };
      used = 'pdf-parse';
      mark('pdfparse_ok', { pages: meta.pages });
    } catch (e) {
      console.error('[extractor] pdf-parse failed:', e.message);
      mark('pdfparse_fail', { error: e?.message || String(e) });
    }
  }

  // 5) Legibility assessment
  const leg = basicLegibility({ text, numPages: meta.pages || 0 });
  meta = { ...meta, ...leg, pipeline: used };

  // 6) Evidence selection for verification
  const evidenceRaw = buildEvidence({ text, meta });
  const evidence = mapCitations({ text, evidence: evidenceRaw, meta });

  console.log(`[extractor] Extraction complete - source: ${used}, text length: ${text.length}, images: ${meta.images}`);
  return { text, meta, evidence, raw, status };
}
