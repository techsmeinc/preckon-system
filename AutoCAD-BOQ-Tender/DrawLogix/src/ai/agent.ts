import Anthropic from "@anthropic-ai/sdk";
import type { ScheduleRow } from "@/db/schema";
import { type Envelope, type ProgramRoom, solveFloorPlan } from "@/domain/floorplan";
import { MODEL } from "./model";

/**
 * The DrawLogix AI copilot — an ArchiLabs-style architectural agent. Claude interprets
 * a natural-language instruction and calls tools that edit the building's room
 * PROGRAMME (rooms with area, kind, repeat count, private en-suites and adjacency) plus
 * an optional fixed FOOTPRINT. We apply each tool to an in-memory programme and loop
 * until the model is done (the standard tool_use → tool_result manual loop), then solve
 * the programme into real dimensioned floor-plan geometry so the copilot's output is a
 * true plan (walls/doors/windows), not just an area list.
 */

type Footprint = { widthM: number; lengthM: number };

const ROOM_ITEM = {
  type: "object" as const,
  properties: {
    name: { type: "string", description: "Base name; for a repeated room give the singular (e.g. 'Ward Bed Room', not 'Ward Bed Rooms')." },
    areaSqm: { type: "number", description: "Floor area of ONE room in m² (do NOT multiply by the count)." },
    kind: { type: "string", enum: ["habitable", "wet", "service", "circulation"], description: "habitable=rooms with daylight (offices/wards/bedrooms); wet=WC/bath/shower; service=store/plant/IT/utility; circulation=corridor/lobby/vestibule." },
    count: { type: "number", description: "How many identical copies of this room (e.g. 20 wards). Default 1." },
    ensuiteSqm: { type: "number", description: "If EACH copy has its own private en-suite bathroom, its area in m². Omit if none." },
    connectsTo: { type: "array", items: { type: "string" }, description: "Names of rooms this space should sit adjacent to." },
  },
  required: ["name", "areaSqm"],
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "generate_layout",
    description:
      "Replace the ENTIRE room programme with a new set of rooms. Use this when the user asks to design a building or space from a brief (e.g. 'design a 3-surgery dental clinic'). Choose realistic room sizes for the building type, mark each room's kind, use `count` for repeated rooms, and set `connectsTo` for rooms that must be adjacent. Optionally set the building footprint if the brief states one.",
    input_schema: {
      type: "object",
      properties: {
        rooms: { type: "array", description: "The full list of rooms for the building.", items: ROOM_ITEM },
        footprint: {
          type: "object",
          description: "Overall building footprint in metres IF the brief states or implies one (e.g. a 15 m × 56 m plot). Omit to let the layout size itself.",
          properties: { widthM: { type: "number" }, lengthM: { type: "number" } },
        },
      },
      required: ["rooms"],
    },
  },
  {
    name: "add_room",
    description: "Add one room (optionally repeated, with an en-suite, and with adjacency) to the programme.",
    input_schema: ROOM_ITEM,
  },
  {
    name: "remove_room",
    description: "Remove a room by name (partial match).",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "resize_room",
    description: "Set a room's area in m² (of a single copy).",
    input_schema: { type: "object", properties: { name: { type: "string" }, areaSqm: { type: "number" } }, required: ["name", "areaSqm"] },
  },
  {
    name: "rename_room",
    description: "Rename a room.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  {
    name: "set_adjacency",
    description: "Set which rooms a given room should sit next to (replaces its adjacency list). Use this to place e.g. an en-suite next to a bedroom, or a store next to a lab.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, connectsTo: { type: "array", items: { type: "string" } } },
      required: ["name", "connectsTo"],
    },
  },
  {
    name: "set_footprint",
    description: "Fix the overall building footprint in metres (the plan is solved to fit inside it). Use when the user gives a plot/building size. Pass zeros to clear it and let the layout size itself.",
    input_schema: {
      type: "object",
      properties: { widthM: { type: "number" }, lengthM: { type: "number" } },
      required: ["widthM", "lengthM"],
    },
  },
];

