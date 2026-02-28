// Granite Vision client (granite-vision-3.2-2b) via llama.cpp OpenAI-compatible HTTP server.
//
// This module is intentionally defensive:
// - If the server doesn't support multimodal message formats, we return a non-fatal error.
// - The caller can decide whether to proceed without vision.

import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

const DEFAULT_PROMPT = [
  'You are analyzing a cropped document region (a figure/diagram/table) from a PDF.',
  '',
  'Tasks:',
  '1) Extract any visible text (best-effort OCR).',
  '2) Briefly summarize what the figure depicts.',
  '3) Detect if this is defense/military equipment (e.g., stealth fighter) and whether part names or serial identifiers are present.',
  '4) Flag risks: PII (SSN/credit card/account numbers), proprietary schematic/blueprint, customer details, internal business/non-public ops content, and child-safety concerns (hate/exploitative/violent/criminal/political news/cyber threat).',
  '',
  'Return ONLY valid JSON with this exact shape:',
  '{',
  '  "extracted_text": "",',
  '  "summary": "",',
  '  "detected_serials": [],',
  '  "flags": {',
  '    "pii": false,',
  '    "proprietary_schematic": false,',
  '    "defense_equipment": false,',
  '    "serial_or_part_names": false,',
  '    "customer_details": false,',
  '    "internal_business": false,',
  '    "non_public_ops": false,',
  '    "unsafe_child": false,',
  '    "hate": false,',
  '    "exploitative": false,',
  '    "violence": false,',
  '    "criminal": false,',
  '    "political_news": false,',
  '    "cyber_threat": false',
  '  },',
  '  "sensitive": false,',
  '  "rationale": ""',
  '}',
].join('\n');

export async function analyzeVisionImage({ imageBase64, prompt, baseUrl }) {
  const url =
    baseUrl ||
    process.env.VISION_URL ||
    process.env.LLAMA_VISION_URL ||
    process.env.LLAMA_URL ||
    'http://localhost:8082';

  const model = process.env.VISION_MODEL || 'granite-vision-3.2-2b';
  const system = 'You are a multimodal document analyzer. Return ONLY valid JSON. No markdown. No prose.';
  const userPrompt = prompt || DEFAULT_PROMPT;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return { extracted_text: '', summary: '', flags: {}, sensitive: false, rationale: '', error: 'missing_image' };
  }

  // OpenAI-compatible multimodal content array
  const payload = {
    model,
    temperature: 0,
    max_tokens: 700,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
  };

  try {
    const resp = await axios.post(`${url}/v1/chat/completions`, payload, { timeout: 120000 });
    const content = resp.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJson(content);

    const flags = typeof parsed?.flags === 'object' && parsed.flags ? parsed.flags : {};
    const detected_serials = Array.isArray(parsed?.detected_serials) ? parsed.detected_serials.map(String).slice(0, 12) : [];
    const sensitive =
      Boolean(parsed?.sensitive) ||
      Boolean(
        flags?.pii ||
        flags?.proprietary_schematic ||
        flags?.customer_details ||
        flags?.internal_business ||
        flags?.non_public_ops ||
        flags?.defense_equipment ||
        flags?.serial_or_part_names ||
        detected_serials.length > 0,
      );

    return {
      extracted_text: String(parsed?.extracted_text || '').slice(0, 4000),
      summary: String(parsed?.summary || '').slice(0, 1200),
      detected_serials,
      flags,
      sensitive,
      rationale: String(parsed?.rationale || '').slice(0, 1200),
      raw: parsed?.raw || undefined,
    };
  } catch (e) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    const message =
      (typeof data === 'object' && data && data?.error && typeof data.error?.message === 'string' && data.error.message) ||
      (typeof data === 'string' && data) ||
      (typeof e?.message === 'string' && e.message) ||
      'Vision request failed';
    const detail =
      typeof data === 'string'
        ? data
        : (typeof data === 'object' && data)
          ? JSON.stringify(data)
          : String(e?.message || '');
    const safeDetail = safeErrorDetail(detail);
    const safeMessage = safeErrorDetail(message, 'vision_request_failed');
    return {
      extracted_text: '',
      summary: '',
      flags: {},
      sensitive: false,
      rationale: '',
      error: 'vision_request_failed',
      status,
      detail: safeMessage.slice(0, 300),
      detail_raw: safeDetail.slice(0, 600),
    };
  }
}

function safeJson(s) {
  const raw = String(s || '').trim();
  if (!raw) return {};

  // Fast path: pure JSON.
  try { return JSON.parse(raw); } catch { }

  // Strip Markdown code fences.
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(unfenced); } catch { }

  // Attempt to parse the first JSON object in the string.
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const maybe = unfenced.slice(first, last + 1).trim();
    try { return JSON.parse(maybe); } catch { }
  }

  return { raw };
}
