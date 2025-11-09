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

  console.log('\n========== GUARDIAN REQUEST ==========');
  console.log('Guardian URL:', url);
  console.log('Text length:', text?.length || 0);
  console.log('Text preview:', text?.substring(0, 200));
  console.log('Categories to check:', categories);

  // Ultra-concise system prompt to reduce token usage
  const system = 'You are a content safety analyzer. Return ONLY valid JSON. No explanations, no notes, no additional text.';

  const user = `Analyze for: ${categories.join(', ')}\n\nText: ${text}\n\nReturn ONLY this JSON format:\n{"flags":[],"scores":{},"unsafe":false,"rationale":""}`;

  try {
    const payload = {
      model: 'guardian',
      temperature: 0.0,  // Zero temperature for deterministic output
      max_tokens: 200,   // Reduced from 800 - force concise response
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };

    console.log('Guardian request payload:', JSON.stringify(payload, null, 2));

    const resp = await axios.post(`${url}/v1/chat/completions`, payload, { timeout: 60000 });

    console.log('Guardian HTTP status:', resp.status);
    console.log('Guardian response data:', JSON.stringify(resp.data, null, 2));

    const content = resp.data?.choices?.[0]?.message?.content || '{}';

    // Debug logging to see what Guardian actually returns
    console.log('[Guardian] Raw response content:', content);

    const parsed = safeJson(content);
    console.log('[Guardian] Parsed JSON:', JSON.stringify(parsed, null, 2));

    // Normalize
    const scores = Object.fromEntries(categories.map(c => [c, clamp01(Number(parsed?.scores?.[c] ?? 0))]));
    console.log('[Guardian] Normalized scores:', JSON.stringify(scores, null, 2));

    const flagged = Object.entries(scores).filter(([, v]) => v >= 0.5).map(([k]) => k);
    console.log('[Guardian] Flagged categories (score >= 0.5):', flagged);

    const nonPiiFlags = flagged.filter(f => f !== 'pii');
    const unsafe = parsed?.unsafe ?? (nonPiiFlags.length > 0);

    console.log('[Guardian] Final result - Flags:', flagged, 'Unsafe:', unsafe, 'Rationale:', parsed?.rationale);
    console.log('========== GUARDIAN RESPONSE END ==========\n');

    return { flags: flagged, scores, unsafe, rationale: parsed?.rationale || '' };
  } catch (e) {
    console.error('[Guardian] ERROR:', e.message);
    console.error('[Guardian] Stack:', e.stack);
    console.log('========== GUARDIAN ERROR END ==========\n');
    return { flags: [], scores: Object.fromEntries(categories.map(c => [c, 0])), unsafe: false, error: String(e?.message || e) };
  }
}

function clamp01(x) { return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

