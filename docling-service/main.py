import io
import os
import shutil
import subprocess
import tempfile
import logging
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

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
        
        # Configure for standard pipeline (no VLM, no OCR to avoid OpenGL)
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = False  # Disable OCR (requires OpenGL)
        pipeline_options.do_table_structure = False  # Disable table structure (may require OpenGL)
        
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
    Uses authoritative flags: --to, --pipeline, --ocr/--no-ocr, --pdf-backend, --tables/--no-tables
    
    Note: Using 'standard' pipeline instead of 'vlm' to avoid model loading issues.
    VLM pipeline requires additional model files that may not be available.
    """
    cli = os.getenv("DOCLING_CLI", "docling")
    to_fmt = os.getenv("DOCLING_TO", "md")
    # Use standard pipeline by default (faster, more reliable)
    pipeline = os.getenv("DOCLING_PIPELINE", "standard")
    vlm_model = os.getenv("DOCLING_VLM_MODEL", "granite_docling")
    use_ocr = os.getenv("DOCLING_OCR", "1") in ("1", "true", "True", "yes")
    pdf_backend = os.getenv("DOCLING_PDF_BACKEND")
    use_tables = os.getenv("DOCLING_TABLES", "1") in ("1", "true", "True", "yes")

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
        args = [cli, "--to", to_fmt, tmp_path]
        if pipeline:
            args += ["--pipeline", pipeline]
        if pipeline == "vlm" and vlm_model:
            args += ["--vlm-model", vlm_model]
        if use_ocr:
            args += ["--ocr"]
        else:
            args += ["--no-ocr"]
        if pdf_backend:
            args += ["--pdf-backend", pdf_backend]
        if use_tables:
            args += ["--tables"]
        else:
            args += ["--no-tables"]

        proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "docling CLI failed")

        output = proc.stdout or ""
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
    Extract text from an uploaded document using Docling Python API.
    Returns JSON with pages, text, and structured blocks.
    """
    data = await file.read()
    res = _extract_with_docling_python(data, file.filename)
    if res and (res.get("text") or res.get("blocks")):
        return JSONResponse(res)
    raise HTTPException(500, "Docling extraction failed")

@app.get("/health")
def health():
    pipeline = os.getenv("DOCLING_PIPELINE", "docling_cli")
    docling_flag = DOCILING_AVAILABLE or CLI_AVAILABLE
    return {"ok": True, "docling": docling_flag, "cli": CLI_AVAILABLE, "pipeline": pipeline}


def _extract_with_docling_cli(bytes_data: bytes, filename: Optional[str] = None):
    """
    Invoke Docling CLI to convert the source to Markdown/JSON, with VLM pipeline.
    Controlled by environment variables:
      DOCLING_CLI=docling (path to binary)
      DOCLING_TO=md|json|html|text (default md)
      DOCLING_PIPELINE=standard|vlm|asr (default vlm)
      DOCLING_VLM_MODEL=granite_docling|smoldocling|... (default granite_docling)
      DOCLING_OCR=1|0 (default 1)
      DOCLING_PDF_BACKEND=pypdfium2|dlparse_v1|dlparse_v2|dlparse_v4 (optional)
      DOCLING_TABLES=1|0 (default 1)
    """
    cli = os.getenv("DOCLING_CLI", "docling")
    to_fmt = os.getenv("DOCLING_TO", "md")
    pipeline = os.getenv("DOCLING_PIPELINE", "vlm")
    vlm_model = os.getenv("DOCLING_VLM_MODEL", "granite_docling")
    use_ocr = os.getenv("DOCLING_OCR", "1") in ("1", "true", "True", "yes")
    pdf_backend = os.getenv("DOCLING_PDF_BACKEND")
    use_tables = os.getenv("DOCLING_TABLES", "1") in ("1", "true", "True", "yes")

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
        args = [cli, "--to", to_fmt, tmp_path]
        if pipeline:
            args += ["--pipeline", pipeline]
        if pipeline == "vlm" and vlm_model:
            args += ["--vlm-model", vlm_model]
        if use_ocr:
            args += ["--ocr"]
        else:
            args += ["--no-ocr"]
        if pdf_backend:
            args += ["--pdf-backend", pdf_backend]
        if use_tables:
            args += ["--tables"]
        else:
            args += ["--no-tables"]

        proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"docling CLI failed: {proc.stderr.strip()[:300]}")

        output = proc.stdout or ""

        # Determine pages using PyMuPDF if possible
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
