"""cad — the CAD extraction sidecar.

Ported from AutoCAD-BOQ-Tender/services/cad-extractor. Parses AutoCAD .dxf
(and .dwg via the ODA File Converter) into a BOQ-oriented JSON summary: layers
with measured geometry, block instance counts, dimensions, title-block fields
and detected schedules.

TRUST BOUNDARY (§5.1). Like the AI worker, this service has NO database access
and no credentials. It is a pure function of the bytes it is handed: Core posts
a storage path, this returns a summary, Core decides what to persist. It cannot
read another tenant's files because it is never told they exist.

  POST /extract   { "path": "/app/.uploads/<key>" } → the summary dict
  POST /render    { "path": ... }                   → { file, svg }
  GET  /health                                      → { ok: true }
"""

from __future__ import annotations

import base64
import os

import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from extractor import extract as extract_dxf, render_to_svg

app = FastAPI(title="preckon-cad", version="1.0.0")

# Uploads are mounted read-only. Refusing paths outside it means a malformed or
# hostile request can't turn this into an arbitrary-file reader.
ROOT = os.path.realpath(os.environ.get("FILE_STORAGE_DIR", "/app/.uploads"))

SUPPORTED = (".dxf", ".dwg")


class PathRequest(BaseModel):
    path: str
    # Storage keys carry a uuid prefix. Agents cite this name in their working,
    # so pass the name the estimator uploaded, not the key on disk.
    filename: str | None = None


def _checked(path: str) -> str:
    real = os.path.realpath(path)
    if not (real == ROOT or real.startswith(ROOT + os.sep)):
        raise HTTPException(status_code=403, detail="path outside the upload root")
    if not os.path.exists(real):
        raise HTTPException(status_code=404, detail=f"file not found: {os.path.basename(path)}")
    if os.path.splitext(real)[1].lower() not in SUPPORTED:
        raise HTTPException(status_code=415, detail="only .dxf and .dwg are handled here")
    return real


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract")
def post_extract(req: PathRequest) -> dict:
    real = _checked(req.path)
    try:
        out = extract_dxf(real)
        if req.filename:
            out["file"] = req.filename
        return out
    except HTTPException:
        raise
    except RuntimeError as exc:
        # A DWG with no ODA converter available lands here. The message is
        # written for an estimator, not a log reader — Core passes it straight
        # through to the Documents screen.
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"extraction failed: {exc!r}")


class RenderPagesRequest(BaseModel):
    path: str
    pages: list[int] | None = None
    dpi: int = 150
    maxPages: int = 8


def _checked_pdf(path: str) -> str:
    """Same containment rule as _checked, but for the PDF the vision pass reads."""
    real = os.path.realpath(path)
    if not (real == ROOT or real.startswith(ROOT + os.sep)):
        raise HTTPException(status_code=403, detail="path outside the upload root")
    if not os.path.exists(real):
        raise HTTPException(status_code=404, detail=f"file not found: {os.path.basename(path)}")
    if os.path.splitext(real)[1].lower() != ".pdf":
        raise HTTPException(status_code=415, detail="render-pages only handles .pdf")
    return real


@app.post("/render-pages")
def post_render_pages(req: RenderPagesRequest) -> dict:
    """Rasterise PDF sheets to base64 PNGs for the vision pass.

    WHY THIS EXISTS. The DXF toolbox is blind to PDFs: a sheet exported to PDF
    carries no layers, no blocks and no queryable geometry, so a tender pack of
    PDF drawings gives the estimating agents nothing to measure. Looking at the
    sheet is then the only route to a quantity, and this is what makes looking
    possible.

    Returns {"pages": [{"page", "width", "height", "b64"}, ...]} with the raw
    PNG payload, no data: URI prefix — the caller decides how to wrap it.
    """
    real = _checked_pdf(req.path)
    try:
        doc = fitz.open(real)
        count = doc.page_count
        if req.pages is not None:
            wanted = [p for p in req.pages if 0 <= p < count][: req.maxPages]
        else:
            wanted = list(range(min(count, req.maxPages)))

        # 72 DPI is PDF native, so DPI/72 is the scale. Clamped: below ~0.5 the
        # dimension strings stop being legible, and past 300 the PNG is large
        # enough to cost more in tokens than the extra detail is worth.
        zoom = max(0.5, min(req.dpi, 300)) / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        rendered: list[dict] = []
        for p in wanted:
            pix = doc.load_page(p).get_pixmap(matrix=matrix, alpha=False)
            rendered.append({
                "page": p,
                "width": pix.width,
                "height": pix.height,
                "b64": base64.b64encode(pix.tobytes("png")).decode("ascii"),
            })
        doc.close()
        return {"file": os.path.basename(real), "pageCount": count, "pages": rendered}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"page render failed: {exc!r}")


@app.post("/render")
def post_render(req: PathRequest) -> dict:
    real = _checked(req.path)
    try:
        return render_to_svg(real)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"render failed: {exc!r}")
