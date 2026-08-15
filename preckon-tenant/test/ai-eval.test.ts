// The regression measure the AI surfaces did not have.
//
// Two properties, both checkable without a model call, both of which break
// silently as the catalogue grows:
//
//   SELECTION  does the assistant reach for the right tool? Pure function of the
//              instruction and the catalogue, so it can be scored exactly.
//   GROUNDING  can a tool return an id that is not in the document? A model can
//              hallucinate; a tool must not be able to.
//
// Extraction accuracy, BOQ completeness and citation fidelity need real model
// calls against fixture projects and belong in a scheduled run with an API key.
// Asserting them here without a model would be a green tick nobody earned.

import { describe, it, expect } from "vitest";
import { applyCommands } from "@/lib/bim/commands";
import { addElement, emptyDocument, type BimDocument } from "@/lib/bim/model";
import { query } from "@/lib/bim/query";
import { BUILTIN_TOOLS } from "@/lib/bim/tools";
import { ToolRegistry } from "@/lib/bim/registry";
import { CAD_TOOLS } from "@/lib/cad/tools";
import type { DxfModel } from "@/lib/cad/model";
import { SELECTION_CORPUS, formatSelection, scoreToolSelection } from "@/lib/bim/eval";

const registry = () => new ToolRegistry().register(...BUILTIN_TOOLS);

// ── Selection ────────────────────────────────────────────────────────────────

describe("tool selection", () => {
  const result = scoreToolSelection(registry());

  /* Set just under the measured score rather than at a round number.

     Measured at 92% top-1 and 92% top-3 on 25 cases, so one case is 4%. A
     threshold of 0.7 would have let selection fall by four cases before anyone
     noticed, which is the same as not measuring it. 0.88 tolerates a single
     borderline case flipping — several instructions have more than one
     defensible first step, and scoring a preference is not the point — while
     failing on a real regression.

     Raise these when the score rises. A threshold left below the actual score is
     a ratchet that never tightens. */
  const TOP1_MIN = 0.88;
  const TOP3_MIN = 0.88;

  it("reaches the right tool first for nearly every instruction", () => {
    // Top-1 is what the agent usually acts on.
    expect(result.top1 / result.total, formatSelection(result)).toBeGreaterThanOrEqual(TOP1_MIN);
  });

  it("has the right tool in the first three", () => {
    // The agent sees the discovered set, not only the top hit, so this is the
    // number that decides whether it CAN do the task at all.
    expect(result.recallAt3 / result.total, formatSelection(result)).toBeGreaterThanOrEqual(TOP3_MIN);
  });

  it("surfaces the right tool somewhere for every instruction in the corpus", () => {
    // A miss here means the capability is unreachable through language, which is
    // indistinguishable from not having built it.
    expect(result.misses, formatSelection(result)).toEqual([]);
  });

  it("scores every recorded instruction, not a paraphrase of one", () => {
    // Phrasings from the recordings are the closest thing to real user input
    // available. A paraphrase would be scoring the paraphraser.
    const recorded = SELECTION_CORPUS.filter((c) => c.source === "recording");
    expect(recorded.length).toBeGreaterThanOrEqual(10);
    const r = scoreToolSelection(registry(), recorded);
    expect(r.misses, formatSelection(r)).toEqual([]);
  });

  it("does not answer filler with the whole catalogue", () => {
    // "all of the in my" carries no intent. Returning everything would look like
    // perfect recall while meaning nothing.
    expect(registry().search("all of the in my")).toHaveLength(0);
  });
});

// ── Grounding ────────────────────────────────────────────────────────────────

