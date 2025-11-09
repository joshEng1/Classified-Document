import axios from 'axios';

export async function verifyWithOpenAI(prompts, apiKey) {
  if (String(process.env.OFFLINE_MODE || 'false').toLowerCase() === 'true') {
    return { verdict: 'no', rationale: 'offline_mode', contradictions: ['OFFLINE_MODE=true'] };
  }
  if (!apiKey) {
    return { verdict: 'no', rationale: 'no_api_key', contradictions: ['missing OPENAI_API_KEY'] };
  }
  try {
    // Classify first (optional): using the classifier prompt to get label and rationale
    const cls = await chatJson({ system: prompts.classifier.system, user: prompts.classifier.user, apiKey, responseFormat: 'json_object' });
    // Verify strictly
    const ver = await chatJson({ system: prompts.verifier.system, user: prompts.verifier.user, apiKey, responseFormat: 'json_object' });
    return { ...ver, classifier: cls };
  } catch (err) {
    return { verdict: 'no', rationale: 'openai_error', contradictions: [String(err?.message || err)] };
  }
}

async function chatJson({ system, user, apiKey, responseFormat }) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const resp = await axios.post(url, {
    model,
    response_format: responseFormat ? { type: responseFormat } : undefined,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  // Try to parse the text as JSON if response_format unsupported by model
  const content = resp.data?.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(content); } catch { return { raw: content }; }
}
