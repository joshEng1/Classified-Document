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
import { redactPdf } from './services/extractor/doclingAdapter.js';

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

    // Process chunks sequentially to maintain order
    for (const ch of chunks) {
      console.log(`\n=== PROCESSING CHUNK ${ch.id} ===`);
      console.log(`Chunk text length: ${ch.text?.length || 0}`);
      console.log(`Chunk page: ${ch.page}`);
      console.log(`Chunk text preview: ${ch.text?.substring(0, 200)}...`);

      // Fire all three operations in parallel for this chunk
      const pSumm = summarizeChunk({ text: ch.text, baseUrl: slmUrl });
      const pMod = moderateText({ text: ch.text, baseUrl: guardianUrl });
      const piiFindings = detectPIIRobust(ch.text, ch.page);

      const [summ, mod] = await Promise.all([pSumm, pMod]);

      console.log(`SLM Response for chunk ${ch.id}:`, JSON.stringify(summ, null, 2));
      console.log(`Guardian Response for chunk ${ch.id}:`, JSON.stringify(mod, null, 2));
      console.log(`PII Findings for chunk ${ch.id}:`, JSON.stringify(piiFindings, null, 2));

      send('chunk', { id: ch.id, page: ch.page, start: ch.start, end: ch.end });
      send('moderation', { id: ch.id, flags: mod.flags, scores: mod.scores, unsafe: mod.unsafe, sensitive: mod.sensitive, rationale: mod.rationale || undefined });

      // Send PII findings for this chunk if any detected
      if (piiFindings.length > 0) {
        const piiTypes = [...new Set(piiFindings.map(f => f.type))];
        const chunkPiiData = {
          id: ch.id,
          page: ch.page,
          count: piiFindings.length,
          types: piiTypes,
          findings: piiFindings.map(f => ({
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

    console.log(`\n=== FINAL PII ANALYSIS ===`);
    console.log(`extraction.blocks available: ${!!extraction.blocks}`);
    console.log(`extraction.blocks length: ${extraction.blocks?.length || 0}`);
    if (extraction.blocks && extraction.blocks.length > 0) {
      console.log(`First block sample:`, JSON.stringify(extraction.blocks[0], null, 2));
    }

    // Use robust PII detector with pattern matching on blocks (includes page numbers)
    const piiFindings = extraction.blocks && extraction.blocks.length > 0
      ? detectPIIFromBlocks(extraction.blocks)
      : detectPIIRobust(extraction.text || '');

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
    const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta });
    const equipment = detectEquipment(extraction.text || '', extraction.meta);
    const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment });

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
      verifier = await verifyWithLlama(updatedPrompts, process.env.LLAMA_URL || 'http://localhost:8080');
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
      searchTexts: buildSearchTexts({ pii, safety }),
    });

    send('final', {
      document_path: docPath || 'uploaded',
      meta: extraction.meta,
      multimodal: extraction.multimodal || undefined,
      redacted_pdf,
      pii,
      safety,
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
    try { (req.files || []).forEach(f => fs.unlinkSync(f.path)); } catch { }
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

function buildSearchTexts({ pii, safety }) {
  const out = [];

  for (const m of (safety?.matches || [])) {
    const page = Number(m?.page || 0);
    const text = String(m?.snippet || '').trim();
    const label = m?.category ? `safety_${m.category}` : 'safety_match';
    if (!page || !text) continue;
    out.push({ page, text, label });
  }

  for (const it of (pii?.items || [])) {
    const page = Number(it?.page || 0);
    const text = String(it?.value || '').trim();
    const label = it?.type ? `pii_${it.type}` : 'pii_match';
    if (!page || !text) continue;
    out.push({ page, text, label });
  }

  // Avoid pathological payload sizes
  return out.slice(0, 120);
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

// Serve static assets for both legacy web/ and new root-based UI
try { app.use(express.static(path.join(__dirname, '../../public'))); } catch { }
try { app.use(express.static(path.join(__dirname, '../../web'))); } catch { }

app.listen(PORT, () => {
  console.log(`Doc classifier service listening on http://localhost:${PORT}`);
});
