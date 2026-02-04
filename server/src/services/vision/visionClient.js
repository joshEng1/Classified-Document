// Granite Vision client (granite-vision-3.2-2b) via llama.cpp OpenAI-compatible HTTP server.
//
// This module is intentionally defensive:
// - If the server doesn't support multimodal message formats, we return a non-fatal error.
// - The caller can decide whether to proceed without vision.

import axios from 'axios';

const DEFAULT_PROMPT = [
  'You are analyzing a cropped document region (a figure/diagram/table) from a PDF.',
  '',
  'Tasks:',
  '1) Extract any visible text (best-effort OCR).',
  '2) Briefly summarize what the figure depicts.',
  '3) Flag risks: PII (SSN/credit card/account numbers), proprietary schematic/blueprint, customer details, internal business content, and child-safety concerns (hate/exploitative/violent/criminal/political news/cyber threat).',
  '',
  'Return ONLY valid JSON with this exact shape:',
  '{',
  '  "extracted_text": "",',
  '  "summary": "",',
  '  "flags": {',
  '    "pii": false,',
  '    "proprietary_schematic": false,',
  '    "customer_details": false,',
  '    "internal_business": false,',
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
    const sensitive = Boolean(parsed?.sensitive) || Boolean(flags?.pii || flags?.proprietary_schematic || flags?.customer_details || flags?.internal_business);

    return {
      extracted_text: String(parsed?.extracted_text || '').slice(0, 4000),
      summary: String(parsed?.summary || '').slice(0, 1200),
      flags,
      sensitive,
      rationale: String(parsed?.rationale || '').slice(0, 1200),
      raw: parsed?.raw || undefined,
    };
  } catch (e) {
    const status = e?.response?.status;
    const detail = e?.response?.data || e?.message;
    return {
      extracted_text: '',
      summary: '',
      flags: {},
      sensitive: false,
      rationale: '',
      error: 'vision_request_failed',
      status,
      detail: String(detail).slice(0, 300),
    };
  }
}

function safeJson(s) {
  try {
    return JSON.parse(String(s || '').trim());
  } catch {
    return { raw: String(s || '') };
  }
}

