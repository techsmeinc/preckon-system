// 2D drafting geometry.
//
// Every case here is checkable by hand, on purpose. Geometry bugs produce
// output that renders, looks approximately right and is wrong — an offset to
// the wrong side, an arc tangent to nothing, a polar array that rotates without
// moving. None of that is caught by looking at a screenshot, so the numbers
// have to be pinned to arithmetic somebody can redo on paper.

import { describe, it, expect } from "vitest";
import {
  offsetSegment, offsetPolyline, intersectLines, intersectSegments,
  mirrorPoint, rotatePoint, scalePoint,
  rectangularArray, polarArray,
  fillet, chamfer,
  extendToBoundary, trimAtBoundary, distanceToSegment,
  divideSegment, measureAlong, linearDimension,
  type Seg,
} from "@/lib/cad/drafting";

const seg = (x1: number, y1: number, x2: number, y2: number): Seg =>
  ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

describe("offset", () => {
  it("goes to the left of the direction of travel", () => {
    /* Left of east is north. Getting this backwards is invisible on a
       symmetric shape and wrong on every other one. */
    const o = offsetSegment(seg(0, 0, 10, 0), 2)!;
    expect(o.a).toEqual({ x: 0, y: 2 });
    expect(o.b).toEqual({ x: 10, y: 2 });
  });

  it("goes right for a negative distance", () => {
    expect(offsetSegment(seg(0, 0, 10, 0), -2)!.a).toEqual({ x: 0, y: -2 });
  });

  it("follows the direction, not the axis", () => {
    // Reverse the line and "left" reverses with it.
    expect(offsetSegment(seg(10, 0, 0, 0), 2)!.a).toEqual({ x: 10, y: -2 });
  });

  it("refuses a zero-length segment instead of returning NaN", () => {
    expect(offsetSegment(seg(5, 5, 5, 5), 2)).toBeNull();
  });

  it("mitres a corner rather than leaving a gap", () => {
    /* An L from (0,0) to (10,0) to (10,10), offset 2 to the left. The naive
       per-segment offset leaves the corner at two different points; the mitre
       puts it at the intersection, (8,2). */
    const p = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    expect(p).toEqual([{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 10 }]);
  });

  it("offsets a closed rectangle inwards as a smaller rectangle", () => {
    // Anticlockwise square, offset +1 (left = inwards), gives a 8×8 square.
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const p = offsetPolyline(sq, 1, true);
    expect(p).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }]);
  });

  it("falls back to a blunt corner rather than an infinite spike", () => {
    // Doubling back on itself: the mitre point is at infinity.
    const p = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 2);
    expect(p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
  });
});

