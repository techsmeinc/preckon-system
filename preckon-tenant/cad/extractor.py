"""DXF/DWG extractor for BOQ intelligence.

Reads a CAD file and produces a structured, BOQ-oriented summary:

- Layers (with entity counts and per-type breakdown)
- Block definitions
- Block instances (INSERT) -- the primary quantity signal for fixtures, doors,
  windows, sockets, etc.
- Text annotations (TEXT + MTEXT), grouped by layer
- Dimensions, with values
- Aggregate geometry per layer (total polyline / line length, circle counts) --
  the primary quantity signal for piping, conduit, walls
- Block attributes (typically used for door/window tags, room schedules)
- A best-effort heuristic schedule extraction

The output is intentionally JSON-serialisable so the Node API can persist it
verbatim and so chunks can be embedded for RAG.
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

import ezdxf
from ezdxf import recover
from ezdxf.document import Drawing
from ezdxf.entities import DXFEntity, Insert, MText, Text


@dataclass
class TextAnnotation:
    layer: str
    text: str
    x: float
    y: float
    height: float
    sheet: str  # modelspace / layout name


@dataclass
class DimensionRecord:
    layer: str
    measurement: float | None
    text: str | None
    sheet: str


@dataclass
class BlockInstanceRecord:
    """One INSERT (block reference). For BOQ we mostly aggregate these."""

    name: str
    layer: str
    x: float
    y: float
    rotation: float
    sheet: str
    attributes: dict[str, str]


@dataclass
class LayerGeometry:
    layer: str
    line_count: int = 0
    line_length_total: float = 0.0
    polyline_count: int = 0
    polyline_length_total: float = 0.0
    # Area take-off signal (drawing units²) — the missing piece that forced every
    # m²/m³ BOQ line to fall back to a guessed quantity. `polyline_area_total` is
    # the summed area of CLOSED polylines on the layer (paving outlines, glazing
    # panels, room boundaries, slabs); `hatch_area_total` is the summed area of
    # HATCH fills (concrete, paving, waterproofing, insulation). Together they let
    # an agent ground an m² quantity from the geometry instead of emitting qty 1.
    closed_polyline_count: int = 0
    polyline_area_total: float = 0.0
    hatch_area_total: float = 0.0
    # The largest few CLOSED-polyline areas on the layer (drawing units², desc).
    # The single biggest closed outline is almost always the building footprint /
    # floor / slab / roof boundary — the ONE clean area take-off signal. The
    # summed polyline_area_total above over-counts (it adds every overlapping
    # outline, furniture polygon and hatch boundary), so an agent can't trust it;
    # the max of this list is the reliable footprint. Bounded to the top 8.
    closed_polyline_top_areas: list[float] = field(default_factory=list)
    circle_count: int = 0
    arc_count: int = 0
    hatch_count: int = 0
    insert_count: int = 0
    text_count: int = 0
    dim_count: int = 0
    other_count: int = 0


@dataclass
class ExtractionResult:
    file: str
    dxf_version: str | None
    units: str | None
    sheets: list[str] = field(default_factory=list)
    layers: list[LayerGeometry] = field(default_factory=list)
    block_definitions: list[str] = field(default_factory=list)
    block_instance_counts: dict[str, dict[str, Any]] = field(default_factory=dict)
    block_instances: list[BlockInstanceRecord] = field(default_factory=list)
    text_annotations: list[TextAnnotation] = field(default_factory=list)
    dimensions: list[DimensionRecord] = field(default_factory=list)
    title_block_fields: dict[str, str] = field(default_factory=dict)
    schedules: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "dxfVersion": self.dxf_version,
            "units": self.units,
            "sheets": self.sheets,
            "layers": [asdict(l) for l in self.layers],
            "blockDefinitions": self.block_definitions,
            "blockInstanceCounts": self.block_instance_counts,
            "blockInstances": [asdict(b) for b in self.block_instances],
            "textAnnotations": [asdict(t) for t in self.text_annotations],
            "dimensions": [asdict(d) for d in self.dimensions],
            "titleBlockFields": self.title_block_fields,
            "schedules": self.schedules,
            "warnings": self.warnings,
        }


# AutoCAD $INSUNITS code -> human label. 0 = unitless.
_UNIT_LABELS = {
    0: "unitless", 1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "m", 14: "dm",
}


def _safe_text(entity: Text | MText) -> str:
    try:
        if isinstance(entity, MText):
            return entity.plain_text(split=False) or ""
        return entity.dxf.text or ""
    except Exception:
        return ""


def _line_length(start: tuple[float, float, float], end: tuple[float, float, float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dz = end[2] - start[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _polyline_length(points: Iterable[tuple]) -> float:
    pts = list(points)
    total = 0.0
    for i in range(1, len(pts)):
        a = pts[i - 1]
        b = pts[i]
        total += math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
    return total


def _record_closed_area(bucket: "LayerGeometry", area: float) -> None:
    """Register one closed-polyline area on the layer: bump the count, add to the
    summed total, and keep it in the bounded top-8 list (so the caller can later
    pick the single largest = the footprint/floor outline)."""
    if area <= 0:
        return
    bucket.closed_polyline_count += 1
    bucket.polyline_area_total += area
    tops = bucket.closed_polyline_top_areas
    tops.append(area)
    if len(tops) > 8:
        tops.sort(reverse=True)
        del tops[8:]


def _shoelace_area(points: Iterable[tuple]) -> float:
    """Absolute polygon area (drawing units²) of a closed ring via the shoelace
    formula. Ignores arc bulges — a straight-segment approximation, which is the
    right level of accuracy for a BOQ take-off signal."""
    pts = [(float(p[0]), float(p[1])) for p in points]
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _hatch_area(hatch) -> float:
    """Best-effort HATCH area: sum the shoelace area of each polyline boundary
    path, and approximate edge paths by their edge endpoints. Wrapped so a weird
    boundary never aborts the layer scan. Islands aren't subtracted — for a
    take-off signal an over-estimate beats no number, and the agent can sanity-
    check against dimensions."""
    total = 0.0
    try:
        for path in hatch.paths:
            try:
                verts = getattr(path, "vertices", None)
                if verts is not None:
                    total += _shoelace_area([(v[0], v[1]) for v in verts])
                    continue
                edges = getattr(path, "edges", None)
                if edges:
                    pts: list[tuple] = []
                    for e in edges:
                        start = getattr(e, "start", None)
                        if start is not None:
                            pts.append((start[0], start[1]))
                    if len(pts) >= 3:
                        total += _shoelace_area(pts)
            except Exception:
                continue
    except Exception:
        return total
    return total


def _layer_bucket(buckets: dict[str, LayerGeometry], layer: str) -> LayerGeometry:
    if layer not in buckets:
        buckets[layer] = LayerGeometry(layer=layer)
    return buckets[layer]


# ── Block / xref explosion ───────────────────────────────────────────────────
# Real drawings nest the bulk of their geometry (walls, paving, glazing, room
# outlines, hatched fills) INSIDE blocks and xrefs, placed via INSERT. Measuring
# only top-level entities therefore misses almost all length/area, forcing every
# m / m² BOQ line to fall back to qty 1. We explode each INSERT's virtual
# entities and fold their geometry into the LAYER buckets. Bounded by a global
# entity budget + recursion depth so a huge drawing can't blow up ingest.
_EXPLODE_ENTITY_BUDGET = 250_000
_EXPLODE_MAX_DEPTH = 5


def _measure_virtual_geometry(
    ins: "Insert",
    layer_buckets: dict[str, LayerGeometry],
    result: ExtractionResult,
    depth: int,
    budget: dict,
) -> None:
    """Recurse into an INSERT's block/xref and accumulate LINE/POLYLINE length and
    closed-polyline / HATCH area into the layer buckets — the real m / m² take-off
    signal. Geometry ONLY: nested INSERTs recurse for their geometry but are NOT
    re-counted as block instances, and text/dimensions are ignored (those are
    captured at the top level), so EA counts and annotations don't get inflated."""
    if depth > _EXPLODE_MAX_DEPTH or budget["left"] <= 0:
        return
    try:
        vents = ins.virtual_entities()
    except Exception:
        return
    insert_layer = getattr(ins.dxf, "layer", "0") or "0"
    for ve in vents:
        if budget["left"] <= 0:
            result.warnings.append("block-explosion budget reached; some nested geometry not measured")
            return
        budget["left"] -= 1
        try:
            dt = ve.dxftype()
            # Entities drawn on layer "0" inside a block inherit the INSERT's layer.
            lyr = getattr(ve.dxf, "layer", "0") or "0"
            if lyr == "0":
                lyr = insert_layer
            bucket = _layer_bucket(layer_buckets, lyr)
            if dt == "LINE":
                bucket.line_count += 1
                s = ve.dxf.start
                e = ve.dxf.end
                bucket.line_length_total += _line_length((s.x, s.y, s.z), (e.x, e.y, e.z))
            elif dt == "LWPOLYLINE":
                bucket.polyline_count += 1
                pts = [(p[0], p[1]) for p in ve.get_points("xy")]
                bucket.polyline_length_total += _polyline_length(pts)
                if bool(getattr(ve, "closed", False)) and len(pts) >= 3:
                    _record_closed_area(bucket, _shoelace_area(pts))
            elif dt == "POLYLINE":
                bucket.polyline_count += 1
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in ve.vertices]
                bucket.polyline_length_total += _polyline_length(pts)
                if bool(getattr(ve, "is_closed", False)) and len(pts) >= 3:
                    _record_closed_area(bucket, _shoelace_area(pts))
            elif dt == "HATCH":
                bucket.hatch_count += 1
                bucket.hatch_area_total += _hatch_area(ve)
            elif dt == "INSERT":
                _measure_virtual_geometry(ve, layer_buckets, result, depth + 1, budget)
        except Exception:
            pass


