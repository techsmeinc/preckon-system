// The issued-drawing tool catalogue.
//
// A modelled building knows what its elements are. An issued sheet knows only
// that there is text reading "307" somewhere on a layer called A-ANNO-ROOM, so
// finding things correctly is most of the work — and the failure that matters is
// a search for room 307 quietly returning 3070 as well.

import { describe, it, expect } from "vitest";
import { applyCadOps } from "@/lib/cad/agent";
import type { DxfModel, Entity } from "@/lib/cad/model";
import { CAD_TOOLS } from "@/lib/cad/tools";
import { ToolRegistry } from "@/lib/bim/registry";

const tool = (name: string) => CAD_TOOLS.find((t) => t.name === name)!;

const text = (t: string, x: number, y: number, layer = "A-ANNO-ROOM"): Entity => ({ kind: "text", layer, text: t, x, y, h: 2.5, id: `t-${t}-${x}` });
const line = (x1: number, y1: number, x2: number, y2: number, layer = "A-WALL"): Entity => ({ kind: "line", layer, x1, y1, x2, y2, id: `l-${x1}-${y1}` });

/** A sheet in millimetres with room numbers that collide by substring. */
function sheet(): DxfModel {
  return {
    insunits: 4,
    layers: [
      { name: "A-WALL", aci: 7, visible: true },
      { name: "A-ANNO-ROOM", aci: 2, visible: true },
      { name: "X-JUNK", aci: 1, visible: false },
    ],
    entities: [
      text("307", 1000, 1000),
      text("3070", 5000, 1000),
      text("307A", 9000, 1000),
      text("CORRIDOR", 3000, 4000),
      line(0, 0, 10000, 0),
      line(0, 0, 0, 8000),
      { kind: "poly", layer: "X-JUNK", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, id: "p1" },
    ],
  };
}

describe("orienting on a sheet", () => {
  it("reports layers, counts, extents and units", () => {
    const r = tool("drawing_overview").run({ doc: sheet() }, {});
    const d = r.data as any;
    expect(d.entities).toBe(7);
    expect(d.units).toBe("mm");
    expect(d.byKind.text).toBe(4);
    expect(d.layers.find((l: any) => l.name === "A-ANNO-ROOM").entities).toBe(4);
  });

  it("says when the drawing never declared its units", () => {
    // Everything measured downstream is wrong by a factor if this is a guess,
    // so it must be visible rather than defaulted silently.
    const m = { ...sheet(), insunits: 0 };
    expect((tool("drawing_overview").run({ doc: m }, {}).data as any).unitsDeclared).toBe(false);
    expect((tool("drawing_overview").run({ doc: sheet() }, {}).data as any).unitsDeclared).toBe(true);
  });

  it("filters the layer list", () => {
    const d = tool("list_layers").run({ doc: sheet() }, { match: "anno" }).data as any;
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0].name).toBe("A-ANNO-ROOM");
  });
});

describe("finding text", () => {
  it("matches 307 as a whole word, not as a prefix of 3070", () => {
    const d = tool("find_text").run({ doc: sheet() }, { text: "307" }).data as any;
    expect(d.count).toBe(1);
    expect(d.matches[0].text).toBe("307");
    expect(d.matches[0].at).toEqual({ x: 1000, y: 1000 });
  });

  it("prefers an exact match over anything looser", () => {
    const d = tool("find_text").run({ doc: sheet() }, { text: "CORRIDOR" }).data as any;
    expect(d.count).toBe(1);
  });

  it("says so when it fell back to a substring", () => {
    const r = tool("find_text").run({ doc: sheet() }, { text: "ORRID" });
    expect(r.ok).toBe(true);
    expect(r.assumptions?.join(" ")).toMatch(/substring/i);
  });

  it("can be pinned to exact only", () => {
    expect(tool("find_text").run({ doc: sheet() }, { text: "ORRID", exact: true }).ok).toBe(false);
  });

  it("restricts to a layer", () => {
    const d = tool("find_text").run({ doc: sheet() }, { text: "307", layer: "A-WALL" }).data as any;
    expect(d.count).toBe(0);
  });

  it("fails honestly rather than returning everything", () => {
    const r = tool("find_text").run({ doc: sheet() }, { text: "999" });
    expect(r.ok).toBe(false);
    expect((r.data as any).count).toBe(0);
  });
});

