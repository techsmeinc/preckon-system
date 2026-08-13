/**
 * BIM — the tool registry.
 *
 * The agent does not carry every capability in its system prompt. It searches
 * this registry for the two or three tools a task needs, then calls them. That
 * is the difference between a fixed command language and something that keeps
 * working at two hundred tools.
 *
 * A tool NEVER mutates. It returns COMMANDS, which Core applies through
 * commands.ts. The blueprint's §7 rule — "LLMs never directly write
 * authoritative geometry" — survives intact: the model chooses a tool, the tool
 * emits commands, the interpreter writes geometry.
 *
 * Tools carry a `module` and a `scope`. Scope is what makes user-authored tools
 * safe to mix with built-ins: a personal tool belongs to one author and is never
 * offered to anyone else.
 */

import type { Command } from "./commands";
import type { BimDocument, Discipline, Element } from "./model";

export type ToolScope = "global" | "personal";
export type ToolKind = "read" | "write";

export type ParamType = "string" | "number" | "boolean" | "selector" | "vec2" | "enum" | "string[]";

export interface ToolParam {
  name: string;
  type: ParamType;
  description: string;
  required?: boolean;
  default?: unknown;
  /** For type "enum". */
  options?: string[];
}

export interface ToolResult {
  ok: boolean;
  /** One sentence for the user. Tools say what they did, not how. */
  summary: string;
  /** Shown as the JSON result card. Keep it small enough to read. */
  data?: unknown;
  /** Empty for read tools. Applied by Core, in order. */
  commands?: Command[];
  /** How many elements this touches — drives the confirmation gate. */
  affected?: number;
  /** Anything the tool guessed, so the agent can report it rather than hide it. */
  assumptions?: string[];
}

export interface ToolContext {
  doc: BimDocument;
  /** Whose session this is — a personal tool only runs for its author. */
  userId?: string;
  /** The specialist driving, for discipline scoping. */
  discipline?: Discipline | "all";
}

export interface Tool {
  /** snake_case, unique. This is what the model emits. */
  name: string;
  /** Display name for the tool card, e.g. "Tag Specific Elements". */
  label: string;
  module: string;
  scope: ToolScope;
  kind: ToolKind;
  /** Who may run a personal tool. Undefined for global tools. */
  owner?: string;
  description: string;
  params: ToolParam[];
  /** Extra search terms that do not appear in the name or description. */
  keywords?: string[];
  /** Disciplines this tool may act for. Undefined means any. */
  disciplines?: Discipline[];
  run: (ctx: ToolContext, args: Record<string, any>) => ToolResult;
}

/** Above this many affected elements, the agent must confirm before applying. */
export const CONFIRM_THRESHOLD = 25;