def _process_space(
    space, sheet_name: str, result: ExtractionResult, layer_buckets: dict[str, LayerGeometry],
    budget: dict,
) -> None:
    for entity in space:
        try:
            _process_entity(entity, sheet_name, result, layer_buckets, budget)
        except Exception as exc:  # one bad entity must never kill the run
            result.warnings.append(f"skipped {entity.dxftype()}: {exc!r}")


def _process_entity(
    entity: DXFEntity,
    sheet_name: str,
    result: ExtractionResult,
    layer_buckets: dict[str, LayerGeometry],
    budget: dict,
) -> None:
    dtype = entity.dxftype()
    layer = getattr(entity.dxf, "layer", "0") or "0"
    bucket = _layer_bucket(layer_buckets, layer)

    if dtype == "LINE":
        bucket.line_count += 1
        start = entity.dxf.start
        end = entity.dxf.end
        bucket.line_length_total += _line_length(
            (start.x, start.y, start.z), (end.x, end.y, end.z)
        )
    elif dtype in {"LWPOLYLINE", "POLYLINE"}:
        bucket.polyline_count += 1
        try:
            if dtype == "LWPOLYLINE":
                pts = [(p[0], p[1]) for p in entity.get_points("xy")]
                is_closed = bool(getattr(entity, "closed", False))
            else:
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
                is_closed = bool(getattr(entity, "is_closed", False))
            bucket.polyline_length_total += _polyline_length(pts)
            # A closed polyline encloses an area — the take-off signal for paving,
            # glazing panels, slabs, room boundaries, etc.
            if is_closed and len(pts) >= 3:
                _record_closed_area(bucket, _shoelace_area(pts))
        except Exception:
            pass
    elif dtype == "CIRCLE":
        bucket.circle_count += 1
    elif dtype == "ARC":
        bucket.arc_count += 1
    elif dtype == "HATCH":
        bucket.hatch_count += 1
        bucket.hatch_area_total += _hatch_area(entity)
    elif dtype == "INSERT":
        bucket.insert_count += 1
        ins: Insert = entity  # type: ignore[assignment]
        name = (ins.dxf.name or "").strip()
        try:
            attrs = {
                (att.dxf.tag or ""): (att.dxf.text or "")
                for att in ins.attribs
            }
        except Exception:
            attrs = {}
        try:
            rot = float(ins.dxf.rotation or 0.0)
        except Exception:
            rot = 0.0
        record = BlockInstanceRecord(
            name=name,
            layer=layer,
            x=float(ins.dxf.insert.x),
            y=float(ins.dxf.insert.y),
            rotation=rot,
            sheet=sheet_name,
            attributes=attrs,
        )
        result.block_instances.append(record)
        agg = result.block_instance_counts.setdefault(
            name, {"total": 0, "byLayer": {}, "sheets": set(), "sampleAttributes": {}}
        )
        agg["total"] += 1
        agg["byLayer"][layer] = agg["byLayer"].get(layer, 0) + 1
        agg["sheets"].add(sheet_name)
        if attrs and not agg["sampleAttributes"]:
            agg["sampleAttributes"] = attrs
        # Explode the block/xref to measure the geometry INSIDE it — most of a
        # drawing's real length/area lives here, not at the top level.
        _measure_virtual_geometry(ins, layer_buckets, result, 1, budget)
    elif dtype in {"TEXT", "MTEXT"}:
        bucket.text_count += 1
        text = _safe_text(entity).strip()
        if not text:
            return
        try:
            insert = entity.dxf.insert
            x = float(getattr(insert, "x", 0.0))
            y = float(getattr(insert, "y", 0.0))
        except Exception:
            x = y = 0.0
        try:
            height = float(entity.dxf.height or 0.0)
        except Exception:
            height = 0.0
        result.text_annotations.append(
            TextAnnotation(layer=layer, text=text, x=x, y=y, height=height, sheet=sheet_name)
        )
    elif dtype == "DIMENSION":
        bucket.dim_count += 1
        try:
            measurement = float(entity.dxf.actual_measurement or 0.0)
        except Exception:
            measurement = None
        try:
            dim_text = entity.dxf.text or ""
        except Exception:
            dim_text = ""
        result.dimensions.append(
            DimensionRecord(layer=layer, measurement=measurement, text=dim_text, sheet=sheet_name)
        )
    else:
        bucket.other_count += 1


