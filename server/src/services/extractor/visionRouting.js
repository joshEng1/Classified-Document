import { getPdfSignals, renderPdfPages, renderPdfRegions } from './doclingAdapter.js';
import { analyzeVisionImage } from '../vision/visionClient.js';

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(v, def) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'y', 'on'].includes(v.toLowerCase());
  return def;
}

function buildPageTextsFromBlocks(blocks, pages) {
  const arr = Array.from({ length: Math.max(1, pages || 1) }, () => '');
  for (const b of blocks || []) {
    const p = Math.max(1, Number(b?.page || 1));
    const idx = Math.min(arr.length - 1, p - 1);
    const t = String(b?.text || '').trim();
    if (!t) continue;
    arr[idx] += (arr[idx] ? '\n' : '') + t;
  }
  return arr;
}

function pickFigureRegions(pageSignals, opts) {
  const minArea = opts.minRegionAreaPct;
  const maxPerPage = opts.maxRegionsPerPage;
  const out = [];

  for (const sig of pageSignals || []) {
    const boxes = Array.isArray(sig?.image_boxes) ? sig.image_boxes : [];
    if (!boxes.length) continue;

    const picked = boxes
      .filter(b => Number(b?.area_pct || 0) >= minArea)
      .sort((a, b) => Number(b?.area_pct || 0) - Number(a?.area_pct || 0))
      .slice(0, maxPerPage);

    for (let i = 0; i < picked.length; i++) {
      const bbox = picked[i]?.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4) continue;
      out.push({
        id: `p${sig.page}_fig${i}`,
        page: sig.page,
        bbox,
        kind: 'figure',
        area_pct: picked[i]?.area_pct || 0,
      });
    }
  }
  return out;
}

