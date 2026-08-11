/**
 * agentic-loop — a tool-using ReAct loop over the Anthropic Messages API.
 *
 * Ported from AutoCAD-BOQ-Tender/artifacts/api-server/src/lib/agentic-loop.ts.
 * That version speaks the OpenAI chat-completions shape (`tool_calls`, and a
 * `role: "tool"` message per result). Anthropic's Messages API is different in
 * two ways that matter, and getting either wrong silently degrades the loop
 * into a single-shot call:
 *
 *   - a tool request arrives as a `tool_use` CONTENT BLOCK on the assistant
 *     message, with `stop_reason: "tool_use"` — not as a separate field;
 *   - every result goes back as `tool_result` blocks inside ONE user message.
 *     Splitting them across several messages trains the model to stop asking
 *     for tools in parallel, which is exactly the behaviour a take-off needs.
 *
 * Pure orchestration — knows nothing about BOQ.
 */

const API = "https://api.anthropic.com/v1/messages";

/** Individual tool results are capped so one chatty layer can't eat the window. */
const MAX_TOOL_RESULT_CHARS = 12_000;

async function post(body) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}


/**
 * Mark a system prompt as cacheable.
 *
 * The stage briefs here are long and identical across calls — HOUSE_RULES, the
 * estimating knowledge, the exemplar bills, the rate book. The BOQ roster alone
 * re-sends all of it once per specialist per turn, and every one of those was
 * being charged and re-read from scratch.
 *
 * A cache breakpoint on the system block means the first call pays for it and
 * the rest of the run reads it back. Nothing about the answer changes; the same
 * bytes are sent, and the model sees exactly the same prompt.
 *
 * Below the threshold it is not worth a breakpoint — short prompts do not reach
 * the minimum cacheable length, and the marker would just be noise in the
 * request. Returned as a plain string in that case, which is what the API
 * expects anyway.
 */
const CACHEABLE_CHARS = 4000;
function cacheableSystem(system) {
  const text = typeof system === "string" ? system : String(system ?? "");
  if (text.length < CACHEABLE_CHARS) return text;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

const textOf = (content) =>
  (content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

/**
 * Run the loop until the model answers without asking for a tool.
 *
 * @returns {{content:string, iterations:number, toolCallsMade:number, hitCap:boolean}}
 */
export async function runAgenticLoop({
  model,
  system,
  user,
  toolbox,
  maxTokens = 8000,
  iterCap = 6,
  onToolCall,
}) {
  const messages = [{ role: "user", content: user }];
  let toolCallsMade = 0;

  for (let i = 0; i < iterCap; i++) {
    const response = await post({
      model,
      max_tokens: maxTokens,
      // Cached: the loop re-sends this brief on every iteration, and a six-turn
      // tool conversation was paying for the same thousands of tokens six times.
      system: cacheableSystem(system),
      messages,
      tools: toolbox.toolDefinitions,
    });

    const content = response.content ?? [];
    messages.push({ role: "assistant", content });

    const calls = content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      return { content: textOf(content), iterations: i + 1, toolCallsMade, hitCap: false };
    }

    // All results for this turn travel back in a single user message.
    const results = [];
    for (const call of calls) {
      const handler = toolbox.handlers[call.name];
      let payload;
      let ok = true;
      if (!handler) {
        ok = false;
        payload = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          payload = await handler(call.input ?? {});
        } catch (err) {
          ok = false;
          payload = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      toolCallsMade++;
      onToolCall?.(call.name, call.input ?? {}, ok);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS),
        // A failed tool must come back as an error result rather than be dropped:
        // the model can then choose a different layer or admit it cannot measure,
        // instead of inventing a number to fill the silence.
        ...(ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }

  // Cap reached. Force a final answer rather than returning whatever half-turn
  // we happen to be holding — an empty response here would be indistinguishable
  // from "this division has no scope", and would quietly drop a whole trade.
  messages.push({
    role: "user",
    content: "You have reached the tool-use limit. Produce your final JSON output now, using what you have already measured. Do not call any more tools.",
  });
  const final = await post({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    tools: toolbox.toolDefinitions,
    tool_choice: { type: "none" },
  });
  return { content: textOf(final.content), iterations: iterCap, toolCallsMade, hitCap: true };
}