def _detect_title_block(result: ExtractionResult) -> None:
    """Best-effort: find INSERTs whose name looks like a title block and
    promote their attributes to the top-level titleBlockFields map."""
    candidates = [
        b for b in result.block_instances if "title" in (b.name or "").lower()
    ]
    if not candidates:
        # Fall back to the most-populated INSERT-with-attributes
        with_attrs = [b for b in result.block_instances if b.attributes]
        if with_attrs:
            candidates = [max(with_attrs, key=lambda b: len(b.attributes))]
    if not candidates:
        return
    chosen = candidates[0]
    for k, v in chosen.attributes.items():
        if k and v:
            result.title_block_fields[k] = v


def _detect_schedules(result: ExtractionResult) -> None:
    """Heuristic schedule detection.

    A 'schedule' in CAD is usually a rectangular grid of TEXT entities. We
    cluster annotations into rows by y-coordinate then merge near-identical row
    arrangements. We only emit a schedule if we find at least 3 rows of >= 3
    columns each on the same layer.
    """
    by_layer: dict[str, list[TextAnnotation]] = defaultdict(list)
    for t in result.text_annotations:
        by_layer[t.layer].append(t)

    for layer, items in by_layer.items():
        if len(items) < 9:  # need at least a 3x3 grid
            continue
        # Group into rows by y, tolerance = median text height
        heights = [i.height for i in items if i.height > 0]
        tol = (sum(heights) / len(heights)) if heights else 1.0
        items_sorted = sorted(items, key=lambda i: -i.y)
        rows: list[list[TextAnnotation]] = []
        for item in items_sorted:
            if rows and abs(rows[-1][0].y - item.y) <= tol:
                rows[-1].append(item)
            else:
                rows.append([item])

        # Keep rows with >= 3 cells, sorted left-to-right
        grid_rows = []
        for row in rows:
            if len(row) >= 3:
                grid_rows.append(sorted(row, key=lambda i: i.x))
        if len(grid_rows) < 3:
            continue

        header = [c.text for c in grid_rows[0]]
        data_rows = [[c.text for c in r] for r in grid_rows[1:]]
        result.schedules.append(
            {
                "layer": layer,
                "rowCount": len(data_rows),
                "header": header,
                "rows": data_rows[:50],  # cap for sanity
            }
        )


