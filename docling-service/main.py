import io
import os
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="Docling-compatible Extractor", version="0.1.0")

try:
    # Optional: real Docling if installed in the image
    from docling.document_converter import DocumentConverter  # type: ignore
    DOCILING_AVAILABLE = True
except Exception:
    DOCILING_AVAILABLE = False

def _extract_with_docling(bytes_data: bytes):
    # Minimal safe wrapper around docling. Falls back on errors.
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
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

def _extract_with_pymupdf(bytes_data: bytes):
    import fitz  # PyMuPDF
    doc = fitz.open(stream=bytes_data, filetype="pdf")
    pages = doc.page_count
    lines: List[str] = []
    for i in range(pages):
        try:
            text = doc.load_page(i).get_text("text")
            for ln in text.splitlines():
                ln = ln.strip()
                if ln:
                    lines.append(ln)
        except Exception:
            pass
    doc.close()
    text = "\n".join(lines)
    return {
        "pages": pages,
        "text": text,
        "blocks": [{"text": b} for b in _to_paragraphs(lines)][:200]
    }

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

@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    data = await file.read()
    # Try Docling first if available
    if DOCILING_AVAILABLE:
        res = _extract_with_docling(data)
        if res and (res.get("text") or res.get("blocks")):
            return JSONResponse(res)
    # Fallback to PyMuPDF, then pdfminer
    try:
        return JSONResponse(_extract_with_pymupdf(data))
    except Exception:
        return JSONResponse(_extract_with_pdfminer(data))

@app.get("/health")
def health():
    return {"ok": True, "docling": DOCILING_AVAILABLE}

