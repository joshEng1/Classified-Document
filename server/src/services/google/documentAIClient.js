import axios from 'axios';
import fs from 'fs';

export async function extractWithDocumentAI({ filePath, mimeType = 'application/pdf' }) {
  const projectId = String(process.env.DOC_AI_PROJECT_ID || '').trim();
  const location = String(process.env.DOC_AI_LOCATION || 'us').trim() || 'us';
  const processorId = String(process.env.DOC_AI_PROCESSOR_ID || '').trim();
  const accessToken = resolveAccessToken();

  if (!filePath || !projectId || !processorId || !accessToken) {
    return null;
  }

  const url = [
    'https://documentai.googleapis.com/v1',
    `projects/${encodeURIComponent(projectId)}`,
    `locations/${encodeURIComponent(location)}`,
    `processors/${encodeURIComponent(processorId)}:process`,
  ].join('/');

  const bytes = fs.readFileSync(filePath);
  const payload = {
    rawDocument: {
      content: bytes.toString('base64'),
      mimeType,
    },
    skipHumanReview: true,
  };

  try {
    const resp = await axios.post(url, payload, {
      timeout: Math.max(10_000, Number(process.env.DOC_AI_TIMEOUT_MS || 90_000) || 90_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      maxBodyLength: Infinity,
    });

    const doc = resp?.data?.document || {};
    const text = String(doc?.text || '').trim();
    const pageCount = Math.max(0, Number(Array.isArray(doc?.pages) ? doc.pages.length : 0) || 0);
    const blocks = buildBlocksFromDocument(doc);
    const meta = { pages: pageCount, source: 'documentai_ocr' };

    return { text, meta, raw: resp.data, blocks };
  } catch {
    return null;
  }
}

function buildBlocksFromDocument(doc) {
  const fullText = String(doc?.text || '');
  const pages = Array.isArray(doc?.pages) ? doc.pages : [];
  const out = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const p = pages[i] || {};
    const paragraphs = Array.isArray(p?.paragraphs) ? p.paragraphs : [];
    const lines = Array.isArray(p?.lines) ? p.lines : [];

    const units = paragraphs.length ? paragraphs : lines;
    for (const unit of units) {
      const t = textFromAnchor(fullText, unit?.layout?.textAnchor).trim();
      if (!t) continue;
      out.push({ page: pageNum, text: t });
    }
  }

  if (!out.length && fullText.trim()) {
    out.push({ page: 1, text: fullText.trim() });
  }
  return out;
}

function textFromAnchor(fullText, anchor) {
  const segs = Array.isArray(anchor?.textSegments) ? anchor.textSegments : [];
  if (!segs.length) return '';
  let acc = '';
  for (const s of segs) {
    const start = Number.isFinite(Number(s?.startIndex)) ? Number(s.startIndex) : 0;
    const end = Number.isFinite(Number(s?.endIndex)) ? Number(s.endIndex) : 0;
    if (end <= start) continue;
    acc += fullText.slice(start, end);
  }
  return acc;
}

function resolveAccessToken() {
  return String(
    process.env.DOC_AI_ACCESS_TOKEN ||
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
    process.env.GOOGLE_ACCESS_TOKEN ||
    ''
  ).trim();
}
