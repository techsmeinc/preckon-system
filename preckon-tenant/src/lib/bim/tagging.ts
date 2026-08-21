/**
 * Tag maintenance: removing tags, and finding the ones pointing at nothing.
 *
 * `tag_elements` and `find_untagged` already live in tools.ts and do their jobs.
 * What was missing is everything AFTER tagging — the operations a model needs
 * once it has been edited a few times.
 *
 * ── ORPHANED TAGS ────────────────────────────────────────────────────────────
 *
 * A tag holds `params.target`, the id of the element it annotates. Delete the
 * element and the tag survives: it is a separate element and nothing cascades.
 * It still draws, it still prints, and it labels something that is no longer in
 * the model.
 *
 * This is worse than an untagged element, and less visible. An untagged room is
 * a gap somebody notices; a tag reading "307" floating over empty floor looks
 * exactly like a tag doing its job, and the person reading the sheet has no way
 * to tell. It is also the natural consequence of ordinary work — every deletion
 * during a revision leaves one behind.
 *
 * ── WHY REMOVAL IS A TOOL RATHER THAN A DELETE ───────────────────────────────
 *
 * Re-tagging from a different field ("show the room name, not the number")
 * means clearing the existing tags first. Doing that by selecting them by hand
 * on a plan with four hundred rooms is the kind of task that gets abandoned
 * halfway, leaving a drawing that is half one convention and half the other.
 */

import type { BimDocument, Id } from "./model";
import { query, type Selector } from "./query";
import type { Tool, ToolContext, ToolResult } from "./registry";

const ok = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: false, summary, ...extra });

/** The ids that already have a tag pointing at them. */
export function taggedIds(doc: BimDocument): Set<Id> {
  const out = new Set<Id>();
  for (const t of query(doc, { category: "tag" })) {
    const target = t.params?.target;
    if (typeof target === "string" && target) out.add(target);
  }
  return out;
}

/** Tags whose target no longer exists in the model. */
export function orphanedTags(doc: BimDocument) {
  return query(doc, { category: "tag" }).filter((t) => {
    const target = t.params?.target;
    return !target || !doc.elements[String(target)];
  });
}

const removeTags: Tool = {
  name: "remove_tags",
  label: "Remove Tags",
  module: "Tagging",
  scope: "global",
  kind: "write",
  description:
    'Delete the tags on elements matching a selector — "remove the room tags" — for re-tagging from a different field, or clearing annotation before a coordination issue. With no selector it removes every tag in the model.',
  keywords: ["remove", "delete", "clear", "untag", "strip", "tags", "annotation", "retag"],
  params: [
    { name: "selector", type: "selector", description: "Which tagged elements to clear, e.g. {category:'room'}. Omit to remove all tags." },
  ],
  run: (ctx: ToolContext, a): ToolResult => {
    const allTags = query(ctx.doc, { category: "tag" });
    if (!allTags.length) return fail("There are no tags in this model.", { affected: 0 });

    let victims = allTags;
    const assumptions: string[] = [];

    if (a.selector) {
      const targets = new Set(query(ctx.doc, a.selector as Selector).map((e) => e.id));
      victims = allTags.filter((t) => targets.has(String(t.params?.target ?? "")));
      if (!victims.length) return fail("No tags point at anything matching that selector.", { affected: 0 });
    } else {
      // Removing every tag is a legitimate thing to want and a bad thing to do
      // by accident, so it is stated rather than assumed to be understood.
      assumptions.push(`No selector given, so this removes every tag in the model — all ${allTags.length} of them.`);
    }

    return ok(`Removing ${victims.length} tag(s).`, {
      commands: victims.map((t) => ({ name: "delete" as const, args: { id: t.id } })),
      affected: victims.length,
      assumptions,
      data: { removed: victims.length, ofTotal: allTags.length },
    });
  },
};

const findOrphanedTags: Tool = {
  name: "find_orphaned_tags",
  label: "Find Orphaned Tags",
  module: "Tagging",
  scope: "global",
  kind: "read",
  description:
    "List tags whose element has been deleted. They survive the deletion, still print on the sheet, and label something that is no longer in the model — the natural consequence of any revision that removes elements.",
  keywords: ["orphan", "orphaned", "dangling", "stale", "tag", "broken", "leftover", "deleted"],
  params: [],
  run: (ctx: ToolContext): ToolResult => {
    const tags = query(ctx.doc, { category: "tag" });
    if (!tags.length) return ok("There are no tags in this model.", { affected: 0, data: { tags: 0, orphaned: 0 } });

    const orphans = orphanedTags(ctx.doc);
    if (!orphans.length) {
      return ok(`All ${tags.length} tag(s) point at an element that exists.`, {
        affected: 0, data: { tags: tags.length, orphaned: 0 },
      });
    }

    return ok(
      `${orphans.length} of ${tags.length} tag(s) point at elements that are no longer in the model. They still print, and a tag labelling something that is not there reads exactly like one doing its job.`,
      {
        affected: 0,
        data: {
          tags: tags.length,
          orphaned: orphans.length,
          elements: orphans.slice(0, 100).map((t) => ({
            id: t.id,
            text: t.params?.text ?? t.name ?? null,
            target: t.params?.target ?? null,
          })),
        },
      },
    );
  },
};

const removeOrphanedTags: Tool = {
  name: "remove_orphaned_tags",
  label: "Remove Orphaned Tags",
  module: "Tagging",
  scope: "global",
  kind: "write",
  description:
    "Delete every tag whose element no longer exists. Safe to run before an issue: it only removes tags that already refer to nothing.",
  keywords: ["remove", "clean", "purge", "orphan", "orphaned", "dangling", "stale", "tidy"],
  params: [],
  run: (ctx: ToolContext): ToolResult => {
    const orphans = orphanedTags(ctx.doc);
    if (!orphans.length) return ok("No orphaned tags to remove.", { affected: 0 });
    return ok(`Removing ${orphans.length} orphaned tag(s).`, {
      commands: orphans.map((t) => ({ name: "delete" as const, args: { id: t.id } })),
      affected: orphans.length,
      data: { removed: orphans.length },
    });
  },
};

export const TAG_MAINTENANCE_TOOLS: Tool[] = [removeTags, findOrphanedTags, removeOrphanedTags];