def _resolve_odafc_path() -> str | None:
    """Locate the ODA File Converter executable and register it with ezdxf.

    Modern ezdxf reads the converter path from its own options
    (``odafc-addon`` / ``win_exec_path``), NOT from the ``EZDXF_ODAFC`` env
    var, and the built-in default only points at the per-machine
    ``C:\\Program Files\\ODA\\...`` install. We support a non-admin /
    portable install by honouring ``EZDXF_ODAFC`` ourselves and falling back
    to a few common locations, then pushing whatever we find into the ezdxf
    option so ``odafc.is_installed()`` and ``odafc.convert()`` pick it up.

    Returns the resolved path, or None if nothing was found.
    """
    candidates: list[str] = []
    env_path = os.environ.get("EZDXF_ODAFC")
    if env_path:
        candidates.append(env_path)
    candidates += [
        os.path.expanduser(r"~\ODA\ODAFileConverter.exe"),
        r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",
        "/usr/bin/ODAFileConverter",
        "/usr/local/bin/ODAFileConverter",
    ]
    for cand in candidates:
        if cand and os.path.isfile(cand):
            try:
                ezdxf.options.set("odafc-addon", "win_exec_path", cand)
            except Exception:
                pass
            return cand
    return None


def _libredwg_convert(path: str, out_path: str) -> bool:
    """Convert DWG→DXF with LibreDWG's dwg2dxf, which is built into this image.

    LibreDWG is GPL and open source, so unlike the ODA File Converter it needs no
    manual download or registration — which is the difference between .dwg
    working out of the box and .dwg being a documented setup step nobody does.
    Coverage is good for R13–R2018 but not perfect; ODA still wins when both are
    present, and a failure here falls through to the ODA path rather than
    ending the attempt.
    """
    exe = shutil.which("dwg2dxf")
    if not exe:
        return False
    try:
        proc = subprocess.run(
            [exe, "-y", "-o", out_path, path],
            capture_output=True, timeout=180, check=False,
        )
    except Exception:
        return False
    # dwg2dxf reports partial reads on its exit code, so trust the artefact:
    # a non-trivial .dxf on disk means we got something ezdxf can open.
    return os.path.exists(out_path) and os.path.getsize(out_path) > 1024


