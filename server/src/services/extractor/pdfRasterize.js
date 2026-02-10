import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export async function rasterizePdfPagesAsBase64({
  filePath,
  dpi = 150,
  maxPages = 0,
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
  });

  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf?.numPages || 0) || 0;
  const limit = Number(maxPages || 0);
  const pageCount = limit > 0 ? Math.min(totalPages, limit) : totalPages;
  const out = [];

  for (let p = 1; p <= pageCount; p++) {
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
