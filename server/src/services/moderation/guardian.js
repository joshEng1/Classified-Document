// Granite Guardian moderation client for llama.cpp HTTP server.
// Invoked per chunk and on final summaries to produce flags + scores.
// Requires a separate llama-server instance loaded with Granite Guardian GGUF.
// Env: GUARDIAN_URL (defaults to LLAMA_URL) for where to send requests.

import axios from 'axios';

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

export async function moderateText({ text, baseUrl, categories = DEFAULT_CATEGORIES }) {
  const url = (baseUrl || process.env.GUARDIAN_URL || process.env.LLAMA_URL || 'http://localhost:8080');

  console.log('\n========== GUARDIAN REQUEST ==========');
  console.log('Guardian URL:', url);
  console.log('Text length:', text?.length || 0);
  console.log('Text preview:', text?.substring(0, 200));
  console.log('Categories to check:', categories);

  // Ultra-concise system prompt to reduce token usage
  const system = 'You are Granite Guardian. Return ONLY valid JSON. No explanations, no notes, no additional text.';

  // BYOC-style criteria: keep short and explicit to reduce false negatives.
  const criteria = [
    'pii: personal identifiers (SSN, phone, email, DOB, address)',
    'ssn: US Social Security Number',
    'credit_card: card numbers (13-19 digits)',
    'financial_account: bank/account numbers or routing identifiers',
    'customer_details: names + addresses + contact details',
    'internal_business: internal communications, business docs, non-public planning',
    'non_public_ops: internal operational content not intended for public release',
    'proprietary_schematic: proprietary schematics/blueprints/defense/next-gen product designs',
    'child_safety: content not safe for kids (hate/exploitative/violent/criminal/political news/cyber threat)',
    'hate: hate speech/harassment',
    'exploitative: sexual exploitation/non-consensual content',
    'violence: graphic or inciting violence',
    'criminal: instructions or facilitation of crime',
    'political_news: breaking political news or election results',
    'cyber_threat: exploits, malware, intrusion instructions, or active threats',
  ].join('\n');

  const user = [
    `Analyze for categories: ${categories.join(', ')}`,
    '',
    'Use these criteria (BYOC):',
    criteria,
    '',
    `Text: ${text}`,
    '',
    'Return ONLY this JSON format:',
    '{"flags":[],"scores":{},"unsafe":false,"sensitive":false,"rationale":""}',
  ].join('\n');

  try {
    const payload = {
      model: process.env.GUARDIAN_MODEL || 'granite-guardian-3.2-3b-a800m',
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

    const UNSAFE_SET = new Set(['hate', 'exploitative', 'self_harm', 'sexual', 'violence', 'criminal', 'political_news', 'cyber_threat', 'child_safety', 'toxicity', 'jailbreak']);
    const SENSITIVE_SET = new Set(['pii', 'ssn', 'credit_card', 'financial_account', 'customer_details', 'internal_business', 'non_public_ops', 'proprietary_schematic']);

    const unsafeByFlags = flagged.some(f => UNSAFE_SET.has(f));
    const sensitiveByFlags = flagged.some(f => SENSITIVE_SET.has(f));

    const unsafe = parsed?.unsafe ?? unsafeByFlags;
    const sensitive = parsed?.sensitive ?? sensitiveByFlags;

    console.log('[Guardian] Final result - Flags:', flagged, 'Unsafe:', unsafe, 'Sensitive:', sensitive, 'Rationale:', parsed?.rationale);
    console.log('========== GUARDIAN RESPONSE END ==========\n');

    return { flags: flagged, scores, unsafe, sensitive, rationale: parsed?.rationale || '' };
  } catch (e) {
    console.error('[Guardian] ERROR:', e.message);
    console.error('[Guardian] Stack:', e.stack);
    console.log('========== GUARDIAN ERROR END ==========\n');
    return { flags: [], scores: Object.fromEntries(categories.map(c => [c, 0])), unsafe: false, sensitive: false, error: String(e?.message || e) };
  }
}

function clamp01(x) { return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

