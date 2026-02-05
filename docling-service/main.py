import io
import os
import json
import base64
import shutil
import subprocess
import tempfile
import logging
import re
import time
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse, Response

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Docling-compatible Extractor", version="0.1.0")

try:
    # Optional: real Docling if installed in the image
    from docling.document_converter import DocumentConverter  # type: ignore
    DOCILING_AVAILABLE = True
except Exception:
    DOCILING_AVAILABLE = False

CLI_AVAILABLE = bool(shutil.which(os.getenv("DOCLING_CLI", "docling")))

# --- Hybrid Vision Routing Helpers (signals/render/redaction) ---

PII_PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "ssn": re.compile(r"\b\d{3}[- ]?\d{2}[- ]?\d{4}\b"),
    # Loose phone matcher; best-effort for redaction overlays
    "phone": re.compile(r"\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b"),
    # Very loose CC matcher; refined below for word-group detection
    "credit_card_like": re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
    "dob": re.compile(r"\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b"),
}

STREET_TYPES = {
    "st",
    "street",
    "ave",
    "avenue",
    "rd",
    "road",
    "blvd",
    "boulevard",
    "ln",
    "lane",
    "dr",
    "drive",
    "ct",
    "court",
    "way",
    "ter",
    "terrace",
    "pl",
    "place",
}

_TRIM_CHARS = " \t\r\n,.;:()[]{}<>\"'"

def _safe_json_loads(s: Optional[str], default):
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default

def _clamp01(x: float) -> float:
    try:
        if x < 0:
            return 0.0
        if x > 1:
            return 1.0
        return float(x)
    except Exception:
        return 0.0

def _bbox_area(bbox) -> float:
    try:
        x0, y0, x1, y1 = bbox
        return max(0.0, float(x1) - float(x0)) * max(0.0, float(y1) - float(y0))
    except Exception:
        return 0.0

def _union_bbox(bboxes):
    xs0 = []
    ys0 = []
    xs1 = []
    ys1 = []
    for b in bboxes:
        try:
            x0, y0, x1, y1 = b
            xs0.append(float(x0))
            ys0.append(float(y0))
            xs1.append(float(x1))
            ys1.append(float(y1))
        except Exception:
            continue
    if not xs0:
        return None
    return [min(xs0), min(ys0), max(xs1), max(ys1)]

def _clean_word(w: str) -> str:
    if not w:
        return ""
    return str(w).strip(_TRIM_CHARS)

def _detect_pii_boxes_fitz_page(page) -> List[dict]:
    """
    Best-effort PII bbox detection from a PyMuPDF page, suitable for redaction overlays.

    This is intentionally conservative: it errs towards redacting obvious PII tokens
    (SSNs, emails, phone numbers, DOBs) and common credit-card layouts (4x 4-digit groups).
    """
    boxes: List[dict] = []

    # (x0, y0, x1, y1, word, block_no, line_no, word_no)
    words = page.get_text("words") or []
    words_sorted = sorted(words, key=lambda w: (w[5], w[6], w[7]))

    def add_box(page_no: int, bbox, label: str, value: str):
        b = _union_bbox([bbox])
        if not b:
            return
        key = (page_no, label, round(b[0], 1), round(b[1], 1), round(b[2], 1), round(b[3], 1), value[:32])
        # de-dupe by coarse rounding + prefix
        if not hasattr(add_box, "_seen"):
            add_box._seen = set()  # type: ignore
        if key in add_box._seen:  # type: ignore
            return
        add_box._seen.add(key)  # type: ignore
        boxes.append({"page": page_no, "bbox": b, "label": label, "value": value[:120]})

    page_no = int(page.number) + 1

    # 1) Single-token matches (email/ssn/dob/phone-ish)
    for w in words_sorted:
        bbox = w[0:4]
        raw = w[4] or ""
        token = _clean_word(raw)
        if not token:
            continue

        if PII_PATTERNS["email"].fullmatch(token):
            add_box(page_no, bbox, "email", token)
            continue

        if PII_PATTERNS["ssn"].search(token):
            add_box(page_no, bbox, "ssn", token)
            continue

        if PII_PATTERNS["dob"].search(token):
            add_box(page_no, bbox, "dob", token)
            continue

        # Phone is tricky: allow partials like "(555)" but prefer full match
        if PII_PATTERNS["phone"].search(token):
            add_box(page_no, bbox, "phone", token)
            continue

    # 2) Credit-card-like: 4 consecutive 4-digit groups on the same line
    four_digits = re.compile(r"^\d{4}$")
    i = 0
    while i < len(words_sorted):
        w = words_sorted[i]
        token = _clean_word(w[4] or "")
        if not four_digits.fullmatch(token):
            i += 1
            continue
        # require same (block,line) for grouping
        block_no = w[5]
        line_no = w[6]
        group = [w]
        j = i + 1
        while j < len(words_sorted) and len(group) < 4:
            wj = words_sorted[j]
            if wj[5] != block_no or wj[6] != line_no:
                break
            tj = _clean_word(wj[4] or "")
            if four_digits.fullmatch(tj):
                group.append(wj)
                j += 1
                continue
            break
        if len(group) == 4:
            b = _union_bbox([g[0:4] for g in group])
            if b:
                value = " ".join(_clean_word(g[4] or "") for g in group)
                add_box(page_no, b, "credit_card_like", value)
            i = j
            continue
        i += 1

    # 3) Address-like: leading number + street words + street type on same line
    i = 0
    while i < len(words_sorted):
        w = words_sorted[i]
        block_no = w[5]
        line_no = w[6]
        token = _clean_word(w[4] or "")
        if not token.isdigit() or len(token) > 6:
            i += 1
            continue
        # scan up to 8 tokens ahead on the same line for street type
        group = [w]
        found_type = False
        j = i + 1
        while j < len(words_sorted) and len(group) < 9:
            wj = words_sorted[j]
            if wj[5] != block_no or wj[6] != line_no:
                break
            tj = _clean_word(wj[4] or "")
            if not tj:
                j += 1
                continue
            group.append(wj)
            if tj.lower().rstrip(".") in STREET_TYPES:
                found_type = True
                break
            j += 1
        if found_type and len(group) >= 3:
            b = _union_bbox([g[0:4] for g in group])
            if b:
                value = " ".join(_clean_word(g[4] or "") for g in group)
                add_box(page_no, b, "address_like", value)
            i = j + 1
            continue
        i += 1

    # 4) Name-like: anchored on common field labels ("Name", "Applicant", etc.) on the same line.
    # This is intentionally conservative to avoid redacting arbitrary capitalized text in marketing docs.
    NAME_LABELS = {"name", "applicant", "employee", "customer"}
    NAME_SKIP = {"last", "first", "middle", "mi", "m.i"}

    def looks_like_name_token(tok: str) -> bool:
        if not tok:
            return False
        t = tok.strip()
        if any(ch.isdigit() for ch in t):
            return False
        if "@" in t:
            return False
        # Allow "Simmons," and "J."
        core = t.rstrip(".,")
        if not core:
            return False
        if len(core) == 1 and t.endswith(".") and core.isalpha() and core.isupper():
            return True
        return core[:1].isupper() and core[1:].islower() and core.isalpha()

    # Group by (block,line) for stable name extraction
    line_map = {}
    for w in words_sorted:
        key = (w[5], w[6])
        line_map.setdefault(key, []).append(w)

    for (_b, _l), line_words in line_map.items():
        toks = [_clean_word(w[4] or "") for w in line_words]
        toks_l = [t.lower() for t in toks]
        for idx, tl in enumerate(toks_l):
            if tl not in NAME_LABELS:
                continue
            # Find the first candidate token after the label
            j = idx + 1
            while j < len(toks):
                tlj = toks_l[j].strip("():,")
                if not tlj:
                    j += 1
                    continue
                if tlj in NAME_SKIP:
                    j += 1
                    continue
                # Skip punctuation-like tokens that sometimes get captured as words
                if tlj in {"(", ")", "-", "—"}:
                    j += 1
                    continue
                break
            if j >= len(toks):
                continue

            picked = []
            # Capture up to 4 tokens (Last, First, Middle/Initial)
            for k in range(j, min(len(toks), j + 5)):
                tk = toks[k]
                if not tk:
                    continue
                # Stop if we run into another label-ish section
                if toks_l[k] in NAME_LABELS:
                    break
                if looks_like_name_token(tk) or (tk.endswith(",") and looks_like_name_token(tk.rstrip(","))):
                    picked.append(line_words[k])
                    continue
                # If we already picked at least 2 name tokens, stop on non-name token
                if len(picked) >= 2:
                    break
            if len(picked) >= 2:
                b = _union_bbox([p[0:4] for p in picked])
                if b:
                    value = " ".join(_clean_word(p[4] or "") for p in picked)
                    add_box(page_no, b, "name", value)

    return boxes


