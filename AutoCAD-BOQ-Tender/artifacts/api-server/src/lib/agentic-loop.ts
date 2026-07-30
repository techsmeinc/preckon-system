import type OpenAI from "openai";
import type { CadToolbox } from "./cad-tools";
import type { AIClient } from "./ai-provider";

// Tool-using ReAct-style loop. Pure orchestration — knows nothing about BOQ.
//
// The loop terminates when the model produces a message with no tool_calls, or
// when iterCap is reached. On iteration cap, we send one final turn with
// tool_choice: "none" to force a textual answer.
//
// If the provider rejects the tools field (some non-OpenAI compat servers
// 400 on it), the caller's onToolUseUnsupported hook fires and the loop
// falls back to a single non-tool call with the same messages. This keeps
// the pipeline working across providers — the specialist just won't be able
// to retrieve extra CAD context, only what was pre-seeded into the prompt.

// Import OpenAI's non-streaming chat-completion shapes. The `create` method
// returns a union of streaming/non-streaming results depending on its args, so
// we'd otherwise lose the `choices` property in the inferred type.
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatMessage = ChatCompletion["choices"][number]["message"];
type ToolCall = NonNullable<ChatMessage["tool_calls"]>[number];
type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgenticLoopOptions {
  client: AIClient;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  toolbox: CadToolbox;
  iterCap?: number;
  onToolUseUnsupported?: (err: unknown) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, ok: boolean) => void;
}

export interface AgenticLoopResult {
  content: string;
  iterations: number;
  toolCallsMade: number;
  fellBackToNoTools: boolean;
}

function isToolUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("tool") &&
    (m.includes("not supported") ||
      m.includes("does not support") ||
      m.includes("unsupported") ||
      m.includes("invalid") ||
      m.includes("400"))
  );
}

export async function runAgenticLoop(opts: AgenticLoopOptions): Promise<AgenticLoopResult> {
  const { client, model, systemPrompt, userPrompt, toolbox } = opts;
  const iterCap = opts.iterCap ?? 6;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let toolCallsMade = 0;
  let fellBackToNoTools = false;

  for (let i = 0; i < iterCap; i++) {
    let response: ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages: messages as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
        tools: toolbox.toolDefinitions,
        tool_choice: "auto",
      });
    } catch (err) {
      if (isToolUnsupportedError(err)) {
        opts.onToolUseUnsupported?.(err);
        fellBackToNoTools = true;
        // Single, no-tools call with the same messages we've built so far
        const fallback = await client.chat.completions.create({
          model,
          messages: messages as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
        });
        return {
          content: fallback.choices[0]?.message?.content ?? "",
          iterations: i + 1,
          toolCallsMade,
          fellBackToNoTools: true,
        };
      }
      throw err;
    }

    const msg = response.choices[0]?.message;
    if (!msg) return { content: "", iterations: i + 1, toolCallsMade, fellBackToNoTools };

    const toolCalls = msg.tool_calls ?? [];
    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) {
      return { content: msg.content ?? "", iterations: i + 1, toolCallsMade, fellBackToNoTools };
    }

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const fname = call.function.name;
      const handler = toolbox.handlers[fname];
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      let result: unknown;
      let ok = true;
      if (!handler) {
        ok = false;
        result = { error: `Unknown tool: ${fname}` };
      } else {
        try {
          result = await handler(args);
        } catch (err) {
          ok = false;
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      toolCallsMade++;
      opts.onToolCall?.(fname, args, ok);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000), // cap individual tool result size
      });
    }
  }

  // Iteration cap reached — force a final answer.
  messages.push({
    role: "user",
    content: "You've reached the tool-use limit. Now produce your final BOQ JSON output. Do not call any more tools.",
  });
  const finalResponse = await client.chat.completions.create({
    model,
    messages: messages as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
    tool_choice: "none",
  });
  return {
    content: finalResponse.choices[0]?.message?.content ?? "",
    iterations: iterCap,
    toolCallsMade,
    fellBackToNoTools,
  };
}
