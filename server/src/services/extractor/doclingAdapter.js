import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { redactPdfNative } from './nativeRedactor.js';

function envTimeout(name, fallbackMs) {
  const raw = Number(process.env[name] || fallbackMs);
  if (!Number.isFinite(raw) || raw < 1000) return fallbackMs;
  return raw;
}

function resolveRedactEngine() {
  const raw = String(process.env.REDACT_ENGINE || 'auto').trim().toLowerCase();
  if (raw === 'native' || raw === 'docling' || raw === 'auto') return raw;
  console.warn(`[redact] invalid REDACT_ENGINE="${raw}", using "auto"`);
  return 'auto';
}

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
      timeout: envTimeout('DOCLING_EXTRACT_TIMEOUT_MS', 180000),
    });
    const json = resp.data || {};
    const text = (json.text || (Array.isArray(json.blocks) ? json.blocks.map(b => b.text).join('\n') : '')).trim();
    const meta = { pages: json.pages || json.page_count || 0 };
    const blocks = json.blocks || [];  // Pass through blocks with page info
    return { text, meta, raw: json, blocks };
  } catch (err) {
    console.warn(`[docling] extract failed: ${err?.message || err}`);
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
      timeout: envTimeout('DOCLING_SIGNALS_TIMEOUT_MS', 240000),
    });
    return resp.data || null;
  } catch (err) {
    console.warn(`[docling] signals failed: ${err?.message || err}`);
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
      timeout: envTimeout('DOCLING_RENDER_TIMEOUT_MS', 240000),
    });
    return resp.data || null;
  } catch (err) {
    console.warn(`[docling] render-regions failed: ${err?.message || err}`);
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
      timeout: envTimeout('DOCLING_RENDER_TIMEOUT_MS', 240000),
    });
    return resp.data || null;
  } catch (err) {
    console.warn(`[docling] render-pages failed: ${err?.message || err}`);
    return null;
  }
}

export async function redactPdf({ filePath, boxes = [], searchTexts = [], detectPii = true }) {
  const base = process.env.DOCLING_URL;
  if (!filePath) return null;
  const engine = resolveRedactEngine();
  const allowNativeFallback = String(process.env.NATIVE_REDACT_FALLBACK || 'true').toLowerCase() !== 'false';

  async function nativeFallback(reason) {
    if (engine === 'docling') return null;
    if (engine === 'auto' && !allowNativeFallback) return null;
    try {
      if (engine === 'native') {
        console.warn('[redact] using native engine');
      } else {
        console.warn(`[docling] redact falling back to native engine (${reason})`);
      }
      return await redactPdfNative({ filePath, boxes, searchTexts, detectPii });
    } catch (fallbackErr) {
      console.warn(`[native-redact] fallback failed: ${fallbackErr?.message || fallbackErr}`);
      return null;
    }
  }

  if (engine === 'native') return nativeFallback('forced_native');

  if (engine === 'docling' && !base) {
    console.warn('[redact] REDACT_ENGINE=docling but DOCLING_URL is missing');
    return null;
  }

  if (!base) {
    return nativeFallback('missing_docling_url');
  }
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('boxes', JSON.stringify(boxes || []));
    form.append('search_texts', JSON.stringify(searchTexts || []));
    form.append('detect_pii', detectPii ? 'true' : 'false');

    const resp = await axios.post(`${base}/redact`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: envTimeout('DOCLING_REDACT_TIMEOUT_MS', 300000),
      responseType: 'arraybuffer',
    });

    return Buffer.from(resp.data);
  } catch (err) {
    console.warn(`[docling] redact failed: ${err?.message || err}`);
    return nativeFallback('docling_error');
  }
}
