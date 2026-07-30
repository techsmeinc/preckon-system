// ─────────────────────────────────────────────────────────────────────────────
// The BIM drawing assistant — ported from DrawLogix/src/bim/agent.ts.
//
// A multi-step tool loop, not a one-shot completion. Claude calls
// `apply_commands`; Core applies them and hands back the updated model summary,
// so the next step can host a door on a wall it just created. That feedback is
// the whole trick — without it the agent is drawing blind and every reference to
// "the wall I just made" is a guess.
//
// Scoping: a specialist may only add its own discipline's categories and edit
// its own elements. Out-of-remit commands are dropped and reported rather than
// silently ignored, so an Electrical engineer asking for walls is told why it
// didn't happen. The Coordinator ("all") bypasses scoping.
//
// The worker holds the API key and has no database. It receives the model
// summary in the request and returns COMMANDS — Core applies and persists them.
// ─────────────────────────────────────────────────────────────────────────────

import { SPECIALISTS, type SpecialistId } from "./agents";
import type { CatalogItem, Element } from "./model";
import type { Command } from "./commands";

const MAX_STEPS = 6;

const SHARED_RULES = `You edit a BIM model by emitting COMMANDS. Never describe geometry in prose — emit commands.

COORDINATES: metres. Plan X east, Y north, Z up. Keep the model near the origin unless it already sits elsewhere.

COMMANDS you may emit:
  {"name":"add","args":{"category":"wall","start":{"x":0,"y":0},"end":{"x":8,"y":0},"level":"<levelId>"}}      linear
  {"name":"add","args":{"category":"floor","outline":[{"x":0,"y":0},{"x":8,"y":0},{"x":8,"y":6},{"x":0,"y":6}]}} area
  {"name":"add","args":{"category":"column","at":{"x":4,"y":3}}}                                                point
  {"name":"add","args":{"category":"door","host":"<wallId>","offset":2.5}}                                      hosted
  {"name":"add_room","args":{"x":0,"y":0,"width":8,"depth":6,"height":3}}     architect/coordinator only
  {"name":"add_level","args":{"name":"First Floor","elevation":3.5}}
  {"name":"set_param","args":{"id":"w3","key":"finish","value":"paint"}}
  {"name":"move","args":{"id":"c2","dx":1,"dy":0}}
  {"name":"delete","args":{"id":"c2"}}

RULES:
- Use ONLY categories from YOUR CATALOG below. An unknown category is dropped.
- Hosted items (doors, windows) need a real host wall id from the MODEL. Create the wall in an earlier step, read the returned model, then host on it.
- Build in dependency order and use several steps: structure/enclosure first, then what sits on it.
- Real dimensions. A room is 3-6 m across, a door 0.9 m, a corridor 1.2-1.5 m — not 100 m.
- Set "done": true when the instruction is satisfied, with a one-sentence "reply" saying what you built.
- Return ONLY the tool call. No prose outside it.`;

function catalogFor(catalog: CatalogItem[], specialist: SpecialistId) {
  const items: CatalogItem[] = specialist === "all" || specialist === "general"
    ? catalog
    : catalog.filter((c) => c.discipline === specialist);
  return items.map((c) => `${c.category} (${c.kind}) — ${c.label}`).join("\n");
}

/** A specialist may only touch its own discipline. */
function allowedCommand(cmd: any, specialist: SpecialistId, catalog: CatalogItem[], elements: Record<string, Element>) {
  if (specialist === "all" || specialist === "general") return true;
  const disciplineOf = (category: string) => catalog.find((c) => c.category === category)?.discipline;
  switch (cmd?.name) {
    case "add":
      return disciplineOf(cmd.args?.category) === specialist;
    case "add_room":
      return specialist === "architectural";
    case "add_level":
      return true;
    case "set_param":
    case "move":
    case "delete":
      return elements[cmd.args?.id]?.discipline === specialist;
    case "clear":
      return false;   // never let a specialist wipe the model
    default:
      return false;
  }
}

const TOOL = {
  name: "apply_commands",
  description: "Apply BIM commands to the model. Call repeatedly until the instruction is satisfied.",
  input_schema: {
    type: "object",
    properties: {
      commands: {
        type: "array",
        description: "Commands to apply in order.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, args: { type: "object" } },
          required: ["name", "args"],
        },
      },
      done: { type: "boolean", description: "True when the instruction is fully satisfied." },
      reply: { type: "string", description: "One sentence describing what you built." },
    },
    required: ["commands"],
  },
};

/**
 * Run the loop.
 *
 * @param apply  (commands) => { summary, applied } — Core applies to the real
 *               document and returns the refreshed summary. Keeping application
 *               on Core's side means the worker never holds project state.
 */
export interface BimAgentArgs {
  instruction: string;
  specialist: SpecialistId;
  summary: string;
  levelId?: string;
  catalog: CatalogItem[];
  elements: Record<string, Element>;
  /** Core applies the commands to the real document and returns the refreshed summary. */
  apply: (cmds: Command[]) => Promise<{ summary: string; applied: number; elements?: Record<string, Element> }>;
  model: string;
  callAnthropic: (req: { model: string; system: string; messages: any[]; tools: any[]; maxTokens: number }) => Promise<any>;
}

export async function runBimAgent({ instruction, specialist, summary, levelId, catalog, elements, apply, model, callAnthropic }: BimAgentArgs) {
  const spec = SPECIALISTS[specialist] ?? SPECIALISTS.all;
  const system = `${spec.system}\n\n${SHARED_RULES}\n\nYOUR CATALOG:\n${catalogFor(catalog, specialist)}`;

  const messages: any[] = [{
    role: "user",
    content: `INSTRUCTION: ${instruction}\n\nDEFAULT LEVEL ID: ${levelId ?? "(none — call add_level first)"}\n\nCURRENT MODEL:\n${summary}`,
  }];

  let totalApplied = 0, totalDropped = 0, reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callAnthropic({ model, system, messages, tools: [TOOL], maxTokens: 2500 });
    const toolUse = (res.content ?? []).find((c: any) => c.type === "tool_use");
    const text = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();

    if (!toolUse) { reply = text || reply; break; }

    const raw = Array.isArray(toolUse.input?.commands) ? toolUse.input.commands : [];
    const ok = raw.filter((c: any) => allowedCommand(c, specialist, catalog, elements));
    const dropped = raw.length - ok.length;
    totalDropped += dropped;

    const { summary: nextSummary, applied, elements: nextElements } = await apply(ok);
    totalApplied += applied;
    if (nextElements) elements = nextElements;

    if (toolUse.input?.reply) reply = toolUse.input.reply;

    // Feed the real, updated model back so the next step can reference what it
    // just created — the same loop DrawLogix uses.
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Applied ${applied} command(s).${dropped ? ` ${dropped} ignored — outside your ${spec.short} remit.` : ""}\n\nMODEL NOW:\n${nextSummary}`,
      }],
    });

    if (toolUse.input?.done) break;
  }

  return {
    applied: totalApplied,
    dropped: totalDropped,
    reply: reply || `${spec.short}: applied ${totalApplied} command(s).`,
  };
}
