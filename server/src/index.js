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
import { detectPII as detectPIIRobust, detectPIIFromBlocks, summarizePII, formatPIIEvidence, generateRedactionSuggestions } from './services/pii/piiDetector.js';
import { assessSafety } from './services/safety/safety.js';
import { classifyPolicy } from './services/policy/policyClassifier.js';
import { detectEquipment } from './services/detectors/equipment.js';
import { chunkDocument } from './services/chunker.js';
import { summarizeChunk } from './services/slm/slmClient.js';
import { moderateText } from './services/moderation/guardian.js';
import { redactPdf, getPdfSignals, renderPdfPages } from './services/extractor/doclingAdapter.js';
import { loadRedactionRules, addRedactionRule, removeRedactionRule } from './services/redaction/redactionRules.js';

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
const redactedDir = path.join(uploadDir, 'redacted');
try { fs.mkdirSync(redactedDir, { recursive: true }); } catch { }
const sessionsDir = path.join(uploadDir, 'sessions');
try { fs.mkdirSync(sessionsDir, { recursive: true }); } catch { }

const PORT = Number(process.env.PORT) || 5055;

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const corsAllowAll = String(process.env.CORS_ALLOW_ALL || 'false').toLowerCase() === 'true';
const corsAllowNull = String(process.env.CORS_ALLOW_NULL || 'false').toLowerCase() === 'true';
const corsOrigins = (() => {
  const v = parseCsv(process.env.CORS_ORIGINS);
  if (v.length) return v;
  return [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
})();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (corsAllowAll) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin) {
    if (origin === 'null' && corsAllowNull) {
      res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Vary', 'Origin');
    } else if (corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '4mb' }));

const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || '25') || 25);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file?.originalname || '').toLowerCase();
    const mime = String(file?.mimetype || '').toLowerCase();
    const looksPdf = name.endsWith('.pdf') || mime === 'application/pdf';
    if (!looksPdf) return cb(Object.assign(new Error('Only PDF uploads are allowed'), { code: 'UNSUPPORTED_FILETYPE' }));
    cb(null, true);
  },
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, version });
});

// Back-compat alias (some docs/UI refer to /api/health)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version });
});

