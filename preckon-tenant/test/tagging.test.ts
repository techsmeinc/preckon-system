// Tag maintenance.
//
// The finding worth having is the orphaned tag: a tag whose element was
// deleted. It survives, still prints, and labels something that is not there —
// and unlike an untagged room, it looks exactly like a tag doing its job. Every
// revision that deletes elements creates them.

import { describe, it, expect } from "vitest";
import { TAG_MAINTENANCE_TOOLS, taggedIds, orphanedTags } from "@/lib/bim/tagging";
import { BUILTIN_TOOLS } from "@/lib/bim/tools";
import type { BimDocument } from "@/lib/bim/model";

const tool = (name: string) => {
  const t = [...TAG_MAINTENANCE_TOOLS, ...BUILTIN_TOOLS].find((x) => x.name === name);
  if (!t) throw new Error(`No tool named ${name}`);
  return t;
};

/** A model of rooms and the tags pointing at them. */
function doc(spec: { rooms?: Array<{ id: string; number?: string; name?: string }>; tags?: Array<{ id: string; target: string; text?: string }> }): BimDocument {
  const elements: Record<string, any> = {};
  const order: string[] = [];
  for (const r of spec.rooms ?? []) {
    elements[r.id] = {
      id: r.id, discipline: "architectural", category: "room", name: r.name,
      geom: { kind: "point", at: { x: 0, y: 0 } },
      params: r.number ? { number: r.number } : {},
    };
    order.push(r.id);
  }
  for (const t of spec.tags ?? []) {
    elements[t.id] = {
      id: t.id, discipline: "general", category: "tag", name: t.text,
      geom: { kind: "point", at: { x: 0, y: 0 } },
      params: { target: t.target, text: t.text ?? "" },
    };
    order.push(t.id);
  }
  return { elements, order, seq: order.length, units: "m" } as BimDocument;
}

const run = (name: string, args: Record<string, any>, d: BimDocument) =>
  tool(name).run({ doc: d } as any, args);

describe("who is tagged", () => {
  it("reads the targets off the tags", () => {
    const d = doc({ rooms: [{ id: "r1" }, { id: "r2" }], tags: [{ id: "t1", target: "r1" }] });
    expect([...taggedIds(d)]).toEqual(["r1"]);
  });

  it("ignores a tag with no target", () => {
    const d = doc({ rooms: [{ id: "r1" }], tags: [{ id: "t1", target: "" }] });
    expect(taggedIds(d).size).toBe(0);
  });
});

describe("orphaned tags", () => {
  const orphaned = doc({
    rooms: [{ id: "r1", number: "101" }],
    tags: [
      { id: "t1", target: "r1", text: "101" },
      { id: "t2", target: "r_deleted", text: "307" },
    ],
  });

  it("finds a tag whose element is gone", () => {
    expect(orphanedTags(orphaned).map((t) => t.id)).toEqual(["t2"]);
  });

  it("explains why they are worse than an untagged element", () => {
    // An untagged room is a gap somebody notices; a tag over empty floor looks
    // exactly like one doing its job.
    const r = run("find_orphaned_tags", {}, orphaned);
    expect(r.summary).toMatch(/reads exactly like one doing its job/);
    expect((r.data as any).orphaned).toBe(1);
  });

  it("reports the tag text, which is what somebody sees on the sheet", () => {
    const r = run("find_orphaned_tags", {}, orphaned);
    expect((r.data as any).elements[0]).toMatchObject({ text: "307", target: "r_deleted" });
  });

  it("says plainly when every tag is sound", () => {
    const clean = doc({ rooms: [{ id: "r1" }], tags: [{ id: "t1", target: "r1" }] });
    const r = run("find_orphaned_tags", {}, clean);
    expect(r.summary).toMatch(/point at an element that exists/);
    expect((r.data as any).orphaned).toBe(0);
  });

  it("handles a model with no tags without calling it a problem", () => {
    const r = run("find_orphaned_tags", {}, doc({ rooms: [{ id: "r1" }] }));
    expect(r.ok).toBe(true);
    expect((r.data as any).tags).toBe(0);
  });

  it("removes only the orphans, leaving sound tags alone", () => {
    const r = run("remove_orphaned_tags", {}, orphaned);
    expect(r.affected).toBe(1);
    expect(r.commands).toEqual([{ name: "delete", args: { id: "t2" } }]);
  });

  it("does nothing when there is nothing to clean", () => {
    const clean = doc({ rooms: [{ id: "r1" }], tags: [{ id: "t1", target: "r1" }] });
    const r = run("remove_orphaned_tags", {}, clean);
    expect(r.affected).toBe(0);
    expect(r.commands).toBeUndefined();
  });
});

