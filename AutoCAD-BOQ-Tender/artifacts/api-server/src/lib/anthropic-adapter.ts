/**
 * Anthropic → OpenAI-shape adapter.
 *
 * The whole pipeline (agentic loop, SOW outline extractor, agent designer,
 * section specialists, completeness verifier, vision pre-pass) speaks the
 * OpenAI `chat.completions.create` / `models.list` surface. Rather than
 * rewrite every call site, this adapter exposes that exact subset but
 * translates each call to/from the OFFICIAL Anthropic Messages API via
 * `@anthropic-ai/sdk`. No OpenAI-compatible shim, no proxy — the real SDK.
 *
 * What it translates:
 *   • OpenAI `messages[]` (system / user / assistant+tool_calls / tool)  ⇄
 *     Anthropic `system` + `messages[]` (text / image / tool_use / tool_result)
 *   • OpenAI `tools` (`{type:"function", function:{...}}`)               →
 *     Anthropic `tools` (`{name, description, input_schema}`)
 *   • OpenAI `tool_choice` ("auto" | "none" | "required" | {type:"function"}) →
 *     Anthropic `tool_choice` ({type:"auto" | "any" | "tool"})
 *   • OpenAI vision content (`image_url` data: URLs)                     →
 *     Anthropic image blocks (base64 / url source)
 *   • streaming (`stream:true`) for the chat-assistant SSE route
 *
 * Notes:
 *   • Opus 4.8 / Sonnet 4.6 REMOVED `temperature`/`top_p`/`top_k` (they 400),
 *     so those params are silently dropped here.
 *   • `max_tokens` is mandatory on Anthropic — defaults to 16000 when the
 *     caller omits it (the agentic loop does).
 *   • Extended/adaptive thinking is intentionally left OFF: the pipeline's
 *     prompts demand strict raw-JSON / bullet-only output (which doubles as a
 *     final-answer-only instruction), and several calls run on tight
 *     max_tokens (verifier 1500, vision 1500) where thinking tokens would risk
 *     truncating the answer. Opus 4.8 produces excellent structured JSON
 *     without it.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AIClient } from "./ai-provider";

const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 180_000;
// Anthropic returns 529 "overloaded_error" under fleet load; the SDK retries
// 429/5xx (incl. 529) with exponential backoff + jitter. 5 retries spans a long
// enough window (~tens of seconds) to ride out most transient overload spikes.
const DEFAULT_MAX_RETRIES = 5;

// ── Loose mirrors of the OpenAI request shapes we actually receive ──────────
interface OAIContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}
interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OAIContentPart[] | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
interface OAITool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

// ── Translation helpers ─────────────────────────────────────────────────────

function dataUrlToImageBlock(url: string): Record<string, unknown> {
  // Sidecar sends `data:image/png;base64,<...>`; also accept a bare https URL.
  const m = /^data:(.+?);base64,(.*)$/s.exec(url);
  if (m) {
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }
  return { type: "image", source: { type: "url", url } };
}

function toAnthropicUserContent(content: string | OAIContentPart[] | null): string | Record<string, unknown>[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const blocks: Record<string, unknown>[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      blocks.push(dataUrlToImageBlock(part.image_url.url));
    }
  }
  return blocks.length > 0 ? blocks : "";
}

function partsToText(content: string | OAIContentPart[] | null): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text" && p.text).map(p => p.text).join("\n");
}

interface TranslatedMessages {
  system: string;
  messages: Record<string, unknown>[];
}

/**
 * Walk the OpenAI message list and produce Anthropic `system` + `messages`.
 * Two structural conversions matter:
 *   • assistant `tool_calls` become `tool_use` content blocks
 *   • consecutive `tool` messages collapse into ONE user turn carrying
 *     multiple `tool_result` blocks (Anthropic requires tool results grouped
 *     in the user turn that follows the assistant's tool_use)
 */