app.get('/api/redacted/:name', (req, res) => {
  const name = String(req.params?.name || '');
  // Basic traversal guard
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: 'invalid_name' });
  const fullPath = path.join(redactedDir, name);
  if (!fullPath.startsWith(redactedDir)) return res.status(400).json({ error: 'invalid_path' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  return res.sendFile(fullPath);
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
    const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta, multimodal: extraction.multimodal });
    const equipment = detectEquipment(extraction.text || '', extraction.meta);
    const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment, multimodal: extraction.multimodal });

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
      const label = extractLabel(cls) || 'Other';
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
        verifier = await verifyWithLlama({ ...updatedPrompts, temperature }, process.env.LLAMA_URL || 'http://localhost:8080');
        if (cross && process.env.OPENAI_API_KEY) {
          const other = await verifyWithOpenAI({ ...updatedPrompts, temperature }, process.env.OPENAI_API_KEY);
          verifier = { primary: 'llama', llama: verifier, openai: other, verdict: verifier.verdict || other.verdict };
        }
      } else {
        verifier = await verifyWithOpenAI({ ...updatedPrompts, temperature }, process.env.OPENAI_API_KEY);
        if (cross) {
          const other = await verifyWithLlama({ ...updatedPrompts, temperature }, process.env.LLAMA_URL || 'http://localhost:8080');
          verifier = { primary: 'openai', openai: verifier, llama: other, verdict: verifier.verdict || other.verdict };
        }
      }

      // Prefer the classifier label returned by the verifier if available
      const vClassifier = (verifier?.classifier) || (verifier?.openai?.classifier) || (verifier?.llama?.classifier);
      const vLabel = vClassifier ? extractLabel(vClassifier) : null;
      if (vLabel) finalLabel = vLabel;

      // Acceptance based on verifier verdict when routed
      if (verifier?.verdict === 'yes') {
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

    const redacted_pdf = await maybeGenerateRedactedPdf({
      filePath,
      originalName: req.file?.originalname,
      extraBoxes: extraction?.multimodal?.redaction_boxes || [],
      searchTexts: buildSearchTexts({ pii, safety }),
    });

    const result = {
      document_path: docPath || 'uploaded',
      meta: extraction.meta,
      multimodal: extraction.multimodal || undefined,
      redacted_pdf,
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

// Streaming pipeline: Upload → Docling convert → Chunker → SLM + Guardian (per chunk) → Final policy
app.post('/api/process-stream', upload.single('file'), async (req, res) => {
  // SSE headers over POST: supported by fetch streaming readers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { }
  };

  try {
    const filePath = req.file ? req.file.path : null;
    const docPath = req.body.document_path || (req.file ? req.file.originalname : undefined);
    const temperature = Number.isFinite(Number(req.body?.temperature)) ? Number(req.body.temperature) : undefined;
    const noImages = String(req.body?.no_images || 'false').toLowerCase() === 'true';
    if (!filePath && !req.body.text) {
      send('error', { error: 'No file or text provided' });
      return res.end();
    }

    // 1) Extract
    send('status', { phase: 'extract_start' });
    const extraction = await extractDocument({
      filePath,
      originalName: req.file?.originalname,
      providedText: req.body.text,
      preferDocling: true,
      disableVision: noImages,
    });
    send('extract', { meta: extraction.meta, status: extraction.status });

    // Pre-checks
    send('precheck', {
      pages: extraction.meta.pages || 0,
      images: extraction.meta.images || 0,
      legibility: {
        hasText: extraction.meta.hasText,
        avgCharsPerPage: extraction.meta.avgCharsPerPage,
        isLikelyScanned: extraction.meta.isLikelyScanned,
      },
    });

    // 2) Chunker
    send('status', { phase: 'chunk_start' });
    const chunks = chunkDocument(extraction.text || '', extraction.meta, { maxChars: 1600, minChars: 600 });
    send('chunk_index', { total: chunks.length });

    // 3) Per-chunk SLM + Guardian + PII detection, process sequentially for ordered output
    const guardianUrl = process.env.GUARDIAN_URL || process.env.LLAMA_URL || 'http://localhost:8080';
    const slmUrl = process.env.SLM_URL || process.env.LLAMA_URL || 'http://localhost:8080';
    let completed = 0;
    const moderationByChunk = [];
    const piiByChunk = [];

    // Process chunks sequentially to maintain order
    for (const ch of chunks) {
      console.log(`\n=== PROCESSING CHUNK ${ch.id} ===`);
      console.log(`Chunk text length: ${ch.text?.length || 0}`);
      console.log(`Chunk page: ${ch.page}`);
      console.log(`Chunk text preview: ${ch.text?.substring(0, 200)}...`);

      // Fire all three operations in parallel for this chunk
      const pSumm = summarizeChunk({ text: ch.text, baseUrl: slmUrl, temperature });
      const pMod = moderateText({ text: ch.text, baseUrl: guardianUrl });
      const piiFindingsChunk = detectPIIRobust(ch.text, ch.page);

      const [summ, mod] = await Promise.all([pSumm, pMod]);

      console.log(`SLM Response for chunk ${ch.id}:`, JSON.stringify(summ, null, 2));
      console.log(`Guardian Response for chunk ${ch.id}:`, JSON.stringify(mod, null, 2));
      console.log(`PII Findings for chunk ${ch.id}:`, JSON.stringify(piiFindingsChunk, null, 2));

      send('chunk', { id: ch.id, page: ch.page, start: ch.start, end: ch.end });
      send('moderation', { id: ch.id, flags: mod.flags, scores: mod.scores, unsafe: mod.unsafe, sensitive: mod.sensitive, rationale: mod.rationale || undefined });
      moderationByChunk.push({ id: ch.id, page: ch.page, ...mod });

      // Send PII findings for this chunk if any detected
      if (piiFindingsChunk.length > 0) {
        piiByChunk.push(...piiFindingsChunk);
        const piiTypes = [...new Set(piiFindingsChunk.map(f => f.type))];
        const chunkPiiData = {
          id: ch.id,
          page: ch.page,
          count: piiFindingsChunk.length,
          types: piiTypes,
          findings: piiFindingsChunk.map(f => ({
            type: f.type || 'Unknown',
            field: f.field || 'Unknown Field',
            severity: f.severity || 'medium',
            page: f.page || ch.page,
            value: f.value || '[redacted]',
            redacted: f.redacted || '[REDACTED]'
          }))
        };
        console.log(`Sending chunk_pii event:`, JSON.stringify(chunkPiiData, null, 2));
        send('chunk_pii', chunkPiiData);
      }

      // DON'T send SLM summary to reduce noise
      // send('slm', { id: ch.id, summary: summ.summary, key_phrases: summ.key_phrases, error: summ.error });
      completed++;
      send('progress', { completed, total: chunks.length });
    }

    // 4) Aggregate detections & final policy classification
    send('status', { phase: 'final_analysis_start' });

    const guardianDoc = aggregateModeration(moderationByChunk);
    send('guardian', guardianDoc);

    console.log(`\n=== FINAL PII ANALYSIS ===`);
    console.log(`PII findings collected from chunks: ${piiByChunk.length}`);

    // Prefer per-chunk findings because they preserve the page mapping used throughout the pipeline.
    // Docling CLI blocks may not include page numbers, which can make everything appear like "Page 1-2" only.
    const piiFindings = dedupePiiFindings(piiByChunk.length ? piiByChunk : (
      extraction.blocks && extraction.blocks.some(b => Number(b?.page || 0) > 0)
        ? detectPIIFromBlocks(extraction.blocks)
        : detectPIIRobust(extraction.text || '')
    ));

    console.log(`\n=== FINAL PII FINDINGS (${piiFindings.length} total) ===`);
    console.log(JSON.stringify(piiFindings, null, 2));

    const piiSummary = summarizePII(piiFindings);
    const piiEvidence = formatPIIEvidence(piiFindings);
    const redactionSuggestions = generateRedactionSuggestions(piiFindings);

    console.log(`\n=== PII SUMMARY ===`);
    console.log(JSON.stringify(piiSummary, null, 2));

    const pii = {
      items: piiFindings,
      summary: piiSummary,
      evidence: piiEvidence,
      redactions: redactionSuggestions,
      hasPII: piiSummary.hasPII,
    };

    const guards = runGuards({ text: extraction.text || '', meta: extraction.meta });
    const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta, multimodal: extraction.multimodal });
    const equipment = detectEquipment(extraction.text || '', extraction.meta);
    const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment, multimodal: extraction.multimodal });

    // Evidence and final
    const prompts = buildPrompts({
      classes: ['Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other'],
      evidence: extraction.evidence,
      candidateLabel: 'Other',
    });
    const local = await classifyLocal({ text: extraction.text || '', guards, meta: extraction.meta });
    const updatedPrompts = buildPrompts({
      classes: ['Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other'],
      evidence: extraction.evidence,
      candidateLabel: local.label,
    });
    const route = shouldRoute({ local, guards, meta: extraction.meta });
    let verifier = null;
    if (route.routed) {
      verifier = await verifyWithLlama({ ...updatedPrompts, temperature }, process.env.LLAMA_URL || 'http://localhost:8080');
    }

    const final = {
      label: local.label,
      accepted: !route.routed || verifier?.verdict === 'yes',
      reason: route.reason,
    };

    const redacted_pdf = await maybeGenerateRedactedPdf({
      filePath,
      originalName: req.file?.originalname,
      extraBoxes: extraction?.multimodal?.redaction_boxes || [],
      searchTexts: buildSearchTexts({ pii, safety, guardian: guardianDoc, meta: extraction.meta }),
    });

    send('final', {
      document_path: docPath || 'uploaded',
      meta: extraction.meta,
      multimodal: extraction.multimodal || undefined,
      redacted_pdf,
      pii,
      safety,
      guardian: guardianDoc,
      equipment,
      policy,
      local,
      routed: route.routed,
      route_reason: route.reason,
      verifier,
      evidence: extraction.evidence,
      final,
      chunks: { total: chunks.length },
    });
  } catch (err) {
    send('error', { error: 'processing_failed', detail: String(err?.message || err) });
  } finally {
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch { }
    try { res.write('event: end\n'); res.write('data: {}\n\n'); } catch { }
    res.end();
  }
});

