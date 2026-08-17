// Which quantities a drawing revision puts in doubt.
//
// The join between DrawLogix and QuantLogix, and the first real step of change
// propagation. The behaviour worth pinning is not the arithmetic — it is the
// third answer.
//
// A measurement that does not record where it was read from cannot be proven
// safe. Sorting it into "unaffected" is how a stale quantity survives a revision
// and reaches a bill; sorting it into "affected" flags everything on the sheet
// and trains people to dismiss the feature. It gets its own verdict.

import { describe, it, expect } from "vitest";
import type { DxfModel, Entity } from "@/lib/cad/model";
import { compareRevisions } from "@/lib/cad/compare";
import { assessRevisionImpact, dimensionChanges, type MeasurementRef } from "@/lib/cad/impact";

const line = (x1: number, y1: number, x2: number, y2: number, layer: string): Entity =>
  ({ kind: "line", layer, x1, y1, x2, y2 });
const text = (t: string, x: number, y: number, layer: string): Entity =>
  ({ kind: "text", layer, text: t, x, y, h: 2.5 });

const sheet = (entities: Entity[], layers: string[]): DxfModel => ({
  insunits: 4,
  layers: layers.map((name) => ({ name, aci: 7, visible: true })),
  entities,
});

const LAYERS = ["A-WALL", "A-SLAB", "A-ANNO-DIMS"];

const before = () =>
  sheet(
    [line(0, 0, 5000, 0, "A-WALL"), line(0, 100, 5000, 100, "A-SLAB"), text("5100", 2500, 200, "A-ANNO-DIMS")],
    LAYERS,
  );

/** Only the wall layer moves. */
const wallMoved = () =>
  sheet(
    [line(0, 300, 5000, 300, "A-WALL"), line(0, 100, 5000, 100, "A-SLAB"), text("5100", 2500, 200, "A-ANNO-DIMS")],
    LAYERS,
  );

const measure = (id: string, item: string, layers?: string[]): MeasurementRef => ({
  id,
  sheet_no: "A-307",
  item,
  quantity: 12.5,
  unit: "m2",
  ...(layers ? { source_layers: layers } : {}),
});

describe("a revision that touches one layer", () => {
  const diff = () => compareRevisions(before(), wallMoved());

  it("flags only what reads from that layer", () => {
    const r = assessRevisionImpact("A-307", diff(), [
      measure("m1", "Blockwork", ["A-WALL"]),
      measure("m2", "Slab", ["A-SLAB"]),
    ]);
    expect(r.affected.map((a) => a.id)).toEqual(["m1"]);
    expect(r.unaffected).toBe(1);
  });

  it("says which layer put a measurement in doubt", () => {
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork", ["A-WALL", "A-SLAB"])]);
    expect(r.affected[0].via).toEqual(["A-WALL"]);
    expect(r.affected[0].why).toContain("A-WALL");
  });

  it("matches a layer name whatever its case", () => {
    // CAD layer naming is not consistent about it, and a missed match here is a
    // stale quantity nobody was warned about.
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork", ["a-wall"])]);
    expect(r.affected).toHaveLength(1);
  });
});

describe("a measurement with no recorded source", () => {
  const diff = () => compareRevisions(before(), wallMoved());

  it("is neither affected nor unaffected", () => {
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork")]);
    expect(r.affected).toEqual([]);
    expect(r.unaffected).toBe(0);
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].verdict).toBe("unknown");
  });

  it("is not quietly counted as safe", () => {
    /* The failure this exists to stop: a quantity whose provenance was never
       recorded surviving a revision untouched and reaching a bill. */
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork")]);
    expect(r.unaffected).toBe(0);
    expect(r.needsReview).toBe(true);
  });

  it("explains what is missing, rather than just refusing", () => {
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork")]);
    expect(r.unknown[0].why).toMatch(/does not record which layers/i);
  });

  it("treats an empty layer list the same as none at all", () => {
    const r = assessRevisionImpact("A-307", diff(), [measure("m1", "Blockwork", [])]);
    expect(r.unknown).toHaveLength(1);
  });
});

