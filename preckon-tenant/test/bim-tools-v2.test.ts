// The capabilities the ArchiLabs recordings demonstrate, as tools.
//
// Each block names the recording it comes from, because the point of these is
// not that the function returns something — it is that the instruction a person
// actually gave in the video now has a path through the system.

import { describe, it, expect } from "vitest";
import { applyCommands } from "@/lib/bim/commands";
import { addElement, emptyDocument, type BimDocument, type Vec2 } from "@/lib/bim/model";
import { count, explain, query } from "@/lib/bim/query";
import { BUILTIN_TOOLS } from "@/lib/bim/tools";
import { ToolRegistry } from "@/lib/bim/registry";

const tool = (n: string) => BUILTIN_TOOLS.find((t) => t.name === n)!;

function room(doc: BimDocument, name: string, x: number, y: number, params: Record<string, any> = {}) {
  return addElement(doc, {
    discipline: "architectural", category: "room", name,
    geom: { kind: "area", outline: [{ x, y }, { x: x + 4, y }, { x: x + 4, y: y + 3 }, { x, y: y + 3 }], thickness: 0 },
    params,
  });
}

function grid(doc: BimDocument, name: string, a: Vec2, b: Vec2) {
  return addElement(doc, { discipline: "general", category: "grid", name, geom: { kind: "linear", start: a, end: b }, params: {} });
}

// ── video 4: "…except the life safety plan sheets, keep those as is" ─────────

describe("excluding part of a set", () => {
  function sheets(): BimDocument {
    let d = emptyDocument();
    d = room(d, "A100 Floor Plan", 0, 0, { kind: "plan", issue_date: "2025-01-01" }).doc;
    d = room(d, "A101 Floor Plan", 10, 0, { kind: "plan", issue_date: "2025-01-01" }).doc;
    d = room(d, "LS100 Life Safety Plan", 20, 0, { kind: "life_safety", issue_date: "2025-01-01" }).doc;
    return d;
  }

  it("subtracts a nested selector from the set", () => {
    const d = sheets();
    const sel = { category: "room", not: [{ params: [{ key: "kind", op: "eq" as const, value: "life_safety" }] }] };
    const got = query(d, sel);
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.name)).not.toContain("LS100 Life Safety Plan");
  });

  it("excludes by name as well as by parameter", () => {
    const d = sheets();
    expect(count(d, { category: "room", not: [{ name: { op: "contains", value: "life safety" } }] })).toBe(2);
  });

  it("leaves the excluded element untouched through a bulk edit", () => {
    // The failure this guards is the one that matters: a bulk update that hits
    // the one set it was told to spare.
    const d = sheets();
    const r = tool("set_parameter").run(
      { doc: d },
      { selector: { category: "room", not: [{ params: [{ key: "kind", op: "eq", value: "life_safety" }] }] }, key: "issue_date", value: "2026-08-14" },
    );
    const after = applyCommands(d, r.commands!);
    const ls = query(after, { name: { op: "contains", value: "Life Safety" } })[0];
    expect(ls.params.issue_date).toBe("2025-01-01");
    expect(query(after, { name: { op: "contains", value: "A100" } })[0].params.issue_date).toBe("2026-08-14");
    expect(r.affected).toBe(2);
  });

  it("spells the exclusion out, rather than counting it", () => {
    // "except 12 things" tells a reviewer nothing about whether the right 12
    // were spared.
    expect(explain({ category: "room", not: [{ name: { op: "contains", value: "life safety" } }] }))
      .toContain('except (name contains "life safety")');
  });

  it("nests — an exclusion is itself a full selector", () => {
    const d = sheets();
    expect(count(d, { not: [{ category: "room", not: [{ name: { op: "contains", value: "A100" } }] }] })).toBe(2);
  });
});

// ── video 8: "Update all the room names…" (rooms to RM numbers) ──────────────