def _compute_pdf_page_signals(pdf_bytes: bytes) -> dict:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        out_pages = []
        for i in range(doc.page_count):
            page = doc.load_page(i)
            rect = page.rect
            page_area = max(1.0, float(rect.width) * float(rect.height))
            image_boxes = []
            text_area = 0.0
            image_area = 0.0

            try:
                d = page.get_text("dict") or {}
                for b in d.get("blocks", []) or []:
                    bbox = b.get("bbox")
                    btype = b.get("type")
                    if not bbox or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                        continue
                    area = _bbox_area(bbox)
                    if btype == 0:
                        text_area += area
                    elif btype == 1:
                        image_area += area
                        image_boxes.append({"bbox": [float(v) for v in bbox], "area_pct": _clamp01(area / page_area)})
            except Exception:
                # If dict extraction fails, fall back to coarse image counts
                image_boxes = []
                text_area = 0.0
                image_area = 0.0

            text_pct = _clamp01(text_area / page_area)
            image_pct = _clamp01(image_area / page_area)
            non_text_pct = _clamp01(1.0 - text_pct)
            figure_count = len(image_boxes)
            # Heuristic: figure-heavy page but little detectable text
            figure_content_missing = bool(figure_count > 0 and text_pct < 0.05)

            out_pages.append(
                {
                    "page": i + 1,
                    "width": float(rect.width),
                    "height": float(rect.height),
                    "text_coverage": text_pct,
                    "image_coverage": image_pct,
                    "non_text_coverage": non_text_pct,
                    "figure_count": figure_count,
                    "figure_content_missing": figure_content_missing,
                    "image_boxes": image_boxes,
                }
            )

        return {"pages": doc.page_count, "page_signals": out_pages}
    finally:
        doc.close()

def _render_pdf_pages(pdf_bytes: bytes, pages: List[int], dpi: int) -> List[dict]:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        images = []
        for p in pages:
            if not isinstance(p, int) or p < 1 or p > doc.page_count:
                continue
            page = doc.load_page(p - 1)
            pix = page.get_pixmap(dpi=dpi)
            png_bytes = pix.tobytes("png")
            images.append({"page": p, "mime": "image/png", "data_b64": base64.b64encode(png_bytes).decode("ascii")})
        return images
    finally:
        doc.close()

def _render_pdf_regions(pdf_bytes: bytes, regions: List[dict], dpi: int) -> List[dict]:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        images = []
        for idx, r in enumerate(regions):
            try:
                page_no = int(r.get("page"))
                bbox = r.get("bbox")
                rid = r.get("id") or f"r{idx}"
                if page_no < 1 or page_no > doc.page_count:
                    continue
                if not bbox or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                    continue
                rect = fitz.Rect([float(v) for v in bbox])
                page = doc.load_page(page_no - 1)
                pix = page.get_pixmap(dpi=dpi, clip=rect)
                png_bytes = pix.tobytes("png")
                images.append(
                    {
                        "id": str(rid),
                        "page": page_no,
                        "bbox": [float(v) for v in bbox],
                        "mime": "image/png",
                        "data_b64": base64.b64encode(png_bytes).decode("ascii"),
                    }
                )
            except Exception:
                continue
        return images
    finally:
        doc.close()

def _apply_pdf_redactions(pdf_bytes: bytes, boxes: List[dict], detect_pii: bool, search_texts: List[dict]) -> dict:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        all_boxes: List[dict] = []
        if detect_pii:
            try:
                for i in range(doc.page_count):
                    page = doc.load_page(i)
                    all_boxes.extend(_detect_pii_boxes_fitz_page(page))
            except Exception as e:
                logger.warning(f"PII bbox detection failed: {e}")

        # Caller-provided bboxes (e.g., figure regions flagged by Granite Vision)
        if boxes:
            for b in boxes:
                try:
                    page_no = int(b.get("page"))
                    bbox = b.get("bbox")
                    label = b.get("label") or "custom"
                    if page_no < 1 or page_no > doc.page_count:
                        continue
                    if not bbox or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                        continue
                    all_boxes.append({"page": page_no, "bbox": [float(v) for v in bbox], "label": str(label)})
                except Exception:
                    continue

        # Caller-provided text queries (e.g., safety matches) resolved to bboxes via search.
        # NOTE: fitz.search_for is exact-string search; this is best-effort.
        if search_texts:
            for q in search_texts:
                try:
                    page_no = int(q.get("page"))
                    qtext = str(q.get("text") or "").strip()
                    label = str(q.get("label") or "match")
                    if not qtext:
                        continue
                    if page_no < 1 or page_no > doc.page_count:
                        continue
                    page = doc.load_page(page_no - 1)
                    rects = page.search_for(qtext)
                    for r in rects or []:
                        all_boxes.append(
                            {
                                "page": page_no,
                                "bbox": [float(r.x0), float(r.y0), float(r.x1), float(r.y1)],
                                "label": label,
                                "value": qtext[:120],
                            }
                        )
                except Exception:
                    continue

        # Apply redaction annotations
        per_page = {}
        for b in all_boxes:
            per_page.setdefault(int(b["page"]), []).append(b)

        for page_no, page_boxes in per_page.items():
            page = doc.load_page(page_no - 1)
            for b in page_boxes:
                try:
                    rect = fitz.Rect(b["bbox"])
                    page.add_redact_annot(rect, fill=(0, 0, 0))
                except Exception:
                    continue
            try:
                page.apply_redactions()
            except Exception:
                # If apply_redactions fails, continue; caller still gets original bytes
                pass

        out_bytes = doc.tobytes(garbage=4, deflate=True)
        return {"pdf_bytes": out_bytes, "boxes": all_boxes}
    finally:
        doc.close()

