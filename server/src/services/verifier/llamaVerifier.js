import axios from 'axios';

export async function verifyWithLlama(prompts, baseUrl) {
  // Use chat endpoint for better control
  try {
    const verJson = await llamaChat(baseUrl, prompts.verifier.system, JSON.stringify(prompts.verifier.user));
    const clsJson = await llamaChat(baseUrl, prompts.classifier.system, JSON.stringify(prompts.classifier.user));
    return { ...verJson, classifier: clsJson };
  } catch (e) {
    return { verdict: 'no', rationale: 'llama_error', contradictions: [String(e?.message || e)] };
  }
}

export async function classifyWithLlama(classifierPrompt, baseUrl) {
  try {
    return await llamaChat(baseUrl, classifierPrompt.system, JSON.stringify(classifierPrompt.user));
  } catch (e) {
    return { error: 'llama_error', detail: [String(e?.message || e)] };
  }
}

async function llamaCompletion(base, system, user) {
  const prompt = `${system}\n\nUSER:\n${user}\n\nRespond JSON only.`;
  const resp = await axios.post(`${base}/completion`, {
    prompt,
    temperature: 0,
    n_predict: 512,  // Increased from 128 to 512 for complete JSON responses
    stop: ['USER:', '\n\n\n'],  // Better stop tokens
  });
  const result = resp.data?.content || resp.data?.completion || '';
  console.log('[llamaCompletion] Response:', result);
  return result;
}

async function llamaChat(base, system, user) {
  const resp = await axios.post(`${base}/v1/chat/completions`, {
    model: 'local-gguf',
    temperature: 0,
    max_tokens: 512,  // Limit response length
    response_format: { type: "json_object" },  // Request JSON mode
    messages: [
      { role: 'system', content: system + '\n\nRespond with valid JSON only.' },
      { role: 'user', content: user }
    ],
  });
  const txt = resp.data?.choices?.[0]?.message?.content || '{}';
  console.log('[llamaChat] Response:', txt.substring(0, 200));
  return safeJson(txt);
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
