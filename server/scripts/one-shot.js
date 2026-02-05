#!/usr/bin/env node
// One-shot classification runner (no server required)
// Usage: node server/scripts/one-shot.js <filePath> [--verify]
// Respects server/.env when run from project root (PORT/LLAMA_URL/DOCLING_URL/etc.)

import path from 'path';
import fs from 'fs';
import url from 'url';
import dotenv from 'dotenv';

// Load env from server/.env if present
const repoRoot = path.join(process.cwd());
const serverEnv = path.join(repoRoot, 'server', '.env');
try { if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv }); } catch {}

// Local imports from service modules
import { extractDocument } from '../src/services/extractor/index.js';
import { runGuards } from '../src/services/extractor/guards.js';
import { detectPII } from '../src/services/pii/detectPII.js';
import { assessSafety } from '../src/services/safety/safety.js';
import { detectEquipment } from '../src/services/detectors/equipment.js';
import { classifyPolicy } from '../src/services/policy/policyClassifier.js';
import { buildPrompts } from '../src/services/verifier/promptBuilder.js';
import { classifyLocal } from '../src/services/classifier/localClassifier.js';
import { classifyWithLlama, verifyWithLlama } from '../src/services/verifier/llamaVerifier.js';
import { verifyWithOpenAI } from '../src/services/verifier/gptVerifier.js';

function parseArgs(argv) {
  const args = { verify: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify' || a === '-v') args.verify = true;
    else if (!args.file) args.file = a;
  }
  return args;
}

function extractLabel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = ['label', 'Label', 'classification', 'class', 'category', 'Category', 'predicted_label', 'predicted_class'];
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  if (obj.result) return extractLabel(obj.result);
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node server/scripts/one-shot.js <filePath> [--verify]');
    process.exit(2);
  }
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(2);
  }

  // 1) Extract
  const extraction = await extractDocument({ filePath, originalName: path.basename(filePath), preferDocling: true });
  // 2) Signals
  const pii = detectPII(extraction.text || '', extraction.meta);
  const guards = runGuards({ text: extraction.text || '', meta: extraction.meta });
  const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta, multimodal: extraction.multimodal });
  const equipment = detectEquipment(extraction.text || '', extraction.meta);
  const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment, multimodal: extraction.multimodal });

  // 3) Local classification
  const classes = ['Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other'];
  const prompts = buildPrompts({ classes, evidence: extraction.evidence, candidateLabel: 'Other' });
  const engine = (process.env.LOCAL_CLASSIFIER || 'heuristic').toLowerCase();
  let local = null;
  if (engine === 'llama') {
    const llamaUrl = process.env.LLAMA_URL || 'http://localhost:8080';
    const cls = await classifyWithLlama(prompts.classifier, llamaUrl);
    const label = extractLabel(cls) || 'Other';
    const conf = Number(process.env.LOCAL_DEFAULT_CONF || '0.92');
    local = { label, confidence: conf, engine: 'llama', raw: cls };
  } else {
    local = await classifyLocal({ text: extraction.text || '', guards, meta: extraction.meta });
  }

  // 4) Optional verify/cross-verify
  let verifier = null;
  if (args.verify || String(process.env.VERIFY_SECOND_PASS || 'false').toLowerCase() === 'true') {
    const updated = buildPrompts({ classes, evidence: extraction.evidence, candidateLabel: local.label });
    const engineV = (process.env.VERIFIER_ENGINE || 'llama').toLowerCase();
    const cross = String(process.env.CROSS_VERIFY || 'false').toLowerCase() === 'true';
    if (engineV === 'llama') {
      verifier = await verifyWithLlama(updated, process.env.LLAMA_URL || 'http://localhost:8080');
      if (cross && process.env.OPENAI_API_KEY && String(process.env.OFFLINE_MODE || 'false').toLowerCase() !== 'true') {
        const other = await verifyWithOpenAI(updated, process.env.OPENAI_API_KEY);
        verifier = { primary: 'llama', llama: verifier, openai: other, verdict: verifier.verdict || other.verdict };
      }
    } else {
      const useOpenAI = String(process.env.OFFLINE_MODE || 'false').toLowerCase() !== 'true';
      verifier = useOpenAI ? await verifyWithOpenAI(updated, process.env.OPENAI_API_KEY) : null;
      if (cross) {
        const other = await verifyWithLlama(updated, process.env.LLAMA_URL || 'http://localhost:8080');
        verifier = { primary: 'openai', openai: verifier, llama: other, verdict: verifier?.verdict || other.verdict };
      }
    }
  }

  const out = {
    path: filePath,
    meta: extraction.meta,
    safety,
    pii: { summary: pii.summary, sample: (pii.items || []).slice(0, 5) },
    equipment,
    policy,
    local,
    verifier,
    final_label: verifier?.classifier ? (extractLabel(verifier.classifier) || local.label) : local.label,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });

