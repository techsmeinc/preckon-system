// PCM v1 — the object vocabulary and how each type is measured.
//
// This is the file that decides what a "wall" IS to Preckon. Everything
// downstream — the quantity, the bill line, the cost, the procurement package —
// is derived from these definitions, so they are data rather than code paths:
// a new object type is a row here, not a branch somewhere.
//
// Phase 1 coverage follows the blueprint's own instruction to implement deeply
// rather than broadly: levels and spaces, walls, doors, windows, columns,
// slabs. Beams, ceilings, stairs and MEP are additions to this shape, not
// changes to it — which is the whole point of keeping types in data.

export type Discipline =
  | "ARCHITECTURE" | "STRUCTURE" | "MECHANICAL" | "ELECTRICAL"
  | "PLUMBING" | "CIVIL" | "FIRE" | "LANDSCAPE" | "GENERAL" | "CUSTOM";

export type GeometryBehavior = "LINEAR" | "AREA" | "POINT" | "HOSTED" | "SPATIAL";

/**
 * Canonical semantic geometry — a description, not a mesh.
 *
 * A wall is a baseline and a thickness. The triangles a browser draws are
 * computed from this and thrown away; the numbers a bill is priced from are
 * computed from this and kept. Storing a mesh as the authoritative form is how
 * a model becomes unmeasurable.
 */
export interface PcmGeometry {
  baseline?: [number, number][];   // LINEAR: metres, project coordinates
  outline?: [number, number][];    // AREA
  at?: [number, number];           // POINT / HOSTED
  rotation?: number;               // radians
  thicknessM?: number;
  heightM?: number;
  widthM?: number;
  depthM?: number;
  elevationM?: number;
  /** HOSTED only: how far along the host's baseline, and the sill height. */
  offsetM?: number;
  sillM?: number;
}

export type MeasurementKind = "COUNT" | "LENGTH" | "AREA" | "VOLUME";

export interface MeasurementRule {
  /** Versioned in the code, because a quantity must say which rule produced
   *  it — and "the rule changed" has to be distinguishable from "the building
   *  changed" when a number moves. */
  code: string;
  name: string;
  kind: MeasurementKind;
  unit: "m" | "m2" | "m3" | "nr";
  /** Said in words on the quantity's trace, so an estimator can argue with the
   *  method rather than only with the number. */
  basis: string;
  /** Openings are taken out of the wall they sit in above this area. Below it
   *  the deduction is noise, and every standard method of measurement sets some
   *  such threshold rather than deducting a letterbox. */
  deductOpeningsOverM2?: number;
}

export interface PcmType {
  code: string;
  name: string;
  discipline: Discipline;
  behavior: GeometryBehavior;
  ifcEntity?: string;
  rules: MeasurementRule[];
  /** BIM Studio categories that mean this type, so publishing a studio model
   *  does not need a second mapping table maintained by hand. */
  studioCategories?: string[];
}

const AREA_RULE = (code: string, name: string, basis: string, deduct?: number): MeasurementRule =>
  ({ code, name, kind: "AREA", unit: "m2", basis, deductOpeningsOverM2: deduct });

