/**
 * BIM — the registry-driven agent loop.
 *
 * The earlier loop (agent.ts) put every command in the system prompt and the
 * whole model in the user turn. That works at fifty elements and ten commands.
 * It does not work at five thousand and two hundred, which is where this is
 * going, so the agent now DISCOVERS what it needs:
 *
 *   discover_tools  → search the registry for this task
 *   run_tool        → call one, read its result, decide the next
 *
 * Read tools return data. Write tools return COMMANDS, which Core applies —
 * blueprint §7's "LLMs never directly write authoritative geometry" holds, since
 * the model only ever picks a tool and its arguments.
 *
 * Two behaviours are lifted directly from the ArchiLabs recordings:
 *
 *   - Large actions are COUNTED, then confirmed. "Placing 4 columns per
 *     intersection will create 216 structural columns… Shall I proceed?"
 *   - Assumptions are REPORTED, never buried. If a tool guessed, the guess is
 *     in the reply along with how to correct it.
 */

import { SPECIALISTS, type SpecialistId } from "./agents";
import type { Command } from "./commands";
import { describe, type BimDocument } from "./model";
import { CONFIRM_THRESHOLD, coerceArgs, type Tool, type ToolRegistry, type ToolResult } from "./registry";

const MAX_STEPS = 16;

/** What the caller must do next. */
export type AgentOutcome =
  | { status: "done"; reply: string; applied: number; assumptions: string[]; trace: TraceEntry[] }
  | { status: "needs_confirmation"; reply: string; pending: PendingAction; trace: TraceEntry[] }
  | { status: "needs_input"; reply: string; trace: TraceEntry[] };

export interface PendingAction {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  affected: number;
  summary: string;
  assumptions: string[];
  commands: Command[];
}

export interface TraceEntry {
  tool: string;
  label: string;
  module: string;
  scope: string;
  kind: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  affected?: number;
}

const SYSTEM = `You edit a BIM model by CALLING TOOLS. You never write geometry directly.

HOW TO WORK:
1. Call discover_tools with a short description of the task to find the tools for it.
2. Read before you write. Find the elements first (find_elements / resolve_reference),
   then act on what you found. Never guess an element id.
3. Call run_tool once per step. Read its result before the next step.
4. Set done=true with a reply when the instruction is satisfied.

COORDINATES: metres. Plan X east, Y north, Z up.

RULES:
- If the instruction names something ("room 307", "the corridor"), use resolve_reference.
- If you cannot tell WHICH parameter or element the user means, stop and ask. Say what
  you would do by default and offer the alternative. Do not guess silently.
- If a tool reports assumptions, repeat them in your reply and say how to change them.
- State counts in your reply: what you changed, and how many.
- Return ONLY tool calls. No prose outside them.`;

const DISCOVER_TOOL = {
  name: "discover_tools",
  description: "Search the tool registry for tools relevant to a task. Call this first.",
  input_schema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Short description of what you need to do, e.g. 'tag rooms that have no tag'." },
    },
    required: ["task"],
  },
};

const RUN_TOOL = {
  name: "run_tool",
  description: "Run one tool from the registry by name.",
  input_schema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "The tool's name, exactly as discover_tools reported it." },
      args: { type: "object", description: "Arguments for the tool." },
      done: { type: "boolean", description: "True if this completes the instruction." },
      reply: { type: "string", description: "What you did, with counts. Shown to the user." },
    },
    required: ["tool", "args"],
  },
};

const ASK_TOOL = {
  name: "ask_user",
  description: "Ask a clarifying question when the instruction is genuinely ambiguous. Offer a default and an alternative.",
  input_schema: {
    type: "object",
    properties: { question: { type: "string", description: "The question, including the options." } },
    required: ["question"],
  },
};

export interface BimAgent2Args {
  instruction: string;
  specialist: SpecialistId;
  doc: BimDocument;
  registry: ToolRegistry;
  userId?: string;
  /** Apply commands to the real document; returns the new doc and how many landed. */
  apply: (cmds: Command[]) => Promise<{ doc: BimDocument; applied: number }>;
  model: string;
  callAnthropic: (req: { model: string; system: string; messages: any[]; tools: any[]; maxTokens: number }) => Promise<any>;
  /** Skip the confirmation gate — the user already approved this action. */
  preapproved?: boolean;
  confirmThreshold?: number;
}

