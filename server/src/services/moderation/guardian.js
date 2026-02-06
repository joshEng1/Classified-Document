// Granite Guardian moderation client for llama.cpp HTTP server.
// Invoked per chunk and on final summaries to produce flags + scores.
// Requires a separate llama-server instance loaded with Granite Guardian GGUF.
// Env: GUARDIAN_URL (defaults to LLAMA_URL) for where to send requests.

import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

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

  const debug = String(process.env.GUARDIAN_DEBUG || 'false').toLowerCase() === 'true';
  const threshold = clamp01(Number(process.env.GUARDIAN_FLAG_THRESHOLD ?? process.env.GUARDIAN_THRESHOLD ?? 0.5));
  if (debug) {
    console.log('\n========== GUARDIAN REQUEST ==========');
    console.log('Guardian URL:', url);
    console.log('Text length:', text?.length || 0);
    console.log('Categories to check:', categories);
    console.log('Flag threshold:', threshold);
  }

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

    if (debug) console.log('Guardian request payload keys:', Object.keys(payload));

    const resp = await axios.post(`${url}/v1/chat/completions`, payload, { timeout: 60000 });

    if (debug) {
      console.log('Guardian HTTP status:', resp.status);
      console.log('Guardian response status: ok');
    }

    const content = resp.data?.choices?.[0]?.message?.content || '{}';

    // Debug logging to see what Guardian actually returns
    const parsed = safeJson(content);
    if (debug) console.log('[Guardian] Parsed JSON keys:', Object.keys(parsed || {}));

    // Normalize
    const scores = Object.fromEntries(categories.map(c => [c, clamp01(Number(parsed?.scores?.[c] ?? 0))]));
    if (debug) console.log('[Guardian] Normalized scores keys:', Object.keys(scores || {}));

    const flagged = Object.entries(scores).filter(([, v]) => v >= threshold).map(([k]) => k);
    if (debug) console.log(`[Guardian] Flagged categories (score >= ${threshold}):`, flagged);

    const UNSAFE_SET = new Set(['hate', 'exploitative', 'self_harm', 'sexual', 'violence', 'criminal', 'political_news', 'cyber_threat', 'child_safety', 'toxicity', 'jailbreak']);
    const SENSITIVE_SET = new Set(['pii', 'ssn', 'credit_card', 'financial_account', 'customer_details', 'internal_business', 'non_public_ops', 'proprietary_schematic']);

    const unsafeByFlags = flagged.some(f => UNSAFE_SET.has(f));
    const sensitiveByFlags = flagged.some(f => SENSITIVE_SET.has(f));

    const unsafe = parsed?.unsafe ?? unsafeByFlags;
    const sensitive = parsed?.sensitive ?? sensitiveByFlags;

    if (debug) {
      console.log('[Guardian] Final result - Flags:', flagged, 'Unsafe:', unsafe, 'Sensitive:', sensitive, 'Rationale:', parsed?.rationale);
      console.log('========== GUARDIAN RESPONSE END ==========\n');
    }

    return { flags: flagged, scores, unsafe, sensitive, rationale: parsed?.rationale || '' };
  } catch (e) {
    console.error('[Guardian] ERROR:', safeErrorDetail(e));
    if (debug) {
      console.error('[Guardian] Stack:', e.stack);
      console.log('========== GUARDIAN ERROR END ==========\n');
    }
    return { flags: [], scores: Object.fromEntries(categories.map(c => [c, 0])), unsafe: false, sensitive: false, error: safeErrorDetail(e) };
  }
}

function clamp01(x) { return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

