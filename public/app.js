const $ = (sel) => document.querySelector(sel);

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
    logBuffer: [],
    lastHealth: null,
    lastHealthError: null,
  },
  file: null,
  previewUrl: null,
  previewOpen: false,
  manual: {
    sessionId: null,
    originalName: null,
    pages: 0,
    pageSignals: [],
    currentPage: 1,
    boxes: [],
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
      if (state.ui.lastHealth) setText(healthPre, JSON.stringify(state.ui.lastHealth, null, 2));
      else if (state.ui.lastHealthError) setText(healthPre, String(state.ui.lastHealthError));
      else setText(healthPre, 'â€”');
    }
  }

  // Redaction overlays/list differ in dev mode (coords + labels).
  renderManualBoxList();
  renderManualBoxesOnPage();

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

function resetRunUi() {
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
  renderChips($('#safety-concerns'), []);
  renderChips($('#guardian-flags'), []);
  setText($('#audit-json'), '');
  hide($('#btn-download-redacted'));
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
    if (pre && isDevMode()) setText(pre, JSON.stringify(j, null, 2));
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

function isPdfFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return name.endsWith('.pdf') || type === 'application/pdf';
}

async function deletePdfSession() {
  const id = String(state.manual.sessionId || '').trim();
  if (!id) return;
  state.manual.sessionId = null;
  state.manual.pages = 0;
  state.manual.pageSignals = [];
  state.manual.boxes = [];
  try {
    const url = joinUrl(state.apiBase, `/api/pdf/session/${encodeURIComponent(id)}`);
    await fetchJson(url, { method: 'DELETE' });
  } catch {
    // Best-effort; session cleanup is optional.
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

function renderManualBoxList() {
  const root = $('#redact-box-list');
  if (!root) return;
  root.innerHTML = '';

  const boxes = Array.isArray(state.manual.boxes) ? state.manual.boxes : [];
  if (!boxes.length) {
    const empty = document.createElement('div');
    empty.className = 'muted text-sm';
    empty.textContent = 'No boxes yet. Drag on the page to add one.';
    root.appendChild(empty);
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
    const txt = document.createElement('span');
    txt.className = 'text-sm muted';
    const bb = Array.isArray(b?.bbox) ? b.bbox : [];
    txt.textContent = bb.length === 4 ? bb.map((v) => Number(v).toFixed(1)).join(', ') : '—';
    if (!isDevMode()) txt.textContent = `Box ${idx + 1}`;
    left.appendChild(tag);
    left.appendChild(txt);

    const rm = document.createElement('button');
    rm.className = 'btn-tertiary';
    rm.type = 'button';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => {
      state.manual.boxes = boxes.filter((_x, i) => i !== idx);
      renderManualBoxList();
      renderManualBoxesOnPage();
    });

    top.appendChild(left);
    top.appendChild(rm);
    row.appendChild(top);
    root.appendChild(row);
  }
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

  const boxes = (Array.isArray(state.manual.boxes) ? state.manual.boxes : []).filter((b) => Number(b?.page || 0) === state.manual.currentPage);
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
    div.className = 'redact-box';
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.width = `${Math.max(2, width)}px`;
    div.style.height = `${Math.max(2, height)}px`;
    if (isDevMode()) {
      const badge = document.createElement('div');
      badge.className = 'redact-badge';
      badge.textContent = String(idx + 1);
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

  // Cleanup old session if any.
  await deletePdfSession();

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
}

async function generateManualRedaction() {
  const id = String(state.manual.sessionId || '').trim();
  if (!id) return toast('error', 'No session', 'Open manual redaction after selecting a PDF');

  const btn = $('#btn-generate-manual');
  btn && (btn.disabled = true);
  hide($('#btn-download-manual'));
  try {
    const url = joinUrl(state.apiBase, '/api/pdf/redact');
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        boxes: state.manual.boxes,
        detect_pii: true,
        include_rules: true,
      }),
    });
    if (!res?.ok || !res?.redacted_pdf?.url) throw new Error(res?.error || 'redact_failed');

    const dl = $('#btn-download-manual');
    if (dl) {
      dl.href = joinUrl(state.apiBase, res.redacted_pdf.url);
      dl.download = '';
      show(dl);
    }
    toast('success', 'Redacted PDF ready', 'Download manual redaction');
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