function translateMessages(raw: OAIMessage[]): TranslatedMessages {
  const systemChunks: string[] = [];
  const messages: Record<string, unknown>[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      messages.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of raw) {
    if (m.role === "system") {
      flushToolResults();
      const txt = partsToText(m.content);
      if (txt) systemChunks.push(txt);
      continue;
    }

    if (m.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      });
      continue;
    }

    flushToolResults();

    if (m.role === "user") {
      messages.push({ role: "user", content: toAnthropicUserContent(m.content) });
      continue;
    }

    // assistant
    const blocks: Record<string, unknown>[] = [];
    const txt = partsToText(m.content);
    if (txt.trim()) blocks.push({ type: "text", text: txt });
    for (const tc of m.tool_calls ?? []) {
      let input: unknown = {};
      try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }
      blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
    // Anthropic rejects an assistant turn with empty content.
    if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
  }

  flushToolResults();
  return { system: systemChunks.join("\n\n"), messages };
}

function toAnthropicTools(tools?: OAITool[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const mapped = tools
    .filter(t => t.type === "function" && t.function?.name)
    .map(t => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  return mapped.length > 0 ? mapped : undefined;
}

function toAnthropicToolChoice(tc: unknown): Record<string, unknown> | undefined {
  if (tc === "required" || tc === "any") return { type: "any" };
  if (tc && typeof tc === "object") {
    const obj = tc as { type?: string; function?: { name?: string } };
    if (obj.type === "function" && obj.function?.name) return { type: "tool", name: obj.function.name };
  }
  return { type: "auto" };
}

// ── Response mapping ────────────────────────────────────────────────────────

function anthropicToOpenAICompletion(resp: Anthropic.Message): {
  choices: Array<{ index: number; finish_reason: string; message: { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> } }>;
} {
  let text = "";
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  for (const block of resp.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const finish = resp.stop_reason === "tool_use"
    ? "tool_calls"
    : resp.stop_reason === "max_tokens"
      ? "length"
      : "stop";
  return {
    choices: [{
      index: 0,
      finish_reason: finish,
      message: {
        role: "assistant",
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    }],
  };
}

// ── Param builder ───────────────────────────────────────────────────────────

function buildCreateParams(body: Record<string, unknown>): Record<string, unknown> {
  const { system, messages } = translateMessages((body.messages as OAIMessage[]) ?? []);
  // tool_choice "none" → force a text answer by withholding the tool set
  // entirely (Anthropic does not require tools to be re-declared to keep prior
  // tool_use/tool_result blocks valid in history).
  const forceNoTools = body.tool_choice === "none";
  const tools = forceNoTools ? undefined : toAnthropicTools(body.tools as OAITool[] | undefined);

  const params: Record<string, unknown> = {
    model: body.model,
    max_tokens: (body.max_tokens as number | undefined) ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  if (system) params.system = system;
  if (tools) {
    params.tools = tools;
    params.tool_choice = toAnthropicToolChoice(body.tool_choice);
  }
  return params;
}

// ── Streaming (for the chat-assistant SSE route) ────────────────────────────

async function* streamAsOpenAIChunks(
  client: Anthropic,
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
): AsyncGenerator<{ choices: Array<{ index: number; delta: { content?: string }; finish_reason: string | null }> }> {
  const stream = client.messages.stream(params as unknown as Anthropic.MessageStreamParams, options as Anthropic.RequestOptions);
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }] };
    }
  }
  yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
}

/**
 * Build an object that satisfies the subset of the OpenAI client surface the
 * codebase calls (`chat.completions.create`, `models.list`), backed by the
 * real Anthropic SDK.
 */
export function createAnthropicClient(apiKey: string): AIClient {
  const client = new Anthropic({
    apiKey,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  });

  return {
    chat: {
      completions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async create(body: any, options?: any): Promise<any> {
          const params = buildCreateParams(body);
          if (body?.stream) {
            return streamAsOpenAIChunks(client, params, options);
          }
          const resp = await client.messages.create(
            params as unknown as Anthropic.MessageCreateParamsNonStreaming,
            options as Anthropic.RequestOptions,
          );
          return anthropicToOpenAICompletion(resp);
        },
      },
    },
    models: {
      // The pipeline uses this purely as a reachability probe. Anthropic's
      // list() takes (query, options); the OpenAI callers pass `{timeout}` as
      // the first arg, so forward it as request options.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async list(options?: any): Promise<any> {
        return client.models.list(undefined, options as Anthropic.RequestOptions);
      },
    },
  };
}
