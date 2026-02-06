import axios from 'axios';
import { safeErrorDetail } from '../../util/security.js';

const llamaDebug = String(process.env.LLAMA_DEBUG || '').toLowerCase() === 'true';

function debug(...args) {
  if (!llamaDebug) return;
  console.log(...args);
}

export async function verifyWithLlama(prompts, baseUrl) {
  // Use chat endpoint for better control
  try {
    const temperature = Number.isFinite(Number(prompts?.temperature)) ? Number(prompts.temperature) : undefined;
    const verJson = await llamaChatOrFallback(baseUrl, prompts.verifier.system, JSON.stringify(prompts.verifier.user), temperature);
    const clsJson = await llamaChatOrFallback(baseUrl, prompts.classifier.system, JSON.stringify(prompts.classifier.user), temperature);
    return { ...verJson, classifier: clsJson };
  } catch (e) {
    return { verdict: 'no', rationale: 'llama_error', contradictions: [safeErrorDetail(e)] };
  }
}

export async function classifyWithLlama(classifierPrompt, baseUrl) {
  try {
    const temperature = Number.isFinite(Number(classifierPrompt?.temperature)) ? Number(classifierPrompt.temperature) : undefined;
    return await llamaChatOrFallback(baseUrl, classifierPrompt.system, JSON.stringify(classifierPrompt.user), temperature);
  } catch (e) {
    return { error: 'llama_error', detail: [safeErrorDetail(e)] };
  }
}

function resolveTemp(override) {
  if (Number.isFinite(Number(override))) return Number(override);
  if (Number.isFinite(Number(process.env.LLM_TEMPERATURE))) return Number(process.env.LLM_TEMPERATURE);
  return 0;
}

async function llamaCompletion(base, system, user, temperature) {
  const prompt = `${system}\n\nUSER:\n${user}\n\nRespond JSON only.`;
  const resp = await axios.post(`${base}/completion`, {
    prompt,
    temperature: resolveTemp(temperature),
    n_predict: 512,  // Increased from 128 to 512 for complete JSON responses
    stop: ['USER:', '\n\n\n'],  // Better stop tokens
  });
  const result = resp.data?.content || resp.data?.completion || '';
  debug('[llamaCompletion] response chars:', String(result || '').length);
  return result;
}

async function llamaChat(base, system, user, temperature) {
  debug('[llamaChat] request base:', base);
  debug('[llamaChat] prompt sizes:', { system: system.length, user: user.length });

  // llama.cpp doesn't need/use the model parameter - it uses whatever model was loaded at startup
  // Using "gpt-3.5-turbo" as a placeholder since some clients expect a model field
  // NOTE: response_format may not be supported by all llama.cpp builds - removed for compatibility
  const payload = {
    model: 'gpt-3.5-turbo',
    temperature: resolveTemp(temperature),
    max_tokens: 512,
    messages: [
      { role: 'system', content: system + '\n\nRespond with valid JSON only. Your entire response must be parseable JSON.' },
      { role: 'user', content: user }
    ],
  };

  debug('[llamaChat] payload keys:', Object.keys(payload));

  try {
    const resp = await axios.post(`${base}/v1/chat/completions`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000, // 2 minutes
    });

    const txt = resp.data?.choices?.[0]?.message?.content || '{}';
    debug('[llamaChat] response chars:', String(txt || '').length);
    return safeJson(txt);
  } catch (error) {
    console.error('[llamaChat] Request failed:', safeErrorDetail(error));
    if (error.response) {
      debug('[llamaChat] status:', error.response.status);
    }
    throw error;
  }
}

async function llamaChatOrFallback(base, system, user, temperature) {
  try {
    return await llamaChat(base, system, user, temperature);
  } catch (e) {
    const status = e?.response?.status;
    debug('[llamaChatOrFallback] chat failed:', status, safeErrorDetail(e));
    // Fallback to /completion on chat errors (e.g., 400 model not found)
    try {
      const raw = await llamaCompletion(base, system, user, temperature);
      return safeJson(raw);
    } catch (e2) {
      debug('[llamaChatOrFallback] completion failed:', safeErrorDetail(e2));
      throw e2;
    }
  }
}

function safeJson(s) {
  // Trim whitespace and try to parse
  const trimmed = (s || '').trim();
  if (!trimmed) {
    return { raw: s };
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: s };
  }
}
