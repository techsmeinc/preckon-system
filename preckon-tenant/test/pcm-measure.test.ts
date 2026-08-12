// The measurement engine, against numbers worked out by hand.
//
// This is the test the bill's defensibility rests on. Every other test in this
// repo proves the machinery moves; this one proves the arithmetic is right —
// and the blueprint is explicit that a release cannot be judged on whether the
// output "looks good".
//
// Each case states the hand calculation in the test name, so a failure says
// what the answer should have been rather than only that two numbers differ.

import { describe, it, expect } from "vitest";
import { applyRule, measureObject, geometryBounds, type MeasuredObject } from "@/lib/pcm/measure";
import { pcmType } from "@/lib/pcm/types";

const wall = (over: Partial<MeasuredObject["geometry"]> = {}, hosted: MeasuredObject[] = []): MeasuredObject => ({
  id: "w1",
  typeCode: "WALL",
  geometry: { baseline: [[0, 0], [5, 0]], heightM: 3, thicknessM: 0.15, ...over },
  hosted,
});

const opening = (id: string, widthM: number, heightM: number, typeCode = "DOOR"): MeasuredObject =>
  ({ id, typeCode, geometry: { widthM, heightM } });

const rule = (typeCode: string, code: string) =>
  pcmType(typeCode)!.rules.find((r) => r.code === code)!;

describe("walls", () => {
  it("5 m x 3 m with nothing in it is 15 m2", () => {
    const q = applyRule(wall(), rule("WALL", "NET_WALL_AREA:v1"))!;
    expect(q.value).toBe(15);
    expect(q.unit).toBe("m2");
    expect(q.calculation.problem).toBeUndefined();
  });

  it("deducts a 0.9 x 2.1 door: 15 - 1.89 = 13.11 m2", () => {
    const q = applyRule(wall({}, [opening("d1", 0.9, 2.1)]), rule("WALL", "NET_WALL_AREA:v1"))!;
    expect(q.value).toBe(13.11);
    expect(q.calculation.deductions).toHaveLength(1);
    expect(q.calculation.deductions![0].areaM2).toBe(1.89);
  });

  it("deducts several openings", () => {
    const q = applyRule(
      wall({}, [opening("d1", 0.9, 2.1), opening("w1", 1.2, 1.5, "WINDOW")]),
      rule("WALL", "NET_WALL_AREA:v1")
    )!;
    // 15 - 1.89 - 1.8
    expect(q.value).toBe(11.31);
  });

  it("ignores an opening below the deduction threshold", () => {
    // 0.4 x 0.4 = 0.16 m2, under the rule's 0.5 m2 floor. Every method of
    // measurement has such a threshold; deducting a hatch is not measurement.
    const q = applyRule(wall({}, [opening("h1", 0.4, 0.4)]), rule("WALL", "NET_WALL_AREA:v1"))!;
    expect(q.value).toBe(15);
    expect(q.calculation.deductions).toHaveLength(0);
  });

  it("says WHY it could not measure a wall with no height", () => {
    const q = applyRule(wall({ heightM: 0 }), rule("WALL", "NET_WALL_AREA:v1"))!;
    expect(q.value).toBe(0);
    // The failure has to be legible. A silent zero is how a missing wall gets
    // added into a total that somebody then prices.
    expect(q.calculation.problem).toMatch(/no height/i);
  });

  it("volume is the NET area x thickness, not the gross", () => {
    const q = applyRule(wall({}, [opening("d1", 0.9, 2.1)]), rule("WALL", "WALL_VOLUME:v1"))!;
    // 13.11 x 0.15
    expect(q.value).toBeCloseTo(1.967, 3);
  });

  it("measures length along the baseline, corners included", () => {
    const q = applyRule(
      wall({ baseline: [[0, 0], [3, 0], [3, 4]] }),
      rule("WALL", "WALL_LENGTH:v1")
    )!;
    expect(q.value).toBe(7);      // 3 + 4
  });
});

describe("rooms and slabs", () => {
  const room: MeasuredObject = {
    id: "r1", typeCode: "ROOM",
    geometry: { outline: [[0, 0], [4, 0], [4, 5], [0, 5]] },
  };

  it("a 4 x 5 room is 20 m2", () => {
    expect(applyRule(room, rule("ROOM", "NET_FLOOR_AREA:v1"))!.value).toBe(20);
  });

  it("its perimeter is 18 m", () => {
    expect(applyRule(room, rule("ROOM", "PERIMETER:v1"))!.value).toBe(18);
  });

  it("measures an outline drawn clockwise the same as anticlockwise", () => {
    // A draughtsman's outline runs whichever way they drew it, and a negative
    // floor area is never what anyone meant.
    const reversed: MeasuredObject = { ...room, geometry: { outline: [...room.geometry.outline!].reverse() } };
    expect(applyRule(reversed, rule("ROOM", "NET_FLOOR_AREA:v1"))!.value).toBe(20);
  });

  it("an L-shaped slab measures its true area, not its bounding box", () => {
    const l: MeasuredObject = {
      id: "s1", typeCode: "SLAB",
      geometry: { outline: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]], thicknessM: 0.2 },
    };
    // 6x2 + 2x3 = 18, against a 6x5 = 30 bounding box.
    expect(applyRule(l, rule("SLAB", "SLAB_AREA:v1"))!.value).toBe(18);
    expect(applyRule(l, rule("SLAB", "SLAB_VOLUME:v1"))!.value).toBe(3.6);
  });
});

describe("columns", () => {
  const col: MeasuredObject = {
    id: "c1", typeCode: "COLUMN",
    geometry: { at: [10, 5], widthM: 0.4, depthM: 0.6, heightM: 3.2 },
  };

  it("volume is w x d x h", () => {
    expect(applyRule(col, rule("COLUMN", "COLUMN_VOLUME:v1"))!.value).toBeCloseTo(0.768, 3);
  });

  it("formwork is the four faces only, not the top and bottom", () => {
    // 2 x (0.4 + 0.6) x 3.2 = 6.4. One end is cast against the slab above and
    // the other sits on what is below; neither is shuttered.
    expect(applyRule(col, rule("COLUMN", "COLUMN_FORMWORK:v1"))!.value).toBe(6.4);
  });

  it("counts as one", () => {
    expect(applyRule(col, rule("COLUMN", "COUNT:v1"))!.value).toBe(1);
  });
});

describe("measuring a whole object", () => {
  it("a wall produces its length, its net area and its volume", () => {
    const qs = measureObject(wall({}, [opening("d1", 0.9, 2.1)]), pcmType("WALL")!);
    expect(qs.map((q) => q.ruleCode).sort()).toEqual(
      ["NET_WALL_AREA:v1", "WALL_LENGTH:v1", "WALL_VOLUME:v1"]
    );
  });

  it("every quantity carries the basis it was measured on", () => {
    // This is what makes a number arguable rather than merely believable.
    for (const q of measureObject(wall(), pcmType("WALL")!)) {
      expect(q.calculation.basis.length).toBeGreaterThan(10);
    }
  });
});

describe("bounds", () => {
  it("a linear object's bounds follow its baseline", () => {
    expect(geometryBounds({ baseline: [[0, 0], [5, 2]] })).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 2 });
  });

  it("a point object gets its own footprint, so a box query can find it", () => {
    const b = geometryBounds({ at: [10, 5], widthM: 0.4, depthM: 0.6 })!;
    expect(b.minX).toBeCloseTo(9.7);
    expect(b.maxX).toBeCloseTo(10.3);
  });
});