def _convert_dwg_to_dxf(path: str) -> str:
    """If the file is .dwg, convert it to DXF. Tries the ODA File Converter when
    one is configured (best fidelity), then falls back to LibreDWG, which ships
    in this image. Returns a path to a temporary .dxf."""
    if not path.lower().endswith(".dwg"):
        return path

    out_dir = tempfile.mkdtemp(prefix="dwg2dxf_")
    out_path = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".dxf")

    resolved = _resolve_odafc_path()
    try:
        from ezdxf.addons import odafc  # type: ignore
        if odafc.is_installed():
            odafc.convert(path, out_path, version="R2018", replace=True)  # type: ignore[attr-defined]
            return out_path
    except Exception:
        # An ODA that is present but fails on this file is not the end of the
        # road — LibreDWG may still read it.
        pass

    if _libredwg_convert(path, out_path):
        return out_path

    raise RuntimeError(
        "This DWG could not be converted. LibreDWG could not read it, and no ODA "
        "File Converter is configured. Re-save the drawing as DXF from AutoCAD, or "
        "install the ODA File Converter (free, from opendesign.com) and point "
        "EZDXF_ODAFC at it. "
        f"(EZDXF_ODAFC={os.environ.get('EZDXF_ODAFC') or '(unset)'}, "
        f"resolved={resolved or '(none)'}, dwg2dxf={shutil.which('dwg2dxf') or '(missing)'})"
    )


