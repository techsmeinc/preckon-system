/**
 * BIM — the canonical, multi-discipline document model.
 *
 * Ported verbatim from the DrawLogix monorepo (DrawLogix/src/bim/model.ts). It is
 * pure, framework-free TypeScript with no dependencies, so it runs unchanged in
 * Core, in a React client component, and in the worker. Keep it that way: the
 * moment this file imports React or a database client, the agent can no longer
 * reason over the same model the UI draws.
 *
 * One generic ELEMENT type covers every construction item across every division
 * (Architectural, Structural, Civil, Electrical, Mechanical/HVAC, Plumbing, Fire). Each
 * element has a `discipline`, a `category` (wall, beam, light, duct, sprinkler…), a
 * `geom` (one of four archetypes), and free parameters. A CATALOG maps each category to
 * its discipline, geometry archetype, defaults and colour — so adding a new construction
 * item is a catalog entry, not new code. All mutations go through commands (commands.ts).
 *
 * Coordinates: metres. Plan X (east) / Y (north); Z up. Right-handed, Z-up.
 */

export type Id = string;
export interface Vec2 {
  x: number;
  y: number;
}
export type ParamValue = number | string | boolean;

export type Discipline = "architectural" | "structural" | "civil" | "electrical" | "mechanical" | "plumbing" | "fire" | "general";
export type GeomKind = "linear" | "area" | "point" | "hosted";

/** Geometry archetypes. Only the fields relevant to `kind` are used. */
export interface Geometry {
  kind: GeomKind;
  start?: Vec2; // linear
  end?: Vec2;
  outline?: Vec2[]; // area
  at?: Vec2; // point
  rot?: number; // point rotation (rad)
  host?: Id; // hosted (door/window on a wall)
  offset?: number; // hosted: distance along host from its start
  sill?: number; // hosted: sill height
  width?: number; // linear: thickness across; point: X size; hosted: opening width
  depth?: number; // point: Y size
  height?: number; // vertical extent
  thickness?: number; // area: slab/plate thickness
  elevation?: number; // z base override (else from the element's level)
}

export interface Element {
  id: Id;
  discipline: Discipline;
  category: string;
  name?: string;
  level?: Id;
  geom: Geometry;
  params: Record<string, ParamValue>;
}

export interface BimDocument {
  elements: Record<Id, Element>;
  order: Id[];
  seq: number;
  units: "m";
}

// ── Catalog: the palette of buildable items across all disciplines ────────────
export interface CatalogItem {
  category: string;
  discipline: Discipline;
  kind: GeomKind;
  label: string;
  color: number; // 3D colour
  defaults: Partial<Geometry>;
}

const it = (category: string, discipline: Discipline, kind: GeomKind, label: string, color: number, defaults: Partial<Geometry> = {}): [string, CatalogItem] => [
  category,
  { category, discipline, kind, label, color, defaults },
];

