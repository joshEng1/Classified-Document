import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_CATEGORIES = [
  'toxicity',
  'hate',
  'exploitative',
  'self_harm',
  'sexual',
  'violence',
  'criminal',
  'political_news',
  'cyber_threat',
  'jailbreak',
  'pii',
  'ssn',
  'credit_card',
  'financial_account',
  'customer_details',
  'internal_business',
  'non_public_ops',
  'proprietary_schematic',
  'child_safety',
];

export async function summarizeChunkWithGemini({ text, apiKey, temperature }) {
  if (!apiKey) return { summary: '', key_phrases: [], error: 'missing_gemini_api_key' };
  try {
    const out = await generateJson({
      apiKey,
      model: String(process.env.GEMINI_SUMMARY_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim(),
      system: 'You are a concise analyst. Return strict JSON only.',
      user: {
        task: 'Summarize this chunk in <=2 sentences and list key phrases.',
        schema: { summary: 'string', key_phrases: ['string'] },
        text: String(text || ''),
      },
      temperature: resolveTemp(temperature),
    });
    return {
      summary: String(out?.summary || '').slice(0, 480),
      key_phrases: Array.isArray(out?.key_phrases) ? out.key_phrases.map(v => String(v)).filter(Boolean).slice(0, 8) : [],
    };
  } catch (e) {
    return {
      summary: '',
      key_phrases: [],
      error: safeErrorDetail(e),
      rate_limited: isGeminiRateLimitedError(e),
    };
  }
}

export async function moderateTextWithGemini({ text, apiKey, categories = DEFAULT_CATEGORIES }) {
  if (!apiKey) {
    return {
      flags: [],
      scores: Object.fromEntries(categories.map(c => [c, 0])),
      unsafe: false,
      sensitive: false,
      error: 'missing_gemini_api_key',
    };
  }
  const threshold = clamp01(Number(process.env.GUARDIAN_FLAG_THRESHOLD ?? process.env.GUARDIAN_THRESHOLD ?? 0.5));
  try {
    const out = await generateJson({
      apiKey,
      model: String(process.env.GEMINI_MODERATION_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim(),
      system: 'You are a strict safety/sensitivity classifier. Return strict JSON only.',
      user: {
        task: 'Classify text against categories and return numeric confidence scores in [0,1].',
        categories,
        schema: { scores: { category: 0.0 }, unsafe: false, sensitive: false, rationale: '' },
        text: String(text || ''),
      },
      temperature: 0,
    });

    const scores = Object.fromEntries(categories.map(c => [c, clamp01(Number(out?.scores?.[c] ?? 0))]));
    const flags = Object.entries(scores).filter(([, v]) => v >= threshold).map(([k]) => k);
    const unsafeByFlags = flags.some(f => UNSAFE_SET.has(f));
    const sensitiveByFlags = flags.some(f => SENSITIVE_SET.has(f));
    return {
      flags,
      scores,
      unsafe: typeof out?.unsafe === 'boolean' ? out.unsafe : unsafeByFlags,
      sensitive: typeof out?.sensitive === 'boolean' ? out.sensitive : sensitiveByFlags,
      rationale: String(out?.rationale || ''),
    };
  } catch (e) {
    return {
      flags: [],
      scores: Object.fromEntries(categories.map(c => [c, 0])),
      unsafe: false,
      sensitive: false,
      error: safeErrorDetail(e),
      rate_limited: isGeminiRateLimitedError(e),
    };
  }
}

export async function detectPIIWithGemini({ text, page, apiKey }) {
  if (!apiKey || !text) return [];
  try {
    const out = await generateJson({
      apiKey,
      model: String(process.env.GEMINI_PII_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim(),
      system: 'You detect PII. Return strict JSON only and do not invent values.',
      user: {
        task: 'Extract exact PII values present verbatim in text.',
        pii_types: ['SSN', 'Phone', 'Email', 'ZIP', 'Address', 'DOB', 'CreditCard', 'FinancialAccount', 'Name'],
        schema: {
          findings: [
            { type: 'string', value: 'string', field: 'string', severity: 'critical|high|medium|low', redacted: 'string' },
          ],
        },
        text: String(text || ''),
      },
      temperature: 0,
    });
    const arr = Array.isArray(out?.findings) ? out.findings : (Array.isArray(out) ? out : []);
    const findings = [];
    const seen = new Set();
    for (const it of arr) {
      const value = String(it?.value || '').trim();
      if (!value || value.length < 3) continue;
      const position = indexOfInsensitive(text, value);
      if (position < 0) continue; // guard against hallucinated values
      const type = normalizeType(it?.type);
      const pg = Number.isFinite(Number(page)) ? Number(page) : null;
      const key = `${type.toLowerCase()}|${value.toLowerCase()}|${pg || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        type,
        value,
        redacted: String(it?.redacted || defaultMask(value)),
        position,
        field: String(it?.field || 'Unknown Field'),
        page: pg,
        severity: normalizeSeverity(it?.severity, type),
      });
    }
    return findings;
  } catch {
    return [];
  }
}

async function generateJson({ apiKey, model, system, user, temperature = 0 }) {
  const timeoutMs = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || '45000') || 45000);
  const accessToken = String(process.env.GOOGLE_CLOUD_ACCESS_TOKEN || process.env.GOOGLE_ACCESS_TOKEN || '').trim();
  const baseUrl = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  const url = apiKey ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
  const payload = {
    systemInstruction: { parts: [{ text: String(system || '') }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(user ?? {}) }] }],
    generationConfig: {
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
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
  return safeJson(text);
}

function getResponseText(data) {
  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
  const txt = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim();
  if (txt) return txt;
  const reason = String(data?.promptFeedback?.blockReason || '').trim();
  if (reason) throw new Error(`gemini_blocked:${reason}`);
  return '{}';
}

function safeJson(raw) {
  const s = String(raw || '').trim();
  if (!s) return {};
  try { return JSON.parse(s); } catch { }
  const u = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(u); } catch { }
  const i = u.indexOf('{');
  const j = u.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(u.slice(i, j + 1)); } catch { }
  }
  return {};
}

function resolveTemp(override) {
  if (Number.isFinite(Number(override))) return Number(override);
  if (Number.isFinite(Number(process.env.LLM_TEMPERATURE))) return Number(process.env.LLM_TEMPERATURE);
  return 0;
}

function clamp01(x) {
  return Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : 0;
}

function indexOfInsensitive(text, needle) {
  return String(text || '').toLowerCase().indexOf(String(needle || '').toLowerCase());
}

function defaultMask(value) {
  return String(value || '').replace(/[A-Za-z0-9]/g, 'X');
}

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t.includes('ssn')) return 'SSN';
  if (t.includes('phone')) return 'Phone';
  if (t.includes('email')) return 'Email';
  if (t.includes('zip')) return 'ZIP';
  if (t.includes('address')) return 'Address';
  if (t.includes('dob') || t.includes('birth')) return 'DOB';
  if (t.includes('credit')) return 'CreditCard';
  if (t.includes('financial') || t.includes('account')) return 'FinancialAccount';
  if (t.includes('name')) return 'Name';
  return 'PII';
}

function normalizeSeverity(sev, type) {
  const s = String(sev || '').trim().toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  if (type === 'SSN') return 'critical';
  if (type === 'Phone' || type === 'Email' || type === 'Address' || type === 'DOB') return 'high';
  return 'medium';
}

function isGeminiRateLimitedError(err) {
  const status = Number(err?.response?.status || 0) || 0;
  if (status === 429) return true;
  const text = [
    safeErrorDetail(err, ''),
    String(err?.message || ''),
    (() => {
      try { return JSON.stringify(err?.response?.data || ''); } catch { return ''; }
    })(),
  ].join(' ').toLowerCase();
  return text.includes('resource_exhausted') ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('quota');
}

const UNSAFE_SET = new Set(['hate', 'exploitative', 'self_harm', 'sexual', 'violence', 'criminal', 'political_news', 'cyber_threat', 'child_safety', 'toxicity', 'jailbreak']);
const SENSITIVE_SET = new Set(['pii', 'ssn', 'credit_card', 'financial_account', 'customer_details', 'internal_business', 'non_public_ops', 'proprietary_schematic']);
