import type { FreeformEntity } from "@/ai/agent";
import type { ScheduleRow } from "@/db/schema";
import { decodeConstruction, type Floor, floorsFromSchedule } from "./drafting";

/**
 * IFC4 BIM export for Autodesk Revit (Revit → Open → IFC). Builds a real, coordinated
 * building model — IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey per floor,
 * each storey carrying an IfcSlab, IfcSpace per room, and IfcWallStandardCase walls
 * (exterior envelope + partitions), all as extruded solids at the correct level. This
 * is a hand-written STEP model (no ifcopenshell dependency). Pure — no DOM/DB.
 *
 * NOTE on ".rvt": there is no supported way to write Autodesk's native .rvt format
 * outside Revit itself. IFC is the industry-standard, Revit-native interchange — Revit
 * opens/links it directly and rebuilds walls/slabs/rooms as editable elements.
 */

const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
// Deterministic pseudo-GUID (no Math.random — unavailable in some runtimes). Seeded per call.
function guidGen() {
  let seed = 0x2545f491;
  return (): string => {
    let s = "";
    for (let i = 0; i < 22; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      s += IFC64[seed % 64];
    }
    return s;
  };
}
const esc = (s: string) => s.replace(/'/g, "''").replace(/[\r\n]/g, " ");

interface Ctx {
  e: string[];
  id: number;
  guid: () => string;
  owner: number;
  ctx: number;
  axis: number;
}

function step(ctx: Ctx, body: string): number {
  ctx.id += 1;
  ctx.e.push(`#${ctx.id}=${body};`);
  return ctx.id;
}

/** IfcLocalPlacement at (x,y,z) relative to `rel` (0 = none). */
function placement(ctx: Ctx, x: number, y: number, z: number, rel: number): number {
  const p = step(ctx, `IFCCARTESIANPOINT((${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}))`);
  const a = step(ctx, `IFCAXIS2PLACEMENT3D(#${p},$,$)`);
  return step(ctx, `IFCLOCALPLACEMENT(${rel ? `#${rel}` : "$"},#${a})`);
}

/** An extruded solid from a closed 2D polygon (metres) pushed +Z by `height`. */
function extruded(ctx: Ctx, poly: Array<[number, number]>, height: number): number {
  const pts = poly.map(([x, y]) => step(ctx, `IFCCARTESIANPOINT((${x.toFixed(3)},${y.toFixed(3)}))`));
  const loop = step(ctx, `IFCPOLYLINE((${pts.map((p) => `#${p}`).join(",")},#${pts[0]}))`);
  const prof = step(ctx, `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${loop})`);
  const dir = step(ctx, "IFCDIRECTION((0.,0.,1.))");
  return step(ctx, `IFCEXTRUDEDAREASOLID(#${prof},#${ctx.axis},#${dir},${height.toFixed(3)})`);
}

function shape(ctx: Ctx, solid: number): number {
  const rep = step(ctx, `IFCSHAPEREPRESENTATION(#${ctx.ctx},'Body','SweptSolid',(#${solid}))`);
  return step(ctx, `IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
}

/** A thickened wall rectangle (footprint) from a centreline segment. */
function wallRect(x1: number, y1: number, x2: number, y2: number, t: number): Array<[number, number]> {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2);
  const ny = (dx / len) * (t / 2);
  return [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function header(name: string): string {
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${esc(name)}.ifc','2026-01-01T00:00:00',(''),(''),'DrawLogix','DrawLogix','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ].join("\n");
}

function newCtx(guid: () => string): Ctx {
  const ctx: Ctx = { e: [], id: 0, guid, owner: 0, ctx: 0, axis: 0 };
  const person = step(ctx, "IFCPERSON($,'DrawLogix',$,$,$,$,$,$)");
  const org = step(ctx, "IFCORGANIZATION($,'DrawLogix',$,$,$)");
  const pao = step(ctx, `IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = step(ctx, `IFCAPPLICATION(#${org},'1.0','DrawLogix','DrawLogix')`);
  ctx.owner = step(ctx, `IFCOWNERHISTORY(#${pao},#${app},$,.ADDED.,$,$,$,0)`);
  const origin = step(ctx, "IFCCARTESIANPOINT((0.,0.,0.))");
  ctx.axis = step(ctx, `IFCAXIS2PLACEMENT3D(#${origin},$,$)`);
  ctx.ctx = step(ctx, `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${ctx.axis},$)`);
  return ctx;
}

function units(ctx: Ctx): number {
  const len = step(ctx, "IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const area = step(ctx, "IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const vol = step(ctx, "IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  return step(ctx, `IFCUNITASSIGNMENT((#${len},#${area},#${vol}))`);
}

function aggregate(ctx: Ctx, parent: number, children: number[]) {
  if (children.length === 0) return;
  step(ctx, `IFCRELAGGREGATES('${ctx.guid()}',#${ctx.owner},$,$,#${parent},(${children.map((c) => `#${c}`).join(",")}))`);
}
function contain(ctx: Ctx, storey: number, products: number[]) {
  if (products.length === 0) return;
  step(ctx, `IFCRELCONTAINEDINSPATIALSTRUCTURE('${ctx.guid()}',#${ctx.owner},$,$,(${products.map((p) => `#${p}`).join(",")}),#${storey})`);
}

/** Build a multi-storey BIM model from solved floors. */
function buildBim(floors: Floor[], construction: ReturnType<typeof decodeConstruction>, name: string): string {
  const ctx = newCtx(guidGen());
  const unitAssign = units(ctx);
  const project = step(ctx, `IFCPROJECT('${ctx.guid()}',#${ctx.owner},'${esc(name)}',$,$,$,$,(#${ctx.ctx}),#${unitAssign})`);
  const sitePl = placement(ctx, 0, 0, 0, 0);
  const site = step(ctx, `IFCSITE('${ctx.guid()}',#${ctx.owner},'Site',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPl = placement(ctx, 0, 0, 0, sitePl);
  const building = step(ctx, `IFCBUILDING('${ctx.guid()}',#${ctx.owner},'${esc(name)}',$,$,#${bldgPl},$,$,.ELEMENT.,$,$,$)`);

  const f2f = construction.floorToFloorM || 3;
  const ext = construction.extWallMm / 1000;
  const intt = construction.intWallMm / 1000;
  const storeys: number[] = [];

  floors.forEach((floor, i) => {
    const z = i * f2f;
    const H = floor.plan.height;
    const W = floor.plan.width;
    const storeyPl = placement(ctx, 0, 0, z, bldgPl);
    const storey = step(ctx, `IFCBUILDINGSTOREY('${ctx.guid()}',#${ctx.owner},'${esc(floor.label.replace(/ PLAN$/i, ""))}',$,$,#${storeyPl},$,$,.ELEMENT.,${z.toFixed(3)})`);
    storeys.push(storey);
    const products: number[] = [];
    const fy = (y: number) => H - y; // room y is screen-down → IFC plan y-up

    // Slab (floor plate).
    {
      const slabPl = placement(ctx, 0, 0, 0, storeyPl);
      const solid = extruded(ctx, [[0, 0], [W, 0], [W, H], [0, H]], -0.2);
      const shp = shape(ctx, solid);
      products.push(step(ctx, `IFCSLAB('${ctx.guid()}',#${ctx.owner},'Floor Slab',$,$,#${slabPl},#${shp},$,.FLOOR.)`));
    }

    // Exterior walls (4) + partition walls (unique interior room edges).
    const walls: Array<[number, number, number, number, number]> = [
      [0, 0, W, 0, ext], [W, 0, W, H, ext], [W, H, 0, H, ext], [0, H, 0, 0, ext],
    ];
    const seen = new Set<string>();
    const near = (v: number, e: number) => Math.abs(v - e) < 0.06;
    for (const r of floor.plan.rooms) {
      const x = r.x ?? 0;
      const y = r.y ?? 0;
      const w = r.w ?? 0;
      const h = r.h ?? 0;
      const edges: Array<[number, number, number, number]> = [
        [x, fy(y + h), x + w, fy(y + h)], // bottom (screen) → top strip
        [x, fy(y), x + w, fy(y)],
        [x, fy(y), x, fy(y + h)],
        [x + w, fy(y), x + w, fy(y + h)],
      ];
      for (const [ax, ay, bx, by] of edges) {
        const onExt = (near(ax, 0) && near(bx, 0)) || (near(ax, W) && near(bx, W)) || (near(ay, 0) && near(by, 0)) || (near(ay, H) && near(by, H));
        if (onExt) continue;
        const key = [round2(ax), round2(ay), round2(bx), round2(by)].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        walls.push([ax, ay, bx, by, intt]);
      }
    }
    for (const [x1, y1, x2, y2, t] of walls) {
      const wallPl = placement(ctx, 0, 0, 0, storeyPl);
      const solid = extruded(ctx, wallRect(x1, y1, x2, y2, t), Math.max(2.4, f2f - 0.2));
      const shp = shape(ctx, solid);
      products.push(step(ctx, `IFCWALLSTANDARDCASE('${ctx.guid()}',#${ctx.owner},'Wall',$,$,#${wallPl},#${shp},$,$)`));
    }

    // Spaces (rooms) as extruded volumes.
    const spaces: number[] = [];
    for (const r of floor.plan.rooms) {
      const x = r.x ?? 0;
      const y = r.y ?? 0;
      const w = r.w ?? 0;
      const h = r.h ?? 0;
      const spPl = placement(ctx, 0, 0, 0, storeyPl);
      const solid = extruded(ctx, [[x, fy(y + h)], [x + w, fy(y + h)], [x + w, fy(y)], [x, fy(y)]], Math.max(2.4, f2f - 0.2));
      const shp = shape(ctx, solid);
      spaces.push(step(ctx, `IFCSPACE('${ctx.guid()}',#${ctx.owner},'${esc(r.room)}',$,$,#${spPl},#${shp},'${esc(r.ref)}',.ELEMENT.,.INTERNAL.,$)`));
    }
    aggregate(ctx, storey, spaces);
    contain(ctx, storey, products);
  });

  aggregate(ctx, building, storeys);
  aggregate(ctx, site, [building]);
  aggregate(ctx, project, [site]);
  return `${header(name)}\n${ctx.e.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/** Minimal but valid site IFC from freeform primitives (zones as IfcSpace on the site). */
function buildSite(entities: FreeformEntity[], name: string): string {
  const ctx = newCtx(guidGen());
  const unitAssign = units(ctx);
  const project = step(ctx, `IFCPROJECT('${ctx.guid()}',#${ctx.owner},'${esc(name)}',$,$,$,$,(#${ctx.ctx}),#${unitAssign})`);
  const sitePl = placement(ctx, 0, 0, 0, 0);
  const site = step(ctx, `IFCSITE('${ctx.guid()}',#${ctx.owner},'${esc(name)}',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const zones: number[] = [];
  let n = 0;
  for (const e of entities) {
    if (e.kind !== "rect") continue;
    n += 1;
    const w = e.w ?? 1;
    const h = e.h ?? 1;
    const spPl = placement(ctx, 0, 0, 0, sitePl);
    const solid = extruded(ctx, [[e.x, e.y], [e.x + w, e.y], [e.x + w, e.y + h], [e.x, e.y + h]], 0.2);
    const shp = shape(ctx, solid);
    zones.push(step(ctx, `IFCSPACE('${ctx.guid()}',#${ctx.owner},'Zone ${n}',$,$,#${spPl},#${shp},$,.ELEMENT.,.EXTERNAL.,$)`));
  }
  aggregate(ctx, site, zones);
  aggregate(ctx, project, [site]);
  return `${header(name)}\n${ctx.e.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/** Build an IFC BIM model from a stored drawing (floor plan → building; freeform → site). */
export function buildDrawingIfc(drawing: { title: string; kind: string; schedule: unknown; traceability: string[] | null }): string {
  const construction = decodeConstruction(drawing.traceability);
  const name = drawing.title || "DrawLogix Concept";
  if (drawing.kind === "freeform_sketch") {
    const entities = (Array.isArray(drawing.schedule) ? drawing.schedule : []) as FreeformEntity[];
    return buildSite(entities, name);
  }
  const schedule = (Array.isArray(drawing.schedule) ? drawing.schedule : []) as ScheduleRow[];
  const floors = floorsFromSchedule(schedule);
  if (floors.length === 0) throw new Error("This drawing has no plan geometry to export as BIM.");
  return buildBim(floors, construction, name);
}
