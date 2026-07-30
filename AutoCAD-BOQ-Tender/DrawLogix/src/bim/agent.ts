import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/ai/model";
import { type SpecialistId, SPECIALISTS } from "./agents";
import { applyCommand, type Command } from "./commands";
import { type BimDocument, CATALOG, describe, type Discipline, DISCIPLINES } from "./model";

/**
 * DrawLogix BIM assistant — a multi-step, multi-discipline agent. It reads the model,
 * emits commands (the same ones the toolbar uses), sees the result, and continues until
 * the user's intent is met. Because it works across the whole CATALOG it can build and
 * edit Architectural, Structural, Civil, Electrical, Mechanical, Plumbing and Fire
 * elements — from voice or text. Returns the finished document + a short reply.
 */

const COMMAND_NAMES = ["add", "add_room", "add_level", "set_param", "move", "delete", "clear"] as const;
const VEC = { type: "object" as const, properties: { x: { type: "number" }, y: { type: "number" } } };

const APPLY: Anthropic.Tool = {
  name: "apply_commands",
  description:
    "Apply a batch of BIM commands to the model (metres; plan X east / Y north; Z up), then you will see the updated model and can continue. Use `add` with a `category` from the catalog for ANY element. For a quick room use add_room (makes 4 walls + floor + room). Doors/windows/MEP that host on a wall need the wall's `host` id — so add walls first, see their ids, THEN add hosted/placed items. Place lights/sprinklers/diffusers on ceilings, sockets/switches on walls, columns on a grid, footings under columns, etc.",
  input_schema: {
    type: "object",
    properties: {
      commands: {
        type: "array",
        description: "Commands to apply in order.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", enum: [...COMMAND_NAMES] },
            args: {
              type: "object",
              properties: {
                category: { type: "string", description: "Catalog category for `add` (e.g. wall, beam, column, light, socket, duct, sprinkler, road…)." },
                start: VEC,
                end: VEC,
                outline: { type: "array", items: VEC },
                at: VEC,
                host: { type: "string", description: "Host wall id (for doors/windows)." },
                offset: { type: "number" },
                sill: { type: "number" },
                rot: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                depth: { type: "number" },
                height: { type: "number" },
                thickness: { type: "number" },
                elevation: { type: "number" },
                wallThickness: { type: "number" },
                level: { type: "string" },
                id: { type: "string" },
                key: { type: "string" },
                value: {},
                dx: { type: "number" },
                dy: { type: "number" },
                name: { type: "string" },
              },
            },
          },
          required: ["name", "args"],
        },
      },
      done: { type: "boolean", description: "true if the request is now fully satisfied." },
      reply: { type: "string", description: "Short note on what you did (used when done)." },
    },
    required: ["commands"],
  },
};

function imageBlock(dataUrl: string): Anthropic.ImageBlockParam | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (!m) return null;
  const mediaType = (m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase()) as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  return { type: "image", source: { type: "base64", media_type: mediaType, data: m[2] } };
}

const catsOf = (d: Discipline) => Object.values(CATALOG).filter((c) => c.discipline === d).map((c) => c.category);

function catalogList(spec: SpecialistId): string {
  if (spec === "all") return DISCIPLINES.map((d) => `${d.label}: ${catsOf(d.id).join(", ")}`).join("\n");
  const own = DISCIPLINES.find((d) => d.id === spec);
  const others = DISCIPLINES.filter((d) => d.id !== spec).map((d) => d.label).join(", ");
  return `YOUR palette — ${own?.label ?? spec}: ${catsOf(spec as Discipline).join(", ")}\n(Other disciplines exist for coordination but you must NOT edit them: ${others}.)`;
}

/** Command scoping: a specialist may only add/edit its own discipline (+ general levels/grids). */
function allowedCommand(doc: BimDocument, cmd: Command, spec: SpecialistId): boolean {
  if (spec === "all") return true;
  const ok = (d: Discipline) => d === spec || d === "general";
  switch (cmd.name) {
    case "add": {
      const cat = CATALOG[(cmd.args as { category?: string }).category ?? ""];
      return !!cat && ok(cat.discipline);
    }
    case "add_room":
      return spec === "architectural";
    case "add_level":
      return true;
    case "clear":
      return false;
    case "set_param":
    case "move":
    case "delete": {
      const el = doc.elements[(cmd.args as { id?: string }).id ?? ""];
      return !!el && ok(el.discipline);
    }
    default:
      return false;
  }
}

function parseCommands(raw: unknown): Command[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c) => {
      const o = c as { name?: unknown; args?: unknown };
      const name = String(o.name ?? "");
      if (!(COMMAND_NAMES as readonly string[]).includes(name)) return null;
      return { name, args: (o.args ?? {}) as Record<string, unknown> } as unknown as Command;
    })
    .filter((c): c is Command => c !== null)
    .slice(0, 300);
}

export async function runBimAgent(
  doc: BimDocument,
  instruction: string,
  attachments: string[] = [],
  specialist: SpecialistId = "all",
): Promise<{ reply: string; doc: BimDocument; commandCount: number }> {
  const client = new Anthropic();
  const spec = SPECIALISTS[specialist] ?? SPECIALISTS.all;
  const system =
    "You are a DrawLogix BIM agent — an AI that builds and edits a real 3D building model by emitting commands via apply_commands, working step by step (place hosts first, then items that need their ids). Choose realistic dimensions, make professional assumptions when the brief is vague, coordinate with what already exists, and keep going until the request is met, then set done=true with a short reply.\n\n" +
    `ROLE: ${spec.system}\n` +
    (spec.id === "all" ? "" : "Commands that touch other disciplines are IGNORED — stay strictly within your remit.\n") +
    `\nCATALOG (category by discipline):\n${catalogList(spec.id)}`;

  let working = doc;
  const messages: Anthropic.MessageParam[] = [];
  const firstContent: Anthropic.ContentBlockParam[] = [{ type: "text", text: `${instruction || "Build something sensible."}\n\nCURRENT MODEL:\n${describe(working)}` }];
  for (const a of attachments) {
    const b = imageBlock(a);
    if (b) firstContent.push(b);
  }
  messages.push({ role: "user", content: firstContent });

  let reply = "Done.";
  let total = 0;
  for (let step = 0; step < 6; step++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools: [APPLY],
      tool_choice: step === 0 ? { type: "tool", name: "apply_commands" } : { type: "auto" },
      messages,
    });

    const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!tu) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
      if (text) reply = text;
      break;
    }

    const input = (tu.input ?? {}) as { commands?: unknown[]; done?: boolean; reply?: string };
    const cmds = parseCommands(input.commands);
    // Apply incrementally, scoped to the specialist's discipline (skips out-of-remit edits).
    let applied = 0;
    for (const c of cmds) {
      if (!allowedCommand(working, c, spec.id)) continue;
      const before = working;
      working = applyCommand(working, c);
      if (working !== before) applied += 1;
    }
    total += applied;
    if (input.reply) reply = String(input.reply);

    const skipped = cmds.length - applied;
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: tu.id, content: `Applied ${applied} command(s)${skipped > 0 && spec.id !== "all" ? ` (${skipped} ignored — outside your ${spec.short} remit)` : ""}. MODEL NOW:\n${describe(working)}\n\nContinue if more is needed for the request; otherwise stop and give a one-sentence summary.` }],
    });

    if (input.done) break;
  }

  return { reply, doc: working, commandCount: total };
}
