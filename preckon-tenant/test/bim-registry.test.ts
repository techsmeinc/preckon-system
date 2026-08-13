// The registry-driven copilot: retrieval, tool compilation and the safety rails.
//
// The behaviour under test is the one that makes "tag room 307" possible at all
// — that an instruction naming something can find it, act on exactly it, and
// stop short of a change too large to make unasked.

import { describe, it, expect } from "vitest";
import { applyCommands, type Command } from "@/lib/bim/commands";
import { addElement, describe as describeModel, emptyDocument, type BimDocument } from "@/lib/bim/model";
import { count, query, resolve, compare } from "@/lib/bim/query";
import { BUILTIN_TOOLS, centroid } from "@/lib/bim/tools";
import { ToolRegistry, coerceArgs, CONFIRM_THRESHOLD } from "@/lib/bim/registry";
import { compileAuthoredTool, resolveTemplates, templateRefs, validateAuthoredTool, type AuthoredToolDef } from "@/lib/bim/authoring";

// ── fixtures ─────────────────────────────────────────────────────────────────

function room(doc: BimDocument, name: string, x: number, y: number, w = 4, d = 3) {
  return addElement(doc, {
    discipline: "architectural",
    category: "room",
    name,
    geom: { kind: "area", outline: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }], thickness: 0 },
    params: {},
  });
}

/** Three rooms whose names collide the way real room numbers do. */
function model(): BimDocument {
  let doc = emptyDocument();
  doc = room(doc, "Live/Work Unit 307", 0, 0).doc;
  doc = room(doc, "Live/Work Unit 3070", 10, 0).doc;
  doc = room(doc, "Live/Work Unit 307A", 20, 0).doc;
  doc = room(doc, "Corridor", 30, 0).doc;
  doc = addElement(doc, {
    discipline: "architectural",
    category: "wall",
    name: "North wall",
    geom: { kind: "linear", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, width: 0.2, height: 3 },
    params: { fire_rating: "2 HR" },
  }).doc;
  return doc;
}

const registry = () => new ToolRegistry().register(...BUILTIN_TOOLS);

// ── identity ─────────────────────────────────────────────────────────────────

describe("the model summary carries identity", () => {
  it("names elements, so an instruction can refer to one", () => {
    const text = describeModel(model());
    expect(text).toContain('"Live/Work Unit 307"');
    expect(text).toContain('"Corridor"');
  });

  it("includes parameters, so they can be filtered on", () => {
    expect(describeModel(model())).toContain("fire_rating=2 HR");
  });

  it("summarises instead of dumping once the model is large", () => {
    let doc = emptyDocument();
    for (let i = 0; i < 60; i++) doc = room(doc, `R${i}`, i * 5, 0).doc;
    const text = describeModel(doc, 20);
    expect(text).toContain("too many to list");
    expect(text).toMatch(/room×60/);
    // The levels must survive the summary — every placement needs one.
    expect(text).toContain("Ground Floor");
  });
});

// ── resolution ───────────────────────────────────────────────────────────────

describe("resolving a human reference", () => {
  it("matches 307 as a whole word, not as a prefix of 3070", () => {
    const found = resolve(model(), "307", { category: "room" });
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Live/Work Unit 307");
  });

  it("does not let a fuzzy match dilute an exact one", () => {
    const found = resolve(model(), "Corridor", { category: "room" });
    expect(found.map((e) => e.name)).toEqual(["Corridor"]);
  });

  it("falls back to a substring when nothing stronger matches", () => {
    expect(resolve(model(), "Live/Work", { category: "room" })).toHaveLength(3);
  });

  it("returns nothing rather than guessing when there is no match", () => {
    expect(resolve(model(), "999", { category: "room" })).toHaveLength(0);
  });
});