function isPathWithinRoot(candidatePath, rootPath) {
  try {
    const rel = path.relative(rootPath, candidatePath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function resolveBatchPathItems(rawPaths) {
  const envRoots = parseCsv(process.env.BATCH_PATH_ROOTS).map(r => path.resolve(r));
  const defaultRoots = [
    path.resolve(process.cwd(), 'assets', 'documents'),
    path.resolve(process.cwd(), 'uploads'),
  ].filter(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  const allowedRoots = envRoots.length ? envRoots : defaultRoots;

  const rejected = [];
  const items = [];

  for (const p of rawPaths || []) {
    const raw = String(p || '').trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    const lower = resolved.toLowerCase();
    if (!lower.endsWith('.pdf')) {
      rejected.push({ path: raw, reason: 'not_pdf' });
      continue;
    }
    if (!allowedRoots.some(root => isPathWithinRoot(resolved, root))) {
      rejected.push({ path: raw, reason: 'outside_allowed_roots' });
      continue;
    }
    try {
      if (!fs.existsSync(resolved)) {
        rejected.push({ path: raw, reason: 'not_found' });
        continue;
      }
    } catch {
      rejected.push({ path: raw, reason: 'not_accessible' });
      continue;
    }
    items.push({ path: resolved, originalname: path.basename(resolved) });
  }

  return { allowedRoots, items, rejected };
}

// Batch processing endpoint: accepts multiple files via multipart or JSON paths
app.post('/api/process-batch', upload.array('files'), async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({ path: f.path, originalname: f.originalname, temp: true }));
    const jsonPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];

    let items = files.length ? files : [];
    if (!items.length && jsonPaths.length) {
      const allowPaths = String(process.env.ALLOW_BATCH_PATHS || 'false').toLowerCase() === 'true';
      if (!allowPaths) {
        return res.status(400).json({
          error: 'paths_disabled',
          detail: 'Batch JSON paths are disabled by default. Upload files[] or set ALLOW_BATCH_PATHS=true.',
        });
      }
      const resolved = resolveBatchPathItems(jsonPaths);
      if (!resolved.items.length) {
        return res.status(400).json({
          error: 'no_valid_paths',
          detail: 'No valid PDF paths were provided (must be within allowed roots).',
          allowed_roots: resolved.allowedRoots,
          rejected: resolved.rejected.slice(0, 25),
        });
      }
      items = resolved.items;
    }

    if (!items.length) return res.status(400).json({ error: 'no_inputs', detail: 'Provide files[] (PDF uploads) or enable paths input.' });
    const out = [];
    for (const it of items) {
      const r = await fetchLikeProcess(it.path, it.originalname);
      out.push({ name: it.originalname, result: r });
    }
    res.json({ count: out.length, results: out });
  } catch (e) {
    res.status(500).json({ error: 'batch_failed', detail: String(e?.message || e) });
  } finally {
    try { (req.files || []).forEach(f => fs.unlinkSync(f.path)); } catch { }
  }
});