export const PCM_TYPES: PcmType[] = [
  {
    code: "LEVEL", name: "Level", discipline: "GENERAL", behavior: "SPATIAL",
    ifcEntity: "IfcBuildingStorey", rules: [], studioCategories: ["level"],
  },
  {
    code: "ROOM", name: "Room / Space", discipline: "ARCHITECTURE", behavior: "AREA",
    ifcEntity: "IfcSpace", studioCategories: ["room", "space"],
    rules: [
      AREA_RULE("NET_FLOOR_AREA:v1", "Net floor area", "The room's outline, by the shoelace formula."),
      { code: "PERIMETER:v1", name: "Perimeter", kind: "LENGTH", unit: "m",
        basis: "The closed length of the room's outline — what skirting and coving are measured on." },
    ],
  },
  {
    code: "WALL", name: "Wall", discipline: "ARCHITECTURE", behavior: "LINEAR",
    ifcEntity: "IfcWall", studioCategories: ["wall", "partition", "curtain wall", "curtain_wall"],
    rules: [
      { code: "WALL_LENGTH:v1", name: "Length", kind: "LENGTH", unit: "m",
        basis: "The centreline of the wall's baseline." },
      // The one that matters. A gross area silently over-measures every wall
      // with a door in it, and on a partition-heavy fit-out that is percent,
      // not rounding.
      AREA_RULE("NET_WALL_AREA:v1", "Net wall area (one face)",
        "Length x height, less any hosted opening larger than the deduction threshold.", 0.5),
      { code: "WALL_VOLUME:v1", name: "Volume", kind: "VOLUME", unit: "m3",
        basis: "Net area x thickness — the concrete or blockwork actually placed." },
    ],
  },
  {
    code: "DOOR", name: "Door", discipline: "ARCHITECTURE", behavior: "HOSTED",
    ifcEntity: "IfcDoor", studioCategories: ["door"],
    rules: [{ code: "COUNT:v1", name: "Number", kind: "COUNT", unit: "nr", basis: "One per door." }],
  },
  {
    code: "WINDOW", name: "Window", discipline: "ARCHITECTURE", behavior: "HOSTED",
    ifcEntity: "IfcWindow", studioCategories: ["window"],
    rules: [{ code: "COUNT:v1", name: "Number", kind: "COUNT", unit: "nr", basis: "One per window." }],
  },
  {
    code: "COLUMN", name: "Column", discipline: "STRUCTURE", behavior: "POINT",
    ifcEntity: "IfcColumn", studioCategories: ["column"],
    rules: [
      { code: "COUNT:v1", name: "Number", kind: "COUNT", unit: "nr", basis: "One per column." },
      { code: "COLUMN_VOLUME:v1", name: "Volume", kind: "VOLUME", unit: "m3",
        basis: "Section width x depth x height." },
      AREA_RULE("COLUMN_FORMWORK:v1", "Formwork area",
        "The four faces over the column's height — what is actually shuttered."),
    ],
  },
  {
    code: "SLAB", name: "Slab / Floor", discipline: "STRUCTURE", behavior: "AREA",
    ifcEntity: "IfcSlab", studioCategories: ["slab", "floor", "roof", "ceiling"],
    rules: [
      AREA_RULE("SLAB_AREA:v1", "Plan area", "The slab outline, by the shoelace formula."),
      { code: "SLAB_VOLUME:v1", name: "Volume", kind: "VOLUME", unit: "m3",
        basis: "Plan area x thickness." },
    ],
  },
  {
    code: "BEAM", name: "Beam", discipline: "STRUCTURE", behavior: "LINEAR",
    ifcEntity: "IfcBeam", studioCategories: ["beam"],
    rules: [
      { code: "BEAM_LENGTH:v1", name: "Length", kind: "LENGTH", unit: "m", basis: "Along the beam axis." },
      { code: "BEAM_VOLUME:v1", name: "Volume", kind: "VOLUME", unit: "m3",
        basis: "Length x section width x depth." },
    ],
  },
  {
    code: "EQUIPMENT", name: "Equipment", discipline: "GENERAL", behavior: "POINT",
    ifcEntity: "IfcBuildingElementProxy",
    studioCategories: ["equipment", "fixture", "furniture", "device", "terminal"],
    rules: [{ code: "COUNT:v1", name: "Number", kind: "COUNT", unit: "nr", basis: "One per item." }],
  },
];

const BY_CODE = new Map(PCM_TYPES.map((t) => [t.code, t]));
export const pcmType = (code: string) => BY_CODE.get(code) ?? null;

/** A BIM Studio category → a PCM type. Anything unrecognised becomes EQUIPMENT
 *  rather than being dropped: an object nobody can classify is still an object
 *  somebody placed, and losing it silently is worse than typing it loosely. */
const BY_STUDIO = new Map<string, string>();
for (const t of PCM_TYPES) for (const c of t.studioCategories ?? []) BY_STUDIO.set(c.toLowerCase(), t.code);
export const typeForStudioCategory = (category: string): string =>
  BY_STUDIO.get(String(category ?? "").toLowerCase()) ?? "EQUIPMENT";
