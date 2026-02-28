import fs from 'fs';
import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

const DEFAULT_MODEL = 'prebuilt-read';
const DEFAULT_API_VERSION = '2024-11-30';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POLL_INTERVAL_MS = 1200;

export async function extractTextWithAzureDocumentIntelligence({ filePath }) {
  const endpoint = normalizeEndpoint(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT);
  const apiKey = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  const model = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const apiVersion = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  const timeoutMs = Math.max(5000, Number(process.env.AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(250, Number(process.env.AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS);
  const maxPages = parseEnvNonNegativeInt(process.env.AZURE_DOCUMENT_INTELLIGENCE_MAX_PAGES, 0);

  if (!filePath) return { error: 'azure_di_missing_file' };
  if (!endpoint) return { error: 'azure_di_missing_endpoint' };
  if (!apiKey) return { error: 'azure_di_missing_key' };

  const analyzeUrl = buildAnalyzeUrl({ endpoint, model, apiVersion, maxPages });
  let bytes = null;
  try {
    bytes = await fs.promises.readFile(filePath);
  } catch (e) {
    return { error: `azure_di_read_failed:${safeErrorDetail(e)}` };
  }

  let operationLocation = '';
  try {
    const start = await axios.post(analyzeUrl, bytes, {
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/pdf',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      maxBodyLength: Infinity,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 202,
    });

    operationLocation = String(
      start?.headers?.['operation-location'] ||
      start?.headers?.['Operation-Location'] ||
      ''
    ).trim();

    // Some deployments can return a completed payload directly.
    if (!operationLocation) {
      const parsedInline = parseAnalyzeResult(start?.data, { requestedMaxPages: maxPages });
      if (parsedInline.text) return parsedInline;
      return { error: 'azure_di_missing_operation_location' };
    }
  } catch (e) {
    return { error: `azure_di_start_failed:${safeErrorDetail(e)}` };
  }

  const headers = { 'Ocp-Apim-Subscription-Key': apiKey };
  const startedAt = Date.now();
  let lastStatus = 'running';

  while (true) {
    if ((Date.now() - startedAt) > timeoutMs) {
      return { error: `azure_di_timeout:last_status=${lastStatus}` };
    }
    await sleep(pollIntervalMs);
    try {
      const poll = await axios.get(operationLocation, {
        timeout: Math.min(30000, timeoutMs),
        headers,
      });
      const state = String(poll?.data?.status || '').trim().toLowerCase();
      if (state) lastStatus = state;
      if (state === 'succeeded') {
        const parsed = parseAnalyzeResult(poll?.data, { requestedMaxPages: maxPages });
        if (!parsed.text) return { error: 'azure_di_empty_result' };
        parsed.raw = {
          ...(parsed.raw || {}),
          operation_location: summarizeOperationLocation(operationLocation),
          operation_location_full: operationLocation,
          analyze_result_id: extractAnalyzeResultId(operationLocation),
          status: state,
        };
        return parsed;
      }
      if (state === 'failed' || state === 'canceled') {
        return { error: `azure_di_${state}:${safeErrorDetail(poll?.data?.error || poll?.data || state)}` };
      }
    } catch (e) {
      return { error: `azure_di_poll_failed:${safeErrorDetail(e)}` };
    }
  }
}

export async function deleteAnalyzeResultWithAzureDocumentIntelligence({ operationLocation }) {
  const endpoint = normalizeEndpoint(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT);
  const apiKey = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  const apiVersion = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  const timeoutMs = Math.max(5000, Number(process.env.AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  if (!endpoint) return { ok: false, error: 'azure_di_missing_endpoint' };
  if (!apiKey) return { ok: false, error: 'azure_di_missing_key' };

  const target = normalizeDeleteUrl({ endpoint, operationLocation, apiVersion });
  if (!target) return { ok: false, error: 'azure_di_invalid_operation_location' };

  try {
    const resp = await axios.delete(target, {
      timeout: Math.min(30000, timeoutMs),
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
    });
    return { ok: true, status: Number(resp?.status || 0) || 0 };
  } catch (e) {
    return { ok: false, error: `azure_di_delete_failed:${safeErrorDetail(e)}` };
  }
}

function buildAnalyzeUrl({ endpoint, model, apiVersion, maxPages }) {
  const query = new URLSearchParams();
  query.set('api-version', apiVersion);
  if (maxPages > 0) query.set('pages', `1-${maxPages}`);
  return `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(model)}:analyze?${query.toString()}`;
}

function parseAnalyzeResult(payload, { requestedMaxPages = 0 } = {}) {
  const analyzeResult = payload?.analyzeResult || payload?.result?.analyzeResult || payload?.result || {};
  const pagesRaw = Array.isArray(analyzeResult?.pages) ? analyzeResult.pages : [];
  const pages = requestedMaxPages > 0 ? pagesRaw.slice(0, requestedMaxPages) : pagesRaw;

  const blocks = [];
  for (const p of pages) {
    const page = Number(p?.pageNumber || p?.page || 0) || 0;
    if (!page) continue;
    let text = '';
    const lines = Array.isArray(p?.lines) ? p.lines : [];
    if (lines.length) {
      text = lines
        .map((l) => String(l?.content || l?.text || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
    }
    if (!text) {
      const words = Array.isArray(p?.words) ? p.words : [];
      text = words
        .map((w) => String(w?.content || w?.text || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    if (!text) continue;
    blocks.push({ page, text });
  }

  if (!blocks.length) {
    const paragraphs = Array.isArray(analyzeResult?.paragraphs) ? analyzeResult.paragraphs : [];
    const byPage = new Map();
    for (const para of paragraphs) {
      const page = Number(para?.boundingRegions?.[0]?.pageNumber || 0) || 0;
      const content = String(para?.content || '').trim();
      if (!page || !content) continue;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(content);
    }
    for (const page of Array.from(byPage.keys()).sort((a, b) => a - b)) {
      blocks.push({ page, text: byPage.get(page).join('\n').trim() });
    }
  }

  let text = String(analyzeResult?.content || '').trim();
  if (!text) text = blocks.map((b) => b.text).join('\n\n').trim();
  if (text && !blocks.length) blocks.push({ page: 1, text });
  const pagesReturned = pages.length || (blocks.length ? Math.max(...blocks.map((b) => Number(b.page || 0))) : 0);

  const parsed = {
    text,
    meta: {
      pages: pagesReturned,
      source: 'azure_document_intelligence',
    },
    blocks,
    raw: {
      pages: pages.length,
      requested_max_pages: requestedMaxPages,
      pages_returned: pagesReturned,
      model_id: String(payload?.analyzeResult?.modelId || payload?.modelId || ''),
    },
  };
  if (requestedMaxPages > 0 && pagesReturned > 0 && pagesReturned < requestedMaxPages) {
    parsed.notice = {
      code: 'azure_di_page_cap_notice',
      detail: `Azure returned ${pagesReturned} page(s) while ${requestedMaxPages} were requested; document may have fewer pages or service-tier limits may apply.`,
    };
  }
  return parsed;
}

function normalizeEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function summarizeOperationLocation(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const seg = u.pathname.split('/').filter(Boolean);
    const last = seg[seg.length - 1] || '';
    return `${u.origin}/.../${last}`;
  } catch {
    return '';
  }
}

function extractAnalyzeResultId(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const seg = u.pathname.split('/').filter(Boolean);
    const idx = seg.findIndex((part) => part.toLowerCase() === 'analyzeresults');
    if (idx < 0 || !seg[idx + 1]) return '';
    return String(seg[idx + 1]).trim();
  } catch {
    return '';
  }
}

function normalizeDeleteUrl({ endpoint, operationLocation, apiVersion }) {
  const op = String(operationLocation || '').trim();
  if (!op) return '';
  try {
    const endpointUrl = new URL(endpoint);
    const target = new URL(op);
    if (target.origin !== endpointUrl.origin) return '';
    const path = target.pathname.toLowerCase();
    if (!path.includes('/documentintelligence/documentmodels/')) return '';
    if (!path.includes('/analyzeresults/')) return '';
    if (!target.searchParams.has('api-version')) target.searchParams.set('api-version', apiVersion);
    return target.toString();
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEnvNonNegativeInt(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const clean = raw.split('#')[0].trim();
  if (!clean) return fallback;
  const n = Number.parseInt(clean, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
