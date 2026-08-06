// Ortho, Polar and the polyline tail — the three things reported broken.
//
// Run against the transpiled viewport helpers:
//   npx tsc src/lib/cad/viewport.tsx --outDir .t --jsx preserve --module es2020 \
//     --target es2020 --moduleResolution bundler --skipLibCheck --noEmitOnError false
//   node scripts/cad/draw-test.mjs .t/viewport.js
const { constrainAngle, trimTail } = await import(process.argv[2] ?? "../../.t/viewport.js");

const B = { x: 0, y: 0 };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const ang = (p) => (Math.atan2(p.y, p.x) * 180) / Math.PI;
const len = (p) => Math.hypot(p.x, p.y);

const checks = [];
const check = (what, ok) => checks.push([what, ok]);

/* ── Ortho: lock to the axis the cursor has moved further along ───────── */
{
  const r = constrainAngle(B, { x: 100, y: 12 }, { ortho: true });
  check("ortho locks to X when X dominates", r?.type === "ortho" && near(r.p.y, 0) && near(r.p.x, 100));
}
{
  const r = constrainAngle(B, { x: 12, y: -100 }, { ortho: true });
  check("ortho locks to Y when Y dominates, sign kept", r && near(r.p.x, 0) && near(r.p.y, -100));
}
{
  const r = constrainAngle(B, { x: 50, y: 50 }, { ortho: true });
  check("ortho at exactly 45 degrees picks X rather than nothing", r && near(r.p.y, 0));
}
{
  const r = constrainAngle(B, { x: 0, y: 0 }, { ortho: true });
  check("no movement means no constraint", r === null);
}

/* ── Polar: nearest increment, at any cursor angle ────────────────────── */
{
  // 40 degrees with a 15 degree increment -> 45. The old code did nothing here,
  // because 40 is more than four degrees off an increment. That was the bug.
  const raw = { x: Math.cos((40 * Math.PI) / 180) * 100, y: Math.sin((40 * Math.PI) / 180) * 100 };
  const r = constrainAngle(B, raw, { polar: true, polarInc: 15 });
  check("polar engages 40 degrees off-axis (was silent)", r?.type === "polar" && near(ang(r.p), 45, 1e-6));
}
for (const [deg, want] of [[7, 0], [8, 15], [22, 15], [23, 30], [-40, -45], [172, 180]]) {
  const raw = { x: Math.cos((deg * Math.PI) / 180) * 80, y: Math.sin((deg * Math.PI) / 180) * 80 };
  const r = constrainAngle(B, raw, { polar: true, polarInc: 15 });
  const got = ang(r.p);
  const same = near(((got - want + 540) % 360) - 180, 0, 1e-6);
  check(`polar ${deg} degrees -> ${want}`, same);
}
{
  // The length must stay the user's: the cursor projects onto the locked ray,
  // it does not jump to a fixed distance.
  const raw = { x: Math.cos((40 * Math.PI) / 180) * 100, y: Math.sin((40 * Math.PI) / 180) * 100 };
  const r = constrainAngle(B, raw, { polar: true, polarInc: 15 });
  const expect = 100 * Math.cos((5 * Math.PI) / 180);   // projection onto 45
  check("polar projects the cursor rather than fixing the length", near(len(r.p), expect, 1e-6));
}
{
  const r = constrainAngle(B, { x: 3, y: 97 }, { polar: true, polarInc: 90 });
  check("polar with a 90 degree increment behaves like ortho", near(r.p.x, 0, 1e-6));
}
{
  const r = constrainAngle(B, { x: 10, y: 10 }, { ortho: true, polar: true });
  check("ortho wins when both are somehow set", r?.type === "ortho");
}
{
  check("neither set means no constraint", constrainAngle(B, { x: 9, y: 4 }, {}) === null);
}

/* ── the polyline tail ────────────────────────────────────────────────── */
{
  const d = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
  check("double-click duplicate is dropped", trimTail(d).length === 3);
}
{
  const d = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
  check("a clean chain is untouched", trimTail(d).length === 3);
}
{
  const d = [{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 }];
  check("a run of duplicates collapses to one point, not zero", trimTail(d).length === 1);
}
{
  check("empty stays empty", trimTail([]).length === 0);
}

let bad = 0;
for (const [what, ok] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) bad++;
}
console.log(`\n${bad === 0 ? `PASS — ${checks.length} checks` : `FAIL — ${bad} of ${checks.length}`}`);
process.exit(bad ? 1 : 0);
