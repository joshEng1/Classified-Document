const $ = (sel) => document.querySelector(sel);
const REVIEW_PAGE_SIZE = 10;

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function bytesToHuman(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / (1024 ** i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function normalizeBaseUrl(url) {
  const s = String(url || '').trim();
  return s.replace(/\/+$/, '');
}

function resolveApiBase() {
  const u = new URL(window.location.href);
  const qp = u.searchParams.get('api');
  if (qp) {
    const v = normalizeBaseUrl(qp);
    localStorage.setItem('apiBase', v);
    return v;
  }
  const saved = localStorage.getItem('apiBase');
  return normalizeBaseUrl(saved || window.location.origin);
}

function joinUrl(base, path) {
  const b = normalizeBaseUrl(base);
  const p = String(path || '');
  if (!p) return b;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${b}${p.startsWith('/') ? '' : '/'}${p}`;
}

function loadUiMode() {
  const saved = String(localStorage.getItem('uiMode') || '').trim().toLowerCase();
  return saved === 'dev' ? 'dev' : 'business';
}

function normalizeModelMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'local' || v === 'offline') return 'local';
  return 'online';
}

function loadModelMode() {
  return normalizeModelMode(localStorage.getItem('modelMode') || 'online');
}

function setText(el, text) {
  if (!el) return;
  el.textContent = String(text ?? '');
}

function show(el) {
  if (!el) return;
  el.classList.remove('hidden');
}

function hide(el) {
  if (!el) return;
  el.classList.add('hidden');
}

function toast(kind, title, sub = '', ttlMs = 4200) {
  const root = $('#toasts');
  if (!root) return;
  const card = document.createElement('div');
  card.className = 'toast';
  card.dataset.kind = kind;
  const t = document.createElement('div');
  t.className = 'toast-title';
  t.textContent = title;
  const s = document.createElement('div');
  s.className = 'toast-sub';
  s.textContent = sub;
  card.appendChild(t);
  card.appendChild(s);
  root.appendChild(card);
  setTimeout(() => {
    try { card.remove(); } catch { }
  }, ttlMs);
}

function logLine(line) {
  const msg = `[${nowTime()}] ${line}`;
  try {
    state.ui.logBuffer.push(msg);
    if (state.ui.logBuffer.length > 800) state.ui.logBuffer = state.ui.logBuffer.slice(-600);
  } catch { }

  if (!(state?.ui?.mode === 'dev')) return;
  const root = $('#activity-log');
  if (!root) return;
  const div = document.createElement('div');
  div.textContent = msg;
  root.appendChild(div);
  root.scrollTop = root.scrollHeight;
}

function setStatusPill(state, text) {
  const pill = $('#status-pill');
  if (!pill) return;
  pill.dataset.state = state;
  const span = pill.querySelector('span');
  if (span) {
    span.textContent = text;
  } else {
    pill.textContent = text;
  }
}

function setStepState(stepId, state, subText) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.dataset.state = state;
  const sub = $(`#${stepId}-sub`);
  if (sub && subText != null) sub.textContent = subText;
}

function setProgress(completed, total) {
  const bar = $('#progress-bar');
  const txt = $('#progress-text');
  const right = $('#progress-right');
  const done = Number(completed || 0);
  const tot = Number(total || 0);
  const pct = tot > 0 ? clamp(Math.round((done / tot) * 100), 0, 100) : 0;
  if (bar) bar.style.width = `${pct}%`;
  if (txt) txt.textContent = `${done} / ${tot || 0}`;
  if (right) right.textContent = tot > 0 ? `${pct}%` : '—';
}

function renderChips(container, items, emptyText = 'None') {
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const div = document.createElement('div');
    div.className = 'muted text-sm';
    div.textContent = emptyText;
    container.appendChild(div);
    return;
  }
  const row = document.createElement('div');
  row.className = 'chip-row';
  for (const it of list) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = String(it);
    row.appendChild(chip);
  }
  container.appendChild(row);
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

// Global state for the current run
const state = {
  apiBase: resolveApiBase(),
  ui: {
    mode: loadUiMode(), // 'business' | 'dev'
    modelMode: loadModelMode(), // 'online' | 'local'
    logBuffer: [],
    lastHealth: null,
    lastHealthError: null,
    lastProviderStatus: null,
  },
  terms: {
    accepted: false,
    onlineAccepted: false,
    requiresOnline: false,
    onAccept: null,
  },
  cleanupRefs: new Set(),
  file: null,
  previewUrl: null,
  previewOpen: false,
  manual: {
    sessionId: null,
    originalName: null,
    baseSessionId: null,
    baseOriginalName: null,
    pages: 0,
    pageSignals: [],
    currentPage: 1,
    boxes: [],
    aiBoxes: [],
    drawing: null,
    dpi: 180,
  },
  run: {
    startedAt: 0,
    phase: 'idle',
    chunksTotal: 0,
    chunksCompleted: 0,
    moderationFlags: new Map(),
    piiByType: new Map(),
    piiTotal: 0,
    meta: null,
    guardian: null,
    safety: null,
    policy: null,
    final: null,
    redactedPdf: null,
    redactionReview: null,
    reviewFilter: 'all',
    reviewPage: 0,
  },
};

function isDevMode() {
  return state.ui.mode === 'dev';
}

function renderActivityLogFromBuffer() {
  const root = $('#activity-log');
  if (!root) return;
  root.innerHTML = '';
  for (const line of state.ui.logBuffer.slice(-400)) {
    const div = document.createElement('div');
    div.textContent = line;
    root.appendChild(div);
  }
  root.scrollTop = root.scrollHeight;
}

function applyUiMode() {
  document.documentElement.dataset.mode = state.ui.mode;

  const btn = $('#btn-toggle-mode');
  if (btn) {
    btn.textContent = isDevMode() ? 'Developer mode: On' : 'Developer mode: Off';
    btn.setAttribute('aria-pressed', isDevMode() ? 'true' : 'false');
  }

  // Refresh dev-only panels when entering dev mode.
  if (isDevMode()) {
    renderActivityLogFromBuffer();
    const healthPre = $('#health-json');
    if (healthPre) {
      if (state.ui.lastHealth) {
        const payload = state.ui.lastProviderStatus
          ? { ...state.ui.lastHealth, provider_status: state.ui.lastProviderStatus }
          : state.ui.lastHealth;
        setText(healthPre, JSON.stringify(payload, null, 2));
      }
      else if (state.ui.lastHealthError) setText(healthPre, String(state.ui.lastHealthError));
      else setText(healthPre, 'â€”');
    }
  }

  // Redaction overlays/list differ in dev mode (coords + labels).
  renderManualBoxList();
  renderManualBoxesOnPage();

  const modeSelect = $('#model-mode');
  if (modeSelect) modeSelect.value = state.ui.modelMode;
  setText($('#model-mode-value'), state.ui.modelMode === 'local' ? 'local/offline' : 'online');
  setText(
    $('#model-mode-hint'),
    state.ui.modelMode === 'local'
      ? 'Uses local/offline model path (no hosted verifier calls).'
      : 'Uses hosted API verification.'
  );

  // Update status pill formatting for the selected mode.
  void checkHealth();
}

function setUiMode(mode) {
  state.ui.mode = (mode === 'dev') ? 'dev' : 'business';
  localStorage.setItem('uiMode', state.ui.mode);
  applyUiMode();
}

function toggleUiMode() {
  setUiMode(isDevMode() ? 'business' : 'dev');
  toast('success', 'Mode changed', isDevMode() ? 'Developer mode enabled' : 'Business mode enabled');
}

function setModelMode(mode) {
  state.ui.modelMode = normalizeModelMode(mode);
  localStorage.setItem('modelMode', state.ui.modelMode);
  applyUiMode();
}

function resetRunUi() {
  state.manual.aiBoxes = [];
  state.run = {
    startedAt: Date.now(),
    phase: 'idle',
    chunksTotal: 0,
    chunksCompleted: 0,
    moderationFlags: new Map(),
    piiByType: new Map(),
    piiTotal: 0,
    meta: null,
    guardian: null,
    safety: null,
    policy: null,
    final: null,
    redactedPdf: null,
    redactionReview: null,
    reviewFilter: 'all',
    reviewPage: 0,
  };

  setStepState('step-extract', 'active', 'Waiting…');
  setStepState('step-chunk', '', 'Waiting…');
  setStepState('step-moderate', '', 'Waiting…');
  setStepState('step-final', '', 'Waiting…');
  setProgress(0, 0);

  state.ui.logBuffer = [];

  setText($('#mini-flags'), '0');
  setText($('#mini-pii'), '0');
  setText($('#mini-pages'), '—');
  setText($('#hero-kpi-sensitivity'), '—');
  setText($('#hero-kpi-unsafe'), 'Unsafe: —');
  setText($('#hero-kpi-pages'), '—');
  setText($('#hero-kpi-images'), '—');
  setText($('#hero-kpi-pii'), '—');
  setText($('#hero-kpi-pii-types'), 'Top types: —');
  setText($('#hero-kpi-mode'), '—');

  const log = $('#activity-log');
  if (log) log.innerHTML = '';

  hide($('#report'));
  setText($('#report-subtitle'), '—');
  setText($('#kpi-overall'), '—');
  setText($('#kpi-overall-sub'), '—');
  setText($('#kpi-pages'), '—');
  setText($('#kpi-images'), '—');
  setText($('#kpi-pii-total'), '—');
  setText($('#kpi-pii-types'), '—');
  setText($('#kpi-guardian'), '—');
  setText($('#kpi-guardian-sub'), '—');
  $('#evidence-list')?.replaceChildren();
  $('#redact-text-list')?.replaceChildren();
  setText($('#evidence-counts'), 'Approved: 0 • Rejected: 0 • Total: 0');
  setText($('#evidence-page'), 'Page 1 / 1');
  setText($('#redact-review-summary'), 'Approved: 0 • Rejected: 0 • Total: 0');
  renderChips($('#safety-concerns'), []);
  renderChips($('#guardian-flags'), []);
  setText($('#audit-json'), '');
  hide($('#btn-download-redacted'));
  updateEvidenceControls();
}

function updateMiniStats() {
  // flags
  let flagTotal = 0;
  for (const v of state.run.moderationFlags.values()) flagTotal += v;
  setText($('#mini-flags'), String(flagTotal));
  setText($('#mini-pii'), String(state.run.piiTotal));
  setText($('#mini-pages'), String(state.run.meta?.pages ?? '—'));
}

function updateHeroKpis() {
  const policy = state.run.policy;
  if (policy?.sensitivity) setText($('#hero-kpi-sensitivity'), policy.sensitivity);
  if (policy?.unsafe != null) setText($('#hero-kpi-unsafe'), `Unsafe: ${policy.unsafe ? 'Yes' : 'No'}`);
  if (state.run.meta) {
    setText($('#hero-kpi-pages'), String(state.run.meta.pages ?? '—'));
    setText($('#hero-kpi-images'), String(state.run.meta.images ?? '—'));
  }
  if (state.run.piiTotal) {
    setText($('#hero-kpi-pii'), String(state.run.piiTotal));
    const top = Array.from(state.run.piiByType.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    setText($('#hero-kpi-pii-types'), `Top types: ${top.length ? top.join(', ') : '—'}`);
  }
}

function setPhase(phase) {
  state.run.phase = phase;
  if (phase === 'extract_start') {
    setStepState('step-extract', 'active', 'Extracting document…');
    setStepState('step-chunk', '', 'Waiting…');
    setStepState('step-moderate', '', 'Waiting…');
    setStepState('step-final', '', 'Waiting…');
  }
  if (phase === 'chunk_start') {
    setStepState('step-extract', 'done', 'Extraction complete');
    setStepState('step-chunk', 'active', 'Building chunks…');
    setStepState('step-moderate', '', 'Waiting…');
    setStepState('step-final', '', 'Waiting…');
  }
  if (phase === 'chunk_processing') {
    setStepState('step-extract', 'done', 'Extraction complete');
    setStepState('step-chunk', 'done', `Chunks: ${state.run.chunksTotal || '—'}`);
    setStepState('step-moderate', 'active', 'Running moderation & PII…');
    setStepState('step-final', '', 'Waiting…');
  }
  if (phase === 'final_analysis_start') {
    setStepState('step-extract', 'done', 'Extraction complete');
    setStepState('step-chunk', 'done', `Chunks: ${state.run.chunksTotal || '—'}`);
    setStepState('step-moderate', 'done', 'Chunk analysis complete');
    setStepState('step-final', 'active', 'Finalizing report…');
  }
  if (phase === 'final_done') {
    setStepState('step-final', 'done', 'Complete');
  }
}

async function checkHealth() {
  try {
    const url = joinUrl(state.apiBase, '/health');
    const j = await fetchJson(url, { cache: 'no-store' });
    setStatusPill('ok', `Online • v${j?.version || '—'}`);
    state.ui.lastHealth = j;
    state.ui.lastHealthError = null;
    const version = String(j?.version || '').trim() || '-';
    setStatusPill('ok', isDevMode() ? `Online (v${version})` : 'Online');
    const pre = $('#health-json');
    if (pre && isDevMode()) {
      const payload = state.ui.lastProviderStatus ? { ...j, provider_status: state.ui.lastProviderStatus } : j;
      setText(pre, JSON.stringify(payload, null, 2));
    }
    return true;
  } catch (e) {
    setStatusPill('down', 'Offline');
    state.ui.lastHealth = null;
    state.ui.lastHealthError = String(e?.message || e);
    const pre = $('#health-json');
    if (pre && isDevMode()) setText(pre, state.ui.lastHealthError);
    return false;
  }
}

async function checkProviderStatus(silent = true) {
  try {
    const mode = normalizeModelMode(state.ui.modelMode);
    const url = joinUrl(state.apiBase, `/api/provider-status?model_mode=${encodeURIComponent(mode)}`);
    const j = await fetchJson(url, { cache: 'no-store' });
    state.ui.lastProviderStatus = j || null;

    const pre = $('#health-json');
    if (pre && isDevMode() && state.ui.lastHealth) {
      setText(pre, JSON.stringify({ ...state.ui.lastHealth, provider_status: state.ui.lastProviderStatus }, null, 2));
    }

    if (!silent) {
      const provider = String(j?.provider || 'online');
      if (j?.connected) toast('success', 'Provider reachable', `${provider} is connected`);
      else toast('error', 'Provider not connected', String(j?.detail || 'connection_failed'));
      logLine(`provider_status: mode=${j?.mode || mode} provider=${provider} connected=${j?.connected ? 'yes' : 'no'} detail=${j?.detail || '-'}`);
    }
    return Boolean(j?.connected);
  } catch (e) {
    if (!silent) {
      toast('error', 'Provider check failed', String(e?.message || e));
      logLine(`provider_status_failed: ${String(e?.message || e)}`);
    }
    return false;
  }
}

function isPdfFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return name.endsWith('.pdf') || type === 'application/pdf';
}

async function deletePdfSession() {
  const displayId = String(state.manual.sessionId || '').trim();
  const baseId = String(state.manual.baseSessionId || '').trim();
  const ids = Array.from(new Set([displayId, baseId].filter(Boolean)));

  state.manual.sessionId = null;
  state.manual.originalName = null;
  state.manual.baseSessionId = null;
  state.manual.baseOriginalName = null;
  state.manual.pages = 0;
  state.manual.pageSignals = [];
  state.manual.boxes = [];
  for (const id of ids) {
    try {
      const url = joinUrl(state.apiBase, `/api/pdf/session/${encodeURIComponent(id)}`);
      await fetchJson(url, { method: 'DELETE' });
    } catch {
      // Best-effort; session cleanup is optional.
    }
  }
}

async function clearManualSessionSlot(slot) {
  const isBase = String(slot || '').toLowerCase() === 'base';
  const idField = isBase ? 'baseSessionId' : 'sessionId';
  const keyField = isBase ? 'baseOriginalName' : 'originalName';
  const otherIdField = isBase ? 'sessionId' : 'baseSessionId';
  const id = String(state.manual[idField] || '').trim();
  const otherId = String(state.manual[otherIdField] || '').trim();

  state.manual[idField] = null;
  state.manual[keyField] = null;
  if (!id || id === otherId) return;

  try {
    const url = joinUrl(state.apiBase, `/api/pdf/session/${encodeURIComponent(id)}`);
    await fetchJson(url, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup.
  }
}

function destroyPreviewUrl() {
  try {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  } catch { }
  state.previewUrl = null;
}

function ensurePreviewUrl() {
  if (state.previewUrl) return state.previewUrl;
  if (!state.file || !isPdfFile(state.file)) return null;
  try {
    state.previewUrl = URL.createObjectURL(state.file);
  } catch {
    state.previewUrl = null;
  }
  return state.previewUrl;
}

function renderPreviewUi() {
  const wrap = $('#pdf-preview-wrap');
  const panel = $('#pdf-preview');
  const btn = $('#btn-toggle-preview');
  const frame = $('#pdf-frame');
  if (!wrap || !panel || !btn || !frame) return;

  const pdf = Boolean(state.file && isPdfFile(state.file));
  if (!pdf) {
    hide(wrap);
    state.previewOpen = false;
    destroyPreviewUrl();
    frame.src = 'about:blank';
    return;
  }

  show(wrap);
  btn.textContent = state.previewOpen ? 'Hide' : 'Show';

  if (state.previewOpen) {
    const url = ensurePreviewUrl();
    show(panel);
    frame.src = url || 'about:blank';
  } else {
    hide(panel);
    frame.src = 'about:blank';
  }
}

function hasTermsConsentForMode(mode) {
  const normalized = normalizeModelMode(mode);
  if (!state.terms.accepted) return false;
  if (normalized === 'online' && !state.terms.onlineAccepted) return false;
  return true;
}

function openTermsModal({ online = false } = {}) {
  const modal = $('#tos-modal');
  if (!modal) return;
  state.terms.requiresOnline = Boolean(online);
  const note = $('#tos-mode-note');
  if (note) {
    note.textContent = online
      ? 'Online mode selected: this run uses public-facing hosted APIs.'
      : 'You must agree to continue using this demo.';
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-lock');
}

function closeTermsModal() {
  const modal = $('#tos-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-lock');
}

function requireTerms({ online = false, onAccept = null } = {}) {
  state.terms.onAccept = typeof onAccept === 'function' ? onAccept : null;
  openTermsModal({ online });
}

function acceptTerms() {
  state.terms.accepted = true;
  if (state.terms.requiresOnline) state.terms.onlineAccepted = true;
  const cb = state.terms.onAccept;
  state.terms.onAccept = null;
  closeTermsModal();
  if (typeof cb === 'function') cb();
}

function trackAnalyzeCleanupRef(ref) {
  const id = String(ref || '').trim();
  if (!/^ar_[A-Za-z0-9_]+$/.test(id)) return;
  if (!(state.cleanupRefs instanceof Set)) state.cleanupRefs = new Set();
  state.cleanupRefs.add(id);
}

function flushAnalyzeResultCleanup() {
  const refs = state.cleanupRefs instanceof Set ? Array.from(state.cleanupRefs) : [];
  if (!refs.length) return;
  const url = joinUrl(state.apiBase, '/api/delete-analyze-result');
  const payload = JSON.stringify({ refs });
  let sent = false;
  try {
    if (navigator?.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      sent = navigator.sendBeacon(url, blob);
    }
  } catch { }
  if (!sent) {
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        cache: 'no-store',
      }).catch(() => { });
    } catch { }
  }
  if (state.cleanupRefs instanceof Set) state.cleanupRefs.clear();
}

