// Granite Guardian moderation client for llama.cpp HTTP server.
// Invoked per chunk and on final summaries to produce flags + scores.
// Requires a separate llama-server instance loaded with Granite Guardian GGUF.
// Env: GUARDIAN_URL (defaults to LLAMA_URL) for where to send requests.

import axios from 'axios';

const DEFAULT_CATEGORIES = [
  'toxicity',
  'hate_explicit',
  'hate_implicit',
  'self_harm',
  'sexual',
  'violence',
  'criminal',
  'cyber_threat',
  'jailbreak',
  'pii',
];

export async function moderateText({ text, baseUrl, categories = DEFAULT_CATEGORIES }) {
  const url = (baseUrl || process.env.GUARDIAN_URL || process.env.LLAMA_URL || 'http://localhost:8080');

  // Granite Guardian expects simple chat format, not JSON-wrapped
  const system = 'You are Granite Guardian, an AI content moderation assistant. Analyze the text for safety issues including: PII (personal identifiable information like SSN, phone numbers, addresses), toxicity, hate speech, violence, sexual content, self-harm, criminal activity, cyber threats, and jailbreak attempts. Respond with JSON containing: flags (array of detected categories), scores (object with 0-1 scores per category), unsafe (boolean), and rationale (brief explanation).';

  const user = `Analyze this text for safety and PII:\n\n${text}\n\nCategories to check: ${categories.join(', ')}\n\nRespond with JSON only.`;

  try {
    const payload = {
      model: 'guardian',
      temperature: 0.1,  // Slight temperature for better analysis
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const resp = await axios.post(`${url}/v1/chat/completions`, payload, { timeout: 60000 });
    const content = resp.data?.choices?.[0]?.message?.content || '{}';

    // Debug logging to see what Guardian actually returns
    console.log('[Guardian] Raw response:', content.substring(0, 500));

    const parsed = safeJson(content);
    console.log('[Guardian] Parsed:', JSON.stringify(parsed).substring(0, 300));

    // Normalize
    const scores = Object.fromEntries(categories.map(c => [c, clamp01(Number(parsed?.scores?.[c] ?? 0))]));
    const flagged = Object.entries(scores).filter(([, v]) => v >= 0.5).map(([k]) => k);
    const nonPiiFlags = flagged.filter(f => f !== 'pii');
    const unsafe = parsed?.unsafe ?? (nonPiiFlags.length > 0);

    console.log('[Guardian] Flags:', flagged, 'Unsafe:', unsafe);

    return { flags: flagged, scores, unsafe, rationale: parsed?.rationale || '' };
  } catch (e) {
    return { flags: [], scores: Object.fromEntries(categories.map(c => [c, 0])), unsafe: false, error: String(e?.message || e) };
  }
}

function clamp01(x) { return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