function apply(
  tool: string,
  input: Record<string, unknown>,
  rooms: ProgramRoom[],
  footprint: Footprint | undefined,
): { rooms: ProgramRoom[]; footprint: Footprint | undefined; note: string } {
  const num = (v: unknown, d: number) => Math.max(1, Math.round(Number(v) || d));
  const str = (v: unknown) => String(v ?? "").trim();
  const strList = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12) : undefined);
  const mkRoom = (r: Record<string, unknown>): ProgramRoom => {
    const count = Math.round(Number(r.count) || 1);
    const ensuite = Number(r.ensuiteSqm) || 0;
    return {
      name: str(r.name) || "Room",
      areaSqm: num(r.areaSqm, 12),
      kind: r.kind ? String(r.kind) : undefined,
      count: count > 1 ? Math.min(80, count) : undefined,
      ensuiteSqm: ensuite > 0 ? Math.max(2, Math.round(ensuite)) : undefined,
      connectsTo: strList(r.connectsTo),
    };
  };
  const parseFp = (v: unknown): Footprint | undefined => {
    const o = (v ?? {}) as Record<string, unknown>;
    const w = Number(o.widthM);
    const l = Number(o.lengthM);
    return w > 0 && l > 0 ? { widthM: w, lengthM: l } : undefined;
  };

  switch (tool) {
    case "generate_layout": {
      const list = Array.isArray(input.rooms) ? (input.rooms as Record<string, unknown>[]) : [];
      const next = list.map(mkRoom);
      const fp = parseFp(input.footprint) ?? footprint;
      return { rooms: next, footprint: fp, note: `generated ${next.length} rooms${fp ? ` in a ${fp.widthM}×${fp.lengthM} m footprint` : ""}` };
    }
    case "add_room": {
      const room = mkRoom(input);
      return { rooms: [...rooms, room], footprint, note: `added ${room.name}${room.count ? ` ×${room.count}` : ""}` };
    }
    case "remove_room": {
      const n = str(input.name).toLowerCase();
      const next = rooms.filter((r) => !r.name.toLowerCase().includes(n));
      return { rooms: next, footprint, note: next.length === rooms.length ? `no room matching "${input.name}"` : `removed ${input.name}` };
    }
    case "resize_room": {
      const n = str(input.name).toLowerCase();
      const area = num(input.areaSqm, 10);
      let found = false;
      const next = rooms.map((r) => (r.name.toLowerCase().includes(n) ? ((found = true), { ...r, areaSqm: area }) : r));
      return { rooms: next, footprint, note: found ? `resized ${input.name} to ${area} m²` : `no room matching "${input.name}"` };
    }
    case "rename_room": {
      const from = str(input.from).toLowerCase();
      const to = str(input.to) || "Room";
      let found = false;
      const next = rooms.map((r) => (r.name.toLowerCase().includes(from) ? ((found = true), { ...r, name: to }) : r));
      return { rooms: next, footprint, note: found ? `renamed to ${to}` : `no room matching "${input.from}"` };
    }
    case "set_adjacency": {
      const n = str(input.name).toLowerCase();
      const connectsTo = strList(input.connectsTo) ?? [];
      let found = false;
      const next = rooms.map((r) => (r.name.toLowerCase().includes(n) ? ((found = true), { ...r, connectsTo }) : r));
      return { rooms: next, footprint, note: found ? `set ${input.name} adjacent to ${connectsTo.join(", ") || "(none)"}` : `no room matching "${input.name}"` };
    }
    case "set_footprint": {
      const fp = parseFp(input);
      return { rooms, footprint: fp, note: fp ? `footprint set to ${fp.widthM}×${fp.lengthM} m` : "footprint cleared" };
    }
    default:
      return { rooms, footprint, note: `unknown tool ${tool}` };
  }
}

const envelopeOf = (fp: Footprint | undefined): Envelope | undefined =>
  fp ? { widthAcross: Math.min(fp.widthM, fp.lengthM), lengthAlong: Math.max(fp.widthM, fp.lengthM) } : undefined;

/** Solve the programme into real geometry; fall back to a bare area schedule if empty. */
function solve(rooms: ProgramRoom[], footprint: Footprint | undefined): ScheduleRow[] {
  const solved = solveFloorPlan(rooms, envelopeOf(footprint));
  if (solved.length) return solved;
  return rooms.map((r, i) => ({ ref: `A-${String(i + 1).padStart(2, "0")}`, room: r.name, areaSqm: r.areaSqm, kind: r.kind }));
}