def _load_drawing(path: str):
    """Open a DXF/DWG file as an ezdxf Drawing, converting DWG→DXF first if
    needed and recovering from minor corruption. Returns (doc, auditor|None)."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    effective_path = _convert_dwg_to_dxf(path)
    try:
        return recover.readfile(effective_path)
    except Exception as exc:
        try:
            return ezdxf.readfile(effective_path), None
        except Exception as exc2:
            raise RuntimeError(f"DXF read failed: {exc!r} / fallback: {exc2!r}")


def drawing_bounds(path: str) -> dict[str, float] | None:
    """Compute a ROBUST model-space bounding box for the in-browser viewer to
    fit to. CAD files routinely carry a few stray entities millions of units
    from the real plan; fitting to the raw extents would shrink the drawing to
    an invisible speck. We take the 2nd–98th percentile window of per-entity
    bbox edges so outliers are ignored. Returns {minX,minY,maxX,maxY} or None."""
    doc, _ = _load_drawing(path)
    from ezdxf import bbox
    cxs: list[float] = []
    cys: list[float] = []
    sizes: list[float] = []
    cache = bbox.Cache()
    for e in doc.modelspace():
        try:
            b = bbox.extents([e], cache=cache, fast=True)
        except Exception:
            continue
        if b.has_data:
            cxs.append(b.center.x)
            cys.append(b.center.y)
            sizes.append(max(b.size.x, b.size.y))
    if not cxs:
        return None
    return _mad_window_bounds(cxs, cys, sizes)


def _mad_window_bounds(cxs, cys, sizes):
    """Robust model-space window from entity-centre lists via median ± K·MAD
    (median absolute deviation). MAD survives up to ~50% outliers, so it handles
    BOTH far-flung strays AND large stray *clusters* that defeat percentiles
    (some drawings scatter well over 1% of entities kilometres away). Returns
    {minX,minY,maxX,maxY} or None."""
    import statistics as _st

    def pct(arr: list, p: float) -> float:
        s = sorted(arr)
        return s[min(len(s) - 1, max(0, int(p * (len(s) - 1))))]

    def mad_window(vals: list, K: float) -> tuple[float, float]:
        m = _st.median(vals)
        mad = _st.median([abs(v - m) for v in vals])
        if mad <= 0:
            return min(vals), max(vals)
        return max(m - K * mad, min(vals)), min(m + K * mad, max(vals))

    if len(cxs) >= 20:
        x1, x2 = mad_window(cxs, 5.0)
        y1, y2 = mad_window(cys, 5.0)
    else:
        x1, x2, y1, y2 = min(cxs), max(cxs), min(cys), max(cys)
    msize = pct(sizes, 0.5)
    padx = max((x2 - x1) * 0.05, msize)
    pady = max((y2 - y1) * 0.05, msize)
    x1 -= padx; x2 += padx; y1 -= pady; y2 += pady
    if not (x2 > x1 and y2 > y1):
        return None
    return {"minX": x1, "minY": y1, "maxX": x2, "maxY": y2}


def to_dxf_path(path: str) -> str:
    """Return a path to a DXF rendition of the drawing: the file itself when it
    is already a DXF, otherwise a DWG converted to DXF via the ODA File
    Converter (same path as extraction). Used to feed the in-browser viewer,
    which renders DXF client-side. Raises FileNotFoundError / RuntimeError."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if path.lower().endswith(".dxf"):
        return path
    return _convert_dwg_to_dxf(path)


