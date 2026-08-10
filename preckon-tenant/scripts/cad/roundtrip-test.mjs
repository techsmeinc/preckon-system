// Does saving a drawing preserve what the editor cannot read?
//
//   node scripts/cad/roundtrip-test.mjs
//
// The cases that matter are the entities the model has no idea about — an
// INSERT, a HATCH, a DIMENSION. If those do not come out the other side exactly
// as they went in, the editor is destroying issued drawings and calling it Save.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

// Compiled with tsc rather than a regex: stripping types by hand mangled the
// function signatures, and a test harness that has to be debugged is worse than
// no test at all.
const tmp = path.join(os.tmpdir(), "preckon-roundtrip-test");
mkdirSync(tmp, { recursive: true });
execSync(
  `npx tsc src/lib/cad/roundtrip.ts --outDir "${tmp}" --module esnext --target es2022 --moduleResolution bundler`,
  { stdio: "inherit" }
);
const compiled = path.join(tmp, "roundtrip.js");
const mjs = path.join(tmp, "rt.mjs");
writeFileSync(mjs, readFileSync(compiled, "utf8"));
const { indexDxf, rewriteDxf, maxHandle } = await import(pathToFileURL(mjs).href);

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failed++;
  console.log(`  FAIL  ${name}${detail ? "\n          " + detail : ""}`);
};

const p = (...pairs) => pairs.join("\n") + "\n";

// A drawing with one line the editor understands, and three entities it does
// not: a block reference, a hatch and a dimension. This is what a real sheet
// looks like — the parts we cannot draw are most of it.
const DXF = [
  p("0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC"),
  p("0", "SECTION", "2", "ENTITIES"),
  p("0", "LINE", "5", "A1", "8", "WALLS", "10", "0", "20", "0", "11", "100", "21", "0"),
  p("0", "INSERT", "5", "A2", "8", "DOORS", "2", "DR-900", "10", "50", "20", "0"),
  p("0", "HATCH", "5", "A3", "8", "FLOOR", "2", "ANSI31", "91", "1"),
  p("0", "DIMENSION", "5", "A4", "8", "DIMS", "1", "3600", "10", "0", "20", "-500"),
  p("0", "ENDSEC", "0", "EOF"),
].join("");

const idx = indexDxf(DXF);
check("the entities section is found", idx !== null);
check("four entities, continuations folded in", idx.chunks.length === 4, `got ${idx?.chunks.length}`);
check("handles are read", idx.chunks.map((c) => c.handle).join(",") === "A1,A2,A3,A4",
  idx.chunks.map((c) => c.handle).join(","));

// Nothing changed → the file must come back identical. If this fails, every
// save corrupts something, and no amount of careful editing above it helps.
const untouched = rewriteDxf(idx, new Set(), "");
check("an untouched save is byte-identical", untouched === DXF,
  untouched === DXF ? "" : "the file changed when nothing was edited");

// Delete the one entity the editor understands. The three it does not must
// survive completely — this is the whole point of the module.
const edited = rewriteDxf(idx, new Set(["A1"]), p("0", "LINE", "5", "FF1", "8", "MARKUP", "10", "0", "20", "0", "11", "5", "21", "5"));
check("the deleted entity is gone", !edited.includes("WALLS"));
check("the block reference survived", edited.includes("DR-900"));
check("the hatch survived", edited.includes("ANSI31"));
check("the dimension survived", edited.includes("DIMS"));
check("the new entity is written", edited.includes("MARKUP"));
check("the header is untouched", edited.includes("$INSUNITS"));
check("the file still terminates", edited.trimEnd().endsWith("EOF"));

check("the highest handle is found", maxHandle(idx) === 0xa4, String(maxHandle(idx)));

// A POLYLINE's VERTEX records must stay welded to it: keeping the header and
// dropping the points would write a polyline with no shape.
const POLY = [
  p("0", "SECTION", "2", "ENTITIES"),
  p("0", "POLYLINE", "5", "B1", "8", "P"),
  p("0", "VERTEX", "5", "B2", "10", "0", "20", "0"),
  p("0", "VERTEX", "5", "B3", "10", "9", "20", "9"),
  p("0", "SEQEND", "5", "B4"),
  p("0", "ENDSEC", "0", "EOF"),
].join("");
const pidx = indexDxf(POLY);
check("a polyline and its vertices are one entity", pidx.chunks.length === 1, `got ${pidx.chunks.length}`);
check("dropping the polyline drops its vertices too",
  !rewriteDxf(pidx, new Set(["B1"]), "").includes("VERTEX"));

// A file with no entities section cannot be rewritten safely, and saying so is
// how the caller knows to fall back rather than emit something broken.
check("a file with no entities section is refused", indexDxf(p("0", "SECTION", "2", "HEADER", "0", "ENDSEC")) === null);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
