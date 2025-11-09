// Lightweight client for Granite-4.0-350M (or compatible) via llama.cpp HTTP server.
// Provides per-chunk summarization suitable for UI tooltips and quick context.

import axios from 'axios';

export async function summarizeChunk({ text, baseUrl }) {
  const url = baseUrl || process.env.SLM_URL || process.env.LLAMA_URL || 'http://localhost:8080';
  const system = [
    'You are a concise analyst. Summarize text in <= 2 sentences.',
    'Return strict JSON: { summary: string, key_phrases: string[] }',
  ].join('\n');
  const user = JSON.stringify({ text });
  try {
    const payload = {
      model: 'granite-4.0-350m',
      temperature: 0,
      max_tokens: 400,  // Increased from 180 for more detailed summaries and key phrases
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const resp = await axios.post(`${url}/v1/chat/completions`, payload, { timeout: 60000 });
    const content = resp.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJson(content);
    const summary = String(parsed?.summary || '').slice(0, 480);
    const key_phrases = Array.isArray(parsed?.key_phrases) ? parsed.key_phrases.slice(0, 8) : [];
    return { summary, key_phrases };
  } catch (e) {
    return { summary: '', key_phrases: [], error: String(e?.message || e) };
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