function openRedactModal() {
  const modal = $('#redact-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeRedactModal() {
  const modal = $('#redact-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function pageSignalFor(pageNo) {
  const n = Number(pageNo || 0) || 0;
  return (Array.isArray(state.manual.pageSignals) ? state.manual.pageSignals : []).find((p) => Number(p?.page || 0) === n) || null;
}

function setManualPage(pageNo) {
  const n = Math.max(1, Number(pageNo || 1));
  state.manual.currentPage = n;
  setText($('#redact-page'), String(n));
}

function setManualPages(total) {
  const n = Math.max(0, Number(total || 0));
  state.manual.pages = n;
  setText($('#redact-pages'), n ? String(n) : '—');
}

function normalizeRedactionCandidate(raw) {
  const kind = String(raw?.kind || '').trim().toLowerCase();
  if (kind !== 'text' && kind !== 'box') return null;
  const page = Number(raw?.page || 0) || 0;
  if (!page) return null;
  const id = String(raw?.id || '').trim();
  if (!id) return null;
  const label = String(raw?.label || raw?.source || kind).trim() || kind;
  const source = String(raw?.source || 'policy').trim().toLowerCase() || 'policy';

  if (kind === 'box') {
    const bbox = Array.isArray(raw?.bbox) && raw.bbox.length === 4 ? raw.bbox.map(Number) : null;
    if (!bbox || bbox.some((v) => !Number.isFinite(v))) return null;
    return { id, source, kind, page, label, bbox, approved_default: raw?.approved_default !== false };
  }

  const text = String(raw?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { id, source, kind, page, label, text, approved_default: raw?.approved_default !== false };
}

function getDecisionMap() {
  const decisions = state.run?.redactionReview?.decisionsMap;
  if (decisions && typeof decisions === 'object') return decisions;
  return {};
}

function isCandidateApproved(candidate) {
  const decisions = getDecisionMap();
  const stored = decisions[String(candidate?.id || '')];
  if (stored === 'reject') return false;
  if (stored === 'approve') return true;
  return candidate?.approved_default !== false;
}

function getApprovedReviewCandidates() {
  const review = state.run?.redactionReview;
  const list = Array.isArray(review?.candidates) ? review.candidates : [];
  return list.filter((c) => isCandidateApproved(c));
}

function syncManualAiBoxesFromReview() {
  state.manual.aiBoxes = getApprovedReviewCandidates()
    .filter((c) => String(c?.kind || '') === 'box')
    .map((c) => ({
      candidate_id: c.id,
      source: c.source,
      page: Number(c.page || 0) || 0,
      bbox: Array.isArray(c.bbox) ? c.bbox.map(Number) : [],
      label: String(c.label || c.source || 'review'),
    }))
    .filter((b) => b.page && Array.isArray(b.bbox) && b.bbox.length === 4 && b.bbox.every((v) => Number.isFinite(v)));
}

function setCandidateDecision(candidateId, approved) {
  const review = state.run?.redactionReview;
  if (!review || !candidateId) return;
  if (!review.decisionsMap || typeof review.decisionsMap !== 'object') review.decisionsMap = {};
  review.decisionsMap[String(candidateId)] = approved ? 'approve' : 'reject';
  syncManualAiBoxesFromReview();
  renderEvidence();
  renderManualBoxList();
  renderManualBoxesOnPage();
  renderManualTextReviewList();
  hide($('#btn-download-manual'));
}

function applyRedactionReview(reviewPayload) {
  const candidates = (Array.isArray(reviewPayload?.candidates) ? reviewPayload.candidates : [])
    .map((c) => normalizeRedactionCandidate(c))
    .filter(Boolean);
  const decisionsMap = {};
  for (const c of candidates) decisionsMap[c.id] = c.approved_default === false ? 'reject' : 'approve';

  state.run.redactionReview = {
    summary: reviewPayload?.summary || { total: candidates.length, approved_default: candidates.length, by_kind: {}, by_source: {} },
    candidates,
    decisionsMap,
  };
  syncManualAiBoxesFromReview();
}

function resetReviewDecisionsToDefault() {
  const review = state.run?.redactionReview;
  const candidates = Array.isArray(review?.candidates) ? review.candidates : [];
  if (!review || !candidates.length) return;
  const defaults = {};
  for (const c of candidates) defaults[String(c.id)] = c?.approved_default === false ? 'reject' : 'approve';
  review.decisionsMap = defaults;
  syncManualAiBoxesFromReview();
  renderEvidence();
  renderManualBoxList();
  renderManualBoxesOnPage();
  renderManualTextReviewList();
  hide($('#btn-download-manual'));
}

function getReviewSummaryCounts() {
  const review = state.run?.redactionReview;
  const list = Array.isArray(review?.candidates) ? review.candidates : [];
  let approved = 0;
  let rejected = 0;
  for (const c of list) {
    if (isCandidateApproved(c)) approved++;
    else rejected++;
  }
  return { total: list.length, approved, rejected };
}

function getFilteredReviewCandidates() {
  const review = state.run?.redactionReview;
  const list = Array.isArray(review?.candidates) ? review.candidates : [];
  const filter = String(state.run?.reviewFilter || 'all').toLowerCase();
  if (filter === 'approved') return list.filter((c) => isCandidateApproved(c));
  if (filter === 'rejected') return list.filter((c) => !isCandidateApproved(c));
  return list;
}

function setReviewFilter(filter) {
  const next = String(filter || 'all').toLowerCase();
  state.run.reviewFilter = (next === 'approved' || next === 'rejected') ? next : 'all';
  state.run.reviewPage = 0;
  renderEvidence();
}

function shiftReviewPage(delta) {
  const filtered = getFilteredReviewCandidates();
  const pages = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));
  state.run.reviewPage = clamp((Number(state.run.reviewPage || 0) || 0) + Number(delta || 0), 0, pages - 1);
  renderEvidence();
}

function updateEvidenceControls() {
  const counts = getReviewSummaryCounts();
  const countsEl = $('#evidence-counts');
  if (countsEl) countsEl.textContent = `Approved: ${counts.approved} • Rejected: ${counts.rejected} • Total: ${counts.total}`;

  const summaryEl = $('#redact-review-summary');
  if (summaryEl) summaryEl.textContent = `Approved: ${counts.approved} • Rejected: ${counts.rejected} • Total: ${counts.total}`;

  const filtered = getFilteredReviewCandidates();
  const pageCount = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));
  state.run.reviewPage = clamp(Number(state.run.reviewPage || 0) || 0, 0, pageCount - 1);
  const pageLabel = $('#evidence-page');
  if (pageLabel) pageLabel.textContent = `Page ${state.run.reviewPage + 1} / ${pageCount}`;

  const prev = $('#evidence-prev');
  const next = $('#evidence-next');
  if (prev) prev.disabled = state.run.reviewPage <= 0;
  if (next) next.disabled = state.run.reviewPage >= pageCount - 1;

  const f = String(state.run.reviewFilter || 'all');
  $('#evidence-filter-all')?.classList.toggle('active', f === 'all');
  $('#evidence-filter-approved')?.classList.toggle('active', f === 'approved');
  $('#evidence-filter-rejected')?.classList.toggle('active', f === 'rejected');
}

