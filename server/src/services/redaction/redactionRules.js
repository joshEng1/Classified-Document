import fs from 'fs';
import path from 'path';

const feedbackDir = path.join(process.cwd(), 'feedback');
const rulesPath = path.join(feedbackDir, 'redaction_rules.json');

export function loadRedactionRules() {
  try {
    if (!fs.existsSync(rulesPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    const rules = Array.isArray(parsed?.rules) ? parsed.rules : [];
    return rules
      .filter(r => r && typeof r === 'object')
      .map(r => ({
        id: String(r.id || ''),
        text: String(r.text || '').trim(),
        label: String(r.label || 'user_rule').trim() || 'user_rule',
        enabled: r.enabled !== false,
        created_at: String(r.created_at || ''),
      }))
      .filter(r => r.text && r.enabled);
  } catch {
    return [];
  }
}

export function addRedactionRule({ text, label }) {
  const ruleText = String(text || '').trim();
  if (!ruleText) throw new Error('missing_text');
  if (ruleText.length > 200) throw new Error('text_too_long');

  const safeLabel = String(label || 'user_rule').trim() || 'user_rule';
  const now = new Date().toISOString();
  const id = `r_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  const existing = loadRedactionRulesRaw();
  const rules = Array.isArray(existing?.rules) ? existing.rules : [];

  // De-dupe by (text,label)
  const dup = rules.find(r => String(r?.text || '').trim() === ruleText && String(r?.label || '').trim() === safeLabel);
  if (dup) {
    // If it was previously removed/disabled, re-enable it.
    if (dup.enabled === false) {
      const nextRules = rules.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const same = String(r?.id || '') === String(dup?.id || '');
        return same ? { ...r, enabled: true } : r;
      });
      try { fs.mkdirSync(feedbackDir, { recursive: true }); } catch { }
      fs.writeFileSync(rulesPath, JSON.stringify({ rules: nextRules }, null, 2));
      return { ...dup, enabled: true };
    }
    return { ...dup, enabled: true };
  }

  const next = { id, text: ruleText, label: safeLabel, enabled: true, created_at: now };
  const out = { rules: [...rules, next] };

  try { fs.mkdirSync(feedbackDir, { recursive: true }); } catch { }
  fs.writeFileSync(rulesPath, JSON.stringify(out, null, 2));
  return next;
}

export function removeRedactionRule({ id }) {
  const ruleId = String(id || '').trim();
  if (!ruleId) throw new Error('missing_id');

  const existing = loadRedactionRulesRaw();
  const rules = Array.isArray(existing?.rules) ? existing.rules : [];

  let found = null;
  const nextRules = rules.map((r) => {
    if (!r || typeof r !== 'object') return r;
    if (String(r.id || '').trim() !== ruleId) return r;
    found = { ...r, enabled: false };
    return found;
  });

  if (!found) throw new Error('not_found');

  try { fs.mkdirSync(feedbackDir, { recursive: true }); } catch { }
  fs.writeFileSync(rulesPath, JSON.stringify({ rules: nextRules }, null, 2));

  return {
    id: String(found.id || ''),
    text: String(found.text || '').trim(),
    label: String(found.label || 'user_rule').trim() || 'user_rule',
    enabled: false,
    created_at: String(found.created_at || ''),
  };
}

function loadRedactionRulesRaw() {
  try {
    if (!fs.existsSync(rulesPath)) return { rules: [] };
    return JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  } catch {
    return { rules: [] };
  }
}
