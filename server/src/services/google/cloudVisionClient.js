import axios from 'axios';
import { getPdfSignals, renderPdfPages } from '../extractor/doclingAdapter.js';
import { rasterizePdfPagesAsBase64 } from '../extractor/pdfRasterize.js';
import { safeErrorDetail } from '../../util/security.js';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

const IMAGE_HINT_LABELS = new Set([
  'diagram',
  'chart',
  'graph',
  'plot',
  'illustration',
  'screenshot',
  'drawing',
  'photo',
  'photography',
  'logo',
  'symbol',
  'map',
  'figure',
]);

export async function quickDetectImagesWithCloudVision({ filePath }) {
  const apiKey = resolveVisionApiKey();
  const accessToken = resolveAccessToken();
  if (!apiKey && !accessToken) {
    return { enabled: false, has_images: false, reason: 'missing_cloud_vision_credentials', sampled_pages: [], detections: [] };
  }
  if (!filePath) {
    return { enabled: true, has_images: false, reason: 'missing_file', sampled_pages: [], detections: [] };
  }

  const maxPages = Math.max(1, Math.min(8, Number(process.env.CLOUD_VISION_SAMPLE_MAX_PAGES || 2) || 2));
  const dpi = Math.max(72, Math.min(220, Number(process.env.CLOUD_VISION_SAMPLE_DPI || 120) || 120));
  const objectThreshold = clamp01(Number(process.env.CLOUD_VISION_OBJECT_THRESHOLD || 0.55));

  const signals = await getPdfSignals({ filePath });
  const totalPages = Math.max(1, Number(signals?.pages || 1) || 1);
  const sampledPages = Array.from({ length: Math.min(maxPages, totalPages) }, (_, i) => i + 1);

  const rendered = await renderPdfPages({ filePath, pages: sampledPages, dpi });
  const images = Array.isArray(rendered?.images) ? rendered.images : [];
  if (!images.length) {
    return { enabled: true, has_images: false, reason: 'render_failed', sampled_pages: sampledPages, detections: [] };
  }

  const detections = [];
  let hasImages = false;

  for (const img of images) {
    const page = Number(img?.page || 0) || 0;
    const b64 = String(img?.data_b64 || '').trim();
    if (!page || !b64) continue;
    try {
      const res = await annotateImage({ imageBase64: b64, apiKey, accessToken });
      const objects = Array.isArray(res?.localizedObjectAnnotations) ? res.localizedObjectAnnotations : [];
      const labels = Array.isArray(res?.labelAnnotations) ? res.labelAnnotations : [];
      const strongObjects = objects.filter(o => Number(o?.score || 0) >= objectThreshold);
      const labelHits = labels
        .map(l => String(l?.description || '').trim().toLowerCase())
        .filter(Boolean)
        .filter(n => IMAGE_HINT_LABELS.has(n));

      const pageHasImages = strongObjects.length > 0 || labelHits.length > 0;
      if (pageHasImages) hasImages = true;

      detections.push({
        page,
        has_images: pageHasImages,
        objects: strongObjects.map(o => ({ name: o?.name, score: Number(o?.score || 0) })),
        label_hits: labelHits,
      });
    } catch (e) {
      detections.push({
        page,
        has_images: false,
        error: safeErrorDetail(e),
      });
    }
  }

  return {
    enabled: true,
    has_images: hasImages,
    reason: 'ok',
    sampled_pages: sampledPages,
    detections,
  };
}

export async function extractTextWithCloudVisionPdf({ filePath, maxPages = 5 }) {
  const apiKey = resolveVisionApiKey();
  const accessToken = resolveAccessToken();
  if (!apiKey && !accessToken) return null;
  if (!filePath) return null;

  const pageCap = Math.max(0, Number(maxPages || 0) || 0);
  const renderDpi = Math.max(96, Math.min(300, Number(process.env.CLOUD_VISION_RENDER_DPI || 150) || 150));
  const batchSize = Math.max(1, Math.min(16, Number(process.env.CLOUD_VISION_ANNOTATE_BATCH_SIZE || 4) || 4));
  const inflight = Math.max(1, Math.min(6, Number(process.env.CLOUD_VISION_MAX_INFLIGHT || 2) || 2));
  const pages = await rasterizePdfPagesAsBase64({
    filePath,
    dpi: renderDpi,
    maxPages: pageCap,
    imageFormat: 'png',
  });
  if (!pages.length) return null;

  try {
    const chunks = chunk(pages, batchSize);
    const results = await mapWithConcurrency(chunks, inflight, async (group) => {
      const first = await annotateImagesBatch({
        images: group.map(g => ({ content: g.image_base64 })),
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        apiKey,
        accessToken,
      });
      return group.map((g, idx) => ({
        page: g.page,
        vision: Array.isArray(first) ? (first[idx] || {}) : {},
      }));
    });
    const flat = results.flat().sort((a, b) => Number(a.page || 0) - Number(b.page || 0));

    const blocks = [];
    for (const item of flat) {
      const t = String(item?.vision?.fullTextAnnotation?.text || '').trim();
      if (!t) continue;
      blocks.push({ page: item.page, text: t });
    }
    const text = blocks.map(b => b.text).join('\n\n').trim();

    return {
      text,
      meta: { pages: pages.length, source: 'cloud_vision' },
      blocks,
      raw: { pages: flat.length },
    };
  } catch {
    return null;
  }
}

async function annotateImage({ imageBase64, apiKey, accessToken }) {
  const out = await annotateImagesBatch({
    images: [{ content: imageBase64 }],
    features: [
      { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
      { type: 'LABEL_DETECTION', maxResults: 12 },
    ],
    apiKey,
    accessToken,
  });
  return Array.isArray(out) ? (out[0] || {}) : {};
}

async function annotateImagesBatch({ images, features, apiKey, accessToken }) {
  const url = apiKey ? `${VISION_URL}?key=${encodeURIComponent(apiKey)}` : VISION_URL;
  const payload = {
    requests: (images || []).map(img => ({
      image: { content: String(img?.content || '') },
      features: Array.isArray(features) ? features : [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
    })),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const resp = await axios.post(url, payload, {
    timeout: Math.max(5000, Number(process.env.CLOUD_VISION_TIMEOUT_MS || 20000) || 20000),
    headers,
    maxBodyLength: Infinity,
  });

  const responses = Array.isArray(resp?.data?.responses) ? resp.data.responses : [];
  for (const r of responses) {
    if (r?.error?.message) throw new Error(`cloud_vision_error:${r.error.message}`);
  }
  return responses;
}

function resolveVisionApiKey() {
  return String(
    process.env.GOOGLE_VISION_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
}

function resolveAccessToken() {
  return String(
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
    process.env.GOOGLE_ACCESS_TOKEN ||
    ''
  ).trim();
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}