describe("selectors", () => {
  it("compares case-insensitively", () => {
    expect(compare("2 HR", "contains", "hr")).toBe(true);
    expect(compare("Wall-A", "startsWith", "wall")).toBe(true);
  });

  it("compares numerically when both sides are numbers", () => {
    expect(compare("300", "gt", 200)).toBe(true);
    expect(compare(5, "lte", "5")).toBe(true);
  });

  it("distinguishes missing from empty-but-present", () => {
    expect(compare(undefined, "missing")).toBe(true);
    expect(compare("", "missing")).toBe(true);
    expect(compare("x", "missing")).toBe(false);
    expect(compare("x", "exists")).toBe(true);
  });

  it("treats geometry as queryable parameters", () => {
    // "walls thicker than 150mm" reads as a param test even though width is geometry.
    const found = query(model(), { category: "wall", params: [{ key: "width", op: "gt", value: 0.15 }] });
    expect(found).toHaveLength(1);
  });

  it("filters spatially", () => {
    expect(count(model(), { category: "room", within: { minX: -1, minY: -1, maxX: 9, maxY: 9 } })).toBe(1);
  });
});

// ── tools ────────────────────────────────────────────────────────────────────

describe("tag_elements", () => {
  const tool = BUILTIN_TOOLS.find((t) => t.name === "tag_elements")!;

  it("tags exactly the resolved element and no neighbour", () => {
    const doc = model();
    const target = resolve(doc, "307", { category: "room" })[0];
    const r = tool.run({ doc }, { selector: { ids: [target.id] }, skipTagged: true });

    expect(r.ok).toBe(true);
    expect(r.affected).toBe(1);

    const after = applyCommands(doc, r.commands!);
    const tags = query(after, { category: "tag" });
    expect(tags).toHaveLength(1);
    expect(tags[0].params.target).toBe(target.id);
    expect(tags[0].params.text).toBe("Live/Work Unit 307");
  });

  it("puts the tag at the centre of what it tags", () => {
    const doc = model();
    const target = resolve(doc, "307", { category: "room" })[0];
    const after = applyCommands(doc, tool.run({ doc }, { selector: { ids: [target.id] } }).commands!);
    const tag = query(after, { category: "tag" })[0];
    expect(tag.geom.at).toEqual(centroid(target));
  });

  it("is idempotent — running twice does not double-tag", () => {
    const doc = model();
    const first = tool.run({ doc }, { selector: { category: "room" } });
    const after = applyCommands(doc, first.commands!);
    const second = tool.run({ doc: after }, { selector: { category: "room" } });

    expect(first.affected).toBe(4);
    expect(second.affected).toBe(0);
    expect(second.assumptions?.join(" ")).toContain("already tagged");
  });

  it("reports the assumption when it invents the tag text", () => {
    const r = BUILTIN_TOOLS.find((t) => t.name === "tag_elements")!.run({ doc: model() }, { selector: { category: "room" } });
    expect(r.assumptions?.join(" ")).toMatch(/taken from each element's name/i);
  });

  it("fails honestly when nothing matches", () => {
    const r = tool.run({ doc: model() }, { selector: { category: "nonexistent" } });
    expect(r.ok).toBe(false);
    expect(r.affected).toBe(0);
  });
});

describe("find_untagged", () => {
  it("is what lets the assistant notice an omission unprompted", () => {
    const doc = model();
    const tag = BUILTIN_TOOLS.find((t) => t.name === "tag_elements")!;
    const find = BUILTIN_TOOLS.find((t) => t.name === "find_untagged")!;

    const one = resolve(doc, "Corridor", { category: "room" })[0];
    const after = applyCommands(doc, tag.run({ doc }, { selector: { ids: [one.id] } }).commands!);

    const r = find.run({ doc: after }, { selector: { category: "room" } });
    expect((r.data as any).untagged).toBe(3);
    expect((r.data as any).elements.map((e: any) => e.name)).not.toContain("Corridor");
  });
});

describe("tools never mutate the document", () => {
  it("returns commands rather than a changed model", () => {
    const doc = model();
    const before = JSON.stringify(doc);
    for (const t of BUILTIN_TOOLS.filter((t) => t.kind === "write")) {
      t.run({ doc }, { selector: { category: "room" }, key: "x", value: "1", category: "wall", placements: [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("discipline scoping", () => {
  it("refuses to place another discipline's category", () => {
    const place = BUILTIN_TOOLS.find((t) => t.name === "place_elements")!;
    const r = place.run({ doc: model(), discipline: "electrical" }, { category: "wall", placements: [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("architectural");
  });
});

// ── registry ─────────────────────────────────────────────────────────────────

describe("tool discovery", () => {
  it("surfaces the tagging tools for a tagging task", () => {
    const found = registry().search("tag room 307 it is missing a room tag");
    expect(found.map((t) => t.name)).toContain("tag_elements");
  });

  it("ranks a name match above a passing mention in prose", () => {
    const found = registry().search("delete elements");
    expect(found[0].name).toBe("delete_elements");
  });

  it("ignores filler words rather than matching on them", () => {
    // "all my in the" must not make everything look relevant.
    expect(registry().search("all of the in my")).toHaveLength(0);
  });

  it("hides another user's personal tool", () => {
    const reg = registry();
    reg.upsert({ ...BUILTIN_TOOLS[0], name: "my_tool", scope: "personal", owner: "alice" });
    expect(reg.get("my_tool", "alice")).toBeDefined();
    expect(reg.get("my_tool", "bob")).toBeUndefined();
    expect(reg.all("bob").map((t) => t.name)).not.toContain("my_tool");
  });

  it("refuses duplicate registrations", () => {
    expect(() => registry().register(BUILTIN_TOOLS[0])).toThrow(/duplicate/i);
  });
});

describe("argument coercion", () => {
  const tool = BUILTIN_TOOLS.find((t) => t.name === "move_elements")!;

  it("accepts a stringified number rather than wasting a turn", () => {
    const { args, errors } = coerceArgs(tool, { selector: {}, dx: "2.5" });
    expect(errors).toEqual([]);
    expect(args.dx).toBe(2.5);
  });

  it("applies declared defaults", () => {
    expect(coerceArgs(tool, { selector: {} }).args.dy).toBe(0);
  });

  it("reports a missing required parameter by name", () => {
    expect(coerceArgs(tool, {}).errors.join(" ")).toContain("selector");
  });

  it("rejects a number that is not one", () => {
    expect(coerceArgs(tool, { selector: {}, dx: "over there" }).errors.join(" ")).toMatch(/must be a number/);
  });
});

// ── the confirmation gate ────────────────────────────────────────────────────

describe("sizing an action before taking it", () => {
  it("reports a blast radius the gate can act on", () => {
    let doc = emptyDocument();
    for (let i = 0; i < 40; i++) doc = room(doc, `R${i}`, i * 5, 0).doc;

    const r = BUILTIN_TOOLS.find((t) => t.name === "tag_elements")!.run({ doc }, { selector: { category: "room" } });
    expect(r.affected).toBe(40);
    expect(r.affected!).toBeGreaterThan(CONFIRM_THRESHOLD);
  });

  it("warns that deleting a wall takes its doors with it", () => {
    let doc = emptyDocument();
    const w = addElement(doc, { discipline: "architectural", category: "wall", geom: { kind: "linear", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, width: 0.2, height: 3 }, params: {} });
    doc = w.doc;
    doc = applyCommands(doc, [{ name: "add", args: { category: "door", host: w.id, offset: 2 } }]);

    const r = BUILTIN_TOOLS.find((t) => t.name === "delete_elements")!.run({ doc }, { selector: { category: "wall" } });
    expect(r.assumptions?.join(" ")).toMatch(/host doors\/windows/i);
  });
});

// ── authoring ────────────────────────────────────────────────────────────────

const authored: AuthoredToolDef = {
  name: "tag_untagged_rooms",
  label: "Tag Untagged Rooms",
  module: "My Tools",
  description: "Find rooms with no tag and tag them",
  owner: "alice",
  params: [{ name: "level", type: "string", description: "Level id" }],
  steps: [
    { tool: "find_untagged", args: { selector: { category: "room" } }, as: "missing" },
    { tool: "tag_elements", args: { selector: { ids: "{{steps.missing.data.elements.ids}}" } } },
  ],
};

describe("user-authored tools are data, not code", () => {
  it("compiles a definition into a runnable tool", () => {
    const reg = registry();
    expect(validateAuthoredTool(authored, reg)).toEqual([]);

    const tool = compileAuthoredTool(authored, reg);
    const doc = model();
    const r = tool.run({ doc, userId: "alice" }, {});

    expect(r.ok).toBe(true);
    const after = applyCommands(doc, r.commands!);
    expect(query(after, { category: "tag" })).toHaveLength(4);
  });

  it("carries its author, so it stays private", () => {
    expect(compileAuthoredTool(authored, registry()).owner).toBe("alice");
    expect(compileAuthoredTool(authored, registry()).scope).toBe("personal");
  });

  it("sees its own earlier steps, so it does not act twice", () => {
    // The second step must observe the tags the first step implied, or a
    // find-then-tag tool double-tags on every run.
    const reg = registry();
    const twice: AuthoredToolDef = {
      ...authored,
      name: "tag_twice",
      steps: [
        { tool: "tag_elements", args: { selector: { category: "room" } } },
        { tool: "tag_elements", args: { selector: { category: "room" } }, optional: true },
      ],
    };
    const r = compileAuthoredTool(twice, reg).run({ doc: model(), userId: "alice" }, {});
    expect(r.affected).toBe(4);
  });

  it("rejects a step calling an unknown tool", () => {
    const bad = { ...authored, steps: [{ tool: "does_not_exist", args: {} }] };
    expect(validateAuthoredTool(bad, registry()).join(" ")).toMatch(/unknown tool/);
  });

  it("rejects a reference to a step that has not run yet", () => {
    const bad: AuthoredToolDef = {
      ...authored,
      steps: [{ tool: "tag_elements", args: { selector: { ids: "{{steps.later.data.elements.ids}}" } } }],
    };
    expect(validateAuthoredTool(bad, registry()).join(" ")).toMatch(/before it is bound/);
  });

  it("rejects a reference to an undeclared parameter", () => {
    const bad: AuthoredToolDef = {
      ...authored,
      steps: [{ tool: "find_untagged", args: { selector: { category: "{{params.nope}}" } } }],
    };
    expect(validateAuthoredTool(bad, registry()).join(" ")).toMatch(/unknown parameter/);
  });

  it("refuses to compose personal tools, so there are no cycles to detect", () => {
    const reg = registry();
    reg.upsert(compileAuthoredTool(authored, reg));
    const nested: AuthoredToolDef = { ...authored, name: "wraps_another", steps: [{ tool: "tag_untagged_rooms", args: {} }] };
    expect(validateAuthoredTool(nested, reg).join(" ")).toMatch(/may only call built-in tools/);
  });

  it("caps step count", () => {
    const many = { ...authored, steps: Array.from({ length: 20 }, () => ({ tool: "model_overview", args: {} })) };
    expect(validateAuthoredTool(many, registry()).join(" ")).toMatch(/too many steps/);
  });

  it("will not shadow a built-in tool's name", () => {
    const clash = { ...authored, name: "tag_elements" };
    expect(validateAuthoredTool(clash, registry()).join(" ")).toMatch(/built-in tool/);
  });
});

describe("templates", () => {
  const scope = { params: { n: 7, word: "room" }, steps: { s: { ok: true, summary: "", data: { elements: [{ id: "r1" }, { id: "r2" }] } } } };

  it("resolves a lone placeholder to the real typed value", () => {
    // Not "r1,r2" — a selector needs the array.
    expect(resolveTemplates("{{steps.s.data.elements.ids}}", scope as any)).toEqual(["r1", "r2"]);
    expect(resolveTemplates("{{params.n}}", scope as any)).toBe(7);
  });

  it("interpolates a placeholder inside a longer string", () => {
    expect(resolveTemplates("the {{params.word}} count", scope as any)).toBe("the room count");
  });

  it("resolves inside nested objects and arrays", () => {
    expect(resolveTemplates({ a: [{ b: "{{params.n}}" }] }, scope as any)).toEqual({ a: [{ b: 7 }] });
  });

  it("renders a missing reference as empty rather than the literal braces", () => {
    expect(resolveTemplates("x{{params.absent}}y", scope as any)).toBe("xy");
  });

  it("finds every reference for validation", () => {
    expect(templateRefs({ a: "{{params.x}}", b: ["{{steps.y.z}}"] }).sort()).toEqual(["params.x", "steps.y.z"]);
  });
});
