// Views, sheets and viewports — the four ArchiLabs recordings that are
// documentation rather than geometry.
//
//   video 2  align viewports on a sheet by a common datum
//   video 6  a 3D view for every room in the current view
//   video 7  a sheet, section views laid out in 4 columns with margins, aligned
//   video 9  an area plan on a level using an area scheme

import { describe, it, expect } from "vitest";
import { applyCommands } from "@/lib/bim/commands";
import { CATALOG, addElement, emptyDocument, type BimDocument } from "@/lib/bim/model";
import { query } from "@/lib/bim/query";
import { BUILTIN_TOOLS } from "@/lib/bim/tools";
import { takeoff } from "@/lib/bim/takeoff";
import { ToolRegistry } from "@/lib/bim/registry";

const tool = (n: string) => BUILTIN_TOOLS.find((t) => t.name === n)!;

function room(doc: BimDocument, name: string, x: number, y: number) {
  return addElement(doc, {
    discipline: "architectural", category: "room", name,
    geom: { kind: "area", outline: [{ x, y }, { x: x + 4, y }, { x: x + 4, y: y + 3 }, { x, y: y + 3 }], thickness: 0 },
    params: {},
  });
}

/** Four rooms and a second level, as a starting model. */
function model(): BimDocument {
  let d = emptyDocument();
  d = addElement(d, { discipline: "general", category: "level", name: "L3", geom: { kind: "point", elevation: 7 }, params: {} }).doc;
  for (const [i, n] of ["Office Unit", "Corridor", "Stair", "Live/Work Unit"].entries()) d = room(d, n, i * 10, 0).doc;
  return d;
}

// ── video 6 ──────────────────────────────────────────────────────────────────

describe("a view for every room", () => {
  it("creates one per matching element", () => {
    const d = model();
    const r = tool("create_views_for_elements").run({ doc: d }, { selector: { category: "room" }, kind: "3d" });
    expect(r.affected).toBe(4);

    const after = applyCommands(d, r.commands!);
    const views = query(after, { category: "view" });
    expect(views).toHaveLength(4);
    expect(views.map((v) => v.name)).toContain("3D - Corridor");
  });

  it("crops each view to its own element plus a margin", () => {
    const d = model();
    const after = applyCommands(d, tool("create_views_for_elements").run({ doc: d }, { selector: { category: "room" }, margin: 0.5 }).commands!);
    const v = query(after, { category: "view" }).find((x) => x.name === "3D - Office Unit")!;
    // The first room spans (0,0)–(4,3).
    expect(v.params.cropMinX).toBe(-0.5);
    expect(v.params.cropMaxX).toBe(4.5);
  });

  it("does not make a second view for a room that already has one", () => {
    // Otherwise running it twice leaves "3D - Corridor" duplicated, and the
    // project browser fills with near-identical views.
    const d = model();
    const first = tool("create_views_for_elements").run({ doc: d }, { selector: { category: "room" } });
    const after = applyCommands(d, first.commands!);
    const second = tool("create_views_for_elements").run({ doc: after }, { selector: { category: "room" } });

    expect(second.affected).toBe(0);
    expect(second.assumptions?.join(" ")).toMatch(/already had a 3d view/i);
  });

  it("distinguishes view kinds, so a plan and a 3D of the same room can coexist", () => {
    const d = model();
    const after = applyCommands(d, tool("create_views_for_elements").run({ doc: d }, { selector: { category: "room" }, kind: "3d" }).commands!);
    const plans = tool("create_views_for_elements").run({ doc: after }, { selector: { category: "room" }, kind: "plan" });
    expect(plans.affected).toBe(4);
  });

  it("reports the naming it chose", () => {
    const r = tool("create_views_for_elements").run({ doc: model() }, { selector: { category: "room" } });
    expect(r.assumptions?.join(" ")).toContain("3D - {name}");
  });
});

// ── video 9 ──────────────────────────────────────────────────────────────────

describe("an area plan on a level", () => {
  it("creates one for a named level and scheme", () => {
    const d = model();
    const r = tool("create_area_plan").run({ doc: d }, { level: "L3", scheme: "Rentable" });
    expect(r.affected).toBe(1);

    const after = applyCommands(d, r.commands!);
    const v = query(after, { category: "view" })[0];
    expect(v.params.viewKind).toBe("area");
    expect(v.params.scheme).toBe("Rentable");
  });

  it("reuses an existing one rather than duplicating it", () => {
    // The recording is explicit: "The REUSED Area Plan view (ID 853466)".
    const d = model();
    const after = applyCommands(d, tool("create_area_plan").run({ doc: d }, { level: "L3", scheme: "Rentable" }).commands!);
    const again = tool("create_area_plan").run({ doc: after }, { level: "L3", scheme: "Rentable" });

    expect(again.affected).toBe(0);
    expect(again.assumptions?.join(" ")).toMatch(/reused the existing view/i);
    expect((again.data as any).reused).toBe(true);
  });

  it("treats a different scheme on the same level as a different plan", () => {
    const d = model();
    const after = applyCommands(d, tool("create_area_plan").run({ doc: d }, { level: "L3", scheme: "Rentable" }).commands!);
    expect(tool("create_area_plan").run({ doc: after }, { level: "L3", scheme: "Gross Building" }).affected).toBe(1);
  });

  it("names the levels it does have when the one asked for is absent", () => {
    const r = tool("create_area_plan").run({ doc: model() }, { level: "L9", scheme: "Rentable" });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("L3");
  });
});