// helper to reuse process flow for batch
async function fetchLikeProcess(filePath, originalName) {
  const extraction = await extractDocument({ filePath, originalName, preferDocling: true });
  const pii = detectPII(extraction.text || '', extraction.meta);
  const redacted = pii?.items?.length ? redactPII(extraction.text || '') : (extraction.text || '');
  const guards = runGuards({ text: redacted, meta: extraction.meta });
  const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta, multimodal: extraction.multimodal });
  const equipment = detectEquipment(extraction.text || '', extraction.meta);
  const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment, multimodal: extraction.multimodal });
  const prompts = buildPrompts({
    classes: ['Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other'],
    evidence: extraction.evidence,
    candidateLabel: 'Other',
  });
  let local = await classifyLocal({ text: extraction.text || '', guards, meta: extraction.meta });
  const updatedPrompts = buildPrompts({
    classes: ['Internal Memo', 'Employee Application', 'Invoice', 'Public Marketing Document', 'Other'],
    evidence: extraction.evidence,
    candidateLabel: local.label,
  });
  const forceSecond = String(process.env.VERIFY_SECOND_PASS || 'false').toLowerCase() === 'true';
  const route = forceSecond ? { routed: true, reason: 'forced_second_pass' } : shouldRoute({ local, guards, meta: extraction.meta });
  let verifier = null;
  if (route.routed) {
    verifier = await verifyWithLlama({ ...updatedPrompts }, process.env.LLAMA_URL || 'http://localhost:8080');
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

// HITL feedback endpoint: save SME feedback locally for later analysis
const feedbackDir = path.join(__dirname, '../../feedback');
try { fs.mkdirSync(feedbackDir, { recursive: true }); } catch { }

app.post('/api/feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const ts = Date.now();
    const outPath = path.join(feedbackDir, `feedback_${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify(body, null, 2));
    res.json({ ok: true, path: outPath });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// User-managed redaction rules (remembered across runs).
// These are best-effort "search text" rules used when generating the redacted PDF.
app.get('/api/redaction-rules', (req, res) => {
  const rules = loadRedactionRules();
  res.json({ count: rules.length, rules });
});

app.post('/api/redaction-rules', (req, res) => {
  try {
    const created = addRedactionRule({ text: req.body?.text, label: req.body?.label });
    res.json({ ok: true, rule: created });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.delete('/api/redaction-rules/:id', (req, res) => {
  try {
    const removed = removeRedactionRule({ id: req.params?.id });
    res.json({ ok: true, rule: removed });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = msg === 'not_found' ? 404 : 400;
    res.status(code).json({ ok: false, error: msg });
  }
});

// Manual PDF session for client-side "highlight to redact" workflows.
// Stores the uploaded PDF temporarily so the UI can render pages and submit redaction boxes
// without re-uploading the file on every page change.
app.post('/api/pdf/session', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  const originalName = req.file?.originalname;
  if (!tmpPath) return res.status(400).json({ ok: false, error: 'missing_file' });
  if (!isProbablyPdf({ filePath: tmpPath, originalName })) {
    try { fs.unlinkSync(tmpPath); } catch { }
    return res.status(400).json({ ok: false, error: 'pdf_required' });
  }

  const id = `p_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const sessionPath = path.join(sessionsDir, `${id}.pdf`);
  try {
    fs.renameSync(tmpPath, sessionPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { }
    return res.status(500).json({ ok: false, error: 'session_store_failed', detail: String(e?.message || e) });
  }

  try {
    const signals = await getPdfSignals({ filePath: sessionPath });
    res.json({
      ok: true,
      id,
      file: path.basename(sessionPath),
      original_name: originalName || 'document.pdf',
      pages: Number(signals?.pages || 0) || 0,
      page_signals: Array.isArray(signals?.page_signals) ? signals.page_signals : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'signals_failed', detail: String(e?.message || e) });
  }
});

app.delete('/api/pdf/session/:id', (req, res) => {
  const id = String(req.params?.id || '').trim();
  if (!/^p_[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });
  const fullPath = path.join(sessionsDir, `${id}.pdf`);
  if (!fullPath.startsWith(sessionsDir)) return res.status(400).json({ ok: false, error: 'invalid_path' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: 'not_found' });
  try { fs.unlinkSync(fullPath); } catch { }
  res.json({ ok: true });
});

app.post('/api/pdf/render-pages', async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
    const dpi = Number(req.body?.dpi || 180) || 180;
    if (!/^p_[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });
    const filePath = path.join(sessionsDir, `${id}.pdf`);
    if (!filePath.startsWith(sessionsDir)) return res.status(400).json({ ok: false, error: 'invalid_path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'not_found' });

    const pageList = pages.map(p => Number(p)).filter(p => Number.isFinite(p) && p >= 1 && p <= 200);
    const out = await renderPdfPages({ filePath, pages: pageList, dpi });
    if (!out) return res.status(500).json({ ok: false, error: 'render_failed' });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'render_failed', detail: String(e?.message || e) });
  }
});

