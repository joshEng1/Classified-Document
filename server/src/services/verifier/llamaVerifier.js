import axios from 'axios';

export async function verifyWithLlama(prompts, baseUrl) {
  // Use chat endpoint for better control
  try {
    const temperature = Number.isFinite(Number(prompts?.temperature)) ? Number(prompts.temperature) : undefined;
    const verJson = await llamaChatOrFallback(baseUrl, prompts.verifier.system, JSON.stringify(prompts.verifier.user), temperature);
    const clsJson = await llamaChatOrFallback(baseUrl, prompts.classifier.system, JSON.stringify(prompts.classifier.user), temperature);
    return { ...verJson, classifier: clsJson };
  } catch (e) {
    return { verdict: 'no', rationale: 'llama_error', contradictions: [String(e?.message || e)] };
  }
}

export async function classifyWithLlama(classifierPrompt, baseUrl) {
  try {
    const temperature = Number.isFinite(Number(classifierPrompt?.temperature)) ? Number(classifierPrompt.temperature) : undefined;
    return await llamaChatOrFallback(baseUrl, classifierPrompt.system, JSON.stringify(classifierPrompt.user), temperature);
  } catch (e) {
    return { error: 'llama_error', detail: [String(e?.message || e)] };
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
  console.log('[llamaCompletion] Response:', result);
  return result;
}

async function llamaChat(base, system, user, temperature) {
  console.log('[llamaChat] Sending request to:', base);
  console.log('[llamaChat] System prompt length:', system.length);
  console.log('[llamaChat] User prompt length:', user.length);

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

  console.log('[llamaChat] Request payload:', JSON.stringify(payload, null, 2).substring(0, 500));

  try {
    const resp = await axios.post(`${base}/v1/chat/completions`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000, // 2 minutes
    });

    const txt = resp.data?.choices?.[0]?.message?.content || '{}';
    console.log('[llamaChat] Response:', txt.substring(0, 200));
    return safeJson(txt);
  } catch (error) {
    console.error('[llamaChat] Request failed:', error.message);
    if (error.response) {
      console.error('[llamaChat] Status:', error.response.status);
      console.error('[llamaChat] Response data:', JSON.stringify(error.response.data));
    }
    throw error;
  }
}

async function llamaChatOrFallback(base, system, user, temperature) {
  try {
    return await llamaChat(base, system, user, temperature);
  } catch (e) {
    const status = e?.response?.status;
    const detail = e?.response?.data || e?.message;
    console.log('[llamaChatOrFallback] chat failed:', status, detail);
    // Fallback to /completion on chat errors (e.g., 400 model not found)
    try {
      const raw = await llamaCompletion(base, system, user, temperature);
      return safeJson(raw);
    } catch (e2) {
      console.log('[llamaChatOrFallback] completion failed:', e2?.message || e2);
      throw e2;
    }
  }
}

function safeJson(s) {
  console.log('[safeJson] Input:', typeof s, s?.substring ? s.substring(0, 200) : s);
  // Trim whitespace and try to parse
  const trimmed = (s || '').trim();
  if (!trimmed) {
    console.log('[safeJson] Empty input');
    return { raw: s };
  }
  try {
    const parsed = JSON.parse(trimmed);
    console.log('[safeJson] Parsed:', parsed);
    return parsed;
  } catch (e) {
    console.log('[safeJson] Parse failed:', e.message);
    return { raw: s };
  }
}