describe("intersections", () => {
  it("finds where two infinite lines meet, beyond their drawn ends", () => {
    // Needed by mitre and extend, which both work past the segment.
    expect(intersectLines(seg(0, 0, 1, 0), seg(5, -5, 5, -1))).toEqual({ x: 5, y: 0 });
  });

  it("returns null for parallel lines", () => {
    expect(intersectLines(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull();
  });

  it("only reports a segment crossing within both extents", () => {
    expect(intersectSegments(seg(0, 0, 10, 0), seg(5, -5, 5, 5))).toEqual({ x: 5, y: 0 });
    expect(intersectSegments(seg(0, 0, 1, 0), seg(5, -5, 5, 5))).toBeNull();
  });
});

describe("mirror, rotate, scale", () => {
  it("reflects across a vertical axis", () => {
    expect(mirrorPoint({ x: 3, y: 7 }, seg(5, 0, 5, 10))).toEqual({ x: 7, y: 7 });
  });

  it("reflects across a diagonal, swapping the coordinates", () => {
    expect(mirrorPoint({ x: 3, y: 0 }, seg(0, 0, 10, 10))).toEqual({ x: 0, y: 3 });
  });

  it("leaves a point on the axis where it is", () => {
    expect(mirrorPoint({ x: 5, y: 5 }, seg(0, 0, 10, 10))).toEqual({ x: 5, y: 5 });
  });

  it("rotates anticlockwise about a centre", () => {
    expect(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)).toEqual({ x: 0, y: 1 });
  });

  it("scales about a centre, not about the origin", () => {
    // Scaling about (10,10) leaves that point fixed — the whole reason a
    // scale command asks for a base point.
    expect(scalePoint({ x: 12, y: 10 }, { x: 10, y: 10 }, 2)).toEqual({ x: 14, y: 10 });
    expect(scalePoint({ x: 10, y: 10 }, { x: 10, y: 10 }, 2)).toEqual({ x: 10, y: 10 });
  });
});

describe("arrays", () => {
  it("counts the original as one of the copies", () => {
    // A 3x2 array of a column produces six columns, not seven. Off by one here
    // is an extra bay on every gridline.
    const a = rectangularArray([{ x: 0, y: 0 }], { cols: 3, rows: 2, dx: 5, dy: 4 });
    expect(a).toHaveLength(6);
    expect(a[0][0]).toEqual({ x: 0, y: 0 });
    expect(a[5][0]).toEqual({ x: 10, y: 4 });
  });

  it("divides a full circle by the count, so the last copy is not on the first", () => {
    const a = polarArray([{ x: 10, y: 0 }], { centre: { x: 0, y: 0 }, count: 4 });
    expect(a).toHaveLength(4);
    expect(a[1][0]).toEqual({ x: 0, y: 10 });
    expect(a[3][0]).toEqual({ x: 0, y: -10 });
  });

  it("divides a partial sweep by the gaps, landing exactly on the stated angle", () => {
    const a = polarArray([{ x: 10, y: 0 }], { centre: { x: 0, y: 0 }, count: 3, totalAngleDeg: 90 });
    expect(a[1][0]).toEqual({ x: Math.round(10 * Math.cos(Math.PI / 4) * 1e6) / 1e6, y: Math.round(10 * Math.sin(Math.PI / 4) * 1e6) / 1e6 });
    expect(a[2][0]).toEqual({ x: 0, y: 10 });
  });

  it("rotates the items by default, which is what a polar array means", () => {
    // A two-point item at 0°: rotated 90°, both points turn with it.
    const a = polarArray([{ x: 10, y: 0 }, { x: 12, y: 0 }], { centre: { x: 0, y: 0 }, count: 4 });
    expect(a[1]).toEqual([{ x: 0, y: 10 }, { x: 0, y: 12 }]);
  });

  it("keeps items upright when asked, for text and symbols", () => {
    const a = polarArray([{ x: 10, y: 0 }, { x: 12, y: 0 }], {
      centre: { x: 0, y: 0 }, count: 4, rotateItems: false,
    });
    // Moved to the 90° position but still pointing along +x.
    expect(a[1]).toEqual([{ x: 0, y: 10 }, { x: 2, y: 10 }]);
  });

  it("returns just the original for a count of one", () => {
    expect(polarArray([{ x: 1, y: 0 }], { centre: { x: 0, y: 0 }, count: 1 })).toHaveLength(1);
  });
});

describe("fillet", () => {
  const a = seg(0, 0, 10, 0);      // west leg, meeting at (0,0)
  const b = seg(0, 0, 0, 10);      // north leg

  it("puts the arc inside the corner, tangent to both legs", () => {
    /* A right angle filleted at r=2: tangent points at (2,0) and (0,2), centre
       at (2,2). An arc merely tangent to both lines could sit at (-2,-2), which
       is outside the corner and looks like a mistake nobody made. */
    const f = fillet(a, b, 2)!;
    expect(f.centre).toEqual({ x: 2, y: 2 });
    expect(f.first.b).toEqual({ x: 2, y: 0 });
    expect(f.second.a).toEqual({ x: 0, y: 2 });
  });

  it("trims both legs back to the tangent points", () => {
    const f = fillet(a, b, 2)!;
    expect(f.first).toEqual({ a: { x: 10, y: 0 }, b: { x: 2, y: 0 } });
    expect(f.second).toEqual({ a: { x: 0, y: 2 }, b: { x: 0, y: 10 } });
  });

  it("draws an arc that starts and ends on the tangent points", () => {
    const f = fillet(a, b, 2)!;
    expect(f.arc[0]).toEqual({ x: 2, y: 0 });
    expect(f.arc[f.arc.length - 1]).toEqual({ x: 0, y: 2 });
  });

  it("keeps every arc point at the radius from the centre", () => {
    const f = fillet(a, b, 2)!;
    for (const p of f.arc) {
      expect(Math.hypot(p.x - f.centre.x, p.y - f.centre.y)).toBeCloseTo(2, 6);
    }
  });

  it("refuses a radius that will not fit rather than overrunning the legs", () => {
    // A fillet longer than its own legs is geometrically valid and nonsense.
    expect(fillet(seg(0, 0, 1, 0), seg(0, 0, 0, 1), 5)).toBeNull();
  });

  it("refuses two lines that do not meet", () => {
    expect(fillet(seg(0, 0, 10, 0), seg(20, 20, 30, 30), 2)).toBeNull();
  });

  it("refuses a collinear pair, which has no corner to round", () => {
    expect(fillet(seg(0, 0, 10, 0), seg(0, 0, -10, 0), 2)).toBeNull();
  });

  it("refuses a non-positive radius", () => {
    expect(fillet(a, b, 0)).toBeNull();
  });
});

describe("chamfer", () => {
  it("cuts the corner at the stated distances", () => {
    const c = chamfer(seg(0, 0, 10, 0), seg(0, 0, 0, 10), 2)!;
    expect(c.cut).toEqual({ a: { x: 2, y: 0 }, b: { x: 0, y: 2 } });
  });

  it("takes different distances on each leg", () => {
    const c = chamfer(seg(0, 0, 10, 0), seg(0, 0, 0, 10), 2, 4)!;
    expect(c.cut).toEqual({ a: { x: 2, y: 0 }, b: { x: 0, y: 4 } });
  });

  it("refuses a cut longer than a leg", () => {
    expect(chamfer(seg(0, 0, 1, 0), seg(0, 0, 0, 10), 5)).toBeNull();
  });
});

describe("extend", () => {
  it("extends the near end forward to the boundary", () => {
    const e = extendToBoundary(seg(0, 0, 5, 0), seg(10, -5, 10, 5))!;
    expect(e).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
  });

  it("extends backwards when the boundary is behind the start", () => {
    const e = extendToBoundary(seg(5, 0, 10, 0), seg(0, -5, 0, 5))!;
    expect(e).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
  });

  it("refuses when the line already crosses the boundary", () => {
    expect(extendToBoundary(seg(0, 0, 20, 0), seg(10, -5, 10, 5))).toBeNull();
  });

  it("refuses to extend to a boundary the intersection misses", () => {
    // The infinite lines meet, but not on the boundary segment — extending
    // there would meet something that is not drawn.
    expect(extendToBoundary(seg(0, 0, 5, 0), seg(10, 20, 10, 30))).toBeNull();
  });
});

describe("trim", () => {
  const line = seg(0, 0, 10, 0);
  const wall = seg(4, -5, 4, 5);

  it("keeps the piece nearest the pick point", () => {
    // "Cut this line at that wall" is ambiguous about which piece survives,
    // and every CAD package resolves it by where you clicked.
    expect(trimAtBoundary(line, wall, { x: 1, y: 0 })).toEqual({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } });
    expect(trimAtBoundary(line, wall, { x: 9, y: 0 })).toEqual({ a: { x: 4, y: 0 }, b: { x: 10, y: 0 } });
  });

  it("refuses when nothing crosses", () => {
    expect(trimAtBoundary(line, seg(20, -5, 20, 5), { x: 1, y: 0 })).toBeNull();
  });

  it("refuses a cut at the very end, which would leave a zero-length piece", () => {
    expect(trimAtBoundary(line, seg(0, -5, 0, 5), { x: 5, y: 0 })).toBeNull();
  });

  it("measures distance to a segment, not to its infinite line", () => {
    expect(distanceToSegment({ x: 20, y: 0 }, seg(0, 0, 10, 0))).toBe(10);
    expect(distanceToSegment({ x: 5, y: 3 }, seg(0, 0, 10, 0))).toBe(3);
  });
});