app.post('/api/pdf/redact', async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    const boxes = Array.isArray(req.body?.boxes) ? req.body.boxes : [];
    const detectPii = req.body?.detect_pii === false ? false : true;
    const includeRules = req.body?.include_rules === false ? false : true;

    if (!/^p_[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });
    const filePath = path.join(sessionsDir, `${id}.pdf`);
    if (!filePath.startsWith(sessionsDir)) return res.status(400).json({ ok: false, error: 'invalid_path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'not_found' });

    const cleanBoxes = boxes
      .map((b) => {
        const page = Number(b?.page || 0) || 0;
        const bbox = Array.isArray(b?.bbox) && b.bbox.length === 4 ? b.bbox.map(Number) : null;
        const label = String(b?.label || 'manual').trim() || 'manual';
        if (!page || !bbox || bbox.some(v => !Number.isFinite(v))) return null;
        return { page, bbox, label };
      })
      .filter(Boolean)
      .slice(0, 200);

    let searchTexts = [];
    if (includeRules) {
      const signals = await getPdfSignals({ filePath });
      const pagesTotal = Math.max(1, Number(signals?.pages || 1));
      const rules = loadRedactionRules();
      for (const r of rules.slice(0, 20)) {
        for (let p = 1; p <= pagesTotal; p++) {
          searchTexts.push({ page: p, text: r.text, label: `user_${r.label || 'rule'}` });
          if (searchTexts.length >= 120) break;
        }
        if (searchTexts.length >= 120) break;
      }
    }

    const pdfBytes = await redactPdf({ filePath, boxes: cleanBoxes, searchTexts, detectPii });
    if (!pdfBytes || !Buffer.isBuffer(pdfBytes) || pdfBytes.length < 20) {
      return res.status(500).json({ ok: false, error: 'redact_failed' });
    }

    const outName = `manual_redacted_${Date.now()}_${id}.pdf`;
    const outPath = path.join(redactedDir, outName);
    fs.writeFileSync(outPath, pdfBytes);

    res.json({
      ok: true,
      redacted_pdf: {
        file: outName,
        url: `/api/redacted/${outName}`,
        boxes: cleanBoxes.length,
        search_texts: searchTexts.length,
        pii: detectPii,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'redact_failed', detail: String(e?.message || e) });
  }
});

function requirePIIRedaction(req) {
  const s = String(process.env.REDACT_PII || 'true').toLowerCase();
  const override = typeof req?.body?.redact_pii !== 'undefined' ? String(req.body.redact_pii).toLowerCase() : null;
  const val = override ?? s;
  return val === 'true' || val === '1' || val === 'yes';
}

function extractLabel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Common keys from various models
  const keys = ['label', 'Label', 'classification', 'class', 'category', 'Category', 'predicted_label', 'predicted_class'];
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  // Some models wrap answer within a field like { result: { label: ... } }
  if (obj.result) return extractLabel(obj.result);
  return null;
}

