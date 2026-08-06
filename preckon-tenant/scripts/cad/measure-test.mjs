// Measure a drawing whose answers are known by construction.
//
// A 12 x 8 m room in millimetres, with a 3 x 2 m store inside it, four wall
// faces, a grid line and some furniture. Every figure below can be checked by
// hand, which is the only way to know the engine is right rather than merely
// consistent.
import { digest, describeDigest, polygonArea } from "./measure.js";

const mm = (m) => m * 1000;
const rect = (layer, x, y, w, h) => ({
  kind: "poly", layer, closed: true,
  pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

const model = {
  insunits: 4, // mm
  layers: [
    { name: "A-WALL", aci: 7, visible: true },
    { name: "A-FLOOR", aci: 3, visible: true },
    { name: "GRID", aci: 5, visible: true },
    { name: "A-FURN", aci: 6, visible: true },
    { name: "OLD", aci: 1, visible: false },
  ],
  entities: [
    // The slab: 12 x 8 m = 96 m²
    rect("A-FLOOR", 0, 0, mm(12), mm(8)),
    // A store inside it: 3 x 2 m = 6 m². Summing the two would give 102 m²,
    // which is the trap the engine is supposed to warn about.
    rect("A-FLOOR", mm(1), mm(1), mm(3), mm(2)),
    // Four wall faces round the perimeter: 12+8+12+8 = 40 m of linework.
    { kind: "line", layer: "A-WALL", x1: 0, y1: 0, x2: mm(12), y2: 0 },
    { kind: "line", layer: "A-WALL", x1: mm(12), y1: 0, x2: mm(12), y2: mm(8) },
    { kind: "line", layer: "A-WALL", x1: mm(12), y1: mm(8), x2: 0, y2: mm(8) },
    { kind: "line", layer: "A-WALL", x1: 0, y1: mm(8), x2: 0, y2: 0 },
    // One grid line, 14 m.
    { kind: "line", layer: "GRID", x1: mm(-1), y1: mm(4), x2: mm(13), y2: mm(4) },
    // Furniture and labels.
    rect("A-FURN", mm(6), mm(3), mm(1.6), mm(0.8)),
    { kind: "text", layer: "A-FLOOR", text: "STORE", x: mm(2), y: mm(2), h: 200 },
    { kind: "text", layer: "A-FLOOR", text: "OFFICE", x: mm(7), y: mm(5), h: 200 },
    { kind: "text", layer: "A-FLOOR", text: "OFFICE", x: mm(9), y: mm(5), h: 200 },
    { kind: "line", layer: "OLD", x1: 0, y1: 0, x2: mm(99), y2: 0 },
  ],
};

const d = digest(model);
const m2 = (v) => v / 1e6;      // mm² -> m²
const m = (v) => v / 1000;      // mm  -> m
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

const wall = d.layers.find((l) => l.layer === "A-WALL");
const floor = d.layers.find((l) => l.layer === "A-FLOOR");
const grid = d.layers.find((l) => l.layer === "GRID");
const old = d.layers.find((l) => l.layer === "OLD");

const checks = [
  ["units read as mm", d.units === "mm"],
  ["extents 14 m wide (grid overhangs the slab)", near(m(d.bounds.maxX - d.bounds.minX), 14)],
  ["wall linework totals 40 m", near(m(wall.totalLength), 40)],
  ["longest wall run is 12 m", near(m(wall.longestRun), 12)],
  ["grid run is 14 m", near(m(grid.totalLength), 14)],
  ["floor: 2 closed outlines", floor.closedCount === 2],
  ["largest floor outline is 96 m²", near(m2(floor.largestArea), 96)],
  ["summed floor area is 102 m² — the trap", near(m2(floor.totalArea), 102)],
  ["biggest region overall is the 96 m² slab", near(m2(d.regions[0].area), 96)],
  ["regions sorted largest first", d.regions[0].area >= d.regions[1].area],
  ["longest run listed first is the 14 m grid", near(m(d.runs[0].length), 14)],
  ["OFFICE counted twice", d.texts.find((t) => t.text === "OFFICE")?.n === 2],
  ["hidden layer still measured but flagged", old && old.visible === false],
  ["shoelace on a triangle", near(polygonArea([{x:0,y:0},{x:4,y:0},{x:0,y:3}]), 6)],
];

let bad = 0;
for (const [what, ok] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) bad++;
}

// The same drawing with no declared units must refuse to convert.
const unitless = digest({ ...model, insunits: 0 });
const refuses = unitless.units === null
  && unitless.warnings.some((w) => /does not declare its units/.test(w))
  && /drawing units/.test(describeDigest(unitless));
console.log(`  ${refuses ? "ok  " : "FAIL"}  a drawing with no $INSUNITS is measured in drawing units and says so`);
if (!refuses) bad++;

// And the overlap caution has to fire on a layer that overlaps.
const overlapping = digest({ ...model, entities: [...model.entities,
  rect("A-FLOOR", 0, 0, mm(11), mm(7)), rect("A-FLOOR", 0, 0, mm(10), mm(6)),
  rect("A-FLOOR", 0, 0, mm(9), mm(5)) ] });
const warns = overlapping.warnings.some((w) => /summed area is much larger/.test(w));
console.log(`  ${warns ? "ok  " : "FAIL"}  overlapping outlines raise the summed-area caution`);
if (!warns) bad++;

console.log(`\n${bad === 0 ? "PASS" : `FAIL — ${bad} check(s)`}\n`);
console.log(describeDigest(d).split("\n").slice(0, 12).join("\n"));
process.exit(bad ? 1 : 0);