/** Collapse a solved/expanded schedule back to an editable programme for the next turn. */
function scheduleToProgram(rows: ScheduleRow[]): ProgramRoom[] {
  return rows
    .filter((r) => r.kind !== "circulation" && !/circulation|corridor/i.test(r.room))
    .map((r) => ({ name: r.room, areaSqm: r.areaSqm, kind: r.kind, requirementRef: r.requirementRef }));
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ── Document understanding → design extraction ────────────────────────────────
const CATEGORIES = ["space", "constraint", "assumption", "exclusion", "clarification"] as const;

export interface DesignConstruction {
  storeys: number;
  extWallMm: number;
  intWallMm: number;
  floorToFloorM: number;
  unit: "mm" | "m";
}

export interface ExtractedDesign {
  requirements: { ref: string; category: string; title: string; detail?: string }[];
  rooms: { name: string; areaSqm: number; requirementRef?: string; kind?: string; connectsTo?: string[]; count?: number; ensuiteSqm?: number; floor?: number }[];
  footprint?: { widthM: number; lengthM: number };
  construction: DesignConstruction;
}

const SUBMIT_DESIGN: Anthropic.Tool = {
  name: "submit_design",
  description: "Submit the structured requirements and the room programme extracted from the project documents.",
  input_schema: {
    type: "object",
    properties: {
      footprint: {
        type: "object",
        description: "Overall building footprint in metres IF the documents state it (e.g. '15 m × 56 m'). Omit if not given.",
        properties: { widthM: { type: "number" }, lengthM: { type: "number" } },
      },
      storeys: { type: "number", description: "Number of storeys / floors in the building (1 for single-storey). Read this from the brief; default 1." },
      floorToFloorM: { type: "number", description: "Floor-to-floor height in metres (default 3.0)." },
      extWallMm: { type: "number", description: "Exterior wall thickness in mm, chosen from the construction type in the brief (e.g. 200 concrete/block, 230 blockwork, 250 cavity). Default 200." },
      intWallMm: { type: "number", description: "Internal partition thickness in mm (e.g. 100 stud/block, 115 blockwork). Default 100." },
      unit: { type: "string", enum: ["mm", "m"], description: "Unit for dimension text on the drawing. Default mm (standard for construction)." },
      requirements: {
        type: "array",
        description: "The explicit and implicit requirements found in the documents, each with a stable ref (R-001, R-002, …).",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Stable id like R-001." },
            category: { type: "string", enum: [...CATEGORIES] },
            title: { type: "string", description: "Short requirement statement." },
            detail: { type: "string", description: "Optional fuller text / source quote." },
          },
          required: ["ref", "category", "title"],
        },
      },
      rooms: {
        type: "array",
        description: "The room programme that satisfies the requirements — spaces with realistic floor areas in m².",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Base name. For a repeated room give the singular (e.g. 'Dormitory Room'), not 'Dormitory Rooms'." },
            areaSqm: { type: "number", description: "Floor area of ONE room in square metres (not the total for all copies)." },
            count: { type: "number", description: "How many identical copies of this room (e.g. 20 dormitories). Default 1." },
            ensuiteSqm: { type: "number", description: "If EACH copy of this room has its own private en-suite bathroom, the en-suite area in m². Omit if none." },
            kind: { type: "string", enum: ["habitable", "wet", "service", "circulation"], description: "habitable=rooms with daylight (dorms/offices); wet=WC/bath; service=store/plant/IT/mech/laundry; circulation=corridor/vestibule." },
            connectsTo: { type: "array", items: { type: "string" }, description: "Names of rooms this space should be adjacent to." },
            requirementRef: { type: "string", description: "The R-xxx requirement this space satisfies (for traceability)." },
            floor: { type: "number", description: "Which storey this room is on: 1 = ground floor, 2 = first floor, etc. Distribute rooms sensibly across the storeys (public/reception on ground, private above). Default 1." },
          },
          required: ["name", "areaSqm"],
        },
      },
    },
    required: ["requirements", "rooms"],
  },
};

// ── Freeform drawing tool (schematics / details / site plans — not room plans) ─────
export interface FreeformEntity {
  kind: "line" | "rect" | "circle" | "text";
  layer?: string;
  x: number; // start / insert / centre X (metres)
  y: number;
  x2?: number; // line end
  y2?: number;
  w?: number; // rect
  h?: number;
  r?: number; // circle radius
  text?: string; // text content
  height?: number; // text height (m)
}

