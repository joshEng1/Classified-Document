#!/usr/bin/env node
// Integration test runner for known challenge documents.
//
// Runs the same core pipeline modules used by the server:
// Docling extract -> PII -> Safety -> Equipment -> Policy classification.
//
// Usage:
//   node server/scripts/run-testcases.js
//
// Notes:
// - Requires Docling service reachable at DOCLING_URL and the input PDFs present on disk.
// - This is intentionally lightweight (no test framework dependency).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractDocument } from '../src/services/extractor/index.js';
import { detectPII } from '../src/services/pii/detectPII.js';
import { assessSafety } from '../src/services/safety/safety.js';
import { detectEquipment } from '../src/services/detectors/equipment.js';
import { classifyPolicy } from '../src/services/policy/policyClassifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..'); // repo root (contains assets/, server/, etc.)
const serverEnv = path.join(repoRoot, 'server', '.env');
try { if (fs.existsSync(serverEnv)) loadDotEnv(serverEnv); } catch { }

function loadDotEnv(filePath) {
  const txt = fs.readFileSync(filePath, 'utf-8');
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // Strip inline comment if not quoted
    if (!val.startsWith('"') && !val.startsWith("'")) val = val.split(' #')[0].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function fail(msg) {
  const err = new Error(msg);
  err.code = 'TEST_FAIL';
  throw err;
}

function asRel(p) {
  return p.replaceAll('\\', '/');
}

function getCases() {
  const casesPath = path.join(repoRoot, 'server', 'testcases', 'cases.json');
  const raw = fs.readFileSync(casesPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed?.cases) ? parsed.cases : [];
  if (!cases.length) fail(`No cases found in ${casesPath}`);
  return { casesPath, cases };
}

function containsAny(arr, requiredAny) {
  const set = new Set(arr || []);
  return (requiredAny || []).some(v => set.has(v));
}

function checkNum(name, actual, op, expected) {
  if (!Number.isFinite(actual)) fail(`${name}: actual is not a number (${actual})`);
  if (!Number.isFinite(expected)) fail(`${name}: expected is not a number (${expected})`);
  if (op === '>=') { if (!(actual >= expected)) fail(`${name}: expected >= ${expected}, got ${actual}`); return; }
  if (op === '<=') { if (!(actual <= expected)) fail(`${name}: expected <= ${expected}, got ${actual}`); return; }
  if (op === '==') { if (!(actual === expected)) fail(`${name}: expected == ${expected}, got ${actual}`); return; }
  fail(`${name}: unknown op ${op}`);
}

function checkStringEq(name, actual, expected) {
  if (String(actual) !== String(expected)) fail(`${name}: expected "${expected}", got "${actual}"`);
}

async function runOneCase(tc) {
  const id = String(tc?.id || 'unknown');
  const fileRel = String(tc?.file || '');
  if (!fileRel) fail(`[${id}] missing file`);
  const requiresVision = Boolean(tc?.requires?.vision);
  const filePath = path.join(repoRoot, fileRel);
  if (!fs.existsSync(filePath)) fail(`[${id}] file not found: ${filePath}`);

  const expect = tc?.expect || {};

  // Keep testcases fast + deterministic:
  // - Only enable Vision for cases that explicitly require it (TC5).
  // Without this, image-heavy marketing PDFs can trigger the Vision router and spend minutes on renders + calls.
  const prevVisionEnable = process.env.VISION_ENABLE;
  if (!requiresVision) process.env.VISION_ENABLE = 'false';

  const extraction = await extractDocument({
    filePath,
    originalName: path.basename(filePath),
    preferDocling: true,
  });

  // Restore env for next cases
  if (prevVisionEnable === undefined) delete process.env.VISION_ENABLE;
  else process.env.VISION_ENABLE = prevVisionEnable;

  if (requiresVision) {
    const enabled = extraction?.multimodal?.vision?.enabled === true;
    const regions = Array.isArray(extraction?.multimodal?.vision?.regions) ? extraction.multimodal.vision.regions : [];
    if (!enabled) fail(`[${id}] requires Vision but it is disabled (set VISION_URL and VISION_ENABLE=true)`);
    if (!regions.length) fail(`[${id}] requires Vision but no regions/pages were analyzed`);

    const okRegion = regions.find(r => !(r?.analysis?.error));
    if (!okRegion) {
      const first = regions[0]?.analysis || {};
      const status = first?.status ? ` (${first.status})` : '';
      const msg = String(first?.detail || first?.detail_raw || first?.error || 'vision_failed').slice(0, 240);
      fail(`[${id}] Vision ran but all regions failed${status}: ${msg}`);
    }
  }

  const pii = detectPII(extraction.text || '', extraction.meta);
  const safety = assessSafety({ text: extraction.text || '', meta: extraction.meta, multimodal: extraction.multimodal });
  const equipment = detectEquipment(extraction.text || '', extraction.meta);
  const policy = classifyPolicy({ text: extraction.text || '', meta: extraction.meta, pii, safety, equipment, multimodal: extraction.multimodal });

  // --- Assertions ---
  if (expect.policy_sensitivity) checkStringEq(`[${id}] policy.sensitivity`, policy?.sensitivity, expect.policy_sensitivity);
  if (expect.policy_overall) checkStringEq(`[${id}] policy.overall`, policy?.overall, expect.policy_overall);
  if (typeof expect.safe_for_kids === 'boolean') checkStringEq(`[${id}] safety.safe_for_kids`, Boolean(safety?.safe_for_kids), expect.safe_for_kids);

  if (Number.isFinite(expect.min_pages)) checkNum(`[${id}] meta.pages`, Number(extraction?.meta?.pages || 0), '>=', Number(expect.min_pages));
  if (Number.isFinite(expect.min_images)) checkNum(`[${id}] meta.images`, Number(extraction?.meta?.images || 0), '>=', Number(expect.min_images));

  const piiTotal = Number(pii?.summary?.total || 0);
  if (Number.isFinite(expect.pii_total_min)) checkNum(`[${id}] pii.summary.total`, piiTotal, '>=', Number(expect.pii_total_min));
  if (Number.isFinite(expect.pii_total_max)) checkNum(`[${id}] pii.summary.total`, piiTotal, '<=', Number(expect.pii_total_max));

  if (Array.isArray(expect.pii_types_must_include) && expect.pii_types_must_include.length) {
    const types = (pii?.items || []).map(it => String(it?.type || ''));
    for (const t of expect.pii_types_must_include) {
      if (!types.includes(String(t))) fail(`[${id}] expected PII type "${t}" in detected types: ${Array.from(new Set(types)).join(', ') || '(none)'}`);
    }
  }

  if (Array.isArray(expect.equipment_present_any) && expect.equipment_present_any.length) {
    const present = Array.isArray(equipment?.present) ? equipment.present : [];
    if (!containsAny(present, expect.equipment_present_any)) {
      fail(`[${id}] expected equipment.present to include one of: ${expect.equipment_present_any.join(', ')}; got: ${present.join(', ') || '(none)'}`);
    }
  }

  return {
    id,
    file: asRel(fileRel),
    meta: extraction.meta,
    policy: { sensitivity: policy?.sensitivity, overall: policy?.overall, rationale: policy?.rationale },
    pii: { total: piiTotal, types: Array.from(new Set((pii?.items || []).map(it => it.type))).sort() },
    safety: { unsafe: Boolean(safety?.unsafe), categories: safety?.categories || [] },
    equipment: { present: equipment?.present || [], counts: equipment?.summary || {} },
  };
}

async function main() {
  const { casesPath, cases } = getCases();
  if (!process.env.DOCLING_URL) {
    console.error(`Missing DOCLING_URL. Set it in server/.env (example: DOCLING_URL=http://localhost:7000).`);
    process.exit(2);
  }

  const visionUrl = process.env.VISION_URL;
  const visionReachable = visionUrl ? await probeHttp(visionUrl) : false;
  if (visionUrl && !visionReachable) {
    // Prevent long timeouts inside extractDocument when Vision is configured but not running.
    process.env.VISION_ENABLE = 'false';
  }

  console.log(`Using DOCLING_URL=${process.env.DOCLING_URL}`);
  if (visionUrl) console.log(`VISION_URL=${visionUrl} (${visionReachable ? 'reachable' : 'unreachable'})`);
  console.log(`Loading cases from ${casesPath}`);

  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const tc of cases) {
    const id = String(tc?.id || 'unknown');
    process.stdout.write(`- ${id} ... `);
    const requiresVision = Boolean(tc?.requires?.vision);
    if (requiresVision && (!visionUrl || !visionReachable)) {
      skipped += 1;
      results.push({ ok: true, skipped: true, id, reason: !visionUrl ? 'VISION_URL_not_set' : 'VISION_unreachable' });
      console.log(!visionUrl ? 'SKIP (VISION_URL not set)' : 'SKIP (Vision unreachable)');
      continue;
    }
    try {
      const r = await runOneCase(tc);
      results.push({ ok: true, ...r });
      passed += 1;
      console.log('OK');
    } catch (e) {
      failed += 1;
      const msg = String(e?.message || e);
      results.push({ ok: false, id, error: msg });
      console.log(`FAIL (${msg})`);
    }
  }

  const outDir = path.join(repoRoot, '.run', 'testcases');
  const outPath = path.join(outDir, `results_${Date.now()}.json`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ passed, failed, skipped, at: new Date().toISOString(), results }, null, 2));
    console.log(`Wrote results: ${outPath}`);
  } catch { }

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

async function probeHttp(baseUrl) {
  try {
    const u = String(baseUrl || '').replace(/\/+$/, '');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch(`${u}/v1/models`, { method: 'GET', signal: ctrl.signal });
    clearTimeout(t);
    // Even 404 means the server is reachable; we only care about connectivity.
    return Boolean(resp);
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
