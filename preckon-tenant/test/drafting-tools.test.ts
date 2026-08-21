// The drafting command set.
//
// drafting.test.ts pins the geometry. These test the layer above it: that each
// command REFUSES rather than guesses, and that the refusal says which thing
// was wrong. On an issued drawing, geometry that renders and is subtly wrong is
// worse than a command that did nothing, so the failure paths matter more here
// than the happy ones.

import { describe, it, expect } from "vitest";
import { DRAFTING_TOOLS } from "@/lib/cad/drafting-tools";
import type { DxfModel } from "@/lib/cad/model";

const tool = (name: string) => {
  const t = DRAFTING_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`No tool named ${name}`);
  return t;
};

const model = (entities: any[] = []): DxfModel => ({
  layers: [{ name: "A-WALL", entities: entities.length }] as any,
  entities,
  units: "mm",
} as any);

const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  ({ id: `e${x1}${y1}${x2}${y2}`, kind: "line", layer, x1, y1, x2, y2 });

const ctx = (m: DxfModel) => ({ doc: m } as any);
const run = (name: string, args: Record<string, any>, m: DxfModel = model()) =>
  tool(name).run(ctx(m), args);

describe("the catalogue", () => {
  it("registers the commands a draughtsman reaches for", () => {
    const names = DRAFTING_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_dimension", "array_layer", "chamfer_corner", "extend_line",
      "fillet_corner", "mirror_layer", "offset_layer", "offset_line",
      "polar_array_layer", "set_out_points", "transform_layer", "trim_line",
    ]);
  });

  it("gives every command a description and searchable keywords", () => {
    for (const t of DRAFTING_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.keywords?.length).toBeGreaterThan(2);
      expect(t.module).toBe("Drafting");
    }
  });

  it("marks every drafting command as a write", () => {
    expect(DRAFTING_TOOLS.every((t) => t.kind === "write")).toBe(true);
  });
});

describe("offset", () => {
  it("draws the parallel line and says which side", () => {
    const r = run("offset_line", { x1: 0, y1: 0, x2: 10, y2: 0, distance: 2 });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/to the left/);
    expect(r.commands![0]).toMatchObject({ op: "add_line", y1: 2, y2: 2 });
  });

  it("refuses a zero offset instead of drawing over the original", () => {
    const r = run("offset_line", { x1: 0, y1: 0, x2: 10, y2: 0, distance: 0 });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/on top of itself/);
  });

  it("says when it chose the drafting layer, rather than choosing silently", () => {
    const r = run("offset_line", { x1: 0, y1: 0, x2: 10, y2: 0, distance: 2 });
    expect(r.assumptions![0]).toMatch(/AL-DRAFT/);
    expect(r.assumptions![0]).toMatch(/leaving the issued layers untouched/);
  });

  it("offsets a whole layer and reports the count", () => {
    const m = model([line("A-WALL", 0, 0, 10, 0), line("A-WALL", 0, 5, 10, 5)]);
    const r = run("offset_layer", { source_layer: "A-WALL", distance: 1 }, m);
    expect(r.affected).toBe(2);
    expect(r.summary).toMatch(/Offsetting 2 entities/);
  });

  it("refuses a layer with nothing on it, rather than succeeding with no commands", () => {
    const r = run("offset_layer", { source_layer: "NOPE", distance: 1 }, model([line("A-WALL", 0, 0, 1, 0)]));
    expect(r.ok).toBe(false);
    expect(r.affected).toBe(0);
  });
});

describe("arrays", () => {
  it("emits copies but not the original, which is already drawn", () => {
    // A 3x1 array emits two new entities, not three.
    const m = model([line("A-WALL", 0, 0, 1, 0)]);
    const r = run("array_layer", { source_layer: "A-WALL", cols: 3, dx: 5 }, m);
    expect(r.affected).toBe(2);
    expect(r.commands!.map((c: any) => c.x1)).toEqual([5, 10]);
  });

  it("refuses an array of one", () => {
    const m = model([line("A-WALL", 0, 0, 1, 0)]);
    const r = run("array_layer", { source_layer: "A-WALL", cols: 1, rows: 1, dx: 5 }, m);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/array of one is the original/);
  });

  it("refuses an array with no spacing, which would stack every copy", () => {
    const m = model([line("A-WALL", 0, 0, 1, 0)]);
    const r = run("array_layer", { source_layer: "A-WALL", cols: 4, dx: 0, dy: 0 }, m);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/land on the original/);
  });

  it("keeps items upright on a polar array when asked", () => {
    const m = model([line("A-WALL", 10, 0, 12, 0)]);
    const r = run("polar_array_layer", {
      source_layer: "A-WALL", cx: 0, cy: 0, count: 4, keep_upright: true,
    }, m);
    // Moved to 90° but still running along +x.
    expect(r.commands![0]).toMatchObject({ x1: 0, y1: 10, x2: 2, y2: 10 });
  });
});

