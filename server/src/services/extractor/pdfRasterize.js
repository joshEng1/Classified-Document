import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export async function rasterizePdfPagesAsBase64({
  filePath,
  dpi = 150,
  maxPages = 0,
  pages = [],
  imageFormat = 'png',
}) {
  if (!filePath) return [];
  const bytes = fs.readFileSync(filePath);
  const data = new Uint8Array(bytes);
  const scale = Math.max(0.5, Math.min(4, Number(dpi || 150) / 72));
  const format = String(imageFormat || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png';

  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf?.numPages || 0) || 0;
  const requestedPages = Array.isArray(pages)
    ? Array.from(new Set(
      pages
        .map((p) => Number(p))
        .filter((p) => Number.isFinite(p) && p >= 1 && p <= totalPages)
        .map((p) => Math.floor(p))
    )).sort((a, b) => a - b)
    : [];
  const limit = Number(maxPages || 0);
  const pageList = requestedPages.length
    ? requestedPages
    : Array.from({ length: (limit > 0 ? Math.min(totalPages, limit) : totalPages) }, (_, i) => i + 1);
  const out = [];

  for (const p of pageList) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    const buffer = format === 'jpeg'
      ? canvas.toBuffer('image/jpeg', 90)
      : canvas.toBuffer('image/png');
    out.push({
      page: p,
      mime_type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      image_base64: buffer.toString('base64'),
    });
  }

  return out;
}

export async function inspectPdfPagesBasic({
  filePath,
  maxPages = 0,
}) {
  if (!filePath) return { pages: 0, page_signals: [] };
  const bytes = fs.readFileSync(filePath);
  const data = new Uint8Array(bytes);

  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf?.numPages || 0) || 0;
  const limit = Number(maxPages || 0);
  const pageCount = limit > 0 ? Math.min(totalPages, limit) : totalPages;
  const page_signals = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    page_signals.push({
      page: p,
      width: Number(viewport?.width || 0),
      height: Number(viewport?.height || 0),
      text_coverage: 0,
      image_coverage: 0,
      non_text_coverage: 1,
      figure_count: 0,
      figure_content_missing: false,
      image_boxes: [],
    });
  }

  return {
    pages: pageCount,
    page_signals,
  };
}
