// Clash detection and parametric families.
//
// The clearance tests carry this file. A hard clash gets found by every tool;
// a valve 40 mm from a wall passes coordination, fits, and cannot ever be
// serviced. That one is only findable against a rule, which is why the rules
// are data rather than constants.

import { describe, it, expect } from "vitest";
import { detect, report, gap, overlapVolume, type Item, type ClearanceRule } from "@/lib/cad/clash";
import {
  validateFamily, resolve, evaluate, schedule,
  type Family, type FamilyType, type Instance,
} from "@/lib/cad/families";

const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => ({ x, y, z, dx, dy, dz });

const item = (id: string, discipline: string, b: ReturnType<typeof box>, over: Partial<Item> = {}): Item =>
  ({ id, name: id, discipline, box: b, ...over });

describe("hard clashes", () => {
  it("finds a duct through a beam and calls it critical", () => {
    const beam = item("Beam-1", "structural", box(0, 0, 3, 6, 0.3, 0.5));
    const duct = item("Duct-1", "mechanical", box(2, -0.2, 3.2, 1, 1, 0.4));
    const clashes = detect([beam, duct]);
    expect(clashes[0].kind).toBe("hard");
    expect(clashes[0].severity).toBe("critical");     // structural is involved
    expect(clashes[0].overlapVolume).toBeGreaterThan(0);
  });

  it("computes the overlap volume", () => {
    expect(overlapVolume(box(0, 0, 0, 2, 2, 2), box(1, 1, 1, 2, 2, 2))).toBe(1);
    expect(overlapVolume(box(0, 0, 0, 1, 1, 1), box(5, 5, 5, 1, 1, 1))).toBe(0);
  });

  it("does not clash two services that merely pass near each other", () => {
    const a = item("Pipe-1", "mechanical", box(0, 0, 0, 1, 0.1, 0.1));
    const b = item("Cable-1", "electrical", box(0, 1, 0, 1, 0.1, 0.1));
    expect(detect([a, b])).toHaveLength(0);
  });

  it("respects an opening formed for the element passing through it", () => {
    const wall = item("Wall-1", "architectural", box(0, 0, 0, 5, 0.2, 3), { permittedThrough: ["Duct-2"] });
    const duct = item("Duct-2", "mechanical", box(2, -0.5, 1, 0.5, 1.2, 0.5));
    expect(detect([wall, duct])).toHaveLength(0);
  });

  it("reports touching separately, since nothing fits between", () => {
    const a = item("A", "architectural", box(0, 0, 0, 1, 1, 1));
    const b = item("B", "mechanical", box(1, 0, 0, 1, 1, 1));
    const clashes = detect([a, b]);
    expect(clashes[0].kind).toBe("touching");
    expect(clashes[0].message).toMatch(/nothing can be installed between/);
  });
});

describe("clearance", () => {
  const maintenance: ClearanceRule[] = [{
    key: "valve-access",
    appliesTo: { discipline: "mechanical", category: "valve" },
    minimumGap: 0.45,
    reason: "maintenance access",
  }];

  it("flags a valve that fits and cannot be reached", () => {
    // 40 mm from the wall: legal geometry, unserviceable installation, and
    // invisible to a tool that only tests intersection.
    const wall = item("Wall-1", "architectural", box(0, 0, 0, 5, 0.2, 3));
    const valve = item("Valve-1", "mechanical", box(1, 0.24, 1, 0.2, 0.2, 0.2), { category: "valve" });
    const clashes = detect([wall, valve], maintenance);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].kind).toBe("clearance");
    expect(clashes[0].message).toMatch(/It fits, and it cannot be worked on/);
    expect(clashes[0].required).toBe(0.45);
  });

  it("says nothing when the clearance is met", () => {
    const wall = item("Wall-1", "architectural", box(0, 0, 0, 5, 0.2, 3));
    const valve = item("Valve-1", "mechanical", box(1, 1.0, 1, 0.2, 0.2, 0.2), { category: "valve" });
    expect(detect([wall, valve], maintenance)).toHaveLength(0);
  });

  it("applies a rule only against the disciplines it names", () => {
    const scoped: ClearanceRule[] = [{ ...maintenance[0], against: ["structural"] }];
    const wall = item("Wall-1", "architectural", box(0, 0, 0, 5, 0.2, 3));
    const valve = item("Valve-1", "mechanical", box(1, 0.24, 1, 0.2, 0.2, 0.2), { category: "valve" });
    expect(detect([wall, valve], scoped)).toHaveLength(0);
  });

  it("measures the true diagonal gap, not just one axis", () => {
    const g = gap(box(0, 0, 0, 1, 1, 1), box(2, 2, 0, 1, 1, 1));
    expect(g).toBeCloseTo(Math.sqrt(2), 4);
  });
});

