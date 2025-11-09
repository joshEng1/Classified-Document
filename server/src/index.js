import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { extractDocument } from './services/extractor/index.js';
import { runGuards } from './services/extractor/guards.js';
import { classifyLocal } from './services/classifier/localClassifier.js';
import { shouldRoute } from './services/routing.js';
import { buildPrompts } from './services/verifier/promptBuilder.js';
import { verifyWithOpenAI } from './services/verifier/gptVerifier.js';
import { verifyWithLlama, classifyWithLlama } from './services/verifier/llamaVerifier.js';
import { redactPII } from './util/redact.js';
import { detectPII } from './services/pii/detectPII.js';
import { assessSafety } from './services/safety/safety.js';
import { classifyPolicy } from './services/policy/policyClassifier.js';
import { detectEquipment } from './services/detectors/equipment.js';

// Resolve current file/dir for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Read package version
const pkgPath = path.join(__dirname, '..', 'package.json');
let version = '0.0.0';
try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version; } catch { }

const app = express();
const uploadDir = path.join(__dirname, '../../uploads');
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch { }
const upload = multer({ dest: uploadDir });

const PORT = process.env.PORT || 5055;

app.use(express.json({ limit: '4mb' }));

// Enable CORS for local file:// access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, version });
});

app.post('/api/process', upload.single('file'), async (req, res) => {
  try {
    const filePath = req.file ? req.file.path : null;
    const docPath = req.body.document_path || (req.file ? req.file.originalname : undefined);

    if (!filePath && !req.body.text) {
      return res.status(400).json({ error: 'No file or text provided' });
    }

    // 1) Extract evidence (docling or text/ocr)
    const extraction = await extractDocument({
      filePath,
      originalName: req.file?.originalname,
      providedText: req.body.text,
      preferDocling: true,
    });

    // 2) Guards + PII and Safety + redaction for routed/verifier use
    const pii = detectPII(extraction.text || '', extraction.meta);
    const redacted = pii?.items?.length ? requirePIIRedaction(req) ? redactPII(extraction.text || '') : extraction.text || '' : (extraction.text || '');
    const guards = runGuards({ text: redacted, meta: extraction.meta });
    const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta });
    const equipment = detectEquipment(extraction.text || '', extraction.meta);
    const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment });

    // 3) Build prompts (used by llama local or verifier)
    const prompts = buildPrompts({
      classes: [
        'Internal Memo',
        'Employee Application',
        'Invoice',
        'Public Marketing Document',
        'Other',
      ],
      evidence: extraction.evidence,
      candidateLabel: 'Other',
    });

    // 4) Local classification: heuristic/linear OR llama.cpp (primary local LLM)
    let local = null;
    const localEngine = (process.env.LOCAL_CLASSIFIER || 'heuristic').toLowerCase();
    if (localEngine === 'llama') {
      const llamaUrl = process.env.LLAMA_URL || 'http://localhost:8080';
      const cls = await classifyWithLlama(prompts.classifier, llamaUrl);
      const label = cls?.label || cls?.Label || 'Other';
      const conf = Number(process.env.LOCAL_DEFAULT_CONF || '0.92');
      local = { label, confidence: conf, engine: 'llama', raw: cls };
      // Update candidate for verifier
      prompts.user = prompts.user || {};
    } else {
      local = await classifyLocal({ text: extraction.text || '', guards, meta: extraction.meta });
      // Update candidate label for verifier prompts
    }

    const updatedPrompts = buildPrompts({
      classes: [
        'Internal Memo',
        'Employee Application',
        'Invoice',
        'Public Marketing Document',
        'Other',
      ],
      evidence: extraction.evidence,
      candidateLabel: local.label,
    });

    // 5) Routing decision (or force second-pass verification)
    const forceSecond = String(process.env.VERIFY_SECOND_PASS || 'false').toLowerCase() === 'true';
    const route = forceSecond ? { routed: true, reason: 'forced_second_pass' } : shouldRoute({ local, guards, meta: extraction.meta });

    let verifier = null;
    let finalLabel = local.label;
    let accepted = true;
    let acceptedReason = 'local_auto_accept';

    if (route.routed) {
      const engine = (process.env.VERIFIER_ENGINE || 'llama').toLowerCase();
      // offline-first: default to llama; allow double-layered validation
      const cross = String(process.env.CROSS_VERIFY || 'false').toLowerCase() === 'true';
      if (engine === 'llama') {
        verifier = await verifyWithLlama(updatedPrompts, process.env.LLAMA_URL || 'http://localhost:8080');
        if (cross && process.env.OPENAI_API_KEY) {
          const other = await verifyWithOpenAI(updatedPrompts, process.env.OPENAI_API_KEY);
          verifier = { primary: 'llama', llama: verifier, openai: other, verdict: verifier.verdict || other.verdict };
        }
      } else {
        verifier = await verifyWithOpenAI(updatedPrompts, process.env.OPENAI_API_KEY);
        if (cross) {
          const other = await verifyWithLlama(updatedPrompts, process.env.LLAMA_URL || 'http://localhost:8080');
          verifier = { primary: 'openai', openai: verifier, llama: other, verdict: verifier.verdict || other.verdict };
        }
      }

      if (verifier?.verdict === 'yes' && local.confidence >= (Number(process.env.ROUTE_LOW) || 0.5)) {
        finalLabel = local.label;
        accepted = true;
        acceptedReason = 'verifier_yes';
      } else {
        accepted = false;
        acceptedReason = 'verifier_no_or_low_confidence';
      }
    } else {
      // auto-accepted local
      accepted = true;
      acceptedReason = 'local_auto_accept';
    }

    const needs_review = Boolean(safety.unsafe) || (pii?.summary?.total || 0) > 0 || route.routed || (local.confidence < (Number(process.env.ROUTE_LOW) || 0.5));
    const review_reasons = [];
    if (safety.unsafe) review_reasons.push('unsafe_content');
    if ((pii?.summary?.total || 0) > 0) review_reasons.push('pii_detected');
    if (route.routed) review_reasons.push('routed_for_verification');
    if (local.confidence < (Number(process.env.ROUTE_LOW) || 0.5)) review_reasons.push('low_confidence');

    const result = {
      document_path: docPath || 'uploaded',
      meta: extraction.meta,
      engine_info: { model: process.env.LLM_MODEL_NAME || 'local-gguf' },
      guards,
      safety,
      pii,
      policy,
      equipment,
      evidence: extraction.evidence,
      status_updates: extraction.status,
      local,
      routed: route.routed,
      route_reason: route.reason,
      verifier,
      review: { needs_review, reasons: review_reasons },
      final: {
        label: finalLabel,
        accepted,
        reason: acceptedReason,
      },
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'processing_failed', detail: String(err?.message || err) });
  } finally {
    // Cleanup uploaded file
    try {
      if (req.file?.path) fs.unlinkSync(req.file.path);
    } catch { }
  }
});