export const CATALOG: Record<string, CatalogItem> = Object.fromEntries([
  // General
  it("level", "general", "point", "Level", 0x94a3b8, { elevation: 0 }),
  it("grid", "general", "linear", "Grid line", 0xc0392b, {}),

  // ── Architectural ──────────────────────────────────────────────────────────
  it("wall", "architectural", "linear", "Wall", 0xdfe3ea, { width: 0.2, height: 3 }),
  it("interior_wall", "architectural", "linear", "Partition", 0xe7ebf1, { width: 0.1, height: 3 }),
  it("curtain_wall", "architectural", "linear", "Curtain wall", 0x8fd3ff, { width: 0.08, height: 3 }),
  it("door", "architectural", "hosted", "Door", 0xb07a46, { width: 0.9, height: 2.1 }),
  it("window", "architectural", "hosted", "Window", 0x67b7e6, { width: 1.2, height: 1.2, sill: 0.9 }),
  it("floor", "architectural", "area", "Floor", 0xcbd2dc, { thickness: 0.2 }),
  it("roof", "architectural", "area", "Roof", 0x9a6b4f, { thickness: 0.25, elevation: 3 }),
  it("ceiling", "architectural", "area", "Ceiling", 0xeef1f5, { thickness: 0.05, elevation: 2.8 }),
  it("room", "architectural", "area", "Room", 0x6366f1, { thickness: 0 }),
  it("stair", "architectural", "point", "Stair", 0xb8c0cc, { width: 1.2, depth: 3, height: 3 }),
  it("railing", "architectural", "linear", "Railing", 0x9aa3b2, { width: 0.05, height: 1.1 }),
  it("furniture", "architectural", "point", "Furniture", 0xa78bfa, { width: 0.8, depth: 0.8, height: 0.75 }),

  // ── Structural ─────────────────────────────────────────────────────────────
  it("column", "structural", "point", "Column", 0x9198a5, { width: 0.4, depth: 0.4, height: 3 }),
  it("beam", "structural", "linear", "Beam", 0x7f8894, { width: 0.3, height: 0.5, elevation: 2.7 }),
  it("structural_slab", "structural", "area", "Structural slab", 0xb6bdc8, { thickness: 0.25 }),
  it("footing", "structural", "point", "Pad footing", 0x6b7280, { width: 1.5, depth: 1.5, height: 0.4, elevation: -0.4 }),
  it("strip_footing", "structural", "linear", "Strip footing", 0x6b7280, { width: 0.6, height: 0.4, elevation: -0.4 }),
  it("pile", "structural", "point", "Pile", 0x565e6b, { width: 0.5, depth: 0.5, height: 6, elevation: -6 }),
  it("retaining_wall", "structural", "linear", "Retaining wall", 0x8a8f98, { width: 0.35, height: 2.5 }),
  it("shear_wall", "structural", "linear", "Shear wall", 0x9198a5, { width: 0.25, height: 3 }),
  it("brace", "structural", "linear", "Brace", 0x7f8894, { width: 0.15, height: 0.15, elevation: 1.5 }),
  it("truss", "structural", "linear", "Truss", 0x7f8894, { width: 0.2, height: 1.2, elevation: 3 }),

  // ── Civil ──────────────────────────────────────────────────────────────────
  it("site_pad", "civil", "area", "Site pad / grading", 0xd8cfa8, { thickness: 0.3, elevation: -0.3 }),
  it("road", "civil", "linear", "Road", 0x64707d, { width: 6, height: 0.05 }),
  it("parking", "civil", "area", "Parking", 0x7b8794, { thickness: 0.05 }),
  it("sidewalk", "civil", "area", "Sidewalk", 0xb9c0cb, { thickness: 0.1 }),
  it("curb", "civil", "linear", "Curb", 0xa7b0bd, { width: 0.2, height: 0.15 }),
  it("fence", "civil", "linear", "Fence", 0x8b93a1, { width: 0.05, height: 2 }),
  it("gate", "civil", "point", "Gate", 0xb07a46, { width: 4, depth: 0.1, height: 2 }),
  it("drainage_pipe", "civil", "linear", "Drainage pipe", 0x3aa981, { width: 0.4, height: 0.4, elevation: -1 }),
  it("manhole", "civil", "point", "Manhole", 0x2f8f6e, { width: 0.8, depth: 0.8, height: 1, elevation: -1 }),
  it("catch_basin", "civil", "point", "Catch basin", 0x2f8f6e, { width: 0.6, depth: 0.6, height: 0.8, elevation: -0.8 }),
  it("light_pole", "civil", "point", "Light pole", 0xf59e0b, { width: 0.2, depth: 0.2, height: 8 }),
  it("tree", "civil", "point", "Tree", 0x2f9e44, { width: 4, depth: 4, height: 5 }),
  it("retaining_wall_civil", "civil", "linear", "Retaining wall", 0x8a8f98, { width: 0.4, height: 2 }),

  // ── Electrical ─────────────────────────────────────────────────────────────
  it("light", "electrical", "point", "Light fixture", 0xfde047, { width: 0.3, depth: 0.3, height: 0.1, elevation: 2.7 }),
  it("spotlight", "electrical", "point", "Spotlight", 0xfacc15, { width: 0.15, depth: 0.15, height: 0.1, elevation: 2.7 }),
  it("socket", "electrical", "point", "Socket", 0xeab308, { width: 0.1, depth: 0.05, height: 0.1, elevation: 0.3 }),
  it("switch", "electrical", "point", "Switch", 0xca8a04, { width: 0.08, depth: 0.05, height: 0.08, elevation: 1.1 }),
  it("distribution_board", "electrical", "point", "Distribution board", 0xd97706, { width: 0.6, depth: 0.2, height: 0.8, elevation: 1.2 }),
  it("main_panel", "electrical", "point", "Main panel", 0xb45309, { width: 1, depth: 0.3, height: 1.2, elevation: 1 }),
  it("cable_tray", "electrical", "linear", "Cable tray", 0xf59e0b, { width: 0.3, height: 0.1, elevation: 2.8 }),
  it("conduit", "electrical", "linear", "Conduit", 0xfbbf24, { width: 0.05, height: 0.05, elevation: 2.8 }),
  it("generator", "electrical", "point", "Generator", 0x92400e, { width: 3, depth: 1.5, height: 2 }),
  it("transformer", "electrical", "point", "Transformer", 0x78350f, { width: 2, depth: 2, height: 2 }),

  // ── Mechanical / HVAC ──────────────────────────────────────────────────────
  it("duct", "mechanical", "linear", "Duct", 0x60a5fa, { width: 0.4, height: 0.3, elevation: 2.9 }),
  it("diffuser", "mechanical", "point", "Diffuser", 0x93c5fd, { width: 0.3, depth: 0.3, height: 0.1, elevation: 2.8 }),
  it("fcu", "mechanical", "point", "FCU", 0x3b82f6, { width: 1, depth: 0.5, height: 0.3, elevation: 2.6 }),
  it("ahu", "mechanical", "point", "AHU", 0x2563eb, { width: 2.5, depth: 1.5, height: 1.5 }),
  it("vrf_unit", "mechanical", "point", "VRF outdoor unit", 0x1d4ed8, { width: 1.2, depth: 0.7, height: 1.6 }),
  it("chiller", "mechanical", "point", "Chiller", 0x1e40af, { width: 3, depth: 1.5, height: 2 }),
  it("exhaust_fan", "mechanical", "point", "Exhaust fan", 0x60a5fa, { width: 0.5, depth: 0.5, height: 0.4, elevation: 2.7 }),

  // ── Plumbing ───────────────────────────────────────────────────────────────
  it("pipe", "plumbing", "linear", "Pipe", 0x22d3ee, { width: 0.1, height: 0.1, elevation: 0.2 }),
  it("wc", "plumbing", "point", "WC", 0x67e8f9, { width: 0.4, depth: 0.7, height: 0.8 }),
  it("basin", "plumbing", "point", "Basin", 0x67e8f9, { width: 0.6, depth: 0.45, height: 0.85 }),
  it("sink", "plumbing", "point", "Sink", 0x67e8f9, { width: 0.8, depth: 0.6, height: 0.9 }),
  it("shower", "plumbing", "point", "Shower", 0x67e8f9, { width: 0.9, depth: 0.9, height: 0.2 }),
  it("floor_drain", "plumbing", "point", "Floor drain", 0x0891b2, { width: 0.15, depth: 0.15, height: 0.05 }),
  it("water_tank", "plumbing", "point", "Water tank", 0x0e7490, { width: 2, depth: 2, height: 2 }),
  it("pump", "plumbing", "point", "Pump", 0x155e75, { width: 0.6, depth: 0.4, height: 0.5 }),

  // ── Fire ───────────────────────────────────────────────────────────────────
  it("sprinkler", "fire", "point", "Sprinkler", 0xef4444, { width: 0.1, depth: 0.1, height: 0.1, elevation: 2.85 }),
  it("smoke_detector", "fire", "point", "Smoke detector", 0xf87171, { width: 0.15, depth: 0.15, height: 0.05, elevation: 2.9 }),
  it("fire_alarm", "fire", "point", "Fire alarm", 0xdc2626, { width: 0.2, depth: 0.1, height: 0.2, elevation: 1.5 }),
  it("hydrant", "fire", "point", "Hydrant", 0xb91c1c, { width: 0.4, depth: 0.4, height: 0.9 }),
  it("fire_pump", "fire", "point", "Fire pump", 0x991b1b, { width: 1.5, depth: 1, height: 1.2 }),
]);

