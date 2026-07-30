"""DXF/DWG geometry editor for the in-portal CAD editor.

Two halves of a round-trip:

  list_entities(path)
      Return the model-space entities the browser editor can select and edit:
      each with a stable handle, type, layer, colour and its geometry in
      drawing-unit coordinates (so the client can draw selectable hit-targets
      that line up with the WebGL render). Bounded so a huge drawing can't
      produce a giant payload.

  apply_edits(path, ops, target_ext)
      Apply a list of edit operations (delete / move / add line, circle,
      polyline, text / edit text) to a writable copy of the drawing with ezdxf,
      then save. DWG round-trips through the ODA File Converter both ways
      (DWG→DXF to read, DXF→DWG to write). Returns the path to the NEW file —
      the caller versions it; the original on disk is never mutated.

Geometry is edited server-side with ezdxf (the source of truth) rather than in
the browser, so we never have to round-trip a CAD kernel through JavaScript.
"""

from __future__ import annotations

import math
import os
import tempfile
from typing import Any

import ezdxf

from extractor import _convert_dwg_to_dxf, _load_drawing, _resolve_odafc_path

# Cap the selectable-entity payload. Drawings with more than this are still
# viewable (WebGL) and editable by ADDING entities, but we don't ship every
# hit-target — selection is limited to the first N model-space entities.
_MAX_ENTITIES = 20_000

