// Local classifier: tries to load a serialized TF-IDF + linear model if available.
// Falls back to heuristic scoring based on guards and keyword density.
import fs from 'fs';
import path from 'path';

const MODEL_PATH = path.join(process.cwd(), 'server', 'models', 'tfidf_svm.json');

let model = null;
try {
  if (fs.existsSync(MODEL_PATH)) {
    model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
  }
} catch {}

export async function classifyLocal({ text, guards, meta }) {
  if (model) {
    try {
      return classifyWithLinear({ text, guards, meta });
    } catch {}
  }
  return classifyHeuristic({ text, guards, meta });
}

function classifyWithLinear({ text }) {
  const classes = model.classes;
  const feats = computeTf(text, model.vocab);
  // linear logits = W x + b
  const logits = classes.map((_c, idx) => dot(model.W[idx], feats) + (model.b[idx] || 0));
  const probs = softmax(logits);
  const topIdx = argmax(probs);
  return { label: classes[topIdx], confidence: probs[topIdx], probs: objectify(classes, probs), engine: 'linear' };
}

function classifyHeuristic({ text, guards }) {
  const t = (text || '').toLowerCase();
  const scores = new Map([
    ['Internal Memo', guards.memoGuards ? 0.9 : (guards.hasMemo ? 0.6 : 0)],
    ['Employee Application', guards.appGuards ? 0.9 : (guards.hasApplication ? 0.6 : 0)],
    ['Invoice', guards.invoiceGuards ? 0.9 : (guards.hasInvoice ? 0.6 : 0)],
    ['Public Marketing Document', guards.marketingGuards ? 0.85 : (guards.hasMarketing ? 0.6 : 0)],
    ['Other', 0.2],
  ]);
  // Tie-breakers
  if (/\bsubject:\b/i.test(text) && /\bto:\b/i.test(text)) bump(scores, 'Internal Memo', 0.1);
  if (/\bapplication for employment\b/i.test(text)) bump(scores, 'Employee Application', 0.1);
  if (/\binvoice\b/i.test(text)) bump(scores, 'Invoice', 0.1);
  if (/\bfeatures\b|\bbenefits\b|\bplatform\b/i.test(text)) bump(scores, 'Public Marketing Document', 0.1);

  const arr = Array.from(scores.entries());
  arr.sort((a, b) => b[1] - a[1]);
  const [label, confidence] = arr[0];
  const probs = Object.fromEntries(arr);
  return { label, confidence, probs, engine: 'heuristic' };
}

function bump(map, key, delta) {
  map.set(key, (map.get(key) || 0) + delta);
}

function computeTf(text, vocab) {
  const t = (text || '').toLowerCase();
  const counts = new Array(vocab.length).fill(0);
  for (let i = 0; i < vocab.length; i++) {
    const k = vocab[i];
    const re = new RegExp(`\\b${escapeRegex(k)}\\b`, 'g');
    counts[i] = ((t.match(re) || []).length);
  }
  return counts;
}

function dot(a, b) { return a.reduce((s, v, i) => s + v * (b[i] || 0), 0); }
function softmax(arr) {
  const m = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / s);
}
function argmax(arr) { let i = 0; for (let j = 1; j < arr.length; j++) if (arr[j] > arr[i]) i = j; return i; }
function objectify(keys, vals) { const o = {}; keys.forEach((k, i) => o[k] = vals[i]); return o; }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