def _extract_with_docling(bytes_data: bytes, filename: Optional[str] = None):
    # Minimal safe wrapper around docling. Falls back on errors.
    try:
        suffix = ".pdf"
        try:
            if filename:
                _, ext = os.path.splitext(filename)
                if ext and ext.lower() in [".pdf", ".docx", ".doc"]:
                    suffix = ext
        except Exception:
            pass
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(bytes_data)
            tmp_path = tmp.name
        dc = DocumentConverter()
        res = dc.convert(tmp_path)
        # Prefer markdown or plain text representation
        text = ""
        try:
            text = res.document.export_to_markdown()
        except Exception:
            try:
                text = res.document.export_to_text()
            except Exception:
                text = ""
        # Blocks: collect paragraph/text nodes if available
        blocks: List[str] = []
        try:
            for sec in getattr(res.document, "sections", []) or []:
                for para in getattr(sec, "paragraphs", []) or []:
                    t = getattr(para, "text", None)
                    if t:
                        blocks.append(t)
        except Exception:
            pass
        pages = len(getattr(res, "pages", []) or [])
        os.unlink(tmp_path)
        return {
            "pages": pages,
            "text": text or "\n".join(blocks),
            "blocks": [{"text": b} for b in blocks][:200]
        }
    except Exception:
        return None