describe("clash report", () => {
  it("summarises by discipline pairing and orders worst first", () => {
    const items = [
      item("Beam-1", "structural", box(0, 0, 3, 6, 0.3, 0.5)),
      item("Duct-1", "mechanical", box(2, -0.2, 3.2, 1, 1, 0.4)),
      item("Cable-1", "electrical", box(2.5, -0.1, 3.25, 0.5, 0.5, 0.1)),
    ];
    const r = report(items);
    expect(r.clean).toBe(false);
    expect(r.critical).toBeGreaterThan(0);
    expect(r.clashes[0].severity).toBe("critical");
    expect(r.byDisciplinePair[0].count).toBeGreaterThan(0);
  });

  it("can be limited to cross-discipline pairs", () => {
    const a = item("Duct-1", "mechanical", box(0, 0, 0, 2, 2, 2));
    const b = item("Duct-2", "mechanical", box(1, 1, 1, 2, 2, 2));
    expect(report([a, b], [], { crossDisciplineOnly: true }).clean).toBe(true);
    expect(report([a, b]).clean).toBe(false);
  });
});

/* ── families ─────────────────────────────────────────────────────────────── */

const door: Family = {
  key: "door", name: "Single door", category: "door",
  params: [
    { key: "leaf_width", label: "Leaf width", kind: "length", scope: "type", unit: "mm", required: true, min: 600, max: 1200 },
    { key: "height", label: "Height", kind: "length", scope: "type", unit: "mm", required: true },
    { key: "fire_rating", label: "Fire rating", kind: "choice", scope: "type", choices: ["none", "FD30", "FD60"], required: true },
    { key: "handing", label: "Handing", kind: "choice", scope: "instance", choices: ["left", "right"], required: true },
    { key: "frame", label: "Frame allowance", kind: "length", scope: "instance", default: 50 },
    { key: "structural_opening", label: "Structural opening", kind: "length", scope: "instance", formula: "leaf_width + frame * 2" },
  ],
};

const fd60: FamilyType = {
  key: "FD60-900", familyKey: "door", name: "FD60 900mm",
  values: { leaf_width: 900, height: 2100, fire_rating: "FD60" },
};

describe("families", () => {
  it("computes a derived parameter rather than storing it", () => {
    const r = resolve(door, fd60, { id: "d1", typeKey: "FD60-900", values: { handing: "left" } });
    expect(r.values.structural_opening).toBe(1000);   // 900 + 50*2
    expect(r.valid).toBe(true);
  });

  it("rejects a value outside the family's constraints", () => {
    const wide: FamilyType = { ...fd60, values: { ...fd60.values, leaf_width: 1500 } };
    const r = resolve(door, wide, { id: "d1", typeKey: "x", values: { handing: "left" } });
    expect(r.valid).toBe(false);
    expect(r.issues[0].message).toMatch(/above the maximum/);
  });

  it("rejects a choice that is not one of the choices", () => {
    const r = resolve(door, fd60, { id: "d1", typeKey: "x", values: { handing: "sideways" } });
    expect(r.issues.some((i) => /not one of/.test(i.message))).toBe(true);
  });

  it("warns when an instance overrides a type parameter", () => {
    // It looks like it worked and will not follow when the type changes, which
    // is the entire reason to have a type.
    const r = resolve(door, fd60, { id: "d1", typeKey: "x", values: { handing: "left", fire_rating: "FD30" } });
    expect(r.issues.some((i) => /will not follow when the type changes/.test(i.message))).toBe(true);
  });

  it("reports a formula it cannot evaluate instead of silently returning zero", () => {
    const noFrame: Family = { ...door, params: door.params.filter((p) => p.key !== "frame") };
    const r = resolve(noFrame, fd60, { id: "d1", typeKey: "x", values: { handing: "left" } });
    expect(r.values.structural_opening).toBeNull();
    expect(r.issues.some((i) => /Could not evaluate/.test(i.message))).toBe(true);
  });

  it("refuses to evaluate anything that is not arithmetic", () => {
    expect(evaluate("leaf_width + 10", { leaf_width: 900 })).toBe(910);
    expect(evaluate("process.exit(1)", {})).toBeNull();
    expect(evaluate("leaf_width", {})).toBeNull();
  });

  it("catches a choice parameter with no choices at publish time", () => {
    const broken: Family = { ...door, params: [{ key: "x", label: "X", kind: "choice", scope: "type" }] };
    expect(validateFamily(broken)[0].message).toMatch(/never be given a valid value/);
  });

  it("schedules by type, because that is what gets ordered", () => {
    const instances: Instance[] = [
      { id: "d1", typeKey: "FD60-900", values: { handing: "left" } },
      { id: "d2", typeKey: "FD60-900", values: { handing: "right" } },
    ];
    const rows = schedule(instances.map((i) => resolve(door, fd60, i)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ typeName: "FD60 900mm", count: 2 });
  });
});