// ── video 7 ──────────────────────────────────────────────────────────────────

describe("a sheet with views laid out on it", () => {
  /** A model with six section views ready to place. */
  function withSections(): BimDocument {
    let d = model();
    for (let i = 0; i < 6; i++) {
      d = addElement(d, {
        discipline: "general", category: "view", name: `Section ${i} - Existing to New`,
        geom: { kind: "point", at: { x: 0, y: 0 } }, params: { viewKind: "section" },
      }).doc;
    }
    d = addElement(d, {
      discipline: "general", category: "view", name: "Section X - Unrelated",
      geom: { kind: "point", at: { x: 0, y: 0 } }, params: { viewKind: "section" },
    }).doc;
    return d;
  }

  it("creates the sheet", () => {
    const d = withSections();
    const after = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A405", name: "Wall Sections" }).commands!);
    const s = query(after, { category: "sheet" })[0];
    expect(s.name).toBe("A405 - Wall Sections");
    expect(s.params.number).toBe("A405");
  });

  it("refuses a duplicate sheet number", () => {
    // Two sheets answering to A405 makes "place these on A405" ambiguous, and
    // the wrong one silently gets the views.
    const d = withSections();
    const after = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A405", name: "Wall Sections" }).commands!);
    const again = tool("create_sheet").run({ doc: after }, { number: "A405", name: "Something Else" });
    expect(again.ok).toBe(false);
  });

  it("places only the views the selector matched, in the requested columns", () => {
    let d = withSections();
    d = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A405", name: "Wall Sections" }).commands!);

    const r = tool("place_views_on_sheet").run({ doc: d }, {
      sheet: "A405",
      views: { name: { op: "contains", value: "Existing to New" } },
      columns: 4,
    });
    expect(r.affected).toBe(6); // the unrelated section is not swept in

    const after = applyCommands(d, r.commands!);
    const vps = query(after, { category: "viewport" });
    expect(vps).toHaveLength(6);
    expect(vps.filter((v) => v.params.row === 1)).toHaveLength(4);
    expect(vps.filter((v) => v.params.row === 2)).toHaveLength(2);
  });

  it("honours the margins, placing nothing outside them", () => {
    let d = withSections();
    d = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A405", name: "WS", width: 841, height: 594 }).commands!);
    const r = tool("place_views_on_sheet").run({ doc: d }, {
      sheet: "A405", views: { name: { op: "contains", value: "Existing to New" } },
      columns: 4, marginLeftMm: 38.1, marginRightMm: 152.4,
    });
    const xs = (applyCommands(d, r.commands!), r.commands!).map((c: any) => c.args.params.xMm);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(38.1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(841 - 152.4);
  });

  it("refuses margins that leave no room, rather than placing on top of each other", () => {
    let d = withSections();
    d = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A405", name: "WS", width: 841, height: 594 }).commands!);
    const r = tool("place_views_on_sheet").run({ doc: d }, {
      sheet: "A405", views: {}, columns: 4, marginLeftMm: 500, marginRightMm: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/no room/i);
  });

  it("names the sheets that exist when the one asked for does not", () => {
    const r = tool("place_views_on_sheet").run({ doc: withSections() }, { sheet: "A999", views: {} });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/none|A405/);
  });
});

// ── video 2 ──────────────────────────────────────────────────────────────────

describe("aligning viewports by a common datum", () => {
  /** A sheet whose three viewports sit at different heights. */
  function misaligned(): BimDocument {
    let d = emptyDocument();
    const s = addElement(d, { discipline: "general", category: "sheet", name: "A101 - Plans", geom: { kind: "point", at: { x: 0, y: 0 } }, params: { number: "A101", widthMm: 841, heightMm: 594 } });
    d = s.doc;
    for (const [i, y] of [400, 380, 412].entries()) {
      d = addElement(d, {
        discipline: "general", category: "viewport", name: `vp${i}`,
        geom: { kind: "point", at: { x: 0, y: 0 } }, params: { sheet: s.id, view: `v${i}`, xMm: 100 + i * 200, yMm: y },
      }).doc;
    }
    return d;
  }

  it("brings them onto one line", () => {
    const d = misaligned();
    const r = tool("align_viewports").run({ doc: d }, { sheet: "A101", axis: "y", datum: "L3" });
    expect(r.affected).toBe(2); // the first one is already on the target

    const after = applyCommands(d, r.commands!);
    const ys = query(after, { category: "viewport" }).map((v) => v.params.yMm);
    expect(new Set(ys).size).toBe(1);
  });

  it("leaves the other axis alone", () => {
    // Aligning a row vertically must not stack them all in one column.
    const d = misaligned();
    const after = applyCommands(d, tool("align_viewports").run({ doc: d }, { sheet: "A101", axis: "y" }).commands!);
    const xs = query(after, { category: "viewport" }).map((v) => v.params.xMm);
    expect(new Set(xs).size).toBe(3);
  });

  it("records the datum, so the position is explicable later", () => {
    const d = misaligned();
    const after = applyCommands(d, tool("align_viewports").run({ doc: d }, { sheet: "A101", datum: "L3" }).commands!);
    expect(query(after, { category: "viewport" }).filter((v) => v.params.datum === "L3").length).toBe(2);
  });

  it("says when no datum was named", () => {
    const r = tool("align_viewports").run({ doc: misaligned() }, { sheet: "A101" });
    expect(r.assumptions?.join(" ")).toMatch(/no datum named/i);
  });

  it("supports aligning to the average rather than the first", () => {
    const r = tool("align_viewports").run({ doc: misaligned() }, { sheet: "A101", to: "average" });
    expect((r.data as any).target).toBeCloseTo((400 + 380 + 412) / 3, 6);
  });

  it("reports already-aligned rather than pretending to work", () => {
    const d = misaligned();
    const after = applyCommands(d, tool("align_viewports").run({ doc: d }, { sheet: "A101" }).commands!);
    const again = tool("align_viewports").run({ doc: after }, { sheet: "A101" });
    expect(again.affected).toBe(0);
    expect(again.summary).toMatch(/already aligned/i);
  });

  it("will not align a sheet with one viewport", () => {
    let d = emptyDocument();
    const s = addElement(d, { discipline: "general", category: "sheet", name: "A1", geom: { kind: "point" }, params: { number: "A1" } });
    d = s.doc;
    d = addElement(d, { discipline: "general", category: "viewport", name: "vp", geom: { kind: "point" }, params: { sheet: s.id, yMm: 100 } }).doc;
    expect(tool("align_viewports").run({ doc: d }, { sheet: "A1" }).ok).toBe(false);
  });
});

// ── the bill must not price annotation ───────────────────────────────────────

describe("documentation is drawn, never measured", () => {
  it("keeps tags, dimensions, views, sheets and viewports out of the takeoff", () => {
    // These are elements so that one document model serves them. That makes it
    // possible to bill for a view, which nobody would think to look for — the
    // geometry is real enough to survive a glance at the bill.
    let d = emptyDocument();
    d = room(d, "Office", 0, 0).doc;
    const real = takeoff(d).length;

    d = applyCommands(d, tool("create_views_for_elements").run({ doc: d }, { selector: { category: "room" } }).commands!);
    d = applyCommands(d, tool("tag_elements").run({ doc: d }, { selector: { category: "room" } }).commands!);
    d = applyCommands(d, tool("create_sheet").run({ doc: d }, { number: "A1", name: "Plans" }).commands!);

    expect(query(d, { category: "view" }).length).toBeGreaterThan(0);
    expect(takeoff(d).length).toBe(real);
  });

  it("excludes every zero-extent general category, so a new one cannot slip in", () => {
    const zeroExtent = Object.values(CATALOG).filter(
      (c) => c.discipline === "general" && !c.defaults.width && !c.defaults.height && !c.defaults.thickness,
    );
    let d = emptyDocument();
    for (const c of zeroExtent) {
      d = addElement(d, { discipline: "general", category: c.category, name: c.category, geom: { kind: c.kind, at: { x: 0, y: 0 }, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, params: {} }).doc;
    }
    expect(takeoff(d)).toHaveLength(0);
  });
});

describe("discovery, in the words the recordings used", () => {
  const reg = () => new ToolRegistry().register(...BUILTIN_TOOLS);
  const cases: [string, string][] = [
    ["make 3d views for all the rooms in my current view", "create_views_for_elements"],
    ["create a sheet called A405 - Wall Sections", "create_sheet"],
    ["place all the section views onto the sheet in 4 columns", "place_views_on_sheet"],
    ["the viewports on my sheet are misaligned, align them by a common datum", "align_viewports"],
    ["create an area plan on level 3 using the rentable area scheme", "create_area_plan"],
  ];
  for (const [phrase, expected] of cases) {
    it(`"${phrase}" → ${expected}`, () => {
      expect(reg().search(phrase).map((t) => t.name)).toContain(expected);
    });
  }
});