describe("setting out", () => {
  it("gives interior points only", () => {
    // Dividing into 4 gives 3 points. Including the ends produces duplicate
    // nodes that snap oddly and export as zero-length segments.
    expect(divideSegment(seg(0, 0, 12, 0), 4)).toEqual([
      { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 },
    ]);
  });

  it("returns nothing for fewer than two parts", () => {
    expect(divideSegment(seg(0, 0, 10, 0), 1)).toEqual([]);
  });

  it("measures at a fixed spacing and leaves the remainder at the end", () => {
    expect(measureAlong(seg(0, 0, 10, 0), 3)).toEqual([
      { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 },
    ]);
  });

  it("returns nothing when the spacing exceeds the length", () => {
    expect(measureAlong(seg(0, 0, 2, 0), 5)).toEqual([]);
  });
});

describe("dimensions", () => {
  it("reads the measured distance, never a typed value", () => {
    /* A dimension whose text disagrees with its own geometry is the worst
       thing on a drawing, and the only way to guarantee they agree is to
       refuse to let anyone type it. */
    const d = linearDimension({ x: 0, y: 0 }, { x: 3500, y: 0 }, { offset: 500 });
    expect(d!.value).toBe(3500);
    expect(d!.text).toBe("3500");
  });

  it("places the dimension line to the left, like offset", () => {
    const d = linearDimension({ x: 0, y: 0 }, { x: 1000, y: 0 }, { offset: 200 })!;
    expect(d.line).toEqual({ a: { x: 0, y: 200 }, b: { x: 1000, y: 200 } });
  });

  it("runs extension lines from the measured points out to the line", () => {
    const d = linearDimension({ x: 0, y: 0 }, { x: 1000, y: 0 }, { offset: 200 })!;
    expect(d.extensions[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 200 } });
  });

  it("centres the text on the dimension line", () => {
    const d = linearDimension({ x: 0, y: 0 }, { x: 1000, y: 0 }, { offset: 200 })!;
    expect(d.textAt).toEqual({ x: 500, y: 200 });
  });

  it("honours precision and a unit suffix", () => {
    const d = linearDimension({ x: 0, y: 0 }, { x: 3.456, y: 0 }, { precision: 2, unitSuffix: " m" })!;
    expect(d.text).toBe("3.46 m");
  });

  it("measures a diagonal properly", () => {
    expect(linearDimension({ x: 0, y: 0 }, { x: 3, y: 4 })!.value).toBe(5);
  });

  it("refuses a zero-length dimension", () => {
    expect(linearDimension({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});
