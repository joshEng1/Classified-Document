import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const PII_PATTERNS = [
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, // ssn
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email
  /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // phone
  /\b(?:\d[ -]*?){13,19}\b/g, // cc-like
  /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g, // dob-like
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function envNum(name, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const n = Number(process.env[name] || fallback);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function maybePushRect(list, rect) {
  if (!rect) return;
  const x = Number(rect.x || 0);
  const y = Number(rect.y || 0);
  const w = Number(rect.w || 0);
  const h = Number(rect.h || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
  if (w < 1 || h < 1) return;
  list.push({ x, y, w, h });
}

function textItemRectPx(item, viewport) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const x = Number(tx[4] || 0);
  const y = Number(tx[5] || 0);
  const h = Math.max(1, Math.hypot(Number(tx[2] || 0), Number(tx[3] || 0)));
  const w = Math.max(1, Number(item.width || 0) * Number(viewport.scale || 1));
  // pdf.js text y is baseline in viewport space.
  return { x, y: y - h, w, h };
}

function toPxRectFromPdfPoints(bbox, widthPt, heightPt, widthPx, heightPx) {
  const arr = Array.isArray(bbox) ? bbox.map(Number) : null;
  if (!arr || arr.length !== 4 || arr.some((v) => !Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = arr;
  const leftPt = Math.min(x0, x1);
  const topPt = Math.min(y0, y1);
  const rightPt = Math.max(x0, x1);
  const botPt = Math.max(y0, y1);
  const sx = widthPx / Math.max(1, widthPt);
  const sy = heightPx / Math.max(1, heightPt);
  const x = clamp(leftPt * sx, 0, widthPx);
  const y = clamp(topPt * sy, 0, heightPx);
  const w = clamp((rightPt - leftPt) * sx, 0, widthPx - x);
  const h = clamp((botPt - topPt) * sy, 0, heightPx - y);
  return { x, y, w, h };
}

function buildImagePdf(pages) {
  const out = [];
  let offset = 0;

  const write = (bufOrStr) => {
    const b = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'binary');
    out.push(b);
    offset += b.length;
  };

  const pageCount = pages.length;
  if (!pageCount) return Buffer.alloc(0);

  const objects = new Map();
  const xrefOffsets = [];
  const totalObjects = 2 + pageCount * 3;

  // 1: catalog, 2: pages
  objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'binary'));

  const kids = [];
  for (let i = 0; i < pageCount; i++) {
    const imgId = 3 + i * 3;
    const contentId = 4 + i * 3;
    const pageId = 5 + i * 3;
    kids.push(`${pageId} 0 R`);

    const p = pages[i];
    const imgHeader = `<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`;
    const imgFooter = '\nendstream';
    objects.set(imgId, Buffer.concat([
      Buffer.from(imgHeader, 'binary'),
      p.jpeg,
      Buffer.from(imgFooter, 'binary'),
    ]));

    const streamText = `q\n${p.widthPt} 0 0 ${p.heightPt} 0 0 cm\n/Im${i} Do\nQ\n`;
    const contentObj = `<< /Length ${Buffer.byteLength(streamText, 'binary')} >>\nstream\n${streamText}endstream`;
    objects.set(contentId, Buffer.from(contentObj, 'binary'));

    const pageObj = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.widthPt} ${p.heightPt}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects.set(pageId, Buffer.from(pageObj, 'binary'));
  }

  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`, 'binary'));

  write('%PDF-1.7\n%\xFF\xFF\xFF\xFF\n');

  for (let id = 1; id <= totalObjects; id++) {
    xrefOffsets[id] = offset;
    write(`${id} 0 obj\n`);
    write(objects.get(id) || '<<>>');
    write('\nendobj\n');
  }

  const xrefStart = offset;
  write(`xref\n0 ${totalObjects + 1}\n`);
  write('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id++) {
    const off = Number(xrefOffsets[id] || 0);
    write(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(out);
}

export async function redactPdfNative({ filePath, boxes = [], searchTexts = [], detectPii = true }) {
  if (!filePath) return null;
  const bytes = fs.readFileSync(filePath);
  const data = new Uint8Array(bytes);
  const dpi = envNum('NATIVE_REDACT_DPI', 144, 72, 300);
  const scale = dpi / 72;
  const jpegQuality = envNum('NATIVE_REDACT_JPEG_QUALITY', 88, 50, 95);

  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf?.numPages || 0) || 0;
  if (!totalPages) return null;

  const searchByPage = new Map();
  for (const s of (Array.isArray(searchTexts) ? searchTexts : [])) {
    const p = Number(s?.page || 0);
    const text = norm(s?.text || '');
    if (!p || !text) continue;
    if (!searchByPage.has(p)) searchByPage.set(p, []);
    searchByPage.get(p).push(text);
  }

  const boxByPage = new Map();
  for (const b of (Array.isArray(boxes) ? boxes : [])) {
    const p = Number(b?.page || 0);
    if (!p || !Array.isArray(b?.bbox)) continue;
    if (!boxByPage.has(p)) boxByPage.set(p, []);
    boxByPage.get(p).push(b.bbox);
  }

  const rendered = [];
  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const viewPt = page.getViewport({ scale: 1.0 });
    const viewport = page.getViewport({ scale });
    const widthPx = Math.max(1, Math.floor(viewport.width));
    const heightPx = Math.max(1, Math.floor(viewport.height));

    const canvas = createCanvas(widthPx, heightPx);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const rects = [];

    // Manual/system boxes in PDF point coordinates.
    for (const bbox of (boxByPage.get(p) || [])) {
      maybePushRect(rects, toPxRectFromPdfPoints(
        bbox,
        Number(viewPt.width || 1),
        Number(viewPt.height || 1),
        widthPx,
        heightPx
      ));
    }

    // Text-derived redactions (search terms + optional PII patterns).
    const textContent = await page.getTextContent();
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const queries = searchByPage.get(p) || [];
    for (const it of items) {
      const raw = String(it?.str || '');
      if (!raw) continue;
      const s = norm(raw);
      if (!s) continue;

      let hit = false;
      for (const q of queries) {
        if (s.includes(q) || q.includes(s)) {
          hit = true;
          break;
        }
      }
      if (!hit && detectPii) {
        for (const rx of PII_PATTERNS) {
          rx.lastIndex = 0;
          if (rx.test(raw)) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      maybePushRect(rects, textItemRectPx(it, viewport));
    }

    ctx.fillStyle = '#000000';
    for (const r of rects) {
      ctx.fillRect(
        clamp(Math.floor(r.x), 0, widthPx),
        clamp(Math.floor(r.y), 0, heightPx),
        clamp(Math.ceil(r.w), 0, widthPx),
        clamp(Math.ceil(r.h), 0, heightPx)
      );
    }

    const jpeg = canvas.toBuffer('image/jpeg', jpegQuality);
    rendered.push({
      jpeg,
      widthPx,
      heightPx,
      widthPt: Number(viewPt.width || widthPx),
      heightPt: Number(viewPt.height || heightPx),
    });
  }

  return buildImagePdf(rendered);
}
