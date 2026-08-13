/**
 * BIM — user-authored tools.
 *
 * ArchiLabs lets users build their own automations; its recordings show PERSONAL
 * tools ("Room Renaming", "tool test") sitting beside the global catalogue. This
 * is that, with one deliberate constraint:
 *
 *   AN AUTHORED TOOL IS DATA, NEVER CODE.
 *
 * A definition is a list of steps naming built-in tools plus argument templates.
 * There is no eval, no Function constructor, no sandbox to escape — because
 * nothing user-supplied is ever executed. The worst a malicious definition can
 * do is what the built-in tools already permit, which the confirmation gate and
 * discipline scoping already govern. That is why this is safe to persist and run
 * on a shared server, and it is worth keeping true: the moment a step gains an
 * "expression" field evaluated at runtime, this property is gone.
 *
 * Templates: "{{params.x}}" and "{{steps.<as>.<path>}}". A string that is
 * exactly one placeholder resolves to the real typed value (array, number,
 * object); a placeholder inside a longer string interpolates as text.
 */

import { applyCommands, type Command } from "./commands";
import type { BimDocument } from "./model";
import type { Tool, ToolContext, ToolParam, ToolResult } from "./registry";
import { coerceArgs, type ToolRegistry } from "./registry";

/** Hard caps. An authored tool is a convenience, not a programming language. */
export const MAX_STEPS = 12;

export interface AuthoredStep {
  /** Name of a BUILT-IN tool. Authored tools may not call other authored tools. */
  tool: string;
  /** Arguments, possibly containing {{...}} templates. */
  args: Record<string, unknown>;
  /** Bind this step's result so later steps can reference it. */
  as?: string;
  /** Continue if this step fails, rather than aborting the tool. */
  optional?: boolean;
}

export interface AuthoredToolDef {
  name: string;
  label: string;
  module: string;
  description: string;
  owner: string;
  params?: ToolParam[];
  keywords?: string[];
  steps: AuthoredStep[];
}

// ── Validation ───────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * Check a definition before it is saved. Returns human-readable errors.
 *
 * Validation happens at save time AND compile time: a tool saved when
 * `tag_elements` existed must not blow up later if that tool is renamed, so the
 * compiled tool re-checks at run time too.
 */
export function validateAuthoredTool(def: AuthoredToolDef, registry: ToolRegistry): string[] {
  const errors: string[] = [];

  if (!NAME_RE.test(def.name ?? "")) errors.push('name must be snake_case, 3-64 chars, starting with a letter (e.g. "tag_all_rooms")');
  if (!def.label?.trim()) errors.push("label is required");
  if (!def.description?.trim()) errors.push("description is required — it is what the agent searches on");
  if (!def.owner?.trim()) errors.push("owner is required for a personal tool");

  if (registry.get(def.name)?.scope === "global") errors.push(`"${def.name}" is the name of a built-in tool`);

  const steps = def.steps ?? [];
  if (!steps.length) errors.push("at least one step is required");
  if (steps.length > MAX_STEPS) errors.push(`too many steps (${steps.length}); the maximum is ${MAX_STEPS}`);

  const paramNames = new Set((def.params ?? []).map((p) => p.name));
  const bound = new Set<string>();

  steps.forEach((s, i) => {
    const n = i + 1;
    const target = registry.get(s.tool);
    if (!target) {
      errors.push(`step ${n}: unknown tool "${s.tool}"`);
    } else if (target.scope !== "global") {
      // Composition of authored tools would need cycle detection and a depth
      // budget. Refusing it outright keeps the execution model trivially sound.
      errors.push(`step ${n}: "${s.tool}" is a personal tool; steps may only call built-in tools`);
    }

    for (const ref of templateRefs(s.args)) {
      const [ns, key] = ref.split(".");
      if (ns === "params") {
        if (!paramNames.has(key)) errors.push(`step ${n}: references unknown parameter "{{params.${key}}}"`);
      } else if (ns === "steps") {
        if (!bound.has(key)) errors.push(`step ${n}: references "{{steps.${key}}}" before it is bound`);
      } else {
        errors.push(`step ${n}: "{{${ref}}}" must start with "params." or "steps."`);
      }
    }

    if (s.as) {
      if (bound.has(s.as)) errors.push(`step ${n}: "${s.as}" is already bound`);
      bound.add(s.as);
    }
  });

  return errors;
}

// ── Templates ────────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

