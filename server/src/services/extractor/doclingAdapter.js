import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

// Attempts to use a Docling REST endpoint if configured. Falls back to null.
export async function extractWithDocling({ filePath }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    // Expect a Docling service that accepts multipart and returns JSON with blocks
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const resp = await axios.post(`${base}/extract`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
    });
    const json = resp.data || {};
    const text = (json.text || (Array.isArray(json.blocks) ? json.blocks.map(b => b.text).join('\n') : '')).trim();
    const meta = { pages: json.pages || json.page_count || 0 };
    const blocks = json.blocks || [];  // Pass through blocks with page info
    return { text, meta, raw: json, blocks };
  } catch {
    return null;
  }
}

export async function getPdfSignals({ filePath }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const resp = await axios.post(`${base}/signals`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 120000,
    });
    return resp.data || null;
  } catch {
    return null;
  }
}

export async function renderPdfRegions({ filePath, regions, dpi = 220 }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('regions', JSON.stringify(regions || []));
    form.append('dpi', String(dpi || 220));
    const resp = await axios.post(`${base}/render-regions`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 180000,
    });
    return resp.data || null;
  } catch {
    return null;
  }
}

export async function renderPdfPages({ filePath, pages, dpi = 220 }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('pages', JSON.stringify(pages || []));
    form.append('dpi', String(dpi || 220));
    const resp = await axios.post(`${base}/render-pages`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 180000,
    });
    return resp.data || null;
  } catch {
    return null;
  }
}

export async function redactPdf({ filePath, boxes = [], searchTexts = [], detectPii = true }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('boxes', JSON.stringify(boxes || []));
    form.append('search_texts', JSON.stringify(searchTexts || []));
    form.append('detect_pii', detectPii ? 'true' : 'false');

    const resp = await axios.post(`${base}/redact`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 240000,
      responseType: 'arraybuffer',
    });

    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}