function buildSearchTexts({ pii, safety, guardian, meta }) {
  const out = [];

  // Use Granite Guardian as the high-level gate for what to redact beyond PII:
  // - Guardian does not provide exact spans, so we use our regex-based safety matches
  //   to locate the text, but only apply them if Guardian indicates unsafe categories.
  const guardianFlags = new Set(Array.isArray(guardian?.flags) ? guardian.flags.map(String) : []);
  const allowUnsafeTextRedaction =
    guardianFlags.has('child_safety') ||
    guardianFlags.has('hate') ||
    guardianFlags.has('exploitative') ||
    guardianFlags.has('violence') ||
    guardianFlags.has('criminal') ||
    guardianFlags.has('political_news') ||
    guardianFlags.has('cyber_threat');

  if (allowUnsafeTextRedaction) {
    for (const m of (safety?.matches || [])) {
      // Vision-derived unsafe matches are redacted via bbox boxes (not text search).
      if (m?.source === 'vision') continue;
      const page = Number(m?.page || 0);
      const text = String(m?.snippet || '').trim();
      const label = m?.category ? `safety_${m.category}` : 'safety_match';
      if (!page || !text) continue;
      out.push({ page, text, label });
    }
  }

  for (const it of (pii?.items || [])) {
    const page = Number(it?.page || 0);
    const text = String(it?.value || '').trim();
    const label = it?.type ? `pii_${it.type}` : 'pii_match';
    if (!page || !text) continue;
    out.push({ page, text, label });
  }

  // Persisted user rules: apply as exact search text matches across all pages.
  const rules = loadRedactionRules();
  const pages = Math.max(1, Number(meta?.pages || 1));
  for (const r of rules.slice(0, 20)) {
    for (let p = 1; p <= pages; p++) {
      out.push({ page: p, text: r.text, label: `user_${r.label || 'rule'}` });
      if (out.length >= 120) break;
    }
    if (out.length >= 120) break;
  }

  // Avoid pathological payload sizes
  return out.slice(0, 120);
}