describe("removing tags", () => {
  const d = doc({
    rooms: [{ id: "r1" }, { id: "r2" }],
    tags: [{ id: "t1", target: "r1" }, { id: "t2", target: "r2" }],
  });

  it("removes only the tags pointing at the selection", () => {
    const r = run("remove_tags", { selector: { ids: ["r1"] } }, d);
    expect(r.affected).toBe(1);
    expect(r.commands).toEqual([{ name: "delete", args: { id: "t1" } }]);
  });

  it("says out loud when it is removing every tag in the model", () => {
    // A legitimate thing to want and a bad thing to do by accident.
    const r = run("remove_tags", {}, d);
    expect(r.affected).toBe(2);
    expect(r.assumptions![0]).toMatch(/every tag in the model — all 2 of them/);
  });

  it("refuses when the selection has no tags on it", () => {
    const partly = doc({ rooms: [{ id: "r1" }, { id: "r2" }], tags: [{ id: "t1", target: "r1" }] });
    const r = run("remove_tags", { selector: { ids: ["r2"] } }, partly);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/No tags point at anything/);
  });

  it("refuses on a model with no tags", () => {
    expect(run("remove_tags", {}, doc({ rooms: [{ id: "r1" }] })).ok).toBe(false);
  });
});

describe("tagging with each element's own value", () => {
  const rooms = doc({
    rooms: [
      { id: "r1", number: "101", name: "Office" },
      { id: "r2", number: "102", name: "Store" },
    ],
  });

  it("reads the named field per element, not one string for all", () => {
    /* "Tag the rooms with their numbers" means each tag shows its own room's
       number. A single `text` applied to every tag gives four hundred rooms all
       labelled the same thing. */
    const r = run("tag_elements", { selector: { category: "room" }, field: "number" }, rooms);
    expect(r.commands!.map((c: any) => c.args.params.text)).toEqual(["101", "102"]);
  });

  it("still honours a fixed string when one is given", () => {
    const r = run("tag_elements", { selector: { category: "room" }, text: "TBC" }, rooms);
    expect(r.commands!.map((c: any) => c.args.params.text)).toEqual(["TBC", "TBC"]);
  });

  it("falls back through the identity parameters when no field is named", () => {
    const r = run("tag_elements", { selector: { category: "room" } }, rooms);
    expect(r.commands!.map((c: any) => c.args.params.text)).toEqual(["101", "102"]);
  });

  it("reports elements missing the requested field rather than falling back silently", () => {
    // Silent fallback produces tags that look right and read as element ids.
    const mixed = doc({ rooms: [{ id: "r1", number: "101" }, { id: "r2", name: "Unnumbered" }] });
    const r = run("tag_elements", { selector: { category: "room" }, field: "number" }, mixed);
    expect(r.assumptions!.some((s: string) => /carry no "number" value/.test(s))).toBe(true);
    expect(r.assumptions!.some((s: string) => /before the sheet is issued/.test(s))).toBe(true);
  });

  it("records the field on the tag, so a re-tag knows what it was built from", () => {
    const r = run("tag_elements", { selector: { category: "room" }, field: "number" }, rooms);
    expect((r.commands![0] as any).args.params.field).toBe("number");
  });

  it("still skips what is already tagged", () => {
    const partly = doc({
      rooms: [{ id: "r1", number: "101" }, { id: "r2", number: "102" }],
      tags: [{ id: "t1", target: "r1" }],
    });
    const r = run("tag_elements", { selector: { category: "room" }, field: "number" }, partly);
    expect(r.affected).toBe(1);
    expect(r.assumptions!.some((s: string) => /already tagged and were skipped/.test(s))).toBe(true);
  });
});

describe("registration", () => {
  it("exposes the maintenance tools in the built-in catalogue", () => {
    const names = BUILTIN_TOOLS.map((t) => t.name);
    expect(names).toContain("remove_tags");
    expect(names).toContain("find_orphaned_tags");
    expect(names).toContain("remove_orphaned_tags");
  });

  it("does not duplicate the tools that already existed", () => {
    // tag_elements and find_untagged live in tools.ts; a second copy would
    // collide in the registry and shadow one of them unpredictably.
    const names = BUILTIN_TOOLS.map((t) => t.name);
    for (const n of new Set(names)) {
      expect(names.filter((x) => x === n)).toHaveLength(1);
    }
  });
});