def render_to_svg(path: str) -> dict[str, Any]:
    """Render a DXF/DWG file's modelspace to a standalone SVG string for the
    in-portal drawing viewer. Reuses the same DWG→DXF (ODA) conversion path as
    extraction, then draws with ezdxf's native SVG backend (no matplotlib).
    Returns {file, svg}."""
    doc, _auditor = _load_drawing(path)
    try:
        from ezdxf import bbox
        from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
        from ezdxf.addons.drawing.config import (
            Configuration, BackgroundPolicy, ColorPolicy,
        )
    except Exception as exc:  # pragma: no cover - depends on ezdxf install
        raise RuntimeError(f"SVG rendering requires ezdxf.addons.drawing ({exc})")
    msp = doc.modelspace()
    context = RenderContext(doc)
    # Modelspace defaults to a BLACK background in CAD, so ACI colour 7 (the
    # default linework) resolves to WHITE and renders as an invisible/black box
    # in the browser. Tell the render context the background is white so colour
    # 7 maps to black, and force a white page — giving a clean "plotted on
    # paper" look while preserving any genuinely coloured layers.
    context.set_current_layout(msp)
    try:
        context.current_layout_properties.set_colors("#ffffff")
    except Exception:
        pass
    backend = svg.SVGBackend()
    # MONOCHROME_LIGHT_BG forces every layer's linework to a dark, readable tone
    # regardless of its original CAD colour (cyan/yellow/etc. are invisible on
    # white). ezdxf's background policy proved unreliable across files, so the
    # white page is enforced by a post-process step below instead.
    cfg = Configuration(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.MONOCHROME_LIGHT_BG,
    )
    frontend = Frontend(context, backend, config=cfg)

    # Drop entity types ezdxf's renderer mishandles: MULTILEADER content is drawn
    # as the literal class name ("AcDbMLeader") splattered over the drawing, and
    # proxy entities render as garbage. They're annotation callouts — dropping
    # them gives a far cleaner preview.
    SKIP_TYPES = {"MULTILEADER", "ACAD_PROXY_ENTITY"}
    entities = [e for e in msp if e.dxftype() not in SKIP_TYPES]
    drawn = entities

    # Robust crop: these drawings carry many entities scattered kilometres from
    # the real plan, which would blow the page up and shrink the drawing to an
    # invisible speck. Compute the robust MAD window (see drawing_bounds) and
    # render only the entities whose centre falls inside it.
    try:
        cache = bbox.Cache()
        pairs = []
        for e in entities:
            try:
                b = bbox.extents([e], cache=cache, fast=True)
            except Exception:
                continue
            if b.has_data:
                pairs.append((e, b))
        if len(pairs) >= 20:
            win = _mad_window_bounds(
                [b.center.x for _, b in pairs],
                [b.center.y for _, b in pairs],
                [max(b.size.x, b.size.y) for _, b in pairs],
            )
            if win is not None:
                kept = [
                    e for e, b in pairs
                    if win["minX"] <= b.center.x <= win["maxX"]
                    and win["minY"] <= b.center.y <= win["maxY"]
                ]
                if len(kept) >= 10:
                    drawn = kept
    except Exception:
        drawn = entities

    frontend.draw_entities(drawn)
    backend.finalize()

    # Page(0, 0) auto-sizes to the drawn content's bounding box; a small margin
    # keeps the extents off the very edge so fit-to-window looks clean.
    page = layout.Page(0, 0, layout.Units.mm, margins=layout.Margins.all(5))
    svg_string = backend.get_string(page)

    # Force a WHITE page background. ezdxf draws a full-canvas rect with the
    # layout's background colour (usually black for modelspace) regardless of the
    # configured BackgroundPolicy, which would render dark-on-dark. Rewrite that
    # first full-canvas rect to white so the dark linework is always visible.
    import re as _re
    svg_string = _re.sub(
        r'(<rect\s+fill=")#[0-9a-fA-F]{6}("\s+x="0"\s+y="0")',
        r"\1#ffffff\2",
        svg_string,
        count=1,
    )
    # A few pathological drawings render to hundreds of MB (dense hatches) that
    # would OOM the browser. Refuse those so the client falls back to download.
    if len(svg_string) > 70_000_000:
        raise RuntimeError(
            "Drawing is too detailed to preview in the browser "
            f"(rendered ~{len(svg_string) // 1_000_000} MB). Download the original to open it in a CAD application."
        )
    return {"file": os.path.basename(path), "svg": svg_string}