describe("transform", () => {
  it("refuses a transform that would change nothing", () => {
    const m = model([line("A-WALL", 0, 0, 1, 0)]);
    const r = run("transform_layer", { source_layer: "A-WALL", cx: 0, cy: 0, rotate_deg: 0, scale: 1 }, m);
    expect(r.ok).toBe(false);
  });

  it("refuses a non-positive scale factor", () => {
    const m = model([line("A-WALL", 0, 0, 1, 0)]);
    const r = run("transform_layer", { source_layer: "A-WALL", cx: 0, cy: 0, scale: 0 }, m);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/greater than zero/);
  });

  it("rotates about the given base point", () => {
    const m = model([line("A-WALL", 1, 0, 2, 0)]);
    const r = run("transform_layer", { source_layer: "A-WALL", cx: 0, cy: 0, rotate_deg: 90 }, m);
    expect(r.commands![0]).toMatchObject({ x1: 0, y1: 1, x2: 0, y2: 2 });
  });
});

describe("fillet and chamfer", () => {
  const corner = { ax1: 0, ay1: 0, ax2: 10, ay2: 0, bx1: 0, by1: 0, bx2: 0, by2: 10 };

  it("emits both trimmed legs and the arc", () => {
    const r = run("fillet_corner", { ...corner, radius: 2 });
    expect(r.ok).toBe(true);
    expect(r.commands).toHaveLength(3);
    expect((r.data as any).centre).toEqual({ x: 2, y: 2 });
  });

  it("explains why a radius that will not fit is refused", () => {
    // "An arc longer than its own legs is valid geometry and visible nonsense."
    const r = run("fillet_corner", { ax1: 0, ay1: 0, ax2: 1, ay2: 0, bx1: 0, by1: 0, bx2: 0, by2: 1, radius: 5 });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/shorter than the radius needs/);
  });

  it("refuses a zero radius with the right reason, not the fit reason", () => {
    const r = run("fillet_corner", { ...corner, radius: 0 });
    expect(r.summary).toMatch(/greater than zero/);
  });

  it("chamfers unequally when given two distances", () => {
    const r = run("chamfer_corner", { ...corner, d1: 2, d2: 4 });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/2 × 4/);
  });
});

describe("extend and trim", () => {
  it("extends to the boundary", () => {
    const r = run("extend_line", {
      ax1: 0, ay1: 0, ax2: 5, ay2: 0, bx1: 10, by1: -5, bx2: 10, by2: 5,
    });
    expect(r.commands![0]).toMatchObject({ x2: 10, y2: 0 });
  });

  it("explains that a boundary out of reach is not something to extend to", () => {
    const r = run("extend_line", {
      ax1: 0, ay1: 0, ax2: 5, ay2: 0, bx1: 10, by1: 20, bx2: 10, by2: 30,
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/meet something that is not drawn/);
  });

  it("keeps the side the pick point is on", () => {
    const r = run("trim_line", {
      ax1: 0, ay1: 0, ax2: 10, ay2: 0, bx1: 4, by1: -5, bx2: 4, by2: 5,
      keep_x: 9, keep_y: 0,
    });
    expect(r.commands![0]).toMatchObject({ x1: 4, x2: 10 });
  });

  it("says the original is left in place, so nobody assumes it was deleted", () => {
    const r = run("trim_line", {
      ax1: 0, ay1: 0, ax2: 10, ay2: 0, bx1: 4, by1: -5, bx2: 4, by2: 5,
      keep_x: 1, keep_y: 0,
    });
    expect(r.assumptions![0]).toMatch(/left in place/);
  });
});

describe("setting out", () => {
  it("draws a cross at each point", () => {
    const r = run("set_out_points", { x1: 0, y1: 0, x2: 12, y2: 0, parts: 4 });
    expect(r.affected).toBe(3);
    expect(r.commands).toHaveLength(6);   // two strokes per cross
  });

  it("refuses both parts and spacing, which would disagree", () => {
    const r = run("set_out_points", { x1: 0, y1: 0, x2: 12, y2: 0, parts: 4, spacing: 3 });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/only one of them is what you meant/);
  });

  it("refuses neither", () => {
    expect(run("set_out_points", { x1: 0, y1: 0, x2: 12, y2: 0 }).ok).toBe(false);
  });

  it("refuses a spacing longer than the line", () => {
    const r = run("set_out_points", { x1: 0, y1: 0, x2: 2, y2: 0, spacing: 5 });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/longer than the line/);
  });
});

describe("dimension", () => {
  it("reads the measured distance and says it cannot be overridden", () => {
    const r = run("add_dimension", { x1: 0, y1: 0, x2: 3500, y2: 0, offset: 500 });
    expect((r.data as any).text).toBe("3500");
    expect(r.assumptions![0]).toMatch(/cannot be overridden/);
  });

  it("has no parameter for the text, so it cannot be typed", () => {
    /* The guarantee is structural, not a runtime check: there is nowhere to put
       a value that disagrees with the geometry. */
    const names = tool("add_dimension").params.map((p) => p.name);
    expect(names).not.toContain("text");
    expect(names).not.toContain("value");
  });

  it("emits extensions, the line, ticks and the text", () => {
    const r = run("add_dimension", { x1: 0, y1: 0, x2: 1000, y2: 0, offset: 200 });
    const ops = r.commands!.map((c: any) => c.op);
    expect(ops.filter((o: string) => o === "add_line")).toHaveLength(5);
    expect(ops.filter((o: string) => o === "add_text")).toHaveLength(1);
  });

  it("refuses a zero-length dimension", () => {
    expect(run("add_dimension", { x1: 5, y1: 5, x2: 5, y2: 5 }).ok).toBe(false);
  });
});
