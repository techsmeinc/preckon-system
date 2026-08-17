// Comparing two revisions of a drawing.
//
// The precondition for change propagation, and the reason it is hard: entity ids
// here are session-local, so two revisions of the same sheet share none. An
// id-based diff reports every entity as both removed and added. Matching is by
// content, and the ORDER the four outcomes are decided in is the design —
// decided naively, a dimension going from 5100 to 5200 reads as one deletion
// plus one addition, which is true and useless.

import { describe, it, expect } from "vitest";
import type { DxfModel, Entity } from "@/lib/cad/model";
import { affectedLayers, compareRevisions, toleranceFor } from "@/lib/cad/compare";

const line = (x1: number, y1: number, x2: number, y2: number, layer = "A-WALL"): Entity =>
  ({ kind: "line", layer, x1, y1, x2, y2 });
const text = (t: string, x: number, y: number, layer = "A-ANNO-DIMS"): Entity =>
  ({ kind: "text", layer, text: t, x, y, h: 2.5 });

/** A sheet in millimetres, the way an issued drawing arrives. */
const sheet = (entities: Entity[], layers = ["A-WALL", "A-ANNO-DIMS"]): DxfModel => ({
  insunits: 4,
  layers: layers.map((name) => ({ name, aci: 7, visible: true })),
  entities,
});

const base = () =>
  sheet([
    line(0, 0, 5000, 0),
    line(0, 0, 0, 3000),
    text("5100", 2500, 200),
    text("ROOM 307", 1000, 1500, "A-ANNO-ROOM"),
  ], ["A-WALL", "A-ANNO-DIMS", "A-ANNO-ROOM"]);

describe("an unchanged revision", () => {
  it("reports nothing changed", () => {
    const d = compareRevisions(base(), base());
    expect(d.summary).toBe("no geometric change");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(4);
  });

  it("does not depend on ids, which differ between revisions", () => {
    // The whole point: the same drawing loaded twice has different ids, and an
    // id-based diff would call every entity both removed and added.
    const a = base();
    const b: DxfModel = { ...base(), entities: base().entities.map((e, i) => ({ ...e, id: `x${i}` })) };
    expect(compareRevisions(a, b).unchanged).toBe(4);
  });

  it("ignores a segment redrawn in the opposite direction", () => {
    // Nothing on the sheet reads differently for having been drawn
    // right-to-left, and a CAD round trip flips endpoints freely.
    const a = sheet([line(0, 0, 5000, 0)]);
    const b = sheet([line(5000, 0, 0, 0)]);
    expect(compareRevisions(a, b).unchanged).toBe(1);
  });

  it("tolerates floating-point noise from a round trip", () => {
    const a = sheet([line(0, 0, 5000, 0)]);
    const b = sheet([line(0, 0, 5000.0000001, 0)]);
    expect(compareRevisions(a, b).unchanged).toBe(1);
  });
});

describe("a dimension edited in place", () => {
  it("reads as a text change, not a delete plus an add", () => {
    /* The case that decides whether this is useful. An estimator needs to know
       a dimension CHANGED and by how much; "one text removed, one text added"
       makes them find that out themselves. */
    const after = sheet(
      base().entities.map((e) => (e.kind === "text" && e.text === "5100" ? { ...e, text: "5200" } : e)),
      ["A-WALL", "A-ANNO-DIMS", "A-ANNO-ROOM"],
    );
    const d = compareRevisions(base(), after);

    expect(d.textChanged).toHaveLength(1);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.textChanged[0]).toMatchObject({ before: "5100", after: "5200", delta: 100 });
  });

  it("quantifies the change where both readings are numeric", () => {
    const a = sheet([text("2,400", 0, 0)]);
    const b = sheet([text("2,650 mm", 0, 0)]);
    expect(compareRevisions(a, b).textChanged[0].delta).toBe(250);
  });

  it("leaves delta null when the label is prose", () => {
    const a = sheet([text("EXISTING", 0, 0)]);
    const b = sheet([text("DEMOLISH", 0, 0)]);
    const c = compareRevisions(a, b).textChanged[0];
    expect(c.delta).toBeNull();
    expect(c.before).toBe("EXISTING");
  });

  it("does not pair text on different layers as an edit", () => {
    // A room tag and a dimension that happen to share a coordinate are two
    // different things, and calling one an edit of the other would be a lie.
    const a = sheet([text("A", 100, 100, "A-ANNO-DIMS")]);
    const b = sheet([text("B", 100, 100, "A-ANNO-ROOM")], ["A-ANNO-DIMS", "A-ANNO-ROOM"]);
    const d = compareRevisions(a, b);
    expect(d.textChanged).toEqual([]);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
  });
});

describe("geometry moved", () => {
  it("reports a shift rather than a deletion and an addition", () => {
    const a = sheet([line(0, 0, 5000, 0)]);
    const b = sheet([line(0, 300, 5000, 300)]);
    const d = compareRevisions(a, b);

    expect(d.moved).toHaveLength(1);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.moved[0]).toMatchObject({ dx: 0, dy: 300, distance: 300 });
  });

  it("distinguishes a wall that moved from a wall that got longer", () => {
    // Same length, new place → moved. New length → genuinely different.
    const a = sheet([line(0, 0, 5000, 0)]);
    const longer = compareRevisions(a, sheet([line(0, 0, 6000, 0)]));
    expect(longer.moved).toEqual([]);
    expect(longer.added).toHaveLength(1);
    expect(longer.removed).toHaveLength(1);
  });

  it("pairs each of several identical shapes with its nearest counterpart", () => {
    /* Three identical columns nudged: pairing them arbitrarily would report
       three enormous movements instead of three small ones, and the distances
       are what a reviewer judges the revision by. */
    const a = sheet([line(0, 0, 100, 0), line(1000, 0, 1100, 0), line(2000, 0, 2100, 0)]);
    const b = sheet([line(0, 50, 100, 50), line(1000, 50, 1100, 50), line(2000, 50, 2100, 50)]);
    const d = compareRevisions(a, b);

    expect(d.moved).toHaveLength(3);
    for (const m of d.moved) expect(m.distance).toBe(50);
  });
});