export const DISCIPLINES: { id: Discipline; label: string }[] = [
  { id: "architectural", label: "Architecture" },
  { id: "structural", label: "Structural" },
  { id: "civil", label: "Civil" },
  { id: "electrical", label: "Electrical" },
  { id: "mechanical", label: "Mechanical" },
  { id: "plumbing", label: "Plumbing" },
  { id: "fire", label: "Fire" },
];

export const catalogByDiscipline = (d: Discipline): CatalogItem[] => Object.values(CATALOG).filter((c) => c.discipline === d && c.category !== "level");

// ── Document operations (pure) ───────────────────────────────────────────────
export function emptyDocument(): BimDocument {
  const doc: BimDocument = { elements: {}, order: [], seq: 0, units: "m" };
  return addElement(doc, { discipline: "general", category: "level", name: "Ground Floor", geom: { kind: "point", elevation: 0 }, params: {} }).doc;
}

export function addElement(doc: BimDocument, el: Omit<Element, "id"> & { id?: Id }): { doc: BimDocument; id: Id } {
  const seq = doc.seq + 1;
  const id = el.id ?? `${(el.category[0] ?? "e").toLowerCase()}${seq}`;
  const full: Element = { ...el, id };
  return { doc: { ...doc, seq, elements: { ...doc.elements, [id]: full }, order: [...doc.order, id] }, id };
}
export function updateElement(doc: BimDocument, id: Id, patch: Partial<Element>): BimDocument {
  const cur = doc.elements[id];
  if (!cur) return doc;
  return { ...doc, elements: { ...doc.elements, [id]: { ...cur, ...patch } } };
}
export function removeElement(doc: BimDocument, id: Id): BimDocument {
  if (!doc.elements[id]) return doc;
  const elements = { ...doc.elements };
  delete elements[id];
  for (const o of Object.values(elements)) {
    if (o.geom.host === id || (o.category !== "level" && o.level === id)) delete elements[o.id];
  }
  return { ...doc, elements, order: doc.order.filter((x) => elements[x]) };
}