function renderManualTextReviewList() {
  const root = $('#redact-text-list');
  if (!root) return;
  root.innerHTML = '';

  const review = state.run?.redactionReview;
  const list = Array.isArray(review?.candidates) ? review.candidates.filter((c) => c.kind === 'text') : [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'muted text-sm';
    empty.textContent = 'No text redaction candidates from analysis.';
    root.appendChild(empty);
    return;
  }

  for (const c of list.slice(0, 80)) {
    const approved = isCandidateApproved(c);
    const row = document.createElement('div');
    row.className = 'evidence-item';
    row.dataset.approved = approved ? 'true' : 'false';

    const top = document.createElement('div');
    top.className = 'evidence-top';
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    const t1 = document.createElement('span');
    t1.className = 'tag';
    t1.textContent = String(c.label || c.source || 'text');
    const t2 = document.createElement('span');
    t2.className = 'tag';
    t2.textContent = `Page ${Number(c.page || 0) || 1}`;
    left.appendChild(t1);
    left.appendChild(t2);

    const actions = document.createElement('div');
    actions.className = 'decision-actions';
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = `decision-btn ${approved ? 'active-approve' : ''}`;
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => setCandidateDecision(c.id, true));
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = `decision-btn ${approved ? '' : 'active-reject'}`;
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => setCandidateDecision(c.id, false));
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    top.appendChild(left);
    top.appendChild(actions);
    row.appendChild(top);

    const body = document.createElement('div');
    body.className = 'mt-3 text-sm text-neutral-300';
    body.textContent = String(c.text || '').slice(0, 280) || '—';
    row.appendChild(body);
    root.appendChild(row);
  }
}