# Entity types the editor understands geometrically. Anything else is returned
# as a generic bbox marker (still selectable + deletable, just not reshaped).
_EDITABLE = {"LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "TEXT", "MTEXT", "INSERT"}


def _entity_color(e) -> dict[str, Any]:
    """Resolve a display colour: true-colour RGB when set, else the ACI index."""
    info: dict[str, Any] = {}
    try:
        info["aci"] = int(getattr(e.dxf, "color", 256))
    except Exception:
        info["aci"] = 256
    try:
        rgb = getattr(e, "rgb", None)
        if rgb:
            info["rgb"] = [int(rgb[0]), int(rgb[1]), int(rgb[2])]
    except Exception:
        pass
    return info


def _entity_geometry(e) -> dict[str, Any] | None:
    """Geometry payload (drawing-unit coords) for one entity, or None if we can't
    represent it. `kind` tells the client how to draw the hit-target."""
    t = e.dxftype()
    try:
        if t == "LINE":
            s, end = e.dxf.start, e.dxf.end
            return {"kind": "line", "points": [float(s.x), float(s.y), float(end.x), float(end.y)]}
        if t == "CIRCLE":
            c = e.dxf.center
            return {"kind": "circle", "cx": float(c.x), "cy": float(c.y), "r": float(e.dxf.radius)}
        if t == "ARC":
            c = e.dxf.center
            return {
                "kind": "arc", "cx": float(c.x), "cy": float(c.y), "r": float(e.dxf.radius),
                "start": float(e.dxf.start_angle), "end": float(e.dxf.end_angle),
            }
        if t == "LWPOLYLINE":
            pts = [(float(p[0]), float(p[1])) for p in e.get_points("xy")]
            flat = [v for p in pts for v in p]
            return {"kind": "polyline", "points": flat, "closed": bool(getattr(e, "closed", False))}
        if t == "POLYLINE":
            pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
            flat = [v for p in pts for v in p]
            return {"kind": "polyline", "points": flat, "closed": bool(getattr(e, "is_closed", False))}
        if t in ("TEXT", "MTEXT"):
            ins = e.dxf.insert
            if t == "MTEXT":
                txt = e.plain_text(split=False) or ""
            else:
                txt = e.dxf.text or ""
            return {
                "kind": "text", "x": float(ins.x), "y": float(ins.y),
                "height": float(getattr(e.dxf, "height", 0) or 0),
                "rotation": float(getattr(e.dxf, "rotation", 0) or 0), "text": txt,
            }
        if t == "INSERT":
            ins = e.dxf.insert
            return {
                "kind": "insert", "x": float(ins.x), "y": float(ins.y),
                "name": (e.dxf.name or ""),
                "rotation": float(getattr(e.dxf, "rotation", 0) or 0),
            }
    except Exception:
        return None
    return None


def list_entities(path: str) -> dict[str, Any]:
    """Return {entities, bounds, units, count, truncated} for the editor."""
    doc, _ = _load_drawing(path)
    msp = doc.modelspace()
    units = doc.header.get("$INSUNITS", 0)

    out: list[dict[str, Any]] = []
    minx = miny = math.inf
    maxx = maxy = -math.inf
    truncated = False

    for e in msp:
        if len(out) >= _MAX_ENTITIES:
            truncated = True
            break
        t = e.dxftype()
        if t not in _EDITABLE:
            continue
        geom = _entity_geometry(e)
        if geom is None:
            continue
        handle = getattr(e.dxf, "handle", None)
        if not handle:
            continue
        rec = {
            "handle": str(handle),
            "type": t,
            "layer": getattr(e.dxf, "layer", "0") or "0",
            "color": _entity_color(e),
            "geom": geom,
        }
        out.append(rec)
        # Track a quick bbox from the geometry coords for fit-to-view.
        for x, y in _coords_of(geom):
            minx = min(minx, x); maxx = max(maxx, x)
            miny = min(miny, y); maxy = max(maxy, y)

    bounds = None
    if minx != math.inf:
        bounds = {"minX": minx, "minY": miny, "maxX": maxx, "maxY": maxy}

    return {
        "file": os.path.basename(path),
        "units": units,
        "count": len(out),
        "truncated": truncated,
        "bounds": bounds,
        "entities": out,
    }


def _coords_of(geom: dict[str, Any]):
    k = geom.get("kind")
    if k in ("line", "polyline"):
        pts = geom["points"]
        for i in range(0, len(pts) - 1, 2):
            yield pts[i], pts[i + 1]
    elif k in ("circle", "arc"):
        cx, cy, r = geom["cx"], geom["cy"], geom["r"]
        yield cx - r, cy - r
        yield cx + r, cy + r
    elif k in ("text", "insert"):
        yield geom["x"], geom["y"]


# ── Edit operations ──────────────────────────────────────────────────────────

def _apply_one(doc, msp, op: dict[str, Any]) -> str | None:
    """Apply a single op. Returns an error string on failure, None on success."""
    kind = op.get("op")
    db = doc.entitydb

    def find(handle):
        e = db.get(str(handle)) if handle else None
        if e is None:
            raise KeyError(f"entity {handle} not found")
        return e

    if kind == "delete":
        e = find(op.get("handle"))
        layout = e.get_layout() or msp
        layout.delete_entity(e)
        return None

    if kind == "move":
        e = find(op.get("handle"))
        dx, dy = float(op.get("dx", 0)), float(op.get("dy", 0))
        e.translate(dx, dy, 0)
        return None

    if kind == "edit_text":
        e = find(op.get("handle"))
        text = str(op.get("text", ""))
        if e.dxftype() == "MTEXT":
            e.text = text
        else:
            e.dxf.text = text
        return None

    if kind == "add_line":
        msp.add_line(
            (float(op["x1"]), float(op["y1"])), (float(op["x2"]), float(op["y2"])),
            dxfattribs=_attribs(op),
        )
        return None

    if kind == "add_circle":
        msp.add_circle((float(op["cx"]), float(op["cy"])), float(op["r"]), dxfattribs=_attribs(op))
        return None

    if kind == "add_polyline":
        pts = op.get("points", [])
        coords = [(float(pts[i]), float(pts[i + 1])) for i in range(0, len(pts) - 1, 2)]
        msp.add_lwpolyline(coords, close=bool(op.get("closed", False)), dxfattribs=_attribs(op))
        return None

    if kind == "add_text":
        t = msp.add_text(
            str(op.get("text", "")),
            height=float(op.get("height", 2.5)),
            dxfattribs=_attribs(op),
        )
        t.set_placement((float(op["x"]), float(op["y"])))
        return None

    return f"unknown op {kind!r}"


def _attribs(op: dict[str, Any]) -> dict[str, Any]:
    a: dict[str, Any] = {"layer": str(op.get("layer", "0") or "0")}
    if "aci" in op:
        try:
            a["color"] = int(op["aci"])
        except Exception:
            pass
    return a


def apply_edits(path: str, ops: list[dict[str, Any]], target_ext: str | None = None) -> dict[str, Any]:
    """Apply `ops` to a writable copy of the drawing and save a NEW file.

    Returns {path, file, applied, errors}. The output extension matches
    target_ext (".dwg"/".dxf") when given, else the original's extension.
    """
    doc, _ = _load_drawing(path)
    msp = doc.modelspace()

    applied = 0
    errors: list[str] = []
    for i, op in enumerate(ops):
        try:
            err = _apply_one(doc, msp, op)
            if err:
                errors.append(f"op[{i}]: {err}")
            else:
                applied += 1
        except Exception as exc:  # one bad op must not abort the whole save
            errors.append(f"op[{i}] ({op.get('op')!r}): {exc!r}")

    src_ext = os.path.splitext(path)[1].lower()
    out_ext = (target_ext or src_ext or ".dxf").lower()

    out_dir = tempfile.mkdtemp(prefix="cad_edit_")
    stem = os.path.splitext(os.path.basename(path))[0]
    dxf_out = os.path.join(out_dir, stem + ".dxf")
    doc.saveas(dxf_out)

    final_path = dxf_out
    if out_ext == ".dwg":
        final_path = _dxf_to_dwg(dxf_out, os.path.join(out_dir, stem + ".dwg"))

    return {
        "path": final_path,
        "file": os.path.basename(final_path),
        "applied": applied,
        "errors": errors,
    }


def _dxf_to_dwg(dxf_path: str, dwg_out: str) -> str:
    """Convert an edited DXF back to DWG via the ODA File Converter."""
    try:
        from ezdxf.addons import odafc  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"Saving to DWG requires ezdxf.addons.odafc ({exc})")
    _resolve_odafc_path()
    if not odafc.is_installed():
        raise RuntimeError(
            "Saving to DWG requires the ODA File Converter, which was not found. "
            "Install it (free, from opendesign.com) or set EZDXF_ODAFC."
        )
    odafc.convert(dxf_path, dwg_out, version="R2018", replace=True)  # type: ignore[attr-defined]
    return dwg_out
