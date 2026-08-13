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

/**
 * The loop is generic over document and command type.
 *
 * BIM Studio drives a BimDocument emitting Commands; the issued-drawing editor
 * drives a DxfModel emitting CadOps. Everything here — discovery, read-before-
 * write, the gate, the trace — is identical for both, so the two differ only in
 * their tools and in how a document is summarised for the model. Defaults keep
 * every existing BIM call site unchanged.
 */

/** What the caller must do next. */
export type AgentOutcome<Cmd = Command> =
  | { status: "done"; reply: string; applied: number; assumptions: string[]; trace: TraceEntry[] }
  | { status: "needs_confirmation"; reply: string; pending: PendingAction<Cmd>; trace: TraceEntry[] }
  | { status: "needs_input"; reply: string; trace: TraceEntry[] };

export interface PendingAction<Cmd = Command> {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  affected: number;
  summary: string;
  assumptions: string[];
  commands: Cmd[];
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

/**
 * The rules both assistants share. Only the subject noun and the coordinate
 * convention differ between a metre-based BIM model and a sheet in whatever
 * units it was drawn in, so those are arguments rather than two prompts that
 * would drift apart.
 */
const sharedRules = (subject: string, coords: string) => `You edit ${subject} by CALLING TOOLS. You never write geometry directly.

HOW TO WORK:
1. Call discover_tools with a short description of the task to find the tools for it.
2. Read before you write. Find the things first, then act on what you found.
   Never guess an id — if you did not read it from a tool result, you do not know it.
3. Call run_tool once per step. Read its result before the next step.
4. Set done=true with a reply when the instruction is satisfied.

COORDINATES: ${coords}

RULES:
- If the instruction names something ("room 307", "the corridor"), resolve it with a
  read tool before acting. A name is not an id.
- If you cannot tell WHICH parameter or element the user means, stop and ask with
  ask_user. Say what you would do by default and offer the alternative. Do not guess
  silently — a wrong guess applied to a hundred elements is worse than a question.
- If a tool reports assumptions, repeat them in your reply and say how to change them.
- State counts in your reply: what you changed, and how many.
- Return ONLY tool calls. No prose outside them.`;

export { sharedRules };

const SYSTEM = sharedRules("a BIM model", "metres. Plan X east, Y north, Z up.");

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

export interface BimAgent2Args<Doc = BimDocument, Cmd = Command> {
  instruction: string;
  /** BIM only. Omit for documents that have no disciplines, such as a CAD sheet. */
  specialist?: SpecialistId;
  doc: Doc;
  registry: ToolRegistry<Doc, Cmd>;
  userId?: string;
  /** Apply commands to the real document; returns the new doc and how many landed. */
  apply: (cmds: Cmd[]) => Promise<{ doc: Doc; applied: number }>;
  model: string;
  callAnthropic: (req: { model: string; system: string; messages: any[]; tools: any[]; maxTokens: number }) => Promise<any>;
  /** Skip the confirmation gate — the user already approved this action. */
  preapproved?: boolean;
  confirmThreshold?: number;
  /** How to describe this document to the model. Defaults to the BIM summary. */
  summarise?: (doc: Doc) => string;
  /** Replaces the shared rules wholesale. Build one with `sharedRules`. */
  persona?: string;
  /** What the document is called in prose, for the prompt. */
  noun?: string;
}

export async function runBimAgent2<Doc = BimDocument, Cmd = Command>({
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
  summarise,
  persona,
  noun = "MODEL",
}: BimAgent2Args<Doc, Cmd>): Promise<AgentOutcome<Cmd>> {
  const spec = specialist ? (SPECIALISTS[specialist] ?? SPECIALISTS.all) : undefined;
  const discipline = !specialist || specialist === "all" || specialist === "general" ? "all" : specialist;
  const system = `${spec?.system ?? ""}\n\n${persona ?? SYSTEM}`.trim();
  const describeDoc = summarise ?? ((d: Doc) => describe(d as unknown as BimDocument));

  const messages: any[] = [
    {
      role: "user",
      content: `INSTRUCTION: ${instruction}\n\n${noun}:\n${describeDoc(doc)}`,
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
        say(`"${tool.label}" is outside your ${spec?.short ?? "current"} remit — it acts on ${tool.disciplines?.join("/")}.`);
        continue;
      }

      const { args, errors } = coerceArgs(tool, (toolUse.input?.args ?? {}) as Record<string, any>);
      if (errors.length) {
        say(`Cannot run ${tool.label}: ${errors.join("; ")}`);
        continue;
      }

      let result: ToolResult<Cmd>;
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
    reply: reply || `${spec ? `${spec.short}: ` : ""}${applied} change(s) applied.`,
    applied,
    assumptions,
    trace,
  };
}

/** A specialist may only run tools that act for its discipline. */
function allowed(tool: Tool<any, any>, discipline: string): boolean {
  if (discipline === "all") return true;
  if (!tool.disciplines) return true;
  return tool.disciplines.includes(discipline as any);
}

/** Trim a result so a large element list does not swamp the context. */
function json(data: unknown): string {
  const s = JSON.stringify(data, null, 2);
  return s.length > 4000 ? `${s.slice(0, 4000)}\n… (truncated)` : s;
}