function renderManualBoxList() {
  const root = $('#redact-box-list');
  if (!root) return;
  root.innerHTML = '';

  const manualBoxes = Array.isArray(state.manual.boxes) ? state.manual.boxes : [];
  const aiBoxes = Array.isArray(state.manual.aiBoxes) ? state.manual.aiBoxes : [];
  const boxes = [...aiBoxes.map((b) => ({ ...b, _from: 'ai' })), ...manualBoxes.map((b) => ({ ...b, _from: 'manual' }))];
  if (!boxes.length) {
    const empty = document.createElement('div');
    empty.className = 'muted text-sm';
    empty.textContent = 'No approved boxes yet. Drag on the page to add one manually.';
    root.appendChild(empty);
    renderManualTextReviewList();
    return;
  }

  for (const [idx, b] of boxes.entries()) {
    const row = document.createElement('div');
    row.className = 'evidence-item';
    const top = document.createElement('div');
    top.className = 'evidence-top';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `Page ${Number(b?.page || 0) || 1}`;
    const src = document.createElement('span');
    src.className = 'tag';
    src.textContent = b._from === 'ai' ? `AI:${String(b?.source || 'review')}` : 'manual';
    const txt = document.createElement('span');
    txt.className = 'text-sm muted';
    const bb = Array.isArray(b?.bbox) ? b.bbox : [];
    txt.textContent = bb.length === 4 ? bb.map((v) => Number(v).toFixed(1)).join(', ') : '—';
    if (!isDevMode()) txt.textContent = `Box ${idx + 1}`;
    left.appendChild(tag);
    left.appendChild(src);
    left.appendChild(txt);

    top.appendChild(left);
    if (b._from === 'manual') {
      const manualIndex = idx - aiBoxes.length;
      const rm = document.createElement('button');
      rm.className = 'btn-tertiary';
      rm.type = 'button';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        state.manual.boxes = manualBoxes.filter((_x, i) => i !== manualIndex);
        renderManualBoxList();
        renderManualBoxesOnPage();
      });
      top.appendChild(rm);
    } else {
      const badge = document.createElement('span');
      badge.className = 'tag';
      badge.textContent = 'approved';
      top.appendChild(badge);
    }
    row.appendChild(top);
    root.appendChild(row);
  }
  renderManualTextReviewList();
}

function renderManualBoxesOnPage() {
  const layer = $('#redact-box-layer');
  const img = $('#redact-img');
  if (!layer || !img) return;
  layer.innerHTML = '';

  const sig = pageSignalFor(state.manual.currentPage);
  const pageW = Number(sig?.width || 0) || 0;
  const pageH = Number(sig?.height || 0) || 0;
  if (!pageW || !pageH) return;

  const manualBoxes = Array.isArray(state.manual.boxes) ? state.manual.boxes : [];
  const aiBoxes = Array.isArray(state.manual.aiBoxes) ? state.manual.aiBoxes : [];
  const boxes = [
    ...aiBoxes.map((b) => ({ ...b, _from: 'ai' })),
    ...manualBoxes.map((b) => ({ ...b, _from: 'manual' })),
  ].filter((b) => Number(b?.page || 0) === state.manual.currentPage);
  if (!boxes.length) return;

  // Use rendered element size for mapping, so overlays stay aligned on resize.
  const rect = img.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  for (const [idx, b] of boxes.entries()) {
    const bb = Array.isArray(b?.bbox) ? b.bbox.map(Number) : null;
    if (!bb || bb.length !== 4 || bb.some((v) => !Number.isFinite(v))) continue;
    const [x0, y0, x1, y1] = bb;
    const left = (Math.min(x0, x1) / pageW) * w;
    const top = (Math.min(y0, y1) / pageH) * h;
    const width = (Math.abs(x1 - x0) / pageW) * w;
    const height = (Math.abs(y1 - y0) / pageH) * h;

    const div = document.createElement('div');
    div.className = `redact-box ${b._from === 'ai' ? 'redact-box-ai' : 'redact-box-manual'}`;
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.width = `${Math.max(2, width)}px`;
    div.style.height = `${Math.max(2, height)}px`;
    if (isDevMode()) {
      const badge = document.createElement('div');
      badge.className = 'redact-badge';
      badge.textContent = b._from === 'ai' ? `AI ${idx + 1}` : String(idx + 1);
      div.appendChild(badge);
    }
    layer.appendChild(div);
  }
}

async function createPdfSession() {
  if (!state.file || !isPdfFile(state.file)) throw new Error('pdf_required');

  // If we already have a session for this exact file (name+size), reuse it.
  const key = `${state.file.name}:${state.file.size}`;
  if (state.manual.sessionId && state.manual.originalName === key) return state.manual.sessionId;

  // Cleanup old display session if any.
  await clearManualSessionSlot('display');

  const form = new FormData();
  form.append('file', state.file);
  const url = joinUrl(state.apiBase, '/api/pdf/session');
  const res = await fetchJson(url, { method: 'POST', body: form });
  if (!res?.ok || !res?.id) throw new Error(res?.error || 'session_failed');

  state.manual.sessionId = String(res.id);
  state.manual.originalName = key;
  state.manual.pageSignals = Array.isArray(res?.page_signals) ? res.page_signals : [];
  setManualPages(Number(res?.pages || 0) || 0);
  return state.manual.sessionId;
}

