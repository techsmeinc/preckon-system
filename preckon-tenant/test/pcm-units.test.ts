// Units at the boundary.
//
// The failure this guards against is invisible everywhere else: a millimetre
// drawing read as metres produces a model that measures perfectly, prices
// cleanly, totals correctly and is wrong by a factor of a thousand. Every other
// test in this repo passes while it happens, because nothing downstream did
// anything wrong.

import { describe, it, expect } from "vitest";
import {
  checkScale, decideUnit, scaleGeometry, scaleToMetres, unitFromInsunits,
} from "@/lib/pcm/units";

describe("reading what a file says about itself", () => {
  it("maps the DXF unit codes", () => {
    expect(unitFromInsunits(4)).toBe("mm");
    expect(unitFromInsunits(6)).toBe("m");
    expect(unitFromInsunits(2)).toBe("ft");
  });

  it("treats 'unitless' as unknown, not as metres", () => {
    // $INSUNITS 0 means the file declined to say. Reading that as metres is a
    // guess wearing a fact's clothes.
    expect(unitFromInsunits(0)).toBeNull();
    expect(unitFromInsunits(undefined)).toBeNull();
  });

  it("converts to metres", () => {
    expect(scaleToMetres("mm")).toBe(0.001);
    expect(scaleToMetres("ft")).toBeCloseTo(0.3048, 6);
  });
});

describe("deciding units", () => {
  it("prefers what the file declared", () => {
    const d = decideUnit({ declared: "mm" });
    expect(d.unit).toBe("mm");
    expect(d.basis).toBe("DECLARED");
  });

  it("lets a human override the file", () => {
    const d = decideUnit({ declared: "m", override: "mm" });
    expect(d.unit).toBe("mm");
    expect(d.basis).toBe("USER_OVERRIDE");
  });

  it("infers millimetres from a drawing 40,000 units across", () => {
    // Nothing anybody builds is 40 km wide.
    const d = decideUnit({ extent: 40000 });
    expect(d.unit).toBe("mm");
    expect(d.basis).toBe("INFERRED");
    expect(d.note).toMatch(/millimetres/i);
  });

  it("infers metres from a drawing 42 units across", () => {
    const d = decideUnit({ extent: 42 });
    expect(d.unit).toBe("m");
    expect(d.basis).toBe("INFERRED");
  });

  it("refuses to guess in the ambiguous middle, and says so", () => {
    // 900 could be a 900 m site or a 900 mm detail. Guessing here is how the
    // error gets in; the honest answer is the default plus a warning.
    const d = decideUnit({ extent: 900, projectDefault: "m" });
    expect(d.basis).toBe("PROJECT_DEFAULT");
    expect(d.note).toMatch(/ambiguous/i);
  });
});

describe("the scale guard", () => {
  it("passes an ordinary 5 m wall", () => {
    expect(checkScale("WALL", 5)).toBeNull();
  });

  it("passes a long but real 400 m slab", () => {
    // Generous on purpose. This is here to catch a factor of a thousand, not to
    // have opinions about architecture.
    expect(checkScale("SLAB", 400)).toBeNull();
  });

  it("catches a 5,100 m wall and names the likely cause", () => {
    const w = checkScale("WALL", 5100)!;
    expect(w).not.toBeNull();
    // The whole value of the message: say "millimetres read as metres" rather
    // than leaving somebody to work out why the number is strange.
    expect(w.message).toMatch(/millimetres read as metres/i);
  });

  it("blames units when dividing by a thousand would be ordinary", () => {
    // A "200 m column" is 200 mm in millimetres, which is an entirely normal
    // column — so naming the unit error is the right call, not a false alarm.
    expect(checkScale("COLUMN", 200)!.message).toMatch(/millimetres read as metres/i);
  });

  it("does not blame units when the number is absurd either way", () => {
    // 80,000 m is 80 m in millimetres. Still not a column. Something else is
    // wrong, and guessing "units" would send somebody down the wrong path.
    const w = checkScale("COLUMN", 80000)!;
    expect(w.message).toMatch(/beyond anything normally built/i);
    expect(w.message).not.toMatch(/millimetres/i);
  });

  it("says nothing about a type it has no opinion on", () => {
    expect(checkScale("EQUIPMENT", 99999)).toBeNull();
  });
});

describe("scaling geometry", () => {
  it("converts a millimetre wall into metres, coordinates and sizes alike", () => {
    const mm = { baseline: [[0, 0], [5100, 0]] as [number, number][], heightM: 3200, thicknessM: 150 };
    const m = scaleGeometry(mm, 0.001);
    expect(m.baseline).toEqual([[0, 0], [5.1, 0]]);
    expect(m.heightM).toBeCloseTo(3.2);
    expect(m.thicknessM).toBeCloseTo(0.15);
  });

  it("leaves geometry untouched at scale 1, object identity included", () => {
    const g = { outline: [[0, 0], [4, 0], [4, 5]] as [number, number][] };
    expect(scaleGeometry(g, 1)).toBe(g);
  });

  it("scales an outline and a point", () => {
    const g = scaleGeometry({ outline: [[0, 0], [4000, 0]] as [number, number][], at: [1000, 2000] as [number, number] }, 0.001);
    expect(g.outline).toEqual([[0, 0], [4, 0]]);
    expect(g.at).toEqual([1, 2]);
  });

  it("a millimetre wall scaled then measured gives the right area", () => {
    // The end-to-end point of the whole file: 5100 x 3200 mm is 16.32 m2, not
    // 16,320,000 m2.
    const m = scaleGeometry({ baseline: [[0, 0], [5100, 0]] as [number, number][], heightM: 3200 }, 0.001);
    const area = 5.1 * 3.2;
    expect(m.baseline![1][0] * m.heightM!).toBeCloseTo(area, 6);
  });
});