describe("renaming from a pattern", () => {
  function rooms(): BimDocument {
    let d = emptyDocument();
    d = room(d, "Office", 0, 0, { number: "101" }).doc;
    d = room(d, "Corridor", 10, 0, { number: "102" }).doc;
    return d;
  }

  it("builds each name from the element's own parameters", () => {
    const d = rooms();
    const r = tool("rename_by_pattern").run({ doc: d }, { selector: { category: "room" }, pattern: "RM-{number}" });
    const after = applyCommands(d, r.commands!);
    expect(query(after, { category: "room" }).map((e) => e.name)).toEqual(["RM-101", "RM-102"]);
  });

  it("supports the current name and a running index", () => {
    const d = rooms();
    const r = tool("rename_by_pattern").run({ doc: d }, { selector: { category: "room" }, pattern: "{i} - {name}", startAt: 5 });
    const after = applyCommands(d, r.commands!);
    expect(query(after, { category: "room" }).map((e) => e.name)).toEqual(["5 - Office", "6 - Corridor"]);
  });

  it("says so when a placeholder resolved to nothing", () => {
    // Otherwise every element quietly becomes "RM-" and it looks like it worked.
    const r = tool("rename_by_pattern").run({ doc: rooms() }, { selector: { category: "room" }, pattern: "RM-{missing_param}" });
    expect(r.assumptions?.join(" ")).toMatch(/no value for \{missing_param\}/i);
  });

  it("previews the first few renames before any are applied", () => {
    const r = tool("rename_by_pattern").run({ doc: rooms() }, { selector: { category: "room" }, pattern: "RM-{number}" });
    expect((r.data as any).preview[0]).toBe("Office → RM-101");
  });
});

// ── video 10: "…4 structural columns at every grid intersection" ─────────────