const FREEFORM_ITEM = {
  type: "object" as const,
  properties: {
    kind: { type: "string", enum: ["line", "rect", "circle", "text"] },
    layer: { type: "string", description: "AIA-style layer, e.g. A-WALL, A-GLAZ, A-ANNO, A-DIMS. Default 0." },
    x: { type: "number", description: "Start / insert / centre X in metres." },
    y: { type: "number", description: "Start / insert / centre Y in metres." },
    x2: { type: "number", description: "End X (line only)." },
    y2: { type: "number", description: "End Y (line only)." },
    w: { type: "number", description: "Width in metres (rect only)." },
    h: { type: "number", description: "Height in metres (rect only)." },
    r: { type: "number", description: "Radius in metres (circle only)." },
    text: { type: "string", description: "Text content (text only)." },
    height: { type: "number", description: "Text height in metres (text only, default 0.3)." },
  },
  required: ["kind", "x", "y"],
};

const SUBMIT_FREEFORM: Anthropic.Tool = {
  name: "submit_freeform",
  description:
    "Submit a freeform technical drawing as primitive entities, drawn to TRUE real-world scale in METRES (a 300 m long yard spans 300 units — do NOT shrink it). Use this for anything that is NOT a room-based building floor plan: a site plan, a schematic, a single-line diagram, a construction detail, a layout/arrangement sketch. Make it look like a real CAD drawing:\n" +
    "• Put structures/boundaries/roads/fences/sheds on layer 'A-WALL'; annotations/labels on 'A-ANNO'; setting-out grid lines on 'A-GRID'; doors/gates on 'A-DOOR'; glazing on 'A-GLAZ'.\n" +
    "• DIMENSION the drawing: on layer 'A-DIMS', add a short dimension line (a `line`) plus a `text` giving the measurement, for the overall extents AND every major element (zone sizes, building footprints, setbacks, road widths). Use metres for anything over ~40 m, else millimetres.\n" +
    "• Label everything with `text` (zone names, areas, equipment, notes). Size text to be READABLE at the drawing's scale — roughly 1–3% of the overall drawing size (e.g. ~3 m tall text on a 300 m site), NOT 0.3 m.\n" +
    "• Do NOT draw a border, title block, north arrow or scale bar — the engine adds those automatically.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short drawing title." },
      entities: { type: "array", description: "The primitives that make up the drawing.", items: FREEFORM_ITEM },
    },
    required: ["entities"],
  },
};

/** Tagged result of reading the brief — either a measured room plan or freeform geometry. */
export type ExtractedResult =
  | { mode: "floorplan"; design: ExtractedDesign }
  | { mode: "freeform"; title: string; entities: FreeformEntity[] };

/** Parse a `data:image/…;base64,…` URL into an Anthropic image content block. */
function imageBlock(dataUrl: string): Anthropic.ImageBlockParam | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (!m) return null;
  const mediaType = (m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase()) as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  return { type: "image", source: { type: "base64", media_type: mediaType, data: m[2] } };
}

/**
 * Build multimodal message content from a project's documents: text docs become a
 * budgeted, deduped text block; image docs (stored as data-URLs) become native image
 * blocks the VLM reads directly. Returns null-ish content the caller validates.
 */
function docsToContent(docs: { name: string; docType: string; content: string }[]): {
  content: Anthropic.ContentBlockParam[];
  hasText: boolean;
  hasImage: boolean;
} {
  const images: Anthropic.ContentBlockParam[] = [];
  const seen = new Set<string>();
  const parts: string[] = [];
  const PER_DOC = 200_000;
  const TOTAL = 400_000;
  let used = 0;
  for (const d of docs) {
    const content = (d.content ?? "").trim();
    if (!content) continue;
    if (content.startsWith("data:image/")) {
      const block = imageBlock(content);
      if (block) {
        images.push({ type: "text", text: `Reference image: ${d.name}` });
        images.push(block);
      }
      continue;
    }
    const key = content.slice(0, 200);
    if (seen.has(key)) continue; // skip duplicate uploads
    seen.add(key);
    if (used >= TOTAL) continue;
    const slice = content.slice(0, Math.min(PER_DOC, TOTAL - used));
    parts.push(`## ${d.name} (${d.docType})\n${slice}`);
    used += slice.length;
  }
  const content: Anthropic.ContentBlockParam[] = [];
  if (parts.length) content.push({ type: "text", text: parts.join("\n\n") });
  content.push(...images);
  return { content, hasText: parts.length > 0, hasImage: images.length > 0 };
}

