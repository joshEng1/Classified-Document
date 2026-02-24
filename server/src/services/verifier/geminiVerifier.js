import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function verifyWithGemini(prompts, apiKey, options = {}) {
  const enforceOffline = options?.enforceOffline !== false;
  if (enforceOffline && String(process.env.OFFLINE_MODE || 'false').toLowerCase() === 'true') {
    return { verdict: 'no', rationale: 'offline_mode', contradictions: ['OFFLINE_MODE=true'] };
  }
  if (!apiKey) {
    return { verdict: 'no', rationale: 'no_api_key', contradictions: ['missing GEMINI_API_KEY'] };
  }
  try {
    const cls = await generateJson({
      system: prompts.classifier.system,
      user: prompts.classifier.user,
      apiKey,
    });
    const ver = await generateJson({
      system: prompts.verifier.system,
      user: prompts.verifier.user,
      apiKey,
    });
    return { ...ver, classifier: cls };
  } catch (err) {
    const detail = safeErrorDetail(err);
    const rateLimited = isGeminiRateLimitedError(err, detail);
    return {
      verdict: 'no',
      rationale: rateLimited ? 'gemini_rate_limited' : 'gemini_error',
      contradictions: [detail],
      rate_limited: rateLimited,
    };
  }
}

async function generateJson({ system, user, apiKey }) {
  const model = String(process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim();
  const timeoutMs = Math.max(1000, Number(process.env.GEMINI_TIMEOUT_MS || '45000') || 45000);
  const accessToken = String(process.env.GOOGLE_CLOUD_ACCESS_TOKEN || process.env.GOOGLE_ACCESS_TOKEN || '').trim();
  const baseUrl = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  const url = apiKey ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;

  const payload = {
    systemInstruction: {
      parts: [{ text: String(system || '') }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: JSON.stringify(user ?? {}) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const resp = await axios.post(url, payload, {
    timeout: timeoutMs,
    headers,
  });

  const text = getResponseText(resp?.data);
  if (!text) return {};
  return safeJson(text);
}

function getResponseText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();

  if (text) return text;

  const blockReason = String(data?.promptFeedback?.blockReason || '').trim();
  if (blockReason) {
    throw new Error(`gemini_blocked:${blockReason}`);
  }
  return '';
}

function safeJson(rawText) {
  const t = String(rawText || '').trim();
  if (!t) return {};
  try { return JSON.parse(t); } catch { }

  const unfenced = t
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(unfenced); } catch { }

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const fragment = unfenced.slice(start, end + 1);
    try { return JSON.parse(fragment); } catch { }
  }
  return { raw: rawText };
}

function isGeminiRateLimitedError(err, detail = '') {
  const status = Number(err?.response?.status || 0) || 0;
  if (status === 429) return true;
  const text = `${String(detail || '')} ${String(err?.message || '')}`.toLowerCase();
  return text.includes('resource_exhausted') ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('quota') ||
    text.includes('429');
}