describe("finding entities", () => {
  it("filters by kind and layer", () => {
    const d = tool("find_entities").run({ doc: sheet() }, { layer: "A-WALL", kind: "line" }).data as any;
    expect(d.count).toBe(2);
  });

  it("filters by region regardless of corner order", () => {
    const a = tool("find_entities").run({ doc: sheet() }, { kind: "text", region: { x1: 0, y1: 0, x2: 2000, y2: 2000 } }).data as any;
    const b = tool("find_entities").run({ doc: sheet() }, { kind: "text", region: { x1: 2000, y1: 2000, x2: 0, y2: 0 } }).data as any;
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });
});

describe("markup never touches the issued layers", () => {
  it("puts a note on the markup layer and says it did", () => {
    const r = tool("add_note").run({ doc: sheet() }, { text: "check this", x: 100, y: 200 });
    expect(r.commands![0]).toMatchObject({ op: "add_text", layer: "AL-MARKUP", text: "check this" });
    expect(r.assumptions?.join(" ")).toMatch(/leaving the issued layers untouched/i);
  });

  it("scales text height off the sheet rather than assuming millimetres", () => {
    // 2.5 units is legible on a mm drawing and invisible on one in metres.
    const big = tool("add_note").run({ doc: sheet() }, { text: "x", x: 0, y: 0 }).commands![0] as any;
    const small = tool("add_note").run(
      { doc: { ...sheet(), entities: [line(0, 0, 10, 0)] } },
      { text: "x", x: 0, y: 0 },
    ).commands![0] as any;
    expect(big.h).toBeGreaterThan(small.h);
  });

  it("clouds a region and labels it above the box", () => {
    const r = tool("cloud_region").run({ doc: sheet() }, { x: 0, y: 0, w: 500, h: 300, label: "RFI 12" });
    expect(r.commands).toHaveLength(2);
    expect(r.commands![0]).toMatchObject({ op: "add_rect", w: 500, h: 300 });
    const label = r.commands![1] as any;
    expect(label.op).toBe("add_text");
    expect(label.y).toBeGreaterThan(300);
  });
});

describe("sizing a deletion before making it", () => {
  it("counts what a layer delete would take", () => {
    const r = tool("delete_layer").run({ doc: sheet() }, { layer: "A-ANNO-ROOM" });
    expect(r.affected).toBe(4);
    expect(r.commands![0]).toEqual({ op: "delete_layer", layer: "A-ANNO-ROOM" });
  });

  it("refuses a layer that holds nothing, rather than reporting a no-op as success", () => {
    const r = tool("delete_layer").run({ doc: sheet() }, { layer: "NOT-A-LAYER" });
    expect(r.ok).toBe(false);
    expect(r.affected).toBe(0);
  });

  it("counts what a region clear would take, and applying it bears the count out", () => {
    const m = sheet();
    const r = tool("clear_region").run({ doc: m }, { x1: 0, y1: 0, x2: 2000, y2: 2000 });
    const before = m.entities.length;
    const after = applyCadOps(m, r.commands!);
    expect(after.removed).toBe(r.affected);
    expect(after.model.entities.length).toBe(before - r.affected!);
  });
});

describe("tools never mutate the drawing", () => {
  it("returns ops rather than a changed model", () => {
    const m = sheet();
    const before = JSON.stringify(m);
    for (const t of CAD_TOOLS) {
      t.run({ doc: m }, { text: "307", x: 0, y: 0, x1: 0, y1: 0, x2: 1, y2: 1, w: 1, h: 1, layer: "A-WALL" });
    }
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("the shared registry serves the CAD catalogue too", () => {
  const reg = () => new ToolRegistry<DxfModel, any>().register(...CAD_TOOLS);

  it("discovers the right tool for a markup task", () => {
    expect(reg().search("add a note next to room 307").map((t) => t.name)).toContain("add_note");
  });

  it("discovers the right tool for a lookup", () => {
    expect(reg().search("where is the text for room 307").map((t) => t.name)).toContain("find_text");
  });

  it("describes tools with their parameters for the model to read", () => {
    const d = reg().describe(reg().all());
    expect(d).toContain("find_text(text:string, layer:string?, exact:boolean?)");
  });
});