describe("a revision that changes nothing", () => {
  it("puts nothing in doubt", () => {
    const r = assessRevisionImpact("A-307", compareRevisions(before(), before()), [
      measure("m1", "Blockwork", ["A-WALL"]),
    ]);
    expect(r.affected).toEqual([]);
    expect(r.unaffected).toBe(1);
    expect(r.needsReview).toBe(false);
  });

  it("still reports honestly when provenance is missing", () => {
    // Nothing changed, so nothing is stale — but the gap is real and stays
    // visible rather than being hidden by a quiet revision.
    const r = assessRevisionImpact("A-307", compareRevisions(before(), before()), [measure("m1", "Blockwork")]);
    expect(r.unknown).toHaveLength(1);
    expect(r.needsReview).toBe(true);
  });
});

describe("a new layer", () => {
  it("asks for review even when no measurement reads from it", () => {
    /* Geometry on a layer nobody has measured is work that may be missing from
       the bill — a different problem from a stale quantity, and just as much
       worth surfacing. */
    const after = sheet([...before().entities, line(0, 900, 5000, 900, "A-NEW")], [...LAYERS, "A-NEW"]);
    const r = assessRevisionImpact("A-307", compareRevisions(before(), after), [
      measure("m1", "Blockwork", ["A-WALL"]),
    ]);
    expect(r.affected).toEqual([]);
    expect(r.needsReview).toBe(true);
  });
});

describe("nothing is recalculated", () => {
  it("reports the quantity unchanged — staleness is a flag, not a correction", () => {
    /* The same discipline the BIM assistant follows: the system proposes, a
       person decides. A quantity that moved under a signed-off bill without
       anyone agreeing is the failure the artifact chain exists to prevent. */
    const r = assessRevisionImpact("A-307", compareRevisions(before(), wallMoved()), [
      measure("m1", "Blockwork", ["A-WALL"]),
    ]);
    expect(r.affected[0].quantity).toBe(12.5);
    expect(r.affected[0].unit).toBe("m2");
  });
});

describe("dimension changes", () => {
  const withDim = (t: string) =>
    sheet([line(0, 0, 5000, 0, "A-WALL"), text(t, 2500, 200, "A-ANNO-DIMS")], LAYERS);

  it("surfaces a changed label with its delta", () => {
    const d = compareRevisions(withDim("5100"), withDim("5200"));
    const [c] = dimensionChanges(d);
    expect(c).toMatchObject({ before: "5100", after: "5200", delta: 100 });
  });

  it("ranks by proportion, not by absolute size", () => {
    /* 100 mm on a 5 m wall and 100 mm on a 200 mm upstand are not the same
       news, and a list sorted by absolute delta buries the second. */
    const a = sheet(
      [text("5000", 0, 0, "A-ANNO-DIMS"), text("200", 1000, 0, "A-ANNO-DIMS")],
      LAYERS,
    );
    const b = sheet(
      [text("5100", 0, 0, "A-ANNO-DIMS"), text("300", 1000, 0, "A-ANNO-DIMS")],
      LAYERS,
    );
    const changes = dimensionChanges(compareRevisions(a, b));
    expect(changes[0].before).toBe("200");   // 50% beats 2%
    expect(changes[0].percent).toBe(50);
  });

  it("ignores a label that was edited without changing its value", () => {
    // "5100" to "5100 mm" is a formatting change, not a dimension change.
    const d = compareRevisions(withDim("5100"), withDim("5100 mm"));
    expect(dimensionChanges(d)).toEqual([]);
  });

  it("leaves prose out of the dimension list", () => {
    const d = compareRevisions(withDim("EXISTING"), withDim("DEMOLISH"));
    expect(dimensionChanges(d)).toEqual([]);
  });
});

describe("the summary a reviewer reads", () => {
  it("leads with what changed, then what it means", () => {
    const r = assessRevisionImpact("A-307", compareRevisions(before(), wallMoved()), [
      measure("m1", "Blockwork", ["A-WALL"]),
      measure("m2", "Slab", ["A-SLAB"]),
      measure("m3", "Screed"),
    ]);
    expect(r.summary).toMatch(/moved/);
    expect(r.summary).toMatch(/1 affected/);
    expect(r.summary).toMatch(/1 unverifiable/);
  });

  it("says so plainly when the sheet has no measurements", () => {
    const r = assessRevisionImpact("A-307", compareRevisions(before(), wallMoved()), []);
    expect(r.summary).toMatch(/No measurements taken from this sheet/i);
  });
});
