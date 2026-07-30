import type { ScheduleRow } from "@/db/schema";
import { resolvePlan } from "./floorplan";
import { PALETTE, PX_PER_M } from "./layout";

/**
 * Rule-based concept generation (no external AI key required). Turns the project's
 * document text into: structured requirements, an area schedule, and a viewable
 * concept floor-plan as both SVG (in-app) and DXF (opens in AutoCAD/Revit). Every
 * room traces back to the requirement that produced it.
 */

export interface ExtractedRequirement {
  ref: string;
  seq: number;
  category: "space" | "constraint" | "assumption" | "exclusion" | "clarification";
  title: string;
  detail?: string;
  sourceDocumentId?: string;
}

// Default office programme used when the documents don't name enough spaces.
const DEFAULT_PROGRAM: { room: string; areaSqm: number }[] = [
  { room: "Reception", areaSqm: 20 },
  { room: "Open Office", areaSqm: 64 },
  { room: "Meeting Room", areaSqm: 18 },
  { room: "Manager Office", areaSqm: 16 },
  { room: "Kitchenette", areaSqm: 12 },
  { room: "WC", areaSqm: 6 },
  { room: "Store", areaSqm: 8 },
];

// Keyword → default area (m²) when a space is named without an explicit area.
const ROOM_KEYWORDS: { kw: RegExp; room: string; area: number }[] = [
  { kw: /reception|lobby|foyer/i, room: "Reception", area: 20 },
  { kw: /open[\s-]?plan|open office|workspace|bullpen/i, room: "Open Office", area: 64 },
  { kw: /meeting|conference|boardroom/i, room: "Meeting Room", area: 18 },
  { kw: /manager|director|private office|cellular office/i, room: "Manager Office", area: 16 },
  { kw: /kitchen|pantry|tea point|breakout/i, room: "Kitchenette", area: 12 },
  { kw: /toilet|wc|restroom|washroom/i, room: "WC", area: 6 },
  { kw: /store|storage|archive/i, room: "Store", area: 8 },
  { kw: /server|comms|it room|data/i, room: "Server Room", area: 9 },
  { kw: /lab|laboratory/i, room: "Laboratory", area: 40 },
  { kw: /ward|consult|clinic|exam/i, room: "Consulting Room", area: 14 },
  { kw: /classroom|teaching|lecture/i, room: "Classroom", area: 50 },
  { kw: /warehouse|workshop|plant/i, room: "Workshop", area: 120 },
];

function categorize(line: string): ExtractedRequirement["category"] {
  if (/\b(exclude|excluding|not included|out of scope)\b/i.test(line)) return "exclusion";
  if (/\b(assume|assumption|tbc|to be confirmed)\b/i.test(line)) return "assumption";
  if (/\b(must|shall|require|minimum|maximum|comply|standard)\b/i.test(line)) return "constraint";
  if (/\b(room|office|space|area|reception|meeting|kitchen|toilet|store|ward|lab)\b/i.test(line)) return "space";
  return "clarification";
}

/** Pull requirement-like lines out of raw document text. */
export function extractRequirements(
  docs: { id: string; content: string | null }[],
): ExtractedRequirement[] {
  const out: ExtractedRequirement[] = [];
  let seq = 0;
  for (const doc of docs) {
    const lines = (doc.content ?? "")
      .split(/\r?\n|(?<=[.;])\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 8 && l.length <= 480);
    for (const line of lines) {
      seq += 1;
      out.push({
        ref: `R-${String(seq).padStart(3, "0")}`,
        seq,
        category: categorize(line),
        title: line.length > 120 ? `${line.slice(0, 117)}…` : line,
        detail: line.length > 120 ? line : undefined,
        sourceDocumentId: doc.id,
      });
      if (seq >= 40) break; // keep it sane
    }
  }
  return out;
}