function renderEvidence(citations) {
  const root = $('#evidence-list');
  if (!root) return;
  root.innerHTML = '';
  const list = Array.isArray(citations) ? citations : [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'muted text-sm';
    empty.textContent = 'No citations provided.';
    root.appendChild(empty);
    return;
  }

  for (const c of list.slice(0, 12)) {
    const card = document.createElement('div');
    card.className = 'evidence-item';

    const top = document.createElement('div');
    top.className = 'evidence-top';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = String(c?.type || 'evidence');
    const page = document.createElement('span');
    page.className = 'tag';
    page.textContent = `Page ${Number(c?.page || 0) || 1}`;
    left.appendChild(tag);
    left.appendChild(page);

    const btn = document.createElement('button');
    btn.className = 'btn-tertiary';
    btn.type = 'button';
    btn.textContent = 'Remember redaction';
    btn.addEventListener('click', () => {
      openRulesDrawer();
      const textEl = $('#rule-text');
      const labelEl = $('#rule-label');
      if (textEl) textEl.value = String(c?.text || '').trim();
      if (labelEl) {
        const t = String(c?.type || '').toLowerCase();
        const suggest = t.includes('ssn') ? 'ssn'
          : t.includes('address') ? 'address'
          : t.includes('phone') ? 'phone'
          : t.includes('email') ? 'email'
          : t.includes('name') ? 'name'
          : 'custom';
        labelEl.value = suggest;
      }
      void loadRules();
    });

    top.appendChild(left);
    top.appendChild(btn);
    card.appendChild(top);

    const body = document.createElement('div');
    body.className = 'mt-3 text-sm text-neutral-300';
    body.textContent = String(c?.text || '').slice(0, 260) || '—';
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

  renderEvidence(Array.isArray(policy.citations) ? policy.citations : []);
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
  setText($('#hero-kpi-mode'), noImages ? 'Text-only' : 'Hybrid');

  resetRunUi();
  logLine(`upload: ${file.name} (${bytesToHuman(file.size)})`);
  logLine(`settings: no_images=${noImages ? 'true' : 'false'} temperature=${temp.toFixed(2)}`);

  const btn = $('#btn-analyze');
  btn && (btn.disabled = true);

  try {
    const ok = await checkHealth();
    if (!ok) {
      toast('error', 'Backend offline', `Cannot reach ${state.apiBase}`);
    }

    const form = new FormData();
    form.append('file', file);
    form.append('no_images', String(noImages));
    form.append('temperature', String(temp));

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

  // Dropzone / file selection
  const drop = $('#dropzone');
  const input = $('#file-input');
  const pick = () => input?.click();
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
  const openManual = async () => {
    try {
      if (!state.file) throw new Error('No file selected');
      if (!isPdfFile(state.file)) throw new Error('Manual redaction is only available for PDFs');
      openRedactModal();
      setText($('#redact-hint'), 'Preparing session…');
      await createPdfSession();
      setManualPage(1);
      setText($('#redact-hint'), `Rendering page 1 • DPI ${state.manual.dpi}`);
      await renderManualPage(1);
      renderManualBoxList();
      setText($('#redact-hint'), 'Drag to draw boxes. Click Generate when ready.');
    } catch (e) {
      toast('error', 'Manual redaction unavailable', String(e?.message || e));
      closeRedactModal();
    }
  };

  $('#btn-open-manual-redact')?.addEventListener('click', () => void openManual());
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
  window.addEventListener('beforeunload', () => { destroyPreviewUrl(); void deletePdfSession(); });
  window.addEventListener('resize', () => {
    // Keep manual redaction overlay aligned if the viewport size changes.
    renderManualBoxesOnPage();
  });

  // Initialize
  resetRunUi();
  renderPreviewUi();
}

wireUi();