function aggregateModeration(items) {
  const arr = Array.isArray(items) ? items : [];
  const flags = new Set();
  let unsafe = false;
  let sensitive = false;
  for (const it of arr) {
    for (const f of (it?.flags || [])) flags.add(String(f));
    unsafe = unsafe || Boolean(it?.unsafe);
    sensitive = sensitive || Boolean(it?.sensitive);
  }
  return { flags: Array.from(flags).sort(), unsafe, sensitive, chunks: arr.length };
}

function dedupePiiFindings(findings) {
  const arr = Array.isArray(findings) ? findings : [];
  const seen = new Set();
  const out = [];
  for (const f of arr) {
    const type = String(f?.type || '').trim();
    const value = String(f?.value || '').trim();
    const page = Number(f?.page || 0) || 0;
    if (!type || !value) continue;
    const key = `${type.toLowerCase()}|${value.toLowerCase()}|${page || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

async function maybeGenerateRedactedPdf({ filePath, originalName, extraBoxes, searchTexts }) {
  const enabled = String(process.env.REDACT_OUTPUT_PDF || 'true').toLowerCase();
  if (!['1', 'true', 'yes', 'y', 'on'].includes(enabled)) return null;
  if (!filePath) return null;

  const isPdf = isProbablyPdf({ filePath, originalName });
  if (!isPdf) return null;

  const boxes = Array.isArray(extraBoxes) ? extraBoxes : [];
  const searchTextsList = Array.isArray(searchTexts) ? searchTexts : [];
  const pdfBytes = await redactPdf({ filePath, boxes, searchTexts: searchTextsList, detectPii: true });
  if (!pdfBytes || !Buffer.isBuffer(pdfBytes) || pdfBytes.length < 20) return null;

  const safeBase = sanitizeFilename(path.basename(originalName || 'document.pdf'));
  const outName = `redacted_${Date.now()}_${safeBase}`.replace(/\.pdf$/i, '') + '.pdf';
  const outPath = path.join(redactedDir, outName);

  try {
    fs.writeFileSync(outPath, pdfBytes);
  } catch {
    return null;
  }

  return {
    file: outName,
    url: `/api/redacted/${outName}`,
    boxes: boxes.length,
    search_texts: searchTextsList.length,
    pii: true,
  };
}

function isProbablyPdf({ filePath, originalName }) {
  const nameHint = String(originalName || '').toLowerCase();
  if (nameHint.endsWith('.pdf')) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.toString('utf8') === '%PDF';
  } catch {
    return false;
  }
}

function sanitizeFilename(name) {
  const base = String(name || 'document').trim() || 'document';
  // allow a-zA-Z0-9._- only
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function resolveStaticDir(name, candidates) {
  for (const dir of candidates) {
    try {
      const indexFile = path.join(dir, 'index.html');
      if (fs.existsSync(indexFile)) {
        console.log(`[static] Serving ${name} from: ${dir}`);
        return dir;
      }
    } catch { }
  }
  console.warn(`[static] ${name} not found. Tried: ${candidates.join(' | ')}`);
  return null;
}

// Serve static assets.
// NOTE: The server can run in two layouts:
// - Local dev: repo/server/src/index.js  -> public is ../../public
// - Docker image: /app/src/index.js      -> public is ../public
const publicDir = resolveStaticDir('public', [
  path.join(__dirname, '../../public'),
  path.join(__dirname, '../public'),
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), '../public'),
]);

if (publicDir) {
  app.use(express.static(publicDir));
}

// Optional legacy web/ UI (kept for compatibility)
const webDir = resolveStaticDir('web', [
  path.join(__dirname, '../../web'),
  path.join(__dirname, '../web'),
  path.join(process.cwd(), 'web'),
  path.join(process.cwd(), '../web'),
]);
if (webDir) {
  app.use(express.static(webDir));
}

// Centralized error handler (e.g., multer limits)
app.use((err, _req, res, _next) => {
  const code = String(err?.code || '');
  if (code === 'UNSUPPORTED_FILETYPE') {
    return res.status(415).json({ error: 'unsupported_filetype', detail: String(err?.message || 'unsupported file type') });
  }
  if (err?.name === 'MulterError' || code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'upload_error', detail: String(err?.message || 'upload error') });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Doc classifier service listening on http://localhost:${PORT}`);
});