// ── Queries ──────────────────────────────────────────────────────────────────
export const list = (doc: BimDocument): Element[] => doc.order.map((id) => doc.elements[id]).filter(Boolean);
export const byCategory = (doc: BimDocument, category: string): Element[] => list(doc).filter((e) => e.category === category);
export const byDiscipline = (doc: BimDocument, d: Discipline): Element[] => list(doc).filter((e) => e.discipline === d);
export const levels = (doc: BimDocument): Element[] => byCategory(doc, "level").sort((a, b) => (a.geom.elevation ?? 0) - (b.geom.elevation ?? 0));
export const defaultLevel = (doc: BimDocument): Id | undefined => levels(doc)[0]?.id;
export const walls = (doc: BimDocument): Element[] => list(doc).filter((e) => e.geom.kind === "linear" && /wall/.test(e.category));
export const levelElev = (doc: BimDocument, id?: Id): number => {
  const l = id ? doc.elements[id] : undefined;
  return l?.category === "level" ? (l.geom.elevation ?? 0) : 0;
};
export const linLength = (e: Element): number => (e.geom.start && e.geom.end ? Math.hypot(e.geom.end.x - e.geom.start.x, e.geom.end.y - e.geom.start.y) : 0);

/** Compact model summary for the AI (ids, discipline, key geometry, hosts). */
export function describe(doc: BimDocument): string {
  const f = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : "0");
  const rows = list(doc).map((e) => {
    const g = e.geom ?? { kind: "point" as GeomKind };
    const loc =
      g.kind === "linear"
        ? `(${f(g.start?.x)},${f(g.start?.y)})→(${f(g.end?.x)},${f(g.end?.y)}) len=${f(linLength(e))}`
        : g.kind === "area"
          ? `poly[${g.outline?.length ?? 0}]`
          : g.kind === "hosted"
            ? `host=${g.host ?? "?"} off=${f(g.offset)}`
            : `at=(${f(g.at?.x)},${f(g.at?.y)})`;
    return `${e.id} [${e.discipline}] ${e.category} ${loc}${e.level ? ` lvl=${e.level}` : ""}`;
  });
  return rows.length ? rows.join("\n") : "(empty — only a Ground Floor level exists)";
}