/** Every {{reference}} inside an argument tree, for validation. */
export function templateRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(PLACEHOLDER)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) templateRefs(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) templateRefs(v, out);
  }
  return out;
}

/** Walk a dotted path. Supports a trailing `.ids` shorthand over element lists. */
function pick(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: any = root;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (cur === undefined || cur === null) return undefined;
    // `.ids` over a list of elements is the single most common thing a step
    // needs from the previous one, so it is worth a shorthand.
    if (key === "ids" && Array.isArray(cur)) return cur.map((e: any) => e?.id).filter(Boolean);
    cur = cur[key];
  }
  return cur;
}

export function resolveTemplates(value: unknown, scope: { params: Record<string, unknown>; steps: Record<string, ToolResult> }): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}$/);
    // A lone placeholder yields the real value — an array of ids stays an array
    // rather than becoming "id1,id2".
    if (whole) return pick(scope, whole[1]);
    return value.replace(PLACEHOLDER, (_, ref) => {
      const v = pick(scope, ref);
      return v === undefined || v === null ? "" : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, scope)]));
  }
  return value;
}

// ── Compilation ──────────────────────────────────────────────────────────────

/**
 * Turn a definition into a runnable Tool.
 *
 * Steps run in order against a WORKING COPY of the document: each step's
 * commands are applied to that copy before the next step reads it, so a
 * find-then-tag tool sees its own tags and does not place them twice. The
 * caller still receives the full command list and applies it to the real
 * document exactly once.
 */
export function compileAuthoredTool(def: AuthoredToolDef, registry: ToolRegistry): Tool {
  return {
    name: def.name,
    label: def.label,
    module: def.module || "My Tools",
    scope: "personal",
    owner: def.owner,
    kind: def.steps.some((s) => registry.get(s.tool)?.kind === "write") ? "write" : "read",
    description: def.description,
    params: def.params ?? [],
    keywords: def.keywords,
    run: (ctx: ToolContext, args: Record<string, any>): ToolResult => {
      const errors = validateAuthoredTool(def, registry);
      if (errors.length) return { ok: false, summary: `"${def.label}" is no longer valid: ${errors[0]}` };

      let workingDoc: BimDocument = ctx.doc;
      const commands: Command[] = [];
      const steps: Record<string, ToolResult> = {};
      const assumptions: string[] = [];
      const trace: { step: number; tool: string; ok: boolean; summary: string }[] = [];
      let affected = 0;

      for (let i = 0; i < def.steps.length; i++) {
        const step = def.steps[i];
        const tool = registry.get(step.tool);
        if (!tool || tool.scope !== "global") {
          return { ok: false, summary: `Step ${i + 1} calls "${step.tool}", which is not available.`, data: { trace } };
        }

        const resolved = resolveTemplates(step.args, { params: args, steps }) as Record<string, any>;
        const { args: coerced, errors: argErrors } = coerceArgs(tool, resolved);
        if (argErrors.length) {
          if (step.optional) {
            trace.push({ step: i + 1, tool: step.tool, ok: false, summary: argErrors[0] });
            continue;
          }
          return { ok: false, summary: `Step ${i + 1} (${tool.label}): ${argErrors[0]}`, data: { trace } };
        }

        const result = tool.run({ ...ctx, doc: workingDoc }, coerced);
        trace.push({ step: i + 1, tool: step.tool, ok: result.ok, summary: result.summary });

        if (!result.ok && !step.optional) {
          return { ok: false, summary: `Step ${i + 1} (${tool.label}): ${result.summary}`, data: { trace } };
        }

        if (result.commands?.length) {
          commands.push(...result.commands);
          workingDoc = applyCommands(workingDoc, result.commands);
        }
        affected += result.affected ?? 0;
        if (result.assumptions?.length) assumptions.push(...result.assumptions);
        if (step.as) steps[step.as] = result;
      }

      return {
        ok: true,
        summary: `${def.label}: ${trace.filter((t) => t.ok).length} of ${def.steps.length} step(s) completed.`,
        commands,
        affected,
        assumptions,
        data: { trace },
      };
    },
  };
}

/** Validate then register. Returns errors instead of throwing, for API routes. */
export function installAuthoredTool(def: AuthoredToolDef, registry: ToolRegistry): { ok: boolean; errors: string[] } {
  const errors = validateAuthoredTool(def, registry);
  if (errors.length) return { ok: false, errors };
  registry.upsert(compileAuthoredTool(def, registry));
  return { ok: true, errors: [] };
}