export async function augmentWithVision({ filePath, blocks, meta }) {
  const enabled = bool(process.env.VISION_ENABLE, true) && Boolean(process.env.VISION_URL || process.env.LLAMA_VISION_URL);
  if (!enabled) return { enabled: false, page_signals: [], routed: [], regions: [], redaction_boxes: [], markdown: '' };

  const imageCoverageThreshold = num(process.env.VISION_IMAGE_COVERAGE_THRESHOLD, 0.25);
  const figureCountThreshold = num(process.env.VISION_FIGURE_COUNT_THRESHOLD, 1);
  const minTextCharsWithFigures = num(process.env.VISION_MIN_TEXT_CHARS_WITH_FIGURES, 200);
  const maxPages = num(process.env.VISION_MAX_PAGES, 12);
  const cropFigures = bool(process.env.VISION_CROP_FIGURES, true);
  const renderDpi = Math.round(num(process.env.VISION_RENDER_DPI, 220));
  const maxRegionsPerPage = Math.round(num(process.env.VISION_MAX_REGIONS_PER_PAGE, 3));
  const minRegionAreaPct = num(process.env.VISION_MIN_REGION_AREA_PCT, 0.03);
  const minTotalRegionAreaPct = num(process.env.VISION_MIN_TOTAL_REGION_AREA_PCT, 0.15);

  const signals = await getPdfSignals({ filePath });
  const pageSignals = Array.isArray(signals?.page_signals) ? signals.page_signals : [];
  const totalPages = Number(signals?.pages || meta?.pages || pageSignals.length || 0);
  const sigByPage = new Map(pageSignals.map(s => [Number(s?.page || 0), s]));

  const pageTexts = buildPageTextsFromBlocks(blocks || [], totalPages);

  const routed = [];
  for (const sig of pageSignals) {
    const page = Number(sig?.page || 0);
    if (!page || page < 1) continue;
    if (routed.length >= maxPages) break;

    const pageTextLen = (pageTexts[page - 1] || '').trim().length;
    const missing = Boolean(sig?.figure_content_missing) || (Number(sig?.figure_count || 0) > 0 && pageTextLen < minTextCharsWithFigures);
    const imageCov = Number(sig?.image_coverage || 0);
    const figCount = Number(sig?.figure_count || 0);

    const reasons = [];
    if (imageCov >= imageCoverageThreshold) reasons.push('high_image_coverage');
    if (figCount >= figureCountThreshold) reasons.push('figure_count');
    if (missing) reasons.push('figure_content_missing');

    if (reasons.length) {
      routed.push({ page, reasons, signals: sig });
    }
  }

  if (!routed.length) {
    return { enabled: true, page_signals: pageSignals, routed: [], regions: [], redaction_boxes: [], markdown: '' };
  }

  const selectedSignals = routed.map(r => r.signals);
  let regions = [];
  let imagesById = new Map();

  if (cropFigures) {
    regions = pickFigureRegions(selectedSignals, { maxRegionsPerPage, minRegionAreaPct });
    if (regions.length) {
      const rendered = await renderPdfRegions({ filePath, regions, dpi: renderDpi });
      const imgs = Array.isArray(rendered?.images) ? rendered.images : [];
      for (const img of imgs) {
        if (img?.id && img?.data_b64) imagesById.set(String(img.id), img);
      }
    }
  }

  // If crops cover too little of the page (common for PDFs with many tiny image blocks),
  // also analyze the full page for routed pages.
  if (regions.length && imagesById.size > 0) {
    const areaByPage = new Map();
    for (const r of regions) {
      const p = Number(r?.page || 0);
      if (!p) continue;
      areaByPage.set(p, (areaByPage.get(p) || 0) + num(r?.area_pct || 0, 0));
    }
    const pagesNeedingFull = routed
      .map(r => r.page)
      .filter(p => (areaByPage.get(Number(p)) || 0) < minTotalRegionAreaPct);

    if (pagesNeedingFull.length) {
      const rendered = await renderPdfPages({ filePath, pages: pagesNeedingFull, dpi: renderDpi });
      const imgs = Array.isArray(rendered?.images) ? rendered.images : [];
      for (const img of imgs) {
        const id = `p${img.page}_full`;
        imagesById.set(id, { ...img, id });
        regions.push({
          id,
          page: img.page,
          bbox: (() => {
            const sig = sigByPage.get(Number(img.page));
            return sig?.width && sig?.height ? [0, 0, Number(sig.width), Number(sig.height)] : null;
          })(),
          kind: 'page',
        });
      }
    }
  }

  // Fallback: render full pages when no regions were found or region rendering failed
  if (!regions.length || imagesById.size === 0) {
    const pages = routed.map(r => r.page);
    const rendered = await renderPdfPages({ filePath, pages, dpi: renderDpi });
    const imgs = Array.isArray(rendered?.images) ? rendered.images : [];
    regions = imgs.map((img) => ({
      id: `p${img.page}_full`,
      page: img.page,
      bbox: (() => {
        const sig = sigByPage.get(Number(img.page));
        return sig?.width && sig?.height ? [0, 0, Number(sig.width), Number(sig.height)] : null;
      })(),
      kind: 'page',
    }));
    for (const img of imgs) {
      imagesById.set(`p${img.page}_full`, { ...img, id: `p${img.page}_full` });
    }
  }

  const regionResults = [];
  const redactionBoxes = [];

  for (const region of regions) {
    const img = imagesById.get(String(region.id));
    if (!img?.data_b64) continue;

    const analysis = await analyzeVisionImage({ imageBase64: img.data_b64 });
    const record = {
      id: String(region.id),
      page: Number(region.page),
      kind: region.kind,
      bbox: img?.bbox || region.bbox || null,
      analysis,
    };
    regionResults.push(record);

    const flags = analysis?.flags && typeof analysis.flags === 'object' ? analysis.flags : {};
    const unsafeByVision = Boolean(flags?.unsafe_child || flags?.hate || flags?.exploitative || flags?.violence || flags?.criminal || flags?.political_news || flags?.cyber_threat);
    const redact = Boolean(analysis?.sensitive || unsafeByVision);

    if (redact && record.page && Array.isArray(record.bbox) && record.bbox.length === 4) {
      redactionBoxes.push({ page: record.page, bbox: record.bbox, label: unsafeByVision ? 'vision_unsafe' : 'vision_sensitive' });
    }
  }

  const markdown = buildVisionMarkdown(regionResults);

  return {
    enabled: true,
    page_signals: pageSignals,
    routed,
    regions: regionResults,
    redaction_boxes: redactionBoxes,
    markdown,
  };
}

function buildVisionMarkdown(regionResults) {
  if (!Array.isArray(regionResults) || !regionResults.length) return '';
  const lines = [];
  lines.push('\n\n## Vision Supplements (selected figures/pages)\n');
  for (const r of regionResults) {
    const a = r.analysis || {};
    const flags = a?.flags && typeof a.flags === 'object' ? a.flags : {};
    const onFlags = Object.entries(flags).filter(([, v]) => Boolean(v)).map(([k]) => k);

    lines.push(`### Page ${r.page} (${r.kind})`);
    if (a.summary) lines.push(`Summary: ${String(a.summary).trim()}`);
    if (a.extracted_text) lines.push(`Extracted text: ${String(a.extracted_text).trim()}`.slice(0, 1200));
    if (onFlags.length) lines.push(`Flags: ${onFlags.join(', ')}`);
    if (a.rationale) lines.push(`Rationale: ${String(a.rationale).trim()}`);
    if (a.error) lines.push(`Vision error: ${String(a.error)}${a.status ? ` (${a.status})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