async function createBasePdfSession() {
  if (!state.file || !isPdfFile(state.file)) throw new Error('pdf_required');
  const key = `${state.file.name}:${state.file.size}`;
  if (state.manual.baseSessionId && state.manual.baseOriginalName === key) return state.manual.baseSessionId;

  if (state.manual.sessionId && state.manual.originalName === key) {
    state.manual.baseSessionId = state.manual.sessionId;
    state.manual.baseOriginalName = key;
    return state.manual.baseSessionId;
  }

  await clearManualSessionSlot('base');

  const form = new FormData();
  form.append('file', state.file);
  const url = joinUrl(state.apiBase, '/api/pdf/session');
  const res = await fetchJson(url, { method: 'POST', body: form });
  if (!res?.ok || !res?.id) throw new Error(res?.error || 'session_failed');

  state.manual.baseSessionId = String(res.id);
  state.manual.baseOriginalName = key;
  return state.manual.baseSessionId;
}

async function createReviewDisplayPdfSession() {
  const rel = String(state.run?.redactedPdf?.url || '').trim();
  if (!rel) throw new Error('No generated redacted PDF available yet');
  const key = `redacted:${rel}`;
  if (state.manual.sessionId && state.manual.originalName === key) return state.manual.sessionId;

  await clearManualSessionSlot('display');

  const pdfUrl = joinUrl(state.apiBase, rel);
  const pdfRes = await fetch(pdfUrl, { cache: 'no-store' });
  if (!pdfRes.ok) throw new Error(`redacted_fetch_http_${pdfRes.status}`);
  const pdfBlob = await pdfRes.blob();
  if (!pdfBlob || !Number(pdfBlob.size || 0)) throw new Error('redacted_fetch_empty');

  const form = new FormData();
  form.append('file', pdfBlob, 'review-redacted.pdf');
  const url = joinUrl(state.apiBase, '/api/pdf/session');
  const res = await fetchJson(url, { method: 'POST', body: form });
  if (!res?.ok || !res?.id) throw new Error(res?.error || 'session_failed');

  state.manual.sessionId = String(res.id);
  state.manual.originalName = key;
  state.manual.pageSignals = Array.isArray(res?.page_signals) ? res.page_signals : [];
  setManualPages(Number(res?.pages || 0) || 0);
  return state.manual.sessionId;
}

async function renderManualPage(pageNo) {
  const id = String(state.manual.sessionId || '').trim();
  if (!id) throw new Error('missing_session');

  const url = joinUrl(state.apiBase, '/api/pdf/render-pages');
  const body = { id, pages: [pageNo], dpi: state.manual.dpi };
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res?.ok) throw new Error(res?.error || 'render_failed');

  const imgInfo = (Array.isArray(res?.images) ? res.images : []).find((i) => Number(i?.page || 0) === Number(pageNo));
  if (!imgInfo?.data_b64) throw new Error('render_no_image');

  const img = $('#redact-img');
  if (!img) return;
  img.src = `data:${imgInfo.mime || 'image/png'};base64,${imgInfo.data_b64}`;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('image_load_timeout')), 20000);
    img.onload = () => { clearTimeout(t); resolve(); };
    img.onerror = () => { clearTimeout(t); reject(new Error('image_load_failed')); };
  });

  renderManualBoxesOnPage();
}

function getHitRect() {
  const img = $('#redact-img');
  if (!img) return null;
  return img.getBoundingClientRect();
}

function startManualDrawing(clientX, clientY) {
  const rect = getHitRect();
  const layer = $('#redact-draw-layer');
  if (!rect || !layer) return;

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  state.manual.drawing = { x0: x, y0: y, x1: x, y1: y };

  layer.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'redact-box temp';
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `1px`;
  box.style.height = `1px`;
  layer.appendChild(box);
}

function updateManualDrawing(clientX, clientY) {
  const rect = getHitRect();
  const layer = $('#redact-draw-layer');
  if (!rect || !layer || !state.manual.drawing) return;

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  state.manual.drawing.x1 = x;
  state.manual.drawing.y1 = y;

  const x0 = Math.min(state.manual.drawing.x0, x);
  const y0 = Math.min(state.manual.drawing.y0, y);
  const w = Math.abs(x - state.manual.drawing.x0);
  const h = Math.abs(y - state.manual.drawing.y0);

  const box = layer.firstElementChild;
  if (!box) return;
  box.style.left = `${x0}px`;
  box.style.top = `${y0}px`;
  box.style.width = `${Math.max(1, w)}px`;
  box.style.height = `${Math.max(1, h)}px`;
}

function finishManualDrawing() {
  const drawing = state.manual.drawing;
  state.manual.drawing = null;
  const layer = $('#redact-draw-layer');
  if (layer) layer.innerHTML = '';
  if (!drawing) return;

  const imgRect = getHitRect();
  if (!imgRect) return;
  const w = imgRect.width || 1;
  const h = imgRect.height || 1;

  const x0px = clamp(Math.min(drawing.x0, drawing.x1), 0, w);
  const y0px = clamp(Math.min(drawing.y0, drawing.y1), 0, h);
  const x1px = clamp(Math.max(drawing.x0, drawing.x1), 0, w);
  const y1px = clamp(Math.max(drawing.y0, drawing.y1), 0, h);
  const boxW = x1px - x0px;
  const boxH = y1px - y0px;

  // Ignore accidental tiny drags
  if (boxW < 6 || boxH < 6) return;

  const sig = pageSignalFor(state.manual.currentPage);
  const pageW = Number(sig?.width || 0) || 0;
  const pageH = Number(sig?.height || 0) || 0;
  if (!pageW || !pageH) return;

  const x0 = (x0px / w) * pageW;
  const y0 = (y0px / h) * pageH;
  const x1 = (x1px / w) * pageW;
  const y1 = (y1px / h) * pageH;

  state.manual.boxes.push({ page: state.manual.currentPage, bbox: [x0, y0, x1, y1], label: 'manual' });
  renderManualBoxList();
  renderManualBoxesOnPage();
  hide($('#btn-download-manual'));
}

async function generateManualRedaction() {
  const id = String(state.manual.baseSessionId || state.manual.sessionId || '').trim();
  if (!id) return toast('error', 'No session', 'Open manual redaction after selecting a PDF');

  const review = state.run?.redactionReview;
  const hasReview = Boolean(review && Array.isArray(review?.candidates) && review.candidates.length);
  const approved = hasReview ? getApprovedReviewCandidates() : [];
  const approvedBoxes = approved
    .filter((c) => c.kind === 'box')
    .map((c) => ({ page: c.page, bbox: c.bbox, label: c.label || c.source || 'review', candidate_id: c.id }));
  const approvedTexts = approved
    .filter((c) => c.kind === 'text')
    .map((c) => ({ page: c.page, text: c.text, label: c.label || c.source || 'review', candidate_id: c.id }));
  const dedupeKey = (b) => `${Number(b?.page || 0)}|${Array.isArray(b?.bbox) ? b.bbox.map((v) => Number(v).toFixed(3)).join(',') : ''}|${String(b?.label || '').toLowerCase()}`;
  const mergedBoxes = [];
  const seenBox = new Set();
  for (const b of [...approvedBoxes, ...(Array.isArray(state.manual.boxes) ? state.manual.boxes : [])]) {
    const key = dedupeKey(b);
    if (!key || seenBox.has(key)) continue;
    seenBox.add(key);
    mergedBoxes.push(b);
  }

  const btn = $('#btn-generate-manual');
  btn && (btn.disabled = true);
  hide($('#btn-download-manual'));
  try {
    const url = joinUrl(state.apiBase, '/api/pdf/redact');
    const payload = hasReview
      ? {
        id,
        boxes: mergedBoxes,
        search_texts: approvedTexts,
        detect_pii: false,
        include_rules: false,
      }
      : {
        id,
        boxes: state.manual.boxes,
        detect_pii: true,
        include_rules: true,
      };
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res?.ok || !res?.redacted_pdf?.url) throw new Error(res?.error || 'redact_failed');

    const dl = $('#btn-download-manual');
    if (dl) {
      dl.href = joinUrl(state.apiBase, res.redacted_pdf.url);
      dl.download = '';
      show(dl);
    }
    const appliedBoxes = Number(res?.applied?.boxes_applied || 0) || 0;
    const appliedTexts = Number(res?.applied?.search_texts_applied || 0) || 0;
    toast('success', 'Redacted PDF ready', hasReview ? `Applied ${appliedBoxes} boxes + ${appliedTexts} text redactions` : 'Download manual redaction');
  } catch (e) {
    toast('error', 'Manual redaction failed', String(e?.message || e));
  } finally {
    btn && (btn.disabled = false);
  }
}

