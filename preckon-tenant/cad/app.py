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

import os

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