// Batch processing endpoint: accepts multiple files via multipart or JSON paths
app.post('/api/process-batch', upload.array('files'), async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({ path: f.path, originalname: f.originalname }));
    const jsonPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const items = files.length ? files : jsonPaths.map(p => ({ path: p, originalname: path.basename(p) }));
    if (!items.length) return res.status(400).json({ error: 'no_inputs', detail: 'Provide files[] or paths array' });
    const out = [];
    for (const it of items) {
      const r = await fetchLikeProcess(it.path, it.originalname);
      out.push({ name: it.originalname, result: r });
    }
    res.json({ count: out.length, results: out });
  } catch (e) {
    res.status(500).json({ error: 'batch_failed', detail: String(e?.message || e) });
  } finally {
    try { (req.files || []).forEach(f => fs.unlinkSync(f.path)); } catch {}
  }
});

// helper to reuse process flow for batch
async function fetchLikeProcess(filePath, originalName) {
  const extraction = await extractDocument({ filePath, originalName, preferDocling: true });
  const pii = detectPII(extraction.text || '', extraction.meta);
  const redacted = pii?.items?.length ? redactPII(extraction.text || '') : (extraction.text || '');
  const guards = runGuards({ text: redacted, meta: extraction.meta });
  const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta });
  const equipment = detectEquipment(extraction.text || '', extraction.meta);
  const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment });
  const prompts = buildPrompts({
    classes: [ 'Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other' ],
    evidence: extraction.evidence,
    candidateLabel: 'Other',
  });
  let local = await classifyLocal({ text: extraction.text || '', guards, meta: extraction.meta });
  const updatedPrompts = buildPrompts({
    classes: [ 'Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other' ],
    evidence: extraction.evidence,
    candidateLabel: local.label,
  });
  const forceSecond = String(process.env.VERIFY_SECOND_PASS || 'false').toLowerCase() === 'true';
  const route = forceSecond ? { routed: true, reason: 'forced_second_pass' } : shouldRoute({ local, guards, meta: extraction.meta });
  let verifier = null;
  if (route.routed) {
    verifier = await verifyWithLlama(updatedPrompts, process.env.LLAMA_URL || 'http://localhost:8080');
  }
  return {
    document_path: originalName || 'uploaded',
    meta: extraction.meta,
    safety,
    pii,
    policy,
    equipment,
    evidence: extraction.evidence,
    local,
    routed: route.routed,
    route_reason: route.reason,
    verifier,
    status_updates: extraction.status,
    final: { label: local.label, accepted: !route.routed || verifier?.verdict === 'yes', reason: route.reason }
  };
}

function requirePIIRedaction(req) {
  const s = String(process.env.REDact_PII || process.env.REDACT_PII || 'true').toLowerCase();
  const override = typeof req?.body?.redact_piI !== 'undefined' ? String(req.body.redact_piI).toLowerCase() : null;
  const val = override ?? s;
  return val === 'true' || val === '1' || val === 'yes';
}

app.use(express.static(path.join(__dirname, '../../web')));

app.listen(PORT, () => {
  console.log(`Doc classifier service listening on http://localhost:${PORT}`);
});