// ── Registry ─────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(...tools: Tool[]): this {
    for (const t of tools) {
      if (this.tools.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
      this.tools.set(t.name, t);
    }
    return this;
  }

  /** Replace an existing tool — used when a user edits an authored tool. */
  upsert(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string, userId?: string): Tool | undefined {
    const t = this.tools.get(name);
    if (!t) return undefined;
    return this.visible(t, userId) ? t : undefined;
  }

  /**
   * Look up a tool ignoring ownership. For diagnostics only — validation needs
   * to distinguish "no such tool" from "that tool is personal", and `get`
   * collapses both to undefined.
   */
  peek(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** A personal tool is visible only to its author. */
  private visible(t: Tool, userId?: string): boolean {
    return t.scope === "global" || (!!t.owner && t.owner === userId);
  }

  all(userId?: string): Tool[] {
    return [...this.tools.values()].filter((t) => this.visible(t, userId));
  }

  modules(userId?: string): string[] {
    return [...new Set(this.all(userId).map((t) => t.module))].sort();
  }

  /**
   * Rank tools against a free-text task description.
   *
   * Deliberately a plain lexical score rather than embeddings: it runs in the
   * request with no model call, it is debuggable when a tool fails to surface,
   * and at this catalogue size recall is not the bottleneck. Revisit if the
   * registry passes a few hundred tools.
   */
  search(text: string, opts: { userId?: string; limit?: number; discipline?: Discipline | "all" } = {}): Tool[] {
    const { userId, limit = 8, discipline } = opts;
    // An empty search means "show me what there is". A search that is ALL
    // filler ("all of the in my") means the caller said nothing useful —
    // returning the whole catalogue there would dress noise up as relevance.
    if (!text.trim()) return this.all(userId).slice(0, limit);
    const terms = tokenise(text);
    if (!terms.length) return [];

    const scored = this.all(userId)
      .filter((t) => !discipline || discipline === "all" || !t.disciplines || t.disciplines.includes(discipline))
      .map((t) => ({ t, score: score(t, terms) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));

    return scored.slice(0, limit).map((s) => s.t);
  }

  /** Compact catalogue for the model — name, what it does, and its parameters. */
  describe(tools: Tool[]): string {
    return tools
      .map((t) => {
        const ps = t.params
          .map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}`)
          .join(", ");
        return `${t.name}(${ps}) [${t.kind}, module ${t.module}] — ${t.description}`;
      })
      .join("\n");
  }
}

// ── Search scoring ───────────────────────────────────────────────────────────

const STOP = new Set(["the", "a", "an", "all", "my", "in", "on", "of", "to", "for", "and", "with", "please", "make", "me", "i", "it", "is", "are", "this", "that", "by"]);

export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function score(t: Tool, terms: string[]): number {
  const name = tokenise(`${t.name} ${t.label}`);
  const keys = tokenise((t.keywords ?? []).join(" "));
  const desc = tokenise(`${t.description} ${t.module}`);
  let n = 0;
  for (const term of terms) {
    // A hit in the name is worth far more than one in prose — "tag" matching
    // tag_elements should beat a description that merely mentions tagging.
    if (name.some((w) => w === term)) n += 10;
    else if (keys.some((w) => w === term)) n += 6;
    else if (name.some((w) => w.startsWith(term) || term.startsWith(w))) n += 4;
    else if (desc.some((w) => w === term)) n += 2;
  }
  return n;
}

// ── Argument coercion ────────────────────────────────────────────────────────

/**
 * Coerce and validate arguments against a tool's declared parameters.
 *
 * Models emit "3" for a number and "true" for a boolean often enough that
 * rejecting them wastes a turn for no benefit. Coerce what is unambiguous,
 * reject what is not.
 */
export function coerceArgs(tool: Tool, raw: Record<string, any> = {}): { args: Record<string, any>; errors: string[] } {
  const args: Record<string, any> = {};
  const errors: string[] = [];

  for (const p of tool.params) {
    let v = raw[p.name];

    if (v === undefined || v === null || v === "") {
      if (p.default !== undefined) v = p.default;
      else if (p.required) errors.push(`missing required parameter "${p.name}" (${p.type})`);
      if (v === undefined || v === null || v === "") continue;
    }

    switch (p.type) {
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n)) errors.push(`"${p.name}" must be a number, got ${JSON.stringify(v)}`);
        else args[p.name] = n;
        break;
      }
      case "boolean":
        args[p.name] = v === true || v === "true" || v === 1 || v === "1";
        break;
      case "string":
        args[p.name] = String(v);
        break;
      case "string[]":
        args[p.name] = Array.isArray(v) ? v.map(String) : [String(v)];
        break;
      case "enum": {
        const s = String(v);
        if (p.options && !p.options.includes(s)) errors.push(`"${p.name}" must be one of ${p.options.join("|")}, got "${s}"`);
        else args[p.name] = s;
        break;
      }
      case "vec2": {
        const o = v as { x?: unknown; y?: unknown };
        const x = Number(o?.x);
        const y = Number(o?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) errors.push(`"${p.name}" must be {x,y}`);
        else args[p.name] = { x, y };
        break;
      }
      case "selector":
        if (typeof v !== "object" || Array.isArray(v)) errors.push(`"${p.name}" must be a selector object`);
        else args[p.name] = v;
        break;
    }
  }

  return { args, errors };
}

/** Elements a write tool would touch, for the gate and the audit line. */
export const affectedIds = (els: Element[]): string[] => els.map((e) => e.id);
