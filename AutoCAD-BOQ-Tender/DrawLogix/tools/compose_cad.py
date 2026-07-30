#!/usr/bin/env python
"""
compose_cad.py — DrawLogix professional CAD composer.

Reads a plan JSON (produced by DrawLogix from its solved floor plans / freeform
geometry) and writes a professional AutoCAD drawing with ezdxf:

  * proper LAYER / TEXT-STYLE / DIMSTYLE tables
  * double-line walls with real thickness, room hatches (poché)
  * REAL associative DIMENSION entities (per-bay + overall, both axes)
  * door swings, window symbols, a column grid with bubbles, room tags
  * a title block, north arrow, graphic scale bar, per-storey level labels + a
    stacking diagram for multi-storey buildings

It then exports a native **DWG** (opens directly in AutoCAD) via the ODA File
Converter CLI. Emits a JSON result on stdout: {"dxf": path, "dwg": path|null, ...}.

Usage:  python compose_cad.py <input.json> <out_dir> [oda_exe]
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import ezdxf
from ezdxf.enums import TextEntityAlignment

# ── Layers: name -> (ACI colour, lineweight in 1/100 mm) ─────────────────────
LAYERS = {
    "A-WALL": (7, 50),
    "A-WALL-PATT": (8, 9),
    "A-AREA": (3, 9),
    "A-DOOR": (4, 25),
    "A-GLAZ": (5, 25),
    "A-GRID": (8, 9),
    "A-DIMS": (1, 18),
    "A-ANNO": (2, 18),
    "A-TTLB": (7, 35),
}


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def letters(i):
    s = ""
    n = i
    while True:
        s = chr(65 + (n % 26)) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


NICE = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]


def nice_step(target):
    best = NICE[0]
    for n in NICE:
        if n <= target:
            best = n
    return best


def uniq(vals, eps=0.05):
    out = []
    for v in sorted(vals):
        if not out or abs(v - out[-1]) > eps:
            out.append(v)
    return out


class Sheet:
    """Thin drawing helper over an ezdxf modelspace (metres, Y-up)."""

    def __init__(self, unit):
        self.doc = ezdxf.new("R2018", setup=True)
        self.msp = self.doc.modelspace()
        self.unit = unit
        self.doc.header["$INSUNITS"] = 6  # metres
        for name, (color, lw) in LAYERS.items():
            self.doc.layers.add(name, color=color, lineweight=lw)
        if "DL-ANNO" not in self.doc.styles:
            self.doc.styles.add("DL-ANNO", font="arial.ttf")

    def dimstyle(self, span):
        """Create a dimension style sized to the drawing span (metres)."""
        h = max(span * 0.014, 0.05)
        name = "DL"
        if name in self.doc.dimstyles:
            return name
        ds = self.doc.dimstyles.new(name)
        ds.dxf.dimtxt = h        # text height
        ds.dxf.dimasz = h        # arrow size
        ds.dxf.dimexe = h * 0.6  # extension beyond dim line
        ds.dxf.dimexo = h * 0.6  # extension line offset from geometry
        ds.dxf.dimgap = h * 0.4
        ds.dxf.dimtad = 1        # text above the dimension line
        ds.dxf.dimtih = 0        # text aligned with dim line
        ds.dxf.dimtoh = 0
        ds.dxf.dimdec = 0 if self.unit == "mm" else 2
        ds.dxf.dimlfac = 1000.0 if self.unit == "mm" else 1.0
        ds.dxf.dimtxsty = "DL-ANNO"
        try:
            ds.dxf.dimblk = "ARCHTICK"  # architectural tick
        except Exception:
            pass
        return name

    # primitives
    def line(self, layer, x1, y1, x2, y2):
        self.msp.add_line((x1, y1), (x2, y2), dxfattribs={"layer": layer})

    def pline(self, layer, pts, close=True):
        self.msp.add_lwpolyline(pts, close=close, dxfattribs={"layer": layer})

    def circle(self, layer, cx, cy, r):
        self.msp.add_circle((cx, cy), r, dxfattribs={"layer": layer})

    def arc(self, layer, cx, cy, r, a0, a1):
        self.msp.add_arc((cx, cy), r, a0, a1, dxfattribs={"layer": layer})

    def solid_hatch(self, layer, pts, color=None):
        h = self.msp.add_hatch(color=color if color is not None else 7, dxfattribs={"layer": layer})
        h.paths.add_polyline_path(pts, is_closed=True)
        return h

    def pattern_hatch(self, layer, pts, name="ANSI31", scale=0.2):
        h = self.msp.add_hatch(dxfattribs={"layer": layer})
        h.paths.add_polyline_path(pts, is_closed=True)
        try:
            h.set_pattern_fill(name, scale=scale)
        except Exception:
            pass
        return h

    def text(self, layer, x, y, h, s, align="LEFT", rot=0.0):
        al = {
            "LEFT": TextEntityAlignment.LEFT,
            "CENTER": TextEntityAlignment.MIDDLE_CENTER,
            "RIGHT": TextEntityAlignment.RIGHT,
        }.get(align, TextEntityAlignment.LEFT)
        t = self.msp.add_text(str(s)[:256], height=h, rotation=rot, dxfattribs={"layer": layer, "style": "DL-ANNO"})
        t.set_placement((x, y), align=al)

    def hdim(self, xs, ygeom, ydim, style):
        """Chain of horizontal linear dimensions along xs at dim-line y=ydim."""
        for i in range(len(xs) - 1):
            if xs[i + 1] - xs[i] < 0.35:
                continue
            dim = self.msp.add_linear_dim(
                base=(0, ydim), p1=(xs[i], ygeom), p2=(xs[i + 1], ygeom),
                angle=0, dimstyle=style, dxfattribs={"layer": "A-DIMS"},
            )
            dim.render()

    def vdim(self, ys, xgeom, xdim, style):
        for i in range(len(ys) - 1):
            if ys[i + 1] - ys[i] < 0.35:
                continue
            dim = self.msp.add_linear_dim(
                base=(xdim, 0), p1=(xgeom, ys[i]), p2=(xgeom, ys[i + 1]),
                angle=90, dimstyle=style, dxfattribs={"layer": "A-DIMS"},
            )
            dim.render()

    def north(self, x, y, r):
        self.circle("A-TTLB", x, y, r)
        self.solid_hatch("A-TTLB", [(x, y + r * 1.4), (x - r * 0.45, y - r * 0.4), (x + r * 0.45, y - r * 0.4)], color=7)
        self.text("A-TTLB", x, y + r + r * 0.6, r * 0.5, "N", "CENTER")

    def scalebar(self, x, y, total_m):
        seg = nice_step(max(0.5, total_m * 0.2 / 5))
        n = 5
        h = max(seg * 0.15, 0.1)
        th = max(seg * 0.28, 0.18)
        for i in range(n):
            x0 = x + i * seg
            box = [(x0, y), (x0 + seg, y), (x0 + seg, y + h), (x0, y + h)]
            if i % 2 == 0:
                self.solid_hatch("A-TTLB", box, color=7)
            else:
                self.pline("A-TTLB", box, True)
        self.text("A-TTLB", x, y - th * 1.7, th, "0")
        self.text("A-TTLB", x + (n / 2) * seg, y - th * 1.7, th, f"{(n / 2) * seg:g}", "CENTER")
        self.text("A-TTLB", x + n * seg, y - th * 1.7, th, f"{n * seg:g} m", "CENTER")

    def title_block(self, x, y, w, h, name, subtitle, con):
        th = h * 0.16
        self.pline("A-TTLB", [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)
        self.line("A-TTLB", x, y + h - th * 2.4, x + w, y + h - th * 2.4)
        self.line("A-TTLB", x + w - w * 0.32, y, x + w - w * 0.32, y + h)
        self.text("A-TTLB", x + th, y + h - th * 1.5, th * 1.6, name.upper()[:46])
        self.text("A-TTLB", x + th, y + h * 0.5, th, subtitle[:70])
        self.text("A-TTLB", x + th, y + h * 0.2, th,
                  f"WALLS EXT {con['extWallMm']:g}/INT {con['intWallMm']:g}mm  UNITS {self.unit.upper()}")
        self.text("A-TTLB", x + w - w * 0.30, y + h * 0.5, th * 1.1, "SCALE 1:100")
        self.text("A-TTLB", x + w - w * 0.30, y + h * 0.2, th, "DRAWLOGIX (AI)")

    def save_dwg(self, dxf_path, dwg_path, oda_exe):
        """Convert dxf → dwg using the ODA File Converter CLI (folder-based)."""
        if not oda_exe or not os.path.isfile(oda_exe):
            return False, f"ODA converter not found at {oda_exe!r}"
        in_dir = tempfile.mkdtemp(prefix="dl_oda_in_")
        out_dir = tempfile.mkdtemp(prefix="dl_oda_out_")
        base = os.path.basename(dxf_path)
        try:
            import shutil
            shutil.copy(dxf_path, os.path.join(in_dir, base))
            # ODAFileConverter IN OUT OUTVER OUTTYPE RECURSE AUDIT FILTER
            subprocess.run([oda_exe, in_dir, out_dir, "ACAD2018", "DWG", "0", "1", "*.dxf"],
                           timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            produced = os.path.join(out_dir, os.path.splitext(base)[0] + ".dwg")
            if os.path.isfile(produced):
                shutil.copy(produced, dwg_path)
                return True, None
            return False, "ODA produced no DWG"
        except Exception as e:  # noqa: BLE001
            return False, repr(e)


# ── Floor plan drawing ───────────────────────────────────────────────────────
def draw_floor(sh, floor, con, ox, oy, style):
    rooms = floor.get("rooms", [])
    W = _num(floor.get("width"))
    H = _num(floor.get("height"))
    ext = con["extWallMm"] / 1000.0
    intt = con["intWallMm"] / 1000.0

    def TX(x):
        return ox + x

    def TY(y):
        return oy + (H - y)

    on = lambda v, e: abs(v - e) < 0.06

    # exterior wall band + poché
    outer = [(TX(0), TY(0)), (TX(W), TY(0)), (TX(W), TY(H)), (TX(0), TY(H))]
    inner = [(TX(ext), TY(ext)), (TX(W - ext), TY(ext)), (TX(W - ext), TY(H - ext)), (TX(ext), TY(H - ext))]
    sh.pline("A-WALL", outer, True)
    sh.pline("A-WALL", inner, True)

    for r in rooms:
        x, y = _num(r.get("x")), _num(r.get("y"))
        w, h = _num(r.get("w")), _num(r.get("h"))
        x2, y2 = x + w, y + h
        sh.pline("A-AREA", [(TX(x), TY(y)), (TX(x2), TY(y)), (TX(x2), TY(y2)), (TX(x), TY(y2))], True)
        # partition faces (offset inward)
        if not on(x, 0):
            t = intt / 2
            sh.line("A-WALL", TX(x + t), TY(y + intt / 2), TX(x + t), TY(y2 - intt / 2))
        if not on(x2, W):
            t = intt / 2
            sh.line("A-WALL", TX(x2 - t), TY(y + intt / 2), TX(x2 - t), TY(y2 - intt / 2))
        if not on(y, 0):
            t = intt / 2
            sh.line("A-WALL", TX(x + intt / 2), TY(y + t), TX(x2 - intt / 2), TY(y + t))
        if not on(y2, H):
            t = intt / 2
            sh.line("A-WALL", TX(x + intt / 2), TY(y2 - t), TX(x2 - intt / 2), TY(y2 - t))
        # tags
        if str(r.get("kind")) == "circulation":
            sh.text("A-ANNO", TX(x + w / 2), TY(y + h / 2), 0.32, "CIRCULATION", "CENTER")
        else:
            sh.text("A-ANNO", TX(x + 0.3), TY(y + 0.85), 0.34, str(r.get("room", "")).upper())
            sh.text("A-AREA", TX(x + 0.3), TY(y + 1.45), 0.26, f"{int(_num(r.get('areaSqm')))} m2   {r.get('ref','')}")
            sh.text("A-DIMS", TX(x + 0.3), TY(y + 2.0), 0.24, f"{w:.2f} x {h:.2f}")

    for d in floor.get("doors", []):
        dx, dy, s = TX(_num(d.get("x"))), TY(_num(d.get("y"))), _num(d.get("size"), 0.9)
        if d.get("vertical"):
            sh.line("A-DOOR", dx, dy - s / 2, dx + s, dy - s / 2)
            sh.arc("A-DOOR", dx, dy - s / 2, s, 0, 90)
        else:
            sh.line("A-DOOR", dx - s / 2, dy, dx - s / 2, dy + s)
            sh.arc("A-DOOR", dx - s / 2, dy, s, 0, 90)

    for wn in floor.get("windows", []):
        wx, wy, s = TX(_num(wn.get("x"))), TY(_num(wn.get("y"))), _num(wn.get("size"), 1.2) / 2
        if wn.get("vertical"):
            sh.line("A-GLAZ", wx - 0.08, wy - s, wx - 0.08, wy + s)
            sh.line("A-GLAZ", wx + 0.08, wy - s, wx + 0.08, wy + s)
        else:
            sh.line("A-GLAZ", wx - s, wy - 0.08, wx + s, wy - 0.08)
            sh.line("A-GLAZ", wx - s, wy + 0.08, wx + s, wy + 0.08)

    # column grid + bubbles
    xs = uniq([_num(r.get("x")) for r in rooms] + [_num(r.get("x")) + _num(r.get("w")) for r in rooms])
    ys_screen = uniq([_num(r.get("y")) for r in rooms] + [_num(r.get("y")) + _num(r.get("h")) for r in rooms])
    ys_sheet = uniq([H - y for y in ys_screen])
    grid_top = oy + H + 1.4
    grid_left = ox - 4.8
    for i, gx in enumerate(xs):
        sh.line("A-GRID", TX(gx), oy, TX(gx), grid_top - 0.4)
        sh.circle("A-GRID", TX(gx), grid_top, 0.4)
        sh.text("A-GRID", TX(gx), grid_top, 0.32, letters(i), "CENTER")
    for i, gy in enumerate(ys_sheet):
        sh.line("A-GRID", grid_left + 0.4, oy + gy, ox, oy + gy)
        sh.circle("A-GRID", grid_left, oy + gy, 0.4)
        sh.text("A-GRID", grid_left, oy + gy, 0.32, str(i + 1), "CENTER")

    # REAL dimensions: per-bay + overall, both axes
    sh.hdim([TX(x) for x in xs], oy, oy - 1.4, style)
    sh.hdim([TX(0), TX(W)], oy, oy - 2.9, style)
    sh.vdim([oy + y for y in ys_sheet], ox, ox - 1.4, style)
    sh.vdim([oy, oy + H], ox, ox - 2.9, style)

    sh.text("A-ANNO", ox, grid_top + 1.1, 0.6, floor.get("label", "FLOOR PLAN"))
    return 4.8 + W + 1.0, 3.4 + H + 3.0


def stacking(sh, x, y, floors, con):
    bw = 6.0
    fh = max(1.8, con["floorToFloorM"])
    sh.text("A-ANNO", x, y + len(floors) * fh + 1.2, 0.5, "STACKING DIAGRAM")
    for i, fl in enumerate(floors):
        y0 = y + i * fh
        sh.pline("A-WALL", [(x, y0), (x + bw, y0), (x + bw, y0 + fh), (x, y0 + fh)], True)
        sh.text("A-ANNO", x + 0.3, y0 + fh / 2, 0.34, fl.get("label", "").replace(" PLAN", ""))
        sh.text("A-DIMS", x + bw + 0.3, y0 + 0.1, 0.28, f"+{i * con['floorToFloorM']:.2f}")


def compose_floorplan(data):
    con = data["construction"]
    floors = data["floors"]
    span_est = max((_num(f.get("width")) + _num(f.get("height")) for f in floors), default=10)
    sh = Sheet(con.get("unit", "mm"))
    style = sh.dimstyle(span_est)
    cursor = 0.0
    max_top = 0.0
    for f in floors:
        ox, oy = cursor + 4.8, 3.4
        w, h = draw_floor(sh, f, con, ox, oy, style)
        cursor += w + 6.0
        max_top = max(max_top, oy + _num(f.get("height")) + 5.0)
    if len(floors) > 1:
        stacking(sh, cursor, 3.4, floors, con)
        cursor += 10.0
    sh.north(2.0, max_top + 2.5, 1.0)
    sh.scalebar(6.0, max_top + 2.0, max((_num(f.get("width")) for f in floors), default=10))
    sub = (f"{len(floors)}-STOREY  " + " / ".join(f.get("label", "").replace(" FLOOR PLAN", "") for f in floors)) if len(floors) > 1 else "GENERAL ARRANGEMENT"
    sh.title_block(max(cursor - 18, 0), -6.5, 18, 4.2, data.get("projectName", "DrawLogix Concept"), sub, con)
    return sh


def compose_freeform(data):
    con = data.get("construction", {"extWallMm": 200, "intWallMm": 100, "floorToFloorM": 3.0, "storeys": 1, "unit": "m"})
    ents = data.get("freeform", [])
    # bbox of geometry (non-text)
    xs, ys = [], []
    for e in ents:
        k = e.get("kind")
        if k == "text":
            continue
        if k == "line":
            xs += [_num(e.get("x")), _num(e.get("x2"))]
            ys += [_num(e.get("y")), _num(e.get("y2"))]
        elif k == "rect":
            xs += [_num(e.get("x")), _num(e.get("x")) + _num(e.get("w"))]
            ys += [_num(e.get("y")), _num(e.get("y")) + _num(e.get("h"))]
        elif k == "circle":
            r = _num(e.get("r"), 0.5)
            xs += [_num(e.get("x")) - r, _num(e.get("x")) + r]
            ys += [_num(e.get("y")) - r, _num(e.get("y")) + r]
    minx, maxx = (min(xs), max(xs)) if xs else (0, 10)
    miny, maxy = (min(ys), max(ys)) if ys else (0, 10)
    W, Hh = max(maxx - minx, 1), max(maxy - miny, 1)
    span = max(W, Hh)
    unit = "m" if span > 60 else "mm"
    con = {**con, "unit": unit}
    sh = Sheet(unit)
    style = sh.dimstyle(span)
    min_label = span * 0.012

    def maplayer(name):
        u = str(name or "0").upper()
        if u in LAYERS:
            return u
        if "DIM" in u:
            return "A-DIMS"
        if any(k in u for k in ("GRID", "AXIS", "SETOUT", "SETTING")):
            return "A-GRID"
        if any(k in u for k in ("GLAZ", "WINDOW", "GLASS")):
            return "A-GLAZ"
        if any(k in u for k in ("DOOR", "GATE")):
            return "A-DOOR"
        if any(k in u for k in ("WALL", "FENCE", "BUILD", "SHED", "RACK", "CONTAINER", "YARD", "ZONE", "BOUND", "SLAB", "ROAD", "KERB", "PLOT")):
            return "A-WALL"
        return "A-ANNO"

    for e in ents:
        L = maplayer(e.get("layer"))
        k = e.get("kind")
        if k == "line":
            sh.line(L, _num(e.get("x")), _num(e.get("y")), _num(e.get("x2")), _num(e.get("y2")))
        elif k == "rect":
            x, y, w, h = _num(e.get("x")), _num(e.get("y")), _num(e.get("w"), 1), _num(e.get("h"), 1)
            sh.pline(L, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)
        elif k == "circle":
            sh.circle(L, _num(e.get("x")), _num(e.get("y")), _num(e.get("r"), 0.5))
        else:
            sh.text(L, _num(e.get("x")), _num(e.get("y")), max(_num(e.get("height"), 0), min_label), e.get("text", ""))

    has_dims = any(maplayer(e.get("layer")) == "A-DIMS" for e in ents)
    if not has_dims:
        sh.hdim([minx, maxx], miny, miny - span * 0.05, style)
        sh.vdim([miny, maxy], minx, minx - span * 0.05, style)

    pad = span * 0.06
    fx0, fy0, fx1, fy1 = minx - pad * 2.4, miny - pad * 2.8, maxx + pad, maxy + pad * 1.2
    sh.pline("A-TTLB", [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)], True)
    sh.north(fx1 - pad * 1.3, fy1 - pad * 1.3, span * 0.03)
    sh.scalebar(fx0 + pad * 0.6, fy0 + pad * 0.9, W)
    sh.title_block(fx1 - span * 0.42, fy0 + pad * 0.3, span * 0.42, span * 0.12, data.get("projectName", "Concept Drawing"), "SITE / GENERAL ARRANGEMENT", con)
    return sh


def main():
    in_path, out_dir = sys.argv[1], sys.argv[2]
    oda_exe = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("DRAWLOGIX_ODA", r"C:/Users/IKIO/ODA/ODAFileConverter.exe")
    with open(in_path, encoding="utf-8") as fh:
        data = json.load(fh)

    sh = compose_freeform(data) if data.get("mode") == "freeform" else compose_floorplan(data)
    sh.doc.set_modelspace_vport(center=(0, 0), height=200)

    os.makedirs(out_dir, exist_ok=True)
    dxf_path = os.path.join(out_dir, "drawing.dxf")
    dwg_path = os.path.join(out_dir, "drawing.dwg")
    sh.doc.saveas(dxf_path)
    ok, err = sh.save_dwg(dxf_path, dwg_path, oda_exe)
    print(json.dumps({"dxf": dxf_path, "dwg": dwg_path if ok else None, "dwgError": err}))


if __name__ == "__main__":
    main()