def _extract_with_docling_python(data: bytes, filename: str) -> dict:
    """
    Extract text from document using Docling Python API with standard pipeline.
    Uses DocumentConverter directly - no CLI, no VLM, just reliable document understanding.
    Supports both PDF and DOCX files with page tracking.
    """
    import io
    import tempfile
    import os
    
    # Set headless mode to avoid OpenGL requirements
    os.environ['QT_QPA_PLATFORM'] = 'offscreen'
    os.environ['MPLBACKEND'] = 'Agg'
    
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        
        # Configure for standard pipeline (no VLM). OCR/table extraction can be toggled via env.
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = os.getenv("DOCLING_OCR", "1") in ("1", "true", "True", "yes")
        pipeline_options.do_table_structure = os.getenv("DOCLING_TABLES", "1") in ("1", "true", "True", "yes")
        
        # Create converter with standard pipeline
        converter = DocumentConverter(
            format_options={
                "pdf": PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
        
        # Determine file extension from filename
        suffix = ".pdf"  # default
        try:
            if filename:
                _, ext = os.path.splitext(filename)
                if ext and ext.lower() in [".pdf", ".docx", ".doc"]:
                    suffix = ext.lower()
        except Exception:
            pass
        
        # Write bytes to temp file (Docling needs file path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        
        try:
            # Convert document
            result = converter.convert(tmp_path)
            doc = result.document
            
            # Export to markdown for structured text
            markdown_text = doc.export_to_markdown()
            
            # Extract blocks from document structure with page numbers
            blocks = []
            current_page = 1  # Track current page for documents without provenance
            
            for element in doc.iterate_items():
                if hasattr(element, 'text') and element.text.strip():
                    page_num = current_page  # Default to current page
                    
                    # Try to get page number from element's prov (provenance) - works for PDFs
                    if hasattr(element, 'prov') and element.prov:
                        for prov_item in element.prov:
                            if hasattr(prov_item, 'page_no'):
                                page_num = prov_item.page_no + 1  # Convert 0-indexed to 1-indexed
                                current_page = page_num  # Update current page tracker
                                break
                    
                    # For DOCX/DOC, estimate page breaks based on content length
                    # Approximate: ~3000 chars per page (typical for 12pt font, single-spaced)
                    if suffix in ['.docx', '.doc'] and not hasattr(element, 'prov'):
                        # Use cumulative character count to estimate pages
                        total_chars = sum(len(b.get('text', '')) for b in blocks)
                        estimated_page = (total_chars // 3000) + 1
                        page_num = estimated_page
                        current_page = estimated_page
                    
                    blocks.append({
                        "text": element.text.strip(),
                        "page": page_num
                    })
            
            # Get page count
            page_count = len(doc.pages) if hasattr(doc, 'pages') else max((b.get('page', 1) for b in blocks), default=1)
            
            return {
                "pages": page_count,
                "text": markdown_text,
                "blocks": blocks
            }
        finally:
            # Clean up temp file
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except Exception as e:
        logger.error(f"Docling Python API extraction error: {e}")
        return None

def _extract_with_pdfminer(bytes_data: bytes):
    from pdfminer.high_level import extract_text_to_fp
    output = io.StringIO()
    extract_text_to_fp(io.BytesIO(bytes_data), output)
    text = output.getvalue()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return {
        "pages": 0,
        "text": text,
        "blocks": [{"text": b} for b in _to_paragraphs(lines)][:200]
    }

def _to_paragraphs(lines: List[str]) -> List[str]:
    paras: List[str] = []
    buf: List[str] = []
    for ln in lines:
        if len(ln) <= 2 and buf:
            paras.append(" ".join(buf))
            buf = []
        else:
            buf.append(ln)
        if len(buf) >= 8:
            paras.append(" ".join(buf))
            buf = []
    if buf:
        paras.append(" ".join(buf))
    return paras

def _extract_with_docling_cli(bytes_data: bytes, filename: Optional[str] = None):
    """
    Invoke Docling CLI to convert the source to Markdown/JSON.
    Uses authoritative flags: --to, --pipeline, --ocr/--no-ocr, --pdf-backend, --tables/--no-tables, --output

    Note: Using 'standard' pipeline instead of 'vlm' to avoid model loading issues.
    VLM pipeline requires additional model files that may not be available.
    """
    cli = os.getenv("DOCLING_CLI", "docling")
    to_fmt = os.getenv("DOCLING_TO", "md")
    # Use standard pipeline by default (faster, more reliable)
    pipeline = os.getenv("DOCLING_PIPELINE", "standard")
    vlm_model = os.getenv("DOCLING_VLM_MODEL", "granite_docling")
    # OCR is the biggest performance lever for Docling.
    # Modes:
    # - DOCLING_OCR_MODE=on|off|auto (default auto)
    # - DOCLING_OCR=1|0 (legacy; used when DOCLING_OCR_MODE not set)
    ocr_mode = (os.getenv("DOCLING_OCR_MODE", "auto") or "auto").strip().lower()
    use_ocr = os.getenv("DOCLING_OCR", "1") in ("1", "true", "True", "yes")
    pdf_backend = os.getenv("DOCLING_PDF_BACKEND")
    use_tables = os.getenv("DOCLING_TABLES", "1") in ("1", "true", "True", "yes")
    # Avoid massive markdown outputs by default (Docling may embed base64 images).
    # We do NOT rely on embedded images for Vision (we render via /render-pages and /render-regions).
    image_export_mode = (os.getenv("DOCLING_IMAGE_EXPORT_MODE", "placeholder") or "placeholder").strip().lower()

    suffix = ".pdf"
    try:
        if filename:
            _, ext = os.path.splitext(filename)
            if ext and ext.lower() in [".pdf", ".docx", ".doc"]:
                suffix = ext
    except Exception:
        pass

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(bytes_data)
        tmp_path = tmp.name

    try:
        # Docling CLI writes outputs to files, not stdout. Always use a temp output directory and read back the artifact.
        with tempfile.TemporaryDirectory(prefix="docling_out_") as out_dir:
            args = [cli, "--to", to_fmt, "--output", out_dir, tmp_path]
            if pipeline:
                args += ["--pipeline", pipeline]
            if pipeline == "vlm" and vlm_model:
                # Optional: only applies to VLM pipeline
                args += ["--vlm-model", vlm_model]
            # Auto OCR heuristic: if the PDF already has selectable text, skip OCR (much faster).
            # For scanned PDFs, enable OCR.
            use_ocr_final = use_ocr
            if ocr_mode in ("on", "true", "1", "yes"):
                use_ocr_final = True
            elif ocr_mode in ("off", "false", "0", "no"):
                use_ocr_final = False
            elif ocr_mode == "auto":
                try:
                    if _pdf_has_selectable_text(bytes_data):
                        use_ocr_final = False
                except Exception:
                    # If auto-detection fails, fall back to DOCLING_OCR
                    use_ocr_final = use_ocr

            if use_ocr_final:
                args += ["--ocr"]
            else:
                args += ["--no-ocr"]
            if pdf_backend:
                args += ["--pdf-backend", pdf_backend]
            if use_tables:
                args += ["--tables"]
            else:
                args += ["--no-tables"]
            if image_export_mode in ("placeholder", "embedded", "referenced"):
                args += ["--image-export-mode", image_export_mode]

            t0 = time.time()
            proc = subprocess.run(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300,
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            if proc.returncode != 0:
                stderr = (proc.stderr or "").strip()
                raise RuntimeError(stderr[:1000] or "docling CLI failed")

            logger.info(
                f"docling_cli_ok to={to_fmt} pipeline={pipeline} ocr={use_ocr_final} tables={use_tables} image_export={image_export_mode} ms={elapsed_ms}"
            )

            # Prefer exact expected output path, otherwise fall back to first matching file in output dir.
            stem = "document"
            try:
                if filename:
                    stem = os.path.splitext(os.path.basename(filename))[0] or stem
                else:
                    stem = os.path.splitext(os.path.basename(tmp_path))[0] or stem
            except Exception:
                pass

            ext_map = {
                "md": ".md",
                "markdown": ".md",
                "json": ".json",
                "yaml": ".yaml",
                "yml": ".yml",
                "text": ".txt",
                "txt": ".txt",
                "doctags": ".doctags",
                "html": ".html",
                "html_split_page": ".html",
            }
            out_ext = ext_map.get((to_fmt or "md").strip().lower(), f".{(to_fmt or 'md').strip().lower()}")
            expected = os.path.join(out_dir, f"{stem}{out_ext}")
            candidates: List[str] = []
            try:
                if os.path.isfile(expected):
                    candidates = [expected]
                else:
                    candidates = sorted(
                        [
                            os.path.join(out_dir, f)
                            for f in os.listdir(out_dir)
                            if f.lower().endswith(out_ext.lower())
                        ]
                    )
            except Exception:
                candidates = []

            if not candidates:
                # Include a small amount of context to help debugging.
                dir_listing = ""
                try:
                    dir_listing = ", ".join(sorted(os.listdir(out_dir))[:30])
                except Exception:
                    dir_listing = ""
                raise RuntimeError(
                    f"docling_cli_no_output_file (to={to_fmt}, ext={out_ext}, out_dir_listing={dir_listing})"
                )

            with open(candidates[0], "r", encoding="utf-8", errors="replace") as f:
                output = f.read()

        # Determine pages best-effort
        pages = 0
        try:
            import fitz
            doc = fitz.open(tmp_path)
            pages = doc.page_count
            doc.close()
        except Exception:
            pages = 0
        text = output
        blocks = _to_paragraphs([ln.strip() for ln in output.splitlines()])
        return { "pages": pages, "text": text, "blocks": [{"text": b} for b in blocks][:200] }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def _pdf_has_selectable_text(data: bytes) -> bool:
    """
    Best-effort heuristic: return True if the PDF appears to contain real embedded text.
    This avoids enabling OCR on digital PDFs (OCR is expensive and usually unnecessary).
    """
    if not data or data[:4] != b"%PDF":
        return False
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        n = min(3, doc.page_count)
        total = 0
        for i in range(n):
            page = doc.load_page(i)
            total += len((page.get_text("text") or "").strip())
            if total >= 200:
                return True
        return total >= 200
    finally:
        doc.close()

def _guess_is_image(ext: str) -> bool:
    return ext.lower() in [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp"]

def _run_vlm_cli(cli, model, mmproj, image_path, prompt, ctx, temp, topk, topp) -> str:
    args = [cli, "-m", model, "--image", image_path, "-p", prompt, "--ctx-size", str(ctx), "--temp", str(temp), "--top-k", str(topk), "--top-p", str(topp), "--verbose"]
    if mmproj:
        args += ["--mmproj", mmproj]
    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[:500] or "vlm cli failed")
    return proc.stdout or ""

def _vlm_output_to_markdown(output: str, img_path: str) -> str:
    txt = (output or "").strip()
    try:
        from docling_core.types.doc.document import DocTagsDocument
        from docling_core.types.doc import DoclingDocument
        doctags = txt
        doc = DocTagsDocument.from_doctags_and_image_pairs([doctags], [img_path])
        ddoc = DoclingDocument.load_from_doctags(doc, document_name="Document")
        md = ddoc.export_to_markdown()
        if md and len(md.strip()) > 0:
            return md
    except Exception:
        pass
    return txt

def _extract_with_vlm_cli(bytes_data: bytes, filename: Optional[str] = None):
    cli = os.getenv("VLM_CLI")
    model = os.getenv("VLM_MODEL")
    if not cli or not model:
        raise RuntimeError("VLM_CLI and VLM_MODEL must be set for vlm_cli pipeline")
    mmproj = os.getenv("VLM_MMPROJ")
    prompt = os.getenv("VLM_PROMPT", "<__media__>Convert this page to docling.")
    ctx = int(os.getenv("VLM_CTX", "8192") or 8192)
    temp = float(os.getenv("VLM_TEMP", "0") or 0)
    topk = int(os.getenv("VLM_TOPK", "0") or 0)
    topp = float(os.getenv("VLM_TOPP", "1.0") or 1.0)
    dpi = int(os.getenv("VLM_DPI", "240") or 240)

    ext = ".pdf"
    try:
        if filename:
            _, e = os.path.splitext(filename)
            if e:
                ext = e
    except Exception:
        pass

    # If it's an image, run single pass
    if _guess_is_image(ext):
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(bytes_data)
            img_path = tmp.name
        try:
            out_txt = _run_vlm_cli(cli, model, mmproj, img_path, prompt, ctx, temp, topk, topp)
            text = _vlm_output_to_markdown(out_txt, img_path)
            return {"pages": 1, "text": text, "blocks": [{"text": t} for t in _to_paragraphs(text.splitlines())][:200]}
        finally:
            try: os.unlink(img_path)
            except Exception: pass

    # Else assume PDF
    import fitz  # PyMuPDF
    doc = fitz.open(stream=bytes_data, filetype="pdf")
    pages = doc.page_count
    md_pages: List[str] = []
    try:
        for i in range(pages):
            page = doc.load_page(i)
            pix = page.get_pixmap(dpi=dpi)
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as ptmp:
                img_path = ptmp.name
                pix.save(img_path)
            try:
                out_txt = _run_vlm_cli(cli, model, mmproj, img_path, prompt, ctx, temp, topk, topp)
                md = _vlm_output_to_markdown(out_txt, img_path)
                md_pages.append(md)
            finally:
                try: os.unlink(img_path)
                except Exception: pass
    finally:
        doc.close()

    text = ("\f".join(md_pages)).strip()
    blocks = _to_paragraphs([ln.strip() for ln in text.splitlines()])
    return {"pages": pages, "text": text, "blocks": [{"text": b} for b in blocks][:200]}

@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    """
    Extract text from an uploaded document.

    Pipeline selection via env:
      - EXTRACT_PIPELINE=docling_cli (default): prefer Docling CLI conversion (supports --ocr)
      - EXTRACT_PIPELINE=python: Docling Python API
      - EXTRACT_PIPELINE=vlm_cli: llama.cpp multimodal CLI fallback

    Returns JSON with pages, text, and structured blocks.
    """
    data = await file.read()

    pipeline = (os.getenv("EXTRACT_PIPELINE", "docling_cli") or "docling_cli").strip().lower()

    res = None

    # Prefer CLI when available (enables OCR via DOCLING_OCR=1)
    if pipeline in ("docling_cli", "cli") and CLI_AVAILABLE:
        try:
            res = _extract_with_docling_cli(data, file.filename)
        except Exception as e:
            logger.warning(f"Docling CLI extraction failed, falling back: {e}")
            res = None

    if res is None and pipeline in ("vlm_cli", "vlm") and os.getenv("VLM_CLI") and os.getenv("VLM_MODEL"):
        try:
            res = _extract_with_vlm_cli(data, file.filename)
        except Exception as e:
            logger.warning(f"VLM CLI extraction failed, falling back: {e}")
            res = None

    if res is None:
        # Python API (may disable OCR by default; see DOCLING_OCR env)
        try:
            res = _extract_with_docling_python(data, file.filename)
        except Exception as e:
            logger.warning(f"Docling Python API extraction failed, falling back: {e}")
            res = None

    if res is None:
        try:
            res = _extract_with_pdfminer(data)
        except Exception:
            res = None

    if res and (res.get("text") or res.get("blocks")):
        return JSONResponse(res)
    raise HTTPException(500, "Docling extraction failed")


@app.post("/signals")
async def signals(file: UploadFile = File(...)):
    """
    Return per-page layout signals needed for hybrid routing to Granite Vision.

    Signals:
      - image/text/non-text coverage (bbox density)
      - figure_count (image blocks)
      - figure_content_missing (heuristic: figures but low text coverage)
      - image_boxes bboxes for optional region-cropped Vision calls

    NOTE: This endpoint is PDF-focused. Non-PDF inputs will return 400.
    """
    data = await file.read()
    if not (data[:4] == b"%PDF"):
        raise HTTPException(400, "signals_only_supports_pdf")
    try:
        res = _compute_pdf_page_signals(data)
        return JSONResponse(res)
    except Exception as e:
        raise HTTPException(500, f"signals_failed: {str(e)[:200]}")


@app.post("/render-pages")
async def render_pages(
    file: UploadFile = File(...),
    pages: str = Form("[]"),
    dpi: int = Form(220),
):
    """
    Render requested PDF pages to PNG (base64) for downstream Granite Vision calls.

    Form fields:
      - pages: JSON array of 1-based page numbers, e.g. [1,3]
      - dpi: render DPI (default 220)
    """
    page_list = _safe_json_loads(pages, [])
    if not isinstance(page_list, list):
        raise HTTPException(400, "pages_must_be_json_array")

    dpi_int = int(dpi) if dpi else 220
    dpi_int = max(72, min(600, dpi_int))

    data = await file.read()
    if not (data[:4] == b"%PDF"):
        raise HTTPException(400, "render_only_supports_pdf")
    try:
        images = _render_pdf_pages(data, [int(p) for p in page_list if str(p).isdigit()], dpi_int)
        return JSONResponse({"images": images, "dpi": dpi_int})
    except Exception as e:
        raise HTTPException(500, f"render_pages_failed: {str(e)[:200]}")


@app.post("/render-regions")
async def render_regions(
    file: UploadFile = File(...),
    regions: str = Form("[]"),
    dpi: int = Form(220),
):
    """
    Render cropped PDF regions to PNG (base64) for figure-only Granite Vision calls.

    Form fields:
      - regions: JSON array of {id, page, bbox:[x0,y0,x1,y1]}
      - dpi: render DPI (default 220)
    """
    region_list = _safe_json_loads(regions, [])
    if not isinstance(region_list, list):
        raise HTTPException(400, "regions_must_be_json_array")

    dpi_int = int(dpi) if dpi else 220
    dpi_int = max(72, min(600, dpi_int))

    data = await file.read()
    if not (data[:4] == b"%PDF"):
        raise HTTPException(400, "render_only_supports_pdf")
    try:
        images = _render_pdf_regions(data, region_list, dpi_int)
        return JSONResponse({"images": images, "dpi": dpi_int})
    except Exception as e:
        raise HTTPException(500, f"render_regions_failed: {str(e)[:200]}")


@app.post("/redact")
async def redact(
    file: UploadFile = File(...),
    boxes: str = Form("[]"),
    search_texts: str = Form("[]"),
    detect_pii: str = Form("true"),
):
    """
    Burn-in redactions (black boxes) and return a redacted PDF.

    - detect_pii: when true, runs regex-based bbox detection on PDF text.
    - boxes: optional JSON array of {page, bbox:[x0,y0,x1,y1], label} for caller-provided regions
             (e.g., proprietary schematics figure boxes flagged via Granite Vision).
    """
    boxes_list = _safe_json_loads(boxes, [])
    if boxes_list is None or not isinstance(boxes_list, list):
        raise HTTPException(400, "boxes_must_be_json_array")

    search_list = _safe_json_loads(search_texts, [])
    if search_list is None or not isinstance(search_list, list):
        raise HTTPException(400, "search_texts_must_be_json_array")

    detect = str(detect_pii).lower() in ("1", "true", "yes", "y")
    data = await file.read()
    if not (data[:4] == b"%PDF"):
        raise HTTPException(400, "redact_only_supports_pdf")

    try:
        res = _apply_pdf_redactions(data, boxes_list, detect, search_list)
        pdf_bytes = res.get("pdf_bytes") or b""
        return Response(content=pdf_bytes, media_type="application/pdf")
    except Exception as e:
        raise HTTPException(500, f"redact_failed: {str(e)[:200]}")

@app.get("/health")
def health():
    extract_pipeline = os.getenv("EXTRACT_PIPELINE", "docling_cli")
    docling_pipeline = os.getenv("DOCLING_PIPELINE", "standard")
    docling_flag = DOCILING_AVAILABLE or CLI_AVAILABLE
    return {"ok": True, "docling": docling_flag, "cli": CLI_AVAILABLE, "extract_pipeline": extract_pipeline, "docling_pipeline": docling_pipeline}