/**
 * Read the project's documents (text + images) with Claude and extract a drawing.
 * Claude PICKS the representation: a measured room programme (`submit_design`) for a
 * building/floor-plan brief, or freeform geometry (`submit_freeform`) for a schematic,
 * site plan, or detail. Forced tool use (`any`) guarantees clean structured data.
 */
export async function extractDesignFromDocuments(
  docs: { name: string; docType: string; content: string }[],
): Promise<ExtractedResult> {
  const client = new Anthropic();
  const { content, hasText, hasImage } = docsToContent(docs);
  if (!hasText && !hasImage) {
    throw new Error("The documents have no readable text or images — paste the brief text instead.");
  }

  const system =
    "You are an expert architect and draughtsperson. You are given a construction project's source material — a Scope of Work, interview/dictation notes, specifications, schedules, and/or reference images (sketches, plans, photos). Read ALL of it, including the images. " +
    "Decide which drawing best answers the brief and call EXACTLY ONE tool:\n" +
    "• submit_design — when the brief describes a BUILDING made of rooms/spaces (offices, clinics, wards, apartments…). Produce categorised requirements (stable refs R-001, R-002, …) and a room programme grounded in the material: honour a stated FOOTPRINT; for a repeated room give ONE entry with `count` and per-room `areaSqm`; set `ensuiteSqm` for private bathrooms; set each room's `kind` (mark lobbies/vestibules 'circulation'); trace every space to a requirement ref; use realistic m² and USE any schedule that is given. Set the number of `storeys` and assign each room a `floor` (1=ground, 2=first, …) — put reception/public spaces on the ground floor. Choose wall thicknesses (`extWallMm`/`intWallMm`) and `unit` from the construction type in the brief (default 200/100 mm, mm).\n" +
    "• submit_freeform — when the brief wants something that is NOT a room-based floor plan: a site plan, a schematic, a single-line/riser diagram, a construction detail, an arrangement/layout sketch. Draw it to real-world scale from primitives with labels and dimensions.\n" +
    "Match reference images closely when they are provided.";

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    tools: [SUBMIT_DESIGN, SUBMIT_FREEFORM],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content }],
  });

  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

  if (tu?.name === "submit_freeform") {
    const input = (tu.input ?? {}) as { title?: unknown; entities?: unknown[] };
    const entities = parseFreeformEntities(input.entities);
    if (entities.length === 0) throw new Error("The AI returned an empty freeform drawing.");
    return { mode: "freeform", title: String(input.title ?? "Concept Drawing").slice(0, 120), entities };
  }

  // Default: floor-plan / room programme.
  const input = (tu?.input ?? {}) as {
    requirements?: unknown[];
    rooms?: unknown[];
    footprint?: { widthM?: unknown; lengthM?: unknown };
    storeys?: unknown;
    floorToFloorM?: unknown;
    extWallMm?: unknown;
    intWallMm?: unknown;
    unit?: unknown;
  };

  const fp = input.footprint;
  const footprint =
    fp && Number(fp.widthM) > 0 && Number(fp.lengthM) > 0 ? { widthM: Number(fp.widthM), lengthM: Number(fp.lengthM) } : undefined;

  const clampNum = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const construction: DesignConstruction = {
    storeys: clampNum(input.storeys, 1, 1, 10),
    extWallMm: clampNum(input.extWallMm, 200, 75, 500),
    intWallMm: clampNum(input.intWallMm, 100, 50, 300),
    floorToFloorM: clampNum(input.floorToFloorM, 3.0, 2.4, 6),
    unit: input.unit === "m" ? "m" : "mm",
  };

  const requirements = (Array.isArray(input.requirements) ? input.requirements : [])
    .slice(0, 60)
    .map((r, i) => {
      const o = r as Record<string, unknown>;
      const category = String(o.category ?? "space");
      return {
        ref: String(o.ref ?? `R-${String(i + 1).padStart(3, "0")}`),
        category: (CATEGORIES as readonly string[]).includes(category) ? category : "clarification",
        title: String(o.title ?? "Requirement").slice(0, 480),
        detail: o.detail ? String(o.detail).slice(0, 2000) : undefined,
      };
    });

  const rooms = (Array.isArray(input.rooms) ? input.rooms : [])
    .slice(0, 40)
    .map((r) => {
      const o = r as Record<string, unknown>;
      const count = Math.round(Number(o.count) || 1);
      const ensuite = Number(o.ensuiteSqm) || 0;
      return {
        name: String(o.name ?? "Room").slice(0, 120) || "Room",
        areaSqm: Math.max(1, Math.round(Number(o.areaSqm) || 12)),
        count: count > 1 ? Math.min(80, count) : undefined,
        ensuiteSqm: ensuite > 0 ? Math.max(2, Math.round(ensuite)) : undefined,
        kind: o.kind ? String(o.kind) : undefined,
        connectsTo: Array.isArray(o.connectsTo) ? (o.connectsTo as unknown[]).map(String).slice(0, 12) : undefined,
        requirementRef: o.requirementRef ? String(o.requirementRef) : undefined,
        floor: clampNum(o.floor, 1, 1, construction.storeys),
      };
    });

  return { mode: "floorplan", design: { requirements, rooms, footprint, construction } };
}