export async function runBimAgent2({
  instruction,
  specialist,
  doc,
  registry,
  userId,
  apply,
  model,
  callAnthropic,
  preapproved = false,
  confirmThreshold = CONFIRM_THRESHOLD,
}: BimAgent2Args): Promise<AgentOutcome> {
  const spec = SPECIALISTS[specialist] ?? SPECIALISTS.all;
  const discipline = specialist === "all" || specialist === "general" ? "all" : specialist;
  const system = `${spec.system}\n\n${SYSTEM}`;

  const messages: any[] = [
    {
      role: "user",
      content: `INSTRUCTION: ${instruction}\n\nMODEL:\n${describe(doc)}`,
    },
  ];

  const trace: TraceEntry[] = [];
  const assumptions: string[] = [];
  let applied = 0;
  let reply = "";
  let working = doc;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callAnthropic({ model, system, messages, tools: [DISCOVER_TOOL, RUN_TOOL, ASK_TOOL], maxTokens: 3000 });
    const toolUse = (res.content ?? []).find((c: any) => c.type === "tool_use");
    const text = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();

    if (!toolUse) {
      reply = text || reply;
      break;
    }

    messages.push({ role: "assistant", content: res.content });

    const say = (content: string) =>
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content }] });

    // ── ask_user ────────────────────────────────────────────────────────────
    if (toolUse.name === "ask_user") {
      return { status: "needs_input", reply: String(toolUse.input?.question ?? "Could you clarify?"), trace };
    }

    // ── discover_tools ──────────────────────────────────────────────────────
    if (toolUse.name === "discover_tools") {
      const found = registry.search(String(toolUse.input?.task ?? instruction), { userId, discipline });
      say(
        found.length
          ? `Found ${found.length} tool(s):\n\n${registry.describe(found)}`
          : "No tools matched. Try different words, or call discover_tools with a broader description.",
      );
      continue;
    }

    // ── run_tool ────────────────────────────────────────────────────────────
    if (toolUse.name === "run_tool") {
      const name = String(toolUse.input?.tool ?? "");
      const tool = registry.get(name, userId);

      if (!tool) {
        say(`No tool named "${name}" is available. Call discover_tools to see what is.`);
        continue;
      }
      if (!allowed(tool, discipline)) {
        say(`"${tool.label}" is outside your ${spec.short} remit — it acts on ${tool.disciplines?.join("/")}.`);
        continue;
      }

      const { args, errors } = coerceArgs(tool, (toolUse.input?.args ?? {}) as Record<string, any>);
      if (errors.length) {
        say(`Cannot run ${tool.label}: ${errors.join("; ")}`);
        continue;
      }

      let result: ToolResult;
      try {
        result = tool.run({ doc: working, userId, discipline }, args);
      } catch (e: any) {
        // A tool throwing is a bug, not a user error — report it and let the
        // agent try another route rather than failing the whole request.
        say(`${tool.label} failed: ${e?.message ?? "unknown error"}`);
        trace.push({ tool: tool.name, label: tool.label, module: tool.module, scope: tool.scope, kind: tool.kind, ok: false, summary: String(e?.message ?? "error") });
        continue;
      }

      trace.push({
        tool: tool.name,
        label: tool.label,
        module: tool.module,
        scope: tool.scope,
        kind: tool.kind,
        ok: result.ok,
        summary: result.summary,
        data: result.data,
        affected: result.affected,
      });
      if (result.assumptions?.length) assumptions.push(...result.assumptions);
      if (toolUse.input?.reply) reply = String(toolUse.input.reply);

      // The gate. Count first, then ask — the recording's "This is a large
      // action. Shall I proceed to place 216 W10X49 columns?" moment.
      const n = result.affected ?? 0;
      if (result.ok && result.commands?.length && n > confirmThreshold && !preapproved) {
        return {
          status: "needs_confirmation",
          reply: `${result.summary} This is a large action — ${n} elements would change.${result.assumptions?.length ? ` Assumptions: ${result.assumptions.join(" ")}` : ""} Shall I proceed?`,
          pending: {
            tool: tool.name,
            label: tool.label,
            args,
            affected: n,
            summary: result.summary,
            assumptions: result.assumptions ?? [],
            commands: result.commands,
          },
          trace,
        };
      }

      if (result.ok && result.commands?.length) {
        const applyResult = await apply(result.commands);
        working = applyResult.doc;
        applied += applyResult.applied;
      }

      say(
        [
          result.ok ? `${tool.label}: ${result.summary}` : `${tool.label} did not run: ${result.summary}`,
          result.assumptions?.length ? `Assumptions: ${result.assumptions.join(" ")}` : "",
          result.data !== undefined ? `Result:\n${json(result.data)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );

      if (toolUse.input?.done) break;
      continue;
    }

    say(`Unknown tool "${toolUse.name}".`);
  }

  return {
    status: "done",
    reply: reply || `${spec.short}: ${applied} change(s) applied.`,
    applied,
    assumptions,
    trace,
  };
}

/** A specialist may only run tools that act for its discipline. */
function allowed(tool: Tool, discipline: string): boolean {
  if (discipline === "all") return true;
  if (!tool.disciplines) return true;
  return tool.disciplines.includes(discipline as any);
}

/** Trim a result so a large element list does not swamp the context. */
function json(data: unknown): string {
  const s = JSON.stringify(data, null, 2);
  return s.length > 4000 ? `${s.slice(0, 4000)}\n… (truncated)` : s;
}