/** A model with enough of everything for the read tools to have something to find. */
function fixture(): BimDocument {
  let d = emptyDocument();
  d = addElement(d, {
    discipline: "architectural", category: "room", name: "Live/Work Unit 307",
    geom: { kind: "area", outline: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], thickness: 0 },
    params: { number: "307" },
  }).doc;
  const w = addElement(d, {
    discipline: "architectural", category: "wall", name: "North wall",
    geom: { kind: "linear", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, width: 0.2, height: 3 },
    params: { fire_rating: "2 HR" },
  });
  d = w.doc;
  d = applyCommands(d, [
    { name: "add", args: { category: "door", host: w.id, offset: 2 } },
    { name: "add", args: { category: "grid", start: { x: 0, y: -1 }, end: { x: 0, y: 9 }, name: "1" } },
    { name: "add", args: { category: "grid", start: { x: -1, y: 0 }, end: { x: 9, y: 0 }, name: "A" } },
  ]);
  return d;
}

/** Every id string anywhere in a value, however deeply nested. */
function idsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) idsIn(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "id" || k === "target" || k === "ofElement" || k === "host") && typeof v === "string") out.push(v);
      else idsIn(v, out);
    }
  }
  return out;
}

describe("grounding", () => {
  const doc = fixture();
  const real = new Set(query(doc).map((e) => e.id));

  it("has a fixture the read tools can actually find things in", () => {
    // Without this, every tool below returns nothing and passes vacuously.
    expect(real.size).toBeGreaterThan(4);
  });

  for (const tool of BUILTIN_TOOLS.filter((t) => t.kind === "read")) {
    it(`${tool.name} returns only ids that exist`, () => {
      // A read tool inventing an id is a hallucination at the layer that is
      // supposed to be incapable of one — and the agent would then act on it.
      const r = tool.run({ doc }, {
        selector: {}, text: "307", level: "Ground Floor", sheet: "A405",
        fields: ["id", "name"], scheme: "Rentable",
      });
      for (const id of idsIn(r.data)) {
        expect(real.has(id), `${tool.name} returned unknown id "${id}"`).toBe(true);
      }
    });
  }

  for (const tool of BUILTIN_TOOLS.filter((t) => t.kind === "write")) {
    it(`${tool.name} only ever targets ids that exist`, () => {
      const r = tool.run({ doc }, {
        selector: { category: "room" }, key: "note", value: "x", text: "note",
        category: "column", placements: [{ at: { x: 0, y: 0 } }], points: [{ x: 0, y: 0 }],
        pattern: "RM-{number}", color: "red", number: "A9", name: "Test", level: "Ground Floor",
        scheme: "Rentable", views: {}, sheet: "A405",
      });
      // Commands may CREATE ids, so only the ones they reference are checked.
      for (const cmd of r.commands ?? []) {
        const a = cmd.args as Record<string, unknown>;
        for (const key of ["id", "host"]) {
          const v = a[key];
          if (typeof v === "string") {
            expect(real.has(v), `${tool.name} targeted unknown id "${v}"`).toBe(true);
          }
        }
      }
    });
  }

  it("no read tool changes the document", () => {
    const before = JSON.stringify(doc);
    for (const t of BUILTIN_TOOLS.filter((t) => t.kind === "read")) {
      t.run({ doc }, { selector: {}, text: "307", fields: ["id"], sheet: "A405", level: "Ground Floor", scheme: "Rentable" });
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

// ── The same two properties for the issued-drawing catalogue ─────────────────

describe("the drawing assistant is measured too", () => {
  const reg = () => new ToolRegistry<DxfModel, any>().register(...CAD_TOOLS);
  const cases: [string, string[]][] = [
    ["what is in this drawing", ["drawing_overview", "list_layers"]],
    ["list the layers", ["list_layers"]],
    ["where does it say BACKFILL", ["find_text"]],
    ["add a note saying CHECK SLOPE", ["add_note"]],
    ["cloud the area around the stair", ["cloud_region"]],
    ["delete the X-JUNK layer", ["delete_layer"]],
    ["clear everything in that corner", ["clear_region"]],
  ];

  for (const [instruction, expected] of cases) {
    it(`"${instruction}" reaches ${expected.join(" or ")}`, () => {
      const got = reg().search(instruction).map((t) => t.name);
      expect(expected.some((e) => got.includes(e)), `got: ${got.join(", ") || "(nothing)"}`).toBe(true);
    });
  }
});