/** Validate + clamp the freeform entity list returned by the tool. */
export function parseFreeformEntities(raw: unknown): FreeformEntity[] {
  const list = Array.isArray(raw) ? raw : [];
  const num = (v: unknown): number | undefined => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const out: FreeformEntity[] = [];
  for (const item of list.slice(0, 2000)) {
    const o = item as Record<string, unknown>;
    const kind = String(o.kind ?? "");
    if (kind !== "line" && kind !== "rect" && kind !== "circle" && kind !== "text") continue;
    const x = num(o.x);
    const y = num(o.y);
    if (x === undefined || y === undefined) continue;
    const e: FreeformEntity = { kind, x, y, layer: o.layer ? String(o.layer).slice(0, 60) : undefined };
    if (kind === "line") {
      e.x2 = num(o.x2) ?? x;
      e.y2 = num(o.y2) ?? y;
    } else if (kind === "rect") {
      e.w = num(o.w) ?? 1;
      e.h = num(o.h) ?? 1;
    } else if (kind === "circle") {
      e.r = num(o.r) ?? 0.5;
      if (e.r <= 0) continue;
    } else {
      const t = String(o.text ?? "").trim();
      if (!t) continue;
      e.text = t.slice(0, 240);
      e.height = num(o.height) ?? 0.3;
    }
    out.push(e);
  }
  return out;
}

export async function runArchitectAgent(
  current: ScheduleRow[],
  userText: string,
  attachments: string[] = [],
): Promise<{ schedule: ScheduleRow[]; reply: string }> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  let rooms: ProgramRoom[] = scheduleToProgram(current);
  let footprint: Footprint | undefined;
  const notes: string[] = [];

  const system =
    "You are DrawLogix, an AI architectural copilot. You design and edit a building's room programme, which is then solved into a real dimensioned floor plan (walls, doors on every room to the corridor, windows on habitable rooms). Use the tools to satisfy the user's request — add/remove/resize/rename rooms, set repeat counts and private en-suites, set adjacency (connectsTo), fix or clear the building footprint, or generate a whole layout from a brief. " +
    "Ground every edit in the CURRENT programme below: match room names when editing, and keep edits minimal and targeted unless the user asks to redesign. Choose realistic room sizes and correct `kind` for the building type. After your changes, reply in one or two short sentences describing what you did. " +
    `Current programme: ${rooms.length ? rooms.map((r) => `${r.name} (${r.areaSqm} m²${r.kind ? `, ${r.kind}` : ""})`).join(", ") : "(empty)"}.`;

  const userContent: Anthropic.ContentBlockParam[] = [{ type: "text", text: userText }];
  for (const a of attachments) {
    const block = imageBlock(a);
    if (block) userContent.push(block);
  }
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

  for (let step = 0; step < 10; step++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2048, system, tools: TOOLS, messages });

    if (res.stop_reason === "tool_use") {
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = apply(tu.name, (tu.input ?? {}) as Record<string, unknown>, rooms, footprint);
        rooms = out.rooms;
        footprint = out.footprint;
        notes.push(out.note);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out.note });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return { schedule: solve(rooms, footprint), reply: text || (notes.length ? `Done — ${notes.join("; ")}.` : "No change made.") };
  }

  return { schedule: solve(rooms, footprint), reply: notes.length ? `Done — ${notes.join("; ")}.` : "Reached the step limit." };
}