/** Derive an area schedule from the requirements (or the default programme). */
export function deriveSchedule(reqs: ExtractedRequirement[]): ScheduleRow[] {
  const found = new Map<string, ScheduleRow>();
  for (const r of reqs) {
    const text = `${r.title} ${r.detail ?? ""}`;
    const areaMatch = text.match(/(\d{1,4})\s?(?:m2|m²|sqm|sq\.?m|square met)/i);
    for (const k of ROOM_KEYWORDS) {
      if (k.kw.test(text) && !found.has(k.room)) {
        found.set(k.room, {
          ref: `A-${String(found.size + 1).padStart(2, "0")}`,
          room: k.room,
          areaSqm: areaMatch ? Number(areaMatch[1]) : k.area,
          requirementRef: r.ref,
        });
      }
    }
  }
  const rows = found.size > 0 ? [...found.values()] : DEFAULT_PROGRAM.map((p, i) => ({ ref: `A-${String(i + 1).padStart(2, "0")}`, ...p }));
  return rows;
}

/** Inline SVG floor plan: exterior walls, partitions, doors, windows (metric → px). */
export function buildSvg(rows: ScheduleRow[]): string {
  const P = PX_PER_M;
  const M = 6; // px margin
  const { rooms, width, height, doors, windows } = resolvePlan(rows);
  const W = width * P + M * 2;
  const H = height * P + M * 2;
  const px = (v: number) => v * P + M;

  const roomSvg = rooms
    .map((r, i) => {
      const x = px(r.x ?? 0);
      const y = px(r.y ?? 0);
      const w = (r.w ?? 0) * P;
      const h = (r.h ?? 0) * P;
      if (r.kind === "circulation") {
        return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e2e8f0"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#64748b" stroke-width="1.5"/>
  <text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#475569">Circulation</text>
</g>`;
      }
      const color = PALETTE[i % PALETTE.length];
      const dims = `${(r.w ?? 0).toFixed(1)} × ${(r.h ?? 0).toFixed(1)} m`;
      return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}14"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#334155" stroke-width="2"/>
  <text x="${x + 7}" y="${y + 18}" font-family="sans-serif" font-size="12" font-weight="700" fill="#1e1b3a">${escapeXml(r.room)}</text>
  <text x="${x + 7}" y="${y + 33}" font-family="sans-serif" font-size="10.5" fill="#555">${r.areaSqm} m² · ${r.ref}</text>
  <text x="${x + 7}" y="${y + 47}" font-family="sans-serif" font-size="9.5" fill="#94a3b8">${dims}</text>
</g>`;
    })
    .join("\n");

  // Exterior wall = thick envelope outline.
  const envelope = `<rect x="${px(0)}" y="${px(0)}" width="${width * P}" height="${height * P}" fill="none" stroke="#1e1b3a" stroke-width="6"/>`;

  const opening = (cx: number, cy: number, vertical: boolean, s: number, fill: string) =>
    vertical
      ? `<rect x="${cx - 5}" y="${cy - s / 2}" width="10" height="${s}" fill="${fill}"/>`
      : `<rect x="${cx - s / 2}" y="${cy - 5}" width="${s}" height="10" fill="${fill}"/>`;

  const doorSvg = doors
    .map((d) => {
      const cx = px(d.x);
      const cy = px(d.y);
      const s = d.size * P;
      const swing = d.vertical
        ? `<path d="M ${cx} ${cy - s / 2} A ${s} ${s} 0 0 1 ${cx + s} ${cy + s / 2}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`
        : `<path d="M ${cx - s / 2} ${cy} A ${s} ${s} 0 0 1 ${cx + s / 2} ${cy + s}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`;
      return `<g>${opening(cx, cy, d.vertical, s, "#ffffff")}${swing}</g>`;
    })
    .join("\n");

  // Window = wall gap + a blue line.
  const winSvg = windows
    .map((wn) => {
      const cx = px(wn.x);
      const cy = px(wn.y);
      const s = wn.size * P;
      const ln = wn.vertical
        ? `<line x1="${cx}" y1="${cy - s / 2}" x2="${cx}" y2="${cy + s / 2}" stroke="#0ea5e9" stroke-width="2.5"/>`
        : `<line x1="${cx - s / 2}" y1="${cy}" x2="${cx + s / 2}" y2="${cy}" stroke="#0ea5e9" stroke-width="2.5"/>`;
      return `<g>${opening(cx, cy, wn.vertical, s, "#ffffff")}${ln}</g>`;
    })
    .join("\n");

  const caption = `<text x="${M}" y="${H - 6}" font-family="sans-serif" font-size="11" fill="#475569">Building: ${width.toFixed(1)} × ${height.toFixed(1)} m · ${rooms.filter((r) => r.kind !== "circulation").length} rooms</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 18}" width="${W}" height="${H + 18}">
  <rect x="0" y="0" width="${W}" height="${H + 18}" fill="#ffffff"/>
${roomSvg}
${envelope}
${doorSvg}
${winSvg}
${caption}
</svg>`;
}

// Standard AIA-style layers (so it drops straight into an AutoCAD office template).
const DXF_LAYERS: { name: string; aci: number }[] = [
  { name: "A-WALL", aci: 7 }, // walls
  { name: "A-AREA", aci: 3 }, // room boundaries (closed polylines → AREA/HATCH work)
  { name: "A-DOOR", aci: 4 }, // door leaf + swing
  { name: "A-GLAZ", aci: 5 }, // windows / glazing
  { name: "A-ANNO", aci: 2 }, // room tags
  { name: "A-DIMS", aci: 1 }, // dimensions
  { name: "A-TTLB", aci: 8 }, // title block
];

/**
 * AutoCAD-grade R12 DXF: HEADER (metres), a real LAYER table (WALLS/DOORS/TEXT/DIMS/
 * TITLE), room walls + door openings, room labels, overall dimensions, and a title
 * block. Geometry is metric (1 unit = 1 m), so dimensions are truthful.
 */
export function buildDxf(rows: ScheduleRow[], projectName = "DrawLogix Concept"): string {
  const { rooms, width, height, doors, windows } = resolvePlan(rows);
  const flipY = (y: number) => height - y; // DXF Y is up

  const ents: string[] = [];
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    ents.push("0", "LINE", "8", layer, "10", `${x1.toFixed(3)}`, "20", `${y1.toFixed(3)}`, "11", `${x2.toFixed(3)}`, "21", `${y2.toFixed(3)}`);
  const text = (layer: string, x: number, y: number, h: number, s: string) =>
    ents.push("0", "TEXT", "8", layer, "10", `${x.toFixed(3)}`, "20", `${y.toFixed(3)}`, "40", `${h.toFixed(3)}`, "1", s.replace(/[\n\r]/g, " "), "7", "STANDARD");
  const polyline = (layer: string, pts: [number, number][], closed: boolean) => {
    ents.push("0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0");
    for (const p of pts) ents.push("0", "VERTEX", "8", layer, "10", `${p[0].toFixed(3)}`, "20", `${p[1].toFixed(3)}`);
    ents.push("0", "SEQEND");
  };
  const rectPoly = (layer: string, x: number, yb: number, x2: number, yt: number) => polyline(layer, [[x, yb], [x2, yb], [x2, yt], [x, yt]], true);

  // Exterior envelope on A-WALL. Each room is a CLOSED polyline on A-AREA so AutoCAD's
  // AREA / HATCH / room-tag tools work on it directly. Room tags on A-ANNO.
  rectPoly("A-WALL", 0, 0, width, height);
  for (const r of rooms) {
    const x1 = r.x ?? 0;
    const x2 = x1 + (r.w ?? 0);
    const yb = flipY((r.y ?? 0) + (r.h ?? 0));
    const yt = flipY(r.y ?? 0);
    rectPoly("A-AREA", x1, yb, x2, yt);
    if (r.kind !== "circulation") {
      text("A-ANNO", x1 + 0.3, yt - 0.7, 0.35, r.room.toUpperCase());
      text("A-ANNO", x1 + 0.3, yt - 1.3, 0.28, `AREA = ${r.areaSqm} m2`);
      text("A-DIMS", x1 + 0.3, yt - 1.85, 0.24, `${(r.w ?? 0).toFixed(1)} x ${(r.h ?? 0).toFixed(1)} m`);
    } else {
      text("A-ANNO", x1 + 0.3, yt - 0.7, 0.3, "CIRCULATION");
    }
  }

  // Doors: a leaf line + a quarter-circle swing on A-DOOR.
  for (const d of doors) {
    const cx = d.x;
    const cy = flipY(d.y);
    const s = d.size;
    const arc: [number, number][] = [];
    if (d.vertical) {
      const hy = cy - s / 2;
      line("A-DOOR", cx, hy, cx + s, hy);
      for (let i = 0; i <= 8; i++) {
        const a = (Math.PI / 2) * (i / 8);
        arc.push([cx + s * Math.cos(a), hy + s * Math.sin(a)]);
      }
    } else {
      const hx = cx - s / 2;
      line("A-DOOR", hx, cy, hx, cy + s);
      for (let i = 0; i <= 8; i++) {
        const a = (Math.PI / 2) * (i / 8);
        arc.push([hx + s * Math.sin(a), cy + s * Math.cos(a)]);
      }
    }
    polyline("A-DOOR", arc, false);
  }
  // Windows: double line on A-GLAZ.
  for (const wn of windows) {
    const cx = wn.x;
    const cy = flipY(wn.y);
    const s = wn.size / 2;
    if (wn.vertical) {
      line("A-GLAZ", cx - 0.1, cy - s, cx - 0.1, cy + s);
      line("A-GLAZ", cx + 0.1, cy - s, cx + 0.1, cy + s);
    } else {
      line("A-GLAZ", cx - s, cy - 0.1, cx + s, cy - 0.1);
      line("A-GLAZ", cx - s, cy + 0.1, cx + s, cy + 0.1);
    }
  }

  // Linear dimensions (extension lines + ticks + measurement text) on A-DIMS.
  const tick = (x: number, y: number) => line("A-DIMS", x - 0.12, y - 0.12, x + 0.12, y + 0.12);
  {
    const dy = -1.6;
    line("A-DIMS", 0, 0, 0, dy - 0.3);
    line("A-DIMS", width, 0, width, dy - 0.3);
    line("A-DIMS", 0, dy, width, dy);
    tick(0, dy);
    tick(width, dy);
    text("A-DIMS", width / 2 - 0.6, dy + 0.15, 0.32, `${width.toFixed(1)} m`);
  }
  {
    const dx = -1.6;
    line("A-DIMS", 0, 0, dx - 0.3, 0);
    line("A-DIMS", 0, height, dx - 0.3, height);
    line("A-DIMS", dx, 0, dx, height);
    tick(dx, 0);
    tick(dx, height);
    text("A-DIMS", dx - 0.5, height / 2, 0.32, `${height.toFixed(1)} m`);
  }

  // Title block on A-TTLB.
  {
    const total = rows.reduce((a, s) => a + s.areaSqm, 0);
    const bx = 0;
    const by = -6.2;
    const bw = Math.max(12, width * 0.6);
    const bh = 3.4;
    rectPoly("A-TTLB", bx, by, bx + bw, by + bh);
    line("A-TTLB", bx, by + bh - 1.2, bx + bw, by + bh - 1.2);
    text("A-TTLB", bx + 0.4, by + bh - 0.85, 0.5, projectName.toUpperCase());
    text("A-TTLB", bx + 0.4, by + 1.9, 0.32, "DrawLogix — AI Concept Plan");
    text("A-TTLB", bx + 0.4, by + 1.3, 0.3, `TOTAL AREA: ${total} m2   ROOMS: ${rows.length}`);
    text("A-TTLB", bx + 0.4, by + 0.7, 0.3, "UNITS: METRES   DRAWN BY: DRAWLOGIX");
  }

  const header = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "6",
    "9", "$EXTMIN", "10", "-2.0", "20", "-7.0",
    "9", "$EXTMAX", "10", `${(width + 1).toFixed(1)}`, "20", `${(height + 1).toFixed(1)}`,
    "0", "ENDSEC",
  ];
  const layerTable: string[] = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", `${DXF_LAYERS.length + 1}`];
  layerTable.push("0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS");
  for (const l of DXF_LAYERS) layerTable.push("0", "LAYER", "2", l.name, "70", "0", "62", `${l.aci}`, "6", "CONTINUOUS");
  layerTable.push("0", "ENDTAB", "0", "ENDSEC");

  return [...header, ...layerTable, "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"].join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

// ── IFC4 export (opens in Revit / ArchiCAD / IFC viewers) ─────────────────────
const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function ifcGuid(): string {
  let s = "";
  for (let i = 0; i < 22; i++) s += IFC64[Math.floor(Math.random() * 64)];
  return s;
}
const ifcStr = (s: string) => s.replace(/'/g, "''");

/**
 * Minimal but valid IFC4: IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey,
 * with one IfcSpace per room (extruded rectangular geometry, 3 m high). Opens in
 * Revit/ArchiCAD/BIM viewers as a coordinated set of room volumes.
 */
export function buildIfc(rows: ScheduleRow[], projectName = "DrawLogix Concept"): string {
  const M = 1; // layout is already metric
  const H = "3.0"; // storey height
  const { rooms: placed, height } = resolvePlan(rows);

  let id = 0;
  const e: string[] = [];
  const add = (body: string) => {
    id += 1;
    e.push(`#${id}=${body};`);
    return id;
  };

  const person = add("IFCPERSON($,'DrawLogix',$,$,$,$,$,$)");
  const org = add("IFCORGANIZATION($,'DrawLogix',$,$,$)");
  const pao = add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = add(`IFCAPPLICATION(#${org},'1.0','DrawLogix','DrawLogix')`);
  const owner = add(`IFCOWNERHISTORY(#${pao},#${app},$,.ADDED.,$,$,$,0)`);

  const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const axis = add(`IFCAXIS2PLACEMENT3D(#${origin},$,$)`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${axis},$)`);
  const lenU = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const areaU = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const volU = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  const units = add(`IFCUNITASSIGNMENT((#${lenU},#${areaU},#${volU}))`);

  const project = add(`IFCPROJECT('${ifcGuid()}',#${owner},'${ifcStr(projectName)}',$,$,$,$,(#${ctx}),#${units})`);
  const sitePlace = add(`IFCLOCALPLACEMENT($,#${axis})`);
  const site = add(`IFCSITE('${ifcGuid()}',#${owner},'Site',$,$,#${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bPlace = add(`IFCLOCALPLACEMENT(#${sitePlace},#${axis})`);
  const building = add(`IFCBUILDING('${ifcGuid()}',#${owner},'Building',$,$,#${bPlace},$,$,.ELEMENT.,$,$,$)`);
  const sPlace = add(`IFCLOCALPLACEMENT(#${bPlace},#${axis})`);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid()}',#${owner},'Ground Floor',$,$,#${sPlace},$,$,.ELEMENT.,0.)`);

  const spaces: number[] = [];
  for (const r of placed) {
    const rx = r.x ?? 0;
    const ry = r.y ?? 0;
    const rw = r.w ?? 0;
    const rh = r.h ?? 0;
    const w = (rw * M).toFixed(3);
    const d = (rh * M).toFixed(3);
    const cx = ((rx + rw / 2) * M).toFixed(3);
    const cy = ((height - (ry + rh / 2)) * M).toFixed(3);
    const locPt = add(`IFCCARTESIANPOINT((${cx},${cy},0.))`);
    const locAxis = add(`IFCAXIS2PLACEMENT3D(#${locPt},$,$)`);
    const place = add(`IFCLOCALPLACEMENT(#${sPlace},#${locAxis})`);
    const profPt = add("IFCCARTESIANPOINT((0.,0.))");
    const profPlace = add(`IFCAXIS2PLACEMENT2D(#${profPt},$)`);
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profPlace},${w},${d})`);
    const extrDir = add("IFCDIRECTION((0.,0.,1.))");
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${axis},#${extrDir},${H})`);
    const shapeRep = add(`IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
    const prodDef = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);
    const space = add(
      `IFCSPACE('${ifcGuid()}',#${owner},'${ifcStr(r.room)}',$,$,#${place},#${prodDef},'${ifcStr(r.ref)}',.ELEMENT.,.INTERNAL.,$)`,
    );
    spaces.push(space);
  }

  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${storey},(${spaces.map((s) => `#${s}`).join(",")}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${building},(#${storey}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${site},(#${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${project},(#${site}))`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('drawlogix.ifc','${new Date().toISOString()}',(''),(''),'DrawLogix','DrawLogix','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ].join("\n");

  return `${header}\n${e.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
