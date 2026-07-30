"""FastAPI wrapper. Routes to the DXF, drawing-PDF, or text-document extractor
based on the file extension AND an optional `mode` hint from the caller.

POST /extract
   body: { "path": "abs/path/to/file", "mode": "drawing" | "document" }
   For .dxf/.dwg the mode is ignored (always drawing).
   For .pdf the mode picks the extractor:
     - "drawing"  → per-page text spans + heuristic schedules + title block
     - "document" → section-aware chunking for tender/RFP/SOW/spec/addendum
   Default is "drawing" for backward compatibility.

POST /render-cad
   body: { "path": "abs/path/to/file.dxf|.dwg" }
   Renders the drawing's modelspace to a standalone SVG string for the
   in-portal CAD viewer. DWG is converted to DXF first (ODA File Converter).
   Returns { "file": ..., "svg": "<svg ...>" }.

POST /render-pages
   body: { "path": "abs/path/to/file.pdf", "dpi": 150, "pages": [0,1,5] }
   Returns one base64-PNG per requested page. Used by the multimodal vision
   pre-pass so the Node side can feed page images to a vision LLM. `pages`
   is optional — when omitted we render every page (capped at 60).

GET /health → {"ok": true}
"""

from __future__ import annotations

import base64
import io
import os
from typing import List, Optional

import fitz  # PyMuPDF — already a dep for the PDF/text extractors
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from fastapi.responses import FileResponse

from extractor import (
    extract as extract_dxf,
    render_to_svg as render_cad_svg,
    to_dxf_path as cad_to_dxf_path,
    drawing_bounds as cad_drawing_bounds,
)
from editor import list_entities as cad_list_entities, apply_edits as cad_apply_edits
from pdf_extractor import extract_pdf
from document_extractor import extract_document

app = FastAPI(title="cad-extractor", version="0.4.0")


class ExtractRequest(BaseModel):
    path: str
    mode: Optional[str] = "drawing"  # "drawing" | "document"


class RenderCadRequest(BaseModel):
    path: str


class RenderRequest(BaseModel):
    path: str
    # DPI controls image quality vs. payload size. 100 = ~A4 page at ~825×1170,
    # 150 = ~1240×1750. Vision models tolerate 100 fine; some benefit from 150.
    dpi: int = 130
    # Optional zero-based page indices. When None, render every page (capped).
    pages: Optional[List[int]] = None
    # Hard cap so we never produce a 200-page giant payload. 60 covers a typical
    # multi-disciplinary design package.
    maxPages: int = 60


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract")
def post_extract(req: ExtractRequest) -> dict:
    ext = os.path.splitext(req.path)[1].lower()
    mode = (req.mode or "drawing").lower()
    try:
        if ext == ".pdf":
            if mode == "document":
                return extract_document(req.path)
            return extract_pdf(req.path)
        if ext in (".dxf", ".dwg"):
            return extract_dxf(req.path)
        raise HTTPException(status_code=415, detail=f"Unsupported extension: {ext}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {exc!r}")


@app.post("/render-cad")
def post_render_cad(req: RenderCadRequest) -> dict:
    """Render a DXF/DWG file's modelspace to a standalone SVG for in-browser
    preview. DWG is converted to DXF first via the ODA File Converter (same
    path as extraction). Returns {file, svg}."""
    ext = os.path.splitext(req.path)[1].lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=415, detail=f"render-cad only supports .dxf/.dwg, got {ext}")
    try:
        return render_cad_svg(req.path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"CAD render failed: {exc!r}")


@app.post("/to-dxf")
def post_to_dxf(req: RenderCadRequest) -> FileResponse:
    """Return a DXF for the given drawing path (DWG is converted via ODA). The
    in-browser viewer renders DXF client-side, so this is the fast path — just a
    format conversion, no server-side rasterising."""
    ext = os.path.splitext(req.path)[1].lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=415, detail=f"to-dxf only supports .dxf/.dwg, got {ext}")
    try:
        dxf_path = cad_to_dxf_path(req.path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DWG→DXF conversion failed: {exc!r}")
    return FileResponse(dxf_path, media_type="application/dxf", filename=os.path.basename(dxf_path))


@app.post("/cad-bounds")
def post_cad_bounds(req: RenderCadRequest) -> dict:
    """Return a robust model-space bounding box {minX,minY,maxX,maxY} for the
    viewer to fit to, ignoring stray far-flung entities."""
    ext = os.path.splitext(req.path)[1].lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=415, detail=f"cad-bounds only supports .dxf/.dwg, got {ext}")
    try:
        bounds = cad_drawing_bounds(req.path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Bounds computation failed: {exc!r}")
    if bounds is None:
        raise HTTPException(status_code=422, detail="Drawing has no measurable geometry")
    return bounds


class EditRequest(BaseModel):
    path: str
    ops: List[dict]
    # ".dwg" or ".dxf" — the format to save the edited drawing as. Defaults to
    # the source extension so a DWG round-trips back to DWG.
    targetExt: Optional[str] = None


@app.post("/cad-entities")
def post_cad_entities(req: RenderCadRequest) -> dict:
    """Return the selectable/editable model-space entities (handles + geometry)
    for the in-portal geometry editor."""
    ext = os.path.splitext(req.path)[1].lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=415, detail=f"cad-entities only supports .dxf/.dwg, got {ext}")
    try:
        return cad_list_entities(req.path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Entity listing failed: {exc!r}")


@app.post("/cad-edit")
def post_cad_edit(req: EditRequest) -> dict:
    """Apply geometry edit ops and save a NEW drawing file. Returns the path to
    the saved file (the Node side versions it into the uploads dir)."""
    ext = os.path.splitext(req.path)[1].lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=415, detail=f"cad-edit only supports .dxf/.dwg, got {ext}")
    if not isinstance(req.ops, list) or not req.ops:
        raise HTTPException(status_code=400, detail="ops must be a non-empty list")
    try:
        return cad_apply_edits(req.path, req.ops, req.targetExt)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"CAD edit failed: {exc!r}")


@app.post("/render-pages")
def post_render_pages(req: RenderRequest) -> dict:
    """Rasterize PDF pages to base64-encoded PNGs.

    Used by the multi-agent route's multimodal vision pre-pass. We return
    {pages: [{page, width, height, b64}, ...]} where b64 is the PNG payload
    (without the data: URI prefix). Caller is expected to wrap as needed.
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    ext = os.path.splitext(req.path)[1].lower()
    if ext != ".pdf":
        raise HTTPException(status_code=415, detail=f"render-pages only supports .pdf, got {ext}")

    try:
        doc = fitz.open(req.path)
        page_count = doc.page_count
        # Build the page set: explicit list or all-pages-capped.
        if req.pages is not None:
            wanted = [p for p in req.pages if 0 <= p < page_count][: req.maxPages]
        else:
            wanted = list(range(min(page_count, req.maxPages)))

        # Zoom factor: 72 DPI is PDF native, so DPI/72 gives the scale.
        zoom = max(0.5, min(req.dpi, 300)) / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        rendered: list[dict] = []
        for p in wanted:
            page = doc.load_page(p)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            buf = io.BytesIO(pix.tobytes("png"))
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            rendered.append({
                "page": p,
                "width": pix.width,
                "height": pix.height,
                "b64": b64,
            })
        doc.close()
        return {
            "file": os.path.basename(req.path),
            "pageCount": page_count,
            "rendered": rendered,
            "renderedCount": len(rendered),
            "truncated": page_count > req.maxPages and req.pages is None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Render failed: {exc!r}")