def _crop_to_main_drawing(entities: list, bbox) -> list:
    """Return the subset of `entities` that lie within the dense 1st–99th
    percentile window of entity-centre coordinates, dropping far-flung strays.
    Returns the input unchanged when there's too little to judge or the crop
    would discard too much."""
    try:
        cache = bbox.Cache()
        pairs = []
        for e in entities:
            try:
                b = bbox.extents([e], cache=cache, fast=True)
            except Exception:
                continue
            if b.has_data:
                pairs.append((e, b))
        if len(pairs) < 20:
            return entities
        xs = sorted(b.center.x for _, b in pairs)
        ys = sorted(b.center.y for _, b in pairs)

        def pct(arr: list, p: float):
            return arr[min(len(arr) - 1, max(0, int(p * (len(arr) - 1))))]

        x1, x2 = pct(xs, 0.01), pct(xs, 0.99)
        y1, y2 = pct(ys, 0.01), pct(ys, 0.99)
        padx = (x2 - x1) * 0.05 or 1.0
        pady = (y2 - y1) * 0.05 or 1.0
        x1 -= padx; x2 += padx; y1 -= pady; y2 += pady
        kept = [e for e, b in pairs if x1 <= b.center.x <= x2 and y1 <= b.center.y <= y2]
        # Only crop when it keeps the bulk of the drawing (else trust the original).
        if len(kept) >= 10 and len(kept) >= 0.5 * len(pairs):
            return kept
        return entities
    except Exception:
        return entities


def extract(path: str) -> dict[str, Any]:
    """Public entry point. Returns a JSON-serialisable dict."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    effective_path = _convert_dwg_to_dxf(path)

    # ezdxf.recover deals with malformed DXFs and returns auditor warnings.
    try:
        doc, auditor = recover.readfile(effective_path)
    except Exception as exc:
        # Last-ditch: try the normal reader
        try:
            doc = ezdxf.readfile(effective_path)
            auditor = None
        except Exception as exc2:
            raise RuntimeError(f"DXF read failed: {exc!r} / fallback: {exc2!r}")

    result = ExtractionResult(
        file=os.path.basename(path),
        dxf_version=getattr(doc, "dxfversion", None),
        units=_UNIT_LABELS.get(doc.header.get("$INSUNITS", 0), "unknown"),
    )

    if auditor is not None and auditor.has_errors:
        for err in list(auditor.errors)[:10]:
            result.warnings.append(f"audit: {err}")

    layer_buckets: dict[str, LayerGeometry] = {}

    # Block definitions (names only; actual entity content rarely matters for BOQ)
    for blk in doc.blocks:
        name = (blk.name or "").strip()
        if not name or name.startswith("*"):  # *MODEL_SPACE etc.
            continue
        result.block_definitions.append(name)

    # Shared block-explosion budget across the whole drawing (model + layouts).
    budget = {"left": _EXPLODE_ENTITY_BUDGET}

    # Model space
    result.sheets.append("MODEL")
    _process_space(doc.modelspace(), "MODEL", result, layer_buckets, budget)

    # Paper space layouts (each "sheet" the architect set up)
    for layout in doc.layouts:
        if layout.name and layout.name.upper() != "MODEL":
            result.sheets.append(layout.name)
            _process_space(layout, layout.name, result, layer_buckets, budget)

    # Materialise layer buckets, sorted by total entity count
    def layer_total(l: LayerGeometry) -> int:
        return (l.line_count + l.polyline_count + l.circle_count + l.arc_count
                + l.hatch_count + l.insert_count + l.text_count + l.dim_count
                + l.other_count)
    result.layers = sorted(layer_buckets.values(), key=layer_total, reverse=True)

    # Convert sets in block_instance_counts to lists (JSON-serialisable)
    for agg in result.block_instance_counts.values():
        agg["sheets"] = sorted(list(agg["sheets"]))

    # Cap large arrays so the payload stays sane on huge drawings
    if len(result.block_instances) > 5000:
        result.warnings.append(
            f"trimmed block_instances {len(result.block_instances)} -> 5000"
        )
        result.block_instances = result.block_instances[:5000]
    if len(result.text_annotations) > 5000:
        result.warnings.append(
            f"trimmed text_annotations {len(result.text_annotations)} -> 5000"
        )
        result.text_annotations = result.text_annotations[:5000]
    if len(result.dimensions) > 5000:
        result.warnings.append(
            f"trimmed dimensions {len(result.dimensions)} -> 5000"
        )
        result.dimensions = result.dimensions[:5000]

    _detect_title_block(result)
    _detect_schedules(result)

    return result.to_dict()