function openRulesDrawer() {
  const drawer = $('#rules-drawer');
  if (!drawer) return;
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeRulesDrawer() {
  const drawer = $('#rules-drawer');
  if (!drawer) return;
  drawer.classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
}

async function loadRules() {
  const hint = $('#rules-hint');
  if (hint) hint.textContent = `API: ${state.apiBase} • GET /api/redaction-rules`;
  const list = $('#rules-list');
  if (!list) return;

  list.innerHTML = '';
  try {
    const url = joinUrl(state.apiBase, '/api/redaction-rules');
    const j = await fetchJson(url, { cache: 'no-store' });
    const rules = Array.isArray(j?.rules) ? j.rules : [];
    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'muted text-sm';
      empty.textContent = 'No saved rules yet.';
      list.appendChild(empty);
      return;
    }
    for (const r of rules) {
      const row = document.createElement('div');
      row.className = 'evidence-item';
      const top = document.createElement('div');
      top.className = 'evidence-top';
      const left = document.createElement('div');
      left.className = 'flex items-center gap-2';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = String(r?.label || 'rule');
      const txt = document.createElement('span');
      txt.className = 'text-sm';
      txt.textContent = String(r?.text || '');
      left.appendChild(tag);
      left.appendChild(txt);

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-tertiary';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(String(r?.text || ''));
          toast('success', 'Copied', 'Rule text copied to clipboard');
        } catch {
          toast('error', 'Copy failed', 'Clipboard not available');
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-tertiary';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        const id = String(r?.id || '').trim();
        if (!id) return toast('error', 'Cannot remove', 'Missing rule id');
        const ok = confirm('Remove this redaction rule?\n\nIt will no longer be applied to future redacted PDFs.');
        if (!ok) return;
        try {
          const delUrl = joinUrl(state.apiBase, `/api/redaction-rules/${encodeURIComponent(id)}`);
          await fetchJson(delUrl, { method: 'DELETE' });
          toast('success', 'Removed', 'Rule removed');
          await loadRules();
        } catch (e) {
          toast('error', 'Remove failed', String(e?.message || e));
        }
      });

      actions.appendChild(copyBtn);
      actions.appendChild(removeBtn);

      top.appendChild(left);
      top.appendChild(actions);
      row.appendChild(top);
      list.appendChild(row);
    }
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'muted text-sm';
    err.textContent = `Failed to load rules: ${String(e?.message || e)}`;
    list.appendChild(err);
  }
}

async function saveRule() {
  const textEl = $('#rule-text');
  const labelEl = $('#rule-label');
  const text = String(textEl?.value || '').trim();
  const label = String(labelEl?.value || 'custom').trim();
  if (!text) {
    toast('error', 'Rule required', 'Enter text to redact');
    textEl?.focus();
    return;
  }

  try {
    const url = joinUrl(state.apiBase, '/api/redaction-rules');
    await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, label }),
    });
    toast('success', 'Saved rule', 'Will apply to future redacted PDFs');
    if (textEl) textEl.value = '';
    await loadRules();
  } catch (e) {
    toast('error', 'Save failed', String(e?.message || e));
  }
}

function renderEvidence() {
  const root = $('#evidence-list');
  if (!root) return;
  root.innerHTML = '';
  const list = getFilteredReviewCandidates();
  updateEvidenceControls();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'muted text-sm';
    empty.textContent = 'No redaction review candidates.';
    root.appendChild(empty);
    return;
  }

  const page = Number(state.run.reviewPage || 0) || 0;
  const start = page * REVIEW_PAGE_SIZE;
  const view = list.slice(start, start + REVIEW_PAGE_SIZE);

  for (const c of view) {
    const approved = isCandidateApproved(c);
    const card = document.createElement('div');
    card.className = 'evidence-item';
    card.dataset.approved = approved ? 'true' : 'false';

    const top = document.createElement('div');
    top.className = 'evidence-top';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = String(c?.label || c?.type || c?.source || 'evidence');
    const page = document.createElement('span');
    page.className = 'tag';
    page.textContent = `Page ${Number(c?.page || 0) || 1}`;
    const source = document.createElement('span');
    source.className = 'tag';
    source.textContent = String(c?.source || 'policy');
    left.appendChild(tag);
    left.appendChild(page);
    left.appendChild(source);

    const actions = document.createElement('div');
    actions.className = 'decision-actions';
    const approveBtn = document.createElement('button');
    approveBtn.className = `decision-btn ${approved ? 'active-approve' : ''}`;
    approveBtn.type = 'button';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => setCandidateDecision(c.id, true));
    const rejectBtn = document.createElement('button');
    rejectBtn.className = `decision-btn ${approved ? '' : 'active-reject'}`;
    rejectBtn.type = 'button';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => setCandidateDecision(c.id, false));
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    top.appendChild(left);
    top.appendChild(actions);
    card.appendChild(top);

    const body = document.createElement('div');
    body.className = 'mt-3 text-sm text-neutral-300';
    if (String(c?.kind || '').toLowerCase() === 'box') {
      const bb = Array.isArray(c?.bbox) ? c.bbox : [];
      body.textContent = bb.length === 4 ? `Box: ${bb.map((v) => Number(v).toFixed(2)).join(', ')}` : 'Box candidate';
    } else {
      body.textContent = String(c?.text || '').slice(0, 260) || '—';
    }
    card.appendChild(body);
    root.appendChild(card);
  }
}