describe("added and removed", () => {
  it("reports genuinely new geometry as added", () => {
    const d = compareRevisions(base(), sheet([...base().entities, line(0, 3000, 5000, 3000)], ["A-WALL", "A-ANNO-DIMS", "A-ANNO-ROOM"]));
    expect(d.added).toHaveLength(1);
    expect(d.removed).toEqual([]);
  });

  it("reports deleted geometry as removed", () => {
    const after = sheet(base().entities.slice(1), ["A-WALL", "A-ANNO-DIMS", "A-ANNO-ROOM"]);
    const d = compareRevisions(base(), after);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toEqual([]);
  });

  it("counts duplicates rather than collapsing them", () => {
    // A sheet is full of identical short segments; treating them as one entity
    // would hide the removal of nine of them.
    const a = sheet(Array.from({ length: 10 }, () => line(0, 0, 100, 0)));
    const b = sheet(Array.from({ length: 4 }, () => line(0, 0, 100, 0)));
    const d = compareRevisions(a, b);
    expect(d.unchanged).toBe(4);
    expect(d.removed).toHaveLength(6);
  });
});

describe("what the reviewer is told", () => {
  it("groups the change by layer, busiest first", () => {
    const a = sheet([line(0, 0, 100, 0), line(0, 0, 200, 0, "X-JUNK")], ["A-WALL", "X-JUNK"]);
    const b = sheet([line(0, 0, 300, 0, "X-JUNK"), line(0, 0, 400, 0, "X-JUNK")], ["A-WALL", "X-JUNK"]);
    const d = compareRevisions(a, b);
    expect(d.byLayer[0].layer).toBe("X-JUNK");
  });

  it("names layers that appeared or disappeared", () => {
    const a = sheet([line(0, 0, 100, 0)], ["A-WALL"]);
    const b = sheet([line(0, 0, 100, 0)], ["A-WALL", "A-NEW"]);
    const d = compareRevisions(a, b);
    expect(d.layersAdded).toEqual(["A-NEW"]);
    expect(d.layersRemoved).toEqual([]);
  });

  it("summarises in a sentence", () => {
    const a = sheet([line(0, 0, 100, 0), text("100", 50, 10)]);
    const b = sheet([text("150", 50, 10), line(0, 0, 200, 0)]);
    expect(compareRevisions(a, b).summary).toMatch(/added|removed|text changed/);
  });

  it("lists the layers a measurement should be re-checked against", () => {
    /* The bridge to the rest of the chain: a quantity read from a layer this
       revision touched is suspect, and should be marked stale rather than
       silently recalculated. */
    const a = sheet([line(0, 0, 100, 0)], ["A-WALL", "A-ANNO-DIMS"]);
    const b = sheet([line(0, 0, 100, 0), line(0, 50, 100, 50)], ["A-WALL", "A-ANNO-DIMS"]);
    expect(affectedLayers(compareRevisions(a, b))).toEqual(["A-WALL"]);
  });
});

describe("tolerance", () => {
  it("scales with the drawing, since units vary", () => {
    // 2.5 units is noise on a millimetre sheet and a real distance on one in
    // metres. A fixed tolerance is wrong on one of them.
    const mm = toleranceFor(sheet([line(0, 0, 50000, 30000)]));
    const m = toleranceFor(sheet([line(0, 0, 50, 30)]));
    expect(mm).toBeGreaterThan(m);
  });

  it("survives an empty drawing without dividing by zero", () => {
    expect(toleranceFor(sheet([]))).toBeGreaterThan(0);
    expect(() => compareRevisions(sheet([]), sheet([]))).not.toThrow();
  });

  it("uses one tolerance for both revisions", () => {
    /* Two different tolerances would snap the same coordinate into two
       different buckets and invent changes that are only rounding. */
    const small = sheet([line(0, 0, 100, 0)]);
    const large = sheet([line(0, 0, 100, 0), line(0, 0, 900000, 0)]);
    const d = compareRevisions(small, large);
    expect(d.tolerance).toBe(compareRevisions(large, small).tolerance);
    expect(d.unchanged).toBe(1);
  });
});

describe("nearest-match pairing, off the diagonal", () => {
  it("pairs by true distance, not by a coordinate mix-up", () => {
    /* Regression. The comparator read `y.x - from.y` for the second candidate —
       comparing an x against a y. It went unnoticed because the first fixture
       put every shape at y=0, where from.x and from.y coincide and the wrong
       term gives the right answer.

       Here the shapes sit off that diagonal, so a comparator that confuses the
       axes pairs each source with the wrong target and reports movements far
       larger than the ones that happened. */
    const a = sheet([
      line(1000, 50, 1100, 50),
      line(4000, 900, 4100, 900),
    ]);
    const b = sheet([
      line(4000, 920, 4100, 920),   // deliberately out of source order
      line(1000, 70, 1100, 70),
    ]);

    const d = compareRevisions(a, b);
    expect(d.moved).toHaveLength(2);
    // Each shape moved 20 units. A mis-paired diff reports thousands.
    for (const m of d.moved) expect(m.distance).toBe(20);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