describe("columns at grid intersections", () => {
  /** Four verticals × four horizontals = sixteen crossings. */
  function grids(): BimDocument {
    let d = emptyDocument();
    for (let i = 0; i < 4; i++) d = grid(d, `${i + 1}`, { x: i * 6, y: -1 }, { x: i * 6, y: 19 }).doc;
    for (let j = 0; j < 4; j++) d = grid(d, String.fromCharCode(65 + j), { x: -1, y: j * 6 }, { x: 19, y: j * 6 }).doc;
    return d;
  }

  it("computes every crossing", () => {
    const r = tool("grid_intersections").run({ doc: grids() }, {});
    expect((r.data as any).count).toBe(16);
    expect((r.data as any).intersections[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("ignores parallel grids rather than reporting a crossing", () => {
    let d = emptyDocument();
    d = grid(d, "1", { x: 0, y: 0 }, { x: 0, y: 10 }).doc;
    d = grid(d, "2", { x: 5, y: 0 }, { x: 5, y: 10 }).doc;
    const r = tool("grid_intersections").run({ doc: d }, {});
    expect(r.ok).toBe(false);
    expect((r.data as any).intersections).toEqual([]);
  });

  it("counts three grids through one point once, not three times", () => {
    // Otherwise a column gets placed three times in the same spot.
    let d = emptyDocument();
    d = grid(d, "1", { x: -5, y: 0 }, { x: 5, y: 0 }).doc;
    d = grid(d, "2", { x: 0, y: -5 }, { x: 0, y: 5 }).doc;
    d = grid(d, "3", { x: -5, y: -5 }, { x: 5, y: 5 }).doc;
    expect((tool("grid_intersections").run({ doc: d }, {}).data as any).count).toBe(1);
  });

  it("places four columns per intersection, offset in each direction", () => {
    const d = grids();
    const pts = (tool("grid_intersections").run({ doc: d }, {}).data as any).intersections;
    const r = tool("place_at_points").run(
      { doc: d },
      { category: "column", points: pts, offsets: ["up", "down", "left", "right"], offset: 0.3 },
    );
    expect(r.affected).toBe(64); // 16 × 4, the video's arithmetic at smaller scale
    const after = applyCommands(d, r.commands!);
    expect(query(after, { category: "column" })).toHaveLength(64);
    const ats = query(after, { category: "column" }).slice(0, 4).map((e) => e.geom.at);
    expect(ats).toContainEqual({ x: 0, y: 0.3 });
    expect(ats).toContainEqual({ x: -0.3, y: 0 });
  });

  it("warns when a zero offset would stack them", () => {
    const r = tool("place_at_points").run({ doc: grids() }, { category: "column", points: [{ x: 0, y: 0 }], offsets: ["up", "down"], offset: 0 });
    expect(r.assumptions?.join(" ")).toMatch(/coincide/i);
  });

  it("rejects a direction it does not know instead of ignoring it", () => {
    const r = tool("place_at_points").run({ doc: grids() }, { category: "column", points: [{ x: 0, y: 0 }], offsets: ["north"] });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/north/);
  });

  it("refuses a category that is not a point item", () => {
    const r = tool("place_at_points").run({ doc: grids() }, { category: "wall", points: [{ x: 0, y: 0 }] });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/not a point item/i);
  });
});

// ── video 5: "Make a schedule of all the doors in my active view" ────────────

describe("schedules", () => {
  function withDoors(): BimDocument {
    let d = emptyDocument();
    const w = addElement(d, { discipline: "architectural", category: "wall", geom: { kind: "linear", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, width: 0.2, height: 3 }, params: {} });
    d = w.doc;
    d = applyCommands(d, [
      { name: "add", args: { category: "door", host: w.id, offset: 2, params: { mark: "D01", fire_rating: "1 HR" } } },
      { name: "add", args: { category: "door", host: w.id, offset: 5, params: { mark: "D02" } } },
    ]);
    return d;
  }

  it("returns rows with the requested fields", () => {
    const r = tool("create_schedule").run({ doc: withDoors() }, { selector: { category: "door" }, fields: ["id", "mark", "fire_rating"] });
    const d = r.data as any;
    expect(d.count).toBe(2);
    expect(d.rows[0].mark).toBe("D01");
    expect(d.rows[1].fire_rating).toBeNull();
  });

  it("computes length and area rather than only reading parameters", () => {
    let doc = emptyDocument();
    doc = room(doc, "Office", 0, 0).doc;
    const r = tool("create_schedule").run({ doc }, { selector: { category: "room" }, fields: ["name", "area"] });
    expect((r.data as any).rows[0].area).toBe(12); // 4 × 3
  });

  it("groups and counts", () => {
    const r = tool("create_schedule").run({ doc: withDoors() }, { selector: { category: "door" }, fields: ["id"], groupBy: "category" });
    expect((r.data as any).groups).toEqual([{ key: "door", count: 2 }]);
  });

  it("distinguishes an absent parameter from an empty answer", () => {
    // "no fire_rating column values" is a different fact from "no doors are
    // fire rated", and a reviewer needs to know which they are looking at.
    const r = tool("create_schedule").run({ doc: withDoors() }, { selector: { category: "door" }, fields: ["id", "acoustic_rating"] });
    expect(r.assumptions?.join(" ")).toMatch(/no values found for: acoustic_rating/i);
  });

  it("changes nothing — a schedule is a read", () => {
    const doc = withDoors();
    const before = JSON.stringify(doc);
    tool("create_schedule").run({ doc }, { selector: { category: "door" } });
    expect(JSON.stringify(doc)).toBe(before);
    expect(tool("create_schedule").kind).toBe("read");
  });
});

// ── video 3: "Make all my fire rated walls red in my active view" ────────────

describe("graphic overrides", () => {
  function walls(): BimDocument {
    let d = emptyDocument();
    d = addElement(d, { discipline: "architectural", category: "wall", name: "W1", geom: { kind: "linear", start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, width: 0.2, height: 3 }, params: { fire_rating: "2 HR" } }).doc;
    d = addElement(d, { discipline: "architectural", category: "wall", name: "W2", geom: { kind: "linear", start: { x: 0, y: 5 }, end: { x: 5, y: 5 }, width: 0.2, height: 3 }, params: {} }).doc;
    return d;
  }

  it("colours only what the filter matched", () => {
    const d = walls();
    const r = tool("override_graphics").run(
      { doc: d },
      { selector: { category: "wall", params: [{ key: "fire_rating", op: "exists" }] }, color: "red" },
    );
    expect(r.affected).toBe(1);
    const after = applyCommands(d, r.commands!);
    expect(query(after, { name: { op: "eq", value: "W1" } })[0].params.color).toBe("#e11d48");
    expect(query(after, { name: { op: "eq", value: "W2" } })[0].params.color).toBeUndefined();
  });

  it("reports the hex it resolved a colour name to", () => {
    const r = tool("override_graphics").run({ doc: walls() }, { selector: { category: "wall" }, color: "red" });
    expect(r.assumptions?.join(" ")).toContain("#e11d48");
  });

  it("accepts an explicit hex", () => {
    const r = tool("override_graphics").run({ doc: walls() }, { selector: { category: "wall" }, color: "#00ff00" });
    expect(r.ok).toBe(true);
    expect(r.assumptions).toEqual([]);
  });

  it("refuses a colour it cannot resolve, listing what it accepts", () => {
    const r = tool("override_graphics").run({ doc: walls() }, { selector: { category: "wall" }, color: "burnt sienna" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/red, green, blue/);
  });
});

// ── discovery ────────────────────────────────────────────────────────────────

describe("the new tools are findable by the words the videos used", () => {
  const reg = () => new ToolRegistry().register(...BUILTIN_TOOLS);
  const cases: [string, string][] = [
    ["make all my fire rated walls red in my active view", "override_graphics"],
    ["make a schedule of all the doors", "create_schedule"],
    ["place columns at every grid intersection", "grid_intersections"],
    ["update all the room names to RM numbers", "rename_by_pattern"],
    ["update all my sheet issue dates to today", "set_parameter"],
    ["tag room 307 it is missing a room tag", "tag_elements"],
  ];
  for (const [phrase, expected] of cases) {
    it(`"${phrase}" → ${expected}`, () => {
      expect(reg().search(phrase).map((t) => t.name)).toContain(expected);
    });
  }
});