function renderFinalReport(data) {
  state.run.meta = data?.meta || state.run.meta;
  state.run.guardian = data?.guardian || state.run.guardian;
  state.run.safety = data?.safety || state.run.safety;
  state.run.policy = data?.policy || state.run.policy;
  state.run.final = data?.final || state.run.final;
  state.run.redactedPdf = data?.redacted_pdf || null;
  trackAnalyzeCleanupRef(data?.analyze_cleanup_ref);
  if (data?.redaction_review) {
    applyRedactionReview(data.redaction_review);
  } else {
    const fallback = (Array.isArray(data?.policy?.citations) ? data.policy.citations : []).map((c, i) => ({
      id: `legacy_${i}_${Number(c?.page || 1)}`,
      source: 'policy',
      kind: 'text',
      page: Number(c?.page || 0) || 1,
      label: String(c?.type || 'policy'),
      text: String(c?.text || '').trim(),
      approved_default: true,
    })).filter((c) => c.text);
    state.run.redactionReview = {
      summary: { total: fallback.length, approved_default: fallback.length, by_kind: { text: fallback.length }, by_source: { policy: fallback.length } },
      candidates: fallback,
      decisionsMap: Object.fromEntries(fallback.map((c) => [c.id, 'approve'])),
    };
    syncManualAiBoxesFromReview();
  }

  updateMiniStats();
  updateHeroKpis();

  const policy = state.run.policy || {};
  const overall = policy.overall || policy.sensitivity || state.run.final?.label || data?.local?.label || '—';
  const rationale = policy.rationale || state.run.final?.reason || '—';
  setText($('#kpi-overall'), overall);
  setText($('#kpi-overall-sub'), rationale);
  setText($('#report-subtitle'), `${String(data?.document_path || 'document')} • ${overall}`);

  setText($('#kpi-pages'), String(state.run.meta?.pages ?? '—'));
  setText($('#kpi-images'), String(state.run.meta?.images ?? '—'));

  const piiTotal = Number(data?.pii?.summary?.total ?? data?.pii?.items?.length ?? 0) || 0;
  setText($('#kpi-pii-total'), String(piiTotal));

  const piiByType = data?.pii?.summary?.byType && typeof data.pii.summary.byType === 'object' ? data.pii.summary.byType : {};
  const piiTypes = Object.entries(piiByType)
    .sort((a, b) => (b[1]?.length || 0) - (a[1]?.length || 0))
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v.length || 0})`);
  setText($('#kpi-pii-types'), piiTypes.length ? piiTypes.join(', ') : 'No PII detected');

  const gFlags = Array.isArray(data?.guardian?.flags) ? data.guardian.flags : [];
  setText($('#kpi-guardian'), String(gFlags.length));
  setText($('#kpi-guardian-sub'), data?.guardian?.unsafe ? 'Unsafe flagged' : 'No unsafe flags');

  renderEvidence();
  renderManualTextReviewList();
  renderChips($('#safety-concerns'), Array.isArray(data?.safety?.categories) ? data.safety.categories : [], 'No safety concerns detected.');
  renderChips($('#guardian-flags'), gFlags, 'No guardian flags.');

  const dl = $('#btn-download-redacted');
  const url = data?.redacted_pdf?.url ? joinUrl(state.apiBase, data.redacted_pdf.url) : null;
  if (dl && url) {
    dl.href = url;
    dl.download = '';
    show(dl);
  } else {
    hide(dl);
  }

  try {
    setText($('#audit-json'), JSON.stringify(data, null, 2));
  } catch {
    setText($('#audit-json'), '');
  }

  show($('#report'));
  setPhase('final_done');
}

function bumpFlagCounts(flags) {
  const arr = Array.isArray(flags) ? flags : [];
  for (const f of arr) {
    const k = String(f);
    state.run.moderationFlags.set(k, (state.run.moderationFlags.get(k) || 0) + 1);
  }
}

function bumpPiiCounts(types) {
  const arr = Array.isArray(types) ? types : [];
  for (const t of arr) {
    const k = String(t);
    state.run.piiByType.set(k, (state.run.piiByType.get(k) || 0) + 1);
  }
}

function handleSseEvent(eventName, payload) {
  switch (eventName) {
    case 'status': {
      const phase = String(payload?.phase || '');
      if (phase) {
        setPhase(phase);
        logLine(`phase=${phase}`);
      }
      break;
    }
    case 'extract': {
      const meta = payload?.meta || {};
      state.run.meta = meta;
      setText($('#step-extract-sub'), 'Extraction complete');
      setText($('#mini-pages'), String(meta?.pages ?? '—'));
      setText($('#hero-kpi-pages'), String(meta?.pages ?? '—'));
      setText($('#hero-kpi-images'), String(meta?.images ?? '—'));
      logLine(`extract: pages=${meta?.pages ?? '—'} images=${meta?.images ?? '—'}`);
      const status = Array.isArray(payload?.status) ? payload.status : [];
      const cap = status.find((s) => String(s?.phase || '') === 'azure_di_page_cap_notice');
      if (cap?.detail) logLine(`azure_notice: ${String(cap.detail)}`);
      break;
    }
    case 'precheck': {
      const pages = Number(payload?.pages || 0) || 0;
      const images = Number(payload?.images || 0) || 0;
      setText($('#mini-pages'), pages ? String(pages) : '—');
      setText($('#hero-kpi-pages'), pages ? String(pages) : '—');
      setText($('#hero-kpi-images'), String(images));
      logLine(`precheck: pages=${pages} images=${images} scanned=${payload?.legibility?.isLikelyScanned ? 'yes' : 'no'}`);
      break;
    }
    case 'chunk_index': {
      const total = Number(payload?.total || 0) || 0;
      state.run.chunksTotal = total;
      setText($('#step-chunk-sub'), `Chunks: ${total || '—'}`);
      setProgress(0, total);
      logLine(`chunk_index: total=${total}`);
      break;
    }
    case 'chunk': {
      if (state.run.phase !== 'chunk_processing') setPhase('chunk_processing');
      const id = payload?.id;
      const page = payload?.page;
      setText($('#step-moderate-sub'), `Processing chunk ${id ?? '—'} (page ${page ?? '—'})`);
      break;
    }
    case 'moderation': {
      bumpFlagCounts(payload?.flags);
      updateMiniStats();
      logLine(`moderation: flags=${(payload?.flags || []).length} unsafe=${payload?.unsafe ? 'yes' : 'no'}`);
      break;
    }
    case 'chunk_pii': {
      const count = Number(payload?.count || 0) || 0;
      state.run.piiTotal += count;
      bumpPiiCounts(payload?.types);
      updateMiniStats();
      updateHeroKpis();
      logLine(`pii: +${count} types=${(payload?.types || []).join(', ') || '—'}`);
      break;
    }
    case 'progress': {
      const completed = Number(payload?.completed || 0) || 0;
      const total = Number(payload?.total || state.run.chunksTotal || 0) || 0;
      state.run.chunksCompleted = completed;
      state.run.chunksTotal = total;
      setProgress(completed, total);
      setText($('#progress-text'), `${completed} / ${total || 0}`);
      break;
    }
    case 'guardian': {
      state.run.guardian = payload;
      logLine(`guardian: flags=${(payload?.flags || []).length} unsafe=${payload?.unsafe ? 'yes' : 'no'}`);
      break;
    }
    case 'final': {
      logLine('final: received report');
      renderFinalReport(payload);
      break;
    }
    case 'error': {
      const msg = payload?.detail || payload?.error || 'unknown_error';
      toast('error', 'Processing error', String(msg));
      logLine(`error: ${String(msg)}`);
      setPhase('final_done');
      break;
    }
    case 'end': {
      logLine('done');
      break;
    }
    default: {
      // Keep logs small; show unknown events as a single line.
      logLine(`${eventName}`);
      break;
    }
  }
}

async function readSseStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buf.indexOf('\n\n');
      if (idx === -1) break;
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const lines = raw.split('\n').map((l) => l.trimEnd());
      let eventName = 'message';
      let dataLine = '';
      for (const l of lines) {
        if (l.startsWith('event:')) eventName = l.slice('event:'.length).trim();
        if (l.startsWith('data:')) dataLine += l.slice('data:'.length).trim();
      }
      let payload = {};
      if (dataLine) {
        try { payload = JSON.parse(dataLine); } catch { payload = { raw: dataLine }; }
      }
      onEvent(eventName, payload);
    }
  }
}

async function startAnalysis() {
  const file = state.file;
  if (!file) {
    toast('error', 'No file selected', 'Choose a PDF or DOCX to analyze');
    return;
  }

  const noImages = Boolean($('#no-images')?.checked);
  const temp = Number($('#temperature')?.value ?? 0) || 0;
  const modelMode = normalizeModelMode(state.ui.modelMode);
  if (!hasTermsConsentForMode(modelMode)) {
    requireTerms({ online: modelMode === 'online' });
    toast('error', 'Terms required', 'You must agree to the terms before using this demo.');
    return;
  }
  setText($('#hero-kpi-mode'), noImages ? 'Text-only' : 'Hybrid');

  resetRunUi();
  logLine(`upload: ${file.name} (${bytesToHuman(file.size)})`);
  logLine(`settings: no_images=${noImages ? 'true' : 'false'} temperature=${temp.toFixed(2)} model_mode=${modelMode}`);

  const btn = $('#btn-analyze');
  btn && (btn.disabled = true);

  try {
    const ok = await checkHealth();
    if (!ok) {
      toast('error', 'Backend offline', `Cannot reach ${state.apiBase}`);
    }
    if (modelMode === 'online') {
      const connected = await checkProviderStatus(true);
      if (!connected) {
        toast('error', 'Online provider not connected', 'Open Developer Mode and click Check Provider.');
      }
    }

    const form = new FormData();
    form.append('file', file);
    form.append('no_images', String(noImages));
    form.append('temperature', String(temp));
    form.append('model_mode', modelMode);

    setPhase('extract_start');

    const url = joinUrl(state.apiBase, '/api/process-stream');
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `HTTP ${res.status}`);
    }
    toast('success', 'Streaming started', 'Processing document…');
    await readSseStream(res.body, handleSseEvent);
  } catch (e) {
    toast('error', 'Request failed', String(e?.message || e));
    logLine(`request_failed: ${String(e?.message || e)}`);
  } finally {
    btn && (btn.disabled = false);
  }
}

function setFile(file) {
  // Clear any existing PDF object URL so it doesn't leak memory.
  destroyPreviewUrl();
  state.previewOpen = false;
  void deletePdfSession();
  state.manual.boxes = [];
  state.manual.aiBoxes = [];
  state.run.redactionReview = null;

  state.file = file || null;
  const row = $('#file-row');
  const name = $('#file-name');
  const size = $('#file-size');
  if (!file) {
    hide(row);
    setText(name, '—');
    setText(size, '—');
    renderPreviewUi();
    return;
  }
  show(row);
  setText(name, file.name);
  setText(size, bytesToHuman(file.size));

  renderPreviewUi();
}

function wireUi() {
  // API label
  setText($('#api-base-label'), `API: ${state.apiBase}`);

  // Mode toggle (Business by default; persists to localStorage)
  $('#btn-toggle-mode')?.addEventListener('click', toggleUiMode);
  applyUiMode();

  // Health
  setInterval(checkHealth, 6000);
  if (state.ui.modelMode === 'online') {
    void checkProviderStatus(true);
  }

  // Hero CTA scroll
  $('#btn-cta-start')?.addEventListener('click', () => {
    $('#analyzer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Temperature slider label
  const temp = $('#temperature');
  const tempVal = $('#temperature-value');
  const updateTemp = () => setText(tempVal, (Number(temp?.value ?? 0) || 0).toFixed(2));
  temp?.addEventListener('input', updateTemp);
  updateTemp();

  const modelMode = $('#model-mode');
  if (modelMode) {
    modelMode.value = state.ui.modelMode;
    modelMode.addEventListener('change', () => {
      const nextMode = normalizeModelMode(modelMode.value);
      const applyMode = () => {
        setModelMode(nextMode);
        toast('success', 'Model mode updated', state.ui.modelMode === 'local' ? 'Local/Offline mode selected' : 'Online API mode selected');
        if (state.ui.modelMode === 'online') {
          void checkProviderStatus(true);
        }
      };
      if (!hasTermsConsentForMode(nextMode)) {
        modelMode.value = state.ui.modelMode;
        requireTerms({ online: nextMode === 'online', onAccept: applyMode });
        return;
      }
      applyMode();
    });
  }

  $('#btn-check-provider')?.addEventListener('click', () => void checkProviderStatus(false));
  $('#btn-tos-agree')?.addEventListener('click', acceptTerms);

  // Dropzone / file selection
  const drop = $('#dropzone');
  const input = $('#file-input');
  const pick = () => {
    if (!hasTermsConsentForMode(state.ui.modelMode)) {
      requireTerms({ online: state.ui.modelMode === 'online' });
      return;
    }
    input?.click();
  };
  drop?.addEventListener('click', pick);
  drop?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  input?.addEventListener('change', () => {
    const f = input.files && input.files[0] ? input.files[0] : null;
    setFile(f);
  });

  const setDrag = (on) => drop?.classList.toggle('is-dragover', on);
  drop?.addEventListener('dragenter', (e) => { e.preventDefault(); setDrag(true); });
  drop?.addEventListener('dragover', (e) => { e.preventDefault(); setDrag(true); });
  drop?.addEventListener('dragleave', (e) => { e.preventDefault(); setDrag(false); });
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer?.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
    if (f) setFile(f);
  });

  // Buttons
  $('#btn-clear-file')?.addEventListener('click', () => {
    setFile(null);
    if (input) input.value = '';
  });
  $('#btn-analyze')?.addEventListener('click', () => void startAnalysis());
  $('#btn-clear-log')?.addEventListener('click', () => {
    state.ui.logBuffer = [];
    const log = $('#activity-log');
    if (log) log.innerHTML = '';
  });

  // Rules drawer open/close
  const openRules = async () => {
    openRulesDrawer();
    await loadRules();
    $('#rule-text')?.focus();
  };
  $('#btn-open-rules')?.addEventListener('click', () => void openRules());
  $('#btn-open-rules-2')?.addEventListener('click', () => void openRules());
  $('#btn-close-rules')?.addEventListener('click', closeRulesDrawer);
  $('#rules-overlay')?.addEventListener('click', closeRulesDrawer);
  $('#btn-save-rule')?.addEventListener('click', () => void saveRule());

  // ESC closes drawer (and doesn't trap the user in the menu)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      toggleUiMode();
      return;
    }
    if (e.key !== 'Escape') return;
    const rules = $('#rules-drawer');
    const redact = $('#redact-modal');
    if (rules && !rules.classList.contains('hidden')) return closeRulesDrawer();
    if (redact && !redact.classList.contains('hidden')) return closeRedactModal();
  });

  // PDF preview toggle
  $('#btn-toggle-preview')?.addEventListener('click', () => {
    state.previewOpen = !state.previewOpen;
    renderPreviewUi();
  });

  // Manual redaction modal
  const openManual = async ({ fromReport = false } = {}) => {
    try {
      if (!state.file) throw new Error('No file selected');
      if (!isPdfFile(state.file)) throw new Error('Manual redaction is only available for PDFs');
      openRedactModal();
      if (fromReport) {
        resetReviewDecisionsToDefault();
        setText($('#redact-hint'), 'Preparing generated redacted preview...');
        await createBasePdfSession();
        await createReviewDisplayPdfSession();
      } else {
        setText($('#redact-hint'), 'Preparing session...');
        await createPdfSession();
        state.manual.baseSessionId = state.manual.sessionId;
        state.manual.baseOriginalName = state.manual.originalName;
      }
      setManualPage(1);
      setText($('#redact-hint'), `Rendering page 1 • DPI ${state.manual.dpi}`);
      await renderManualPage(1);
      renderManualBoxList();
      if (fromReport) {
        setText($('#redact-hint'), 'Previewing generated redactions. Approve/reject candidates, add boxes, then Generate to rebuild from the original PDF.');
      } else {
        setText($('#redact-hint'), 'Drag to draw boxes. Click Generate when ready.');
      }
    } catch (e) {
      toast('error', 'Manual redaction unavailable', String(e?.message || e));
      closeRedactModal();
    }
  };

  $('#btn-open-manual-redact')?.addEventListener('click', () => void openManual({ fromReport: false }));
  $('#btn-open-manual-redact-report')?.addEventListener('click', () => void openManual({ fromReport: true }));
  $('#btn-close-redact')?.addEventListener('click', closeRedactModal);
  $('#redact-overlay')?.addEventListener('click', closeRedactModal);

  $('#btn-prev-page')?.addEventListener('click', async () => {
    const next = Math.max(1, state.manual.currentPage - 1);
    setManualPage(next);
    try { await renderManualPage(next); } catch (e) { toast('error', 'Render failed', String(e?.message || e)); }
  });
  $('#btn-next-page')?.addEventListener('click', async () => {
    const max = Math.max(1, state.manual.pages || 1);
    const next = Math.min(max, state.manual.currentPage + 1);
    setManualPage(next);
    try { await renderManualPage(next); } catch (e) { toast('error', 'Render failed', String(e?.message || e)); }
  });
  $('#btn-clear-boxes')?.addEventListener('click', () => {
    state.manual.boxes = [];
    renderManualBoxList();
    renderManualBoxesOnPage();
    hide($('#btn-download-manual'));
  });
  $('#btn-generate-manual')?.addEventListener('click', () => void generateManualRedaction());

  $('#evidence-filter-all')?.addEventListener('click', () => setReviewFilter('all'));
  $('#evidence-filter-approved')?.addEventListener('click', () => setReviewFilter('approved'));
  $('#evidence-filter-rejected')?.addEventListener('click', () => setReviewFilter('rejected'));
  $('#evidence-prev')?.addEventListener('click', () => shiftReviewPage(-1));
  $('#evidence-next')?.addEventListener('click', () => shiftReviewPage(1));

  // Drawing interactions
  const hit = $('#redact-hit');
  let drawingActive = false;
  hit?.addEventListener('pointerdown', (e) => {
    drawingActive = true;
    hit.setPointerCapture?.(e.pointerId);
    startManualDrawing(e.clientX, e.clientY);
  });
  hit?.addEventListener('pointermove', (e) => {
    if (!drawingActive) return;
    updateManualDrawing(e.clientX, e.clientY);
  });
  const end = (e) => {
    if (!drawingActive) return;
    drawingActive = false;
    try { hit.releasePointerCapture?.(e.pointerId); } catch { }
    finishManualDrawing();
  };
  hit?.addEventListener('pointerup', end);
  hit?.addEventListener('pointercancel', end);

  // Cleanup blob URL when leaving
  window.addEventListener('pagehide', () => {
    flushAnalyzeResultCleanup();
    destroyPreviewUrl();
    void deletePdfSession();
  });
  window.addEventListener('beforeunload', () => {
    flushAnalyzeResultCleanup();
    destroyPreviewUrl();
    void deletePdfSession();
  });
  window.addEventListener('resize', () => {
    // Keep manual redaction overlay aligned if the viewport size changes.
    renderManualBoxesOnPage();
  });

  // Initialize
  resetRunUi();
  renderPreviewUi();
  requireTerms({ online: state.ui.modelMode === 'online' });
}

wireUi();
