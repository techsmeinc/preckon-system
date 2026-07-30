import OpenAI from "openai";
import { createAnthropicClient } from "./anthropic-adapter";

export type Provider = "openai" | "ollama" | "openrouter" | "groq" | "anthropic";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface ProviderConfig {
  ollamaUrl?: string;
  openrouterKey?: string;
  groqKey?: string;
  anthropicKey?: string;
}

/**
 * The minimal client surface the BOQ pipeline actually calls. Both the real
 * OpenAI SDK client and the Anthropic adapter (see anthropic-adapter.ts)
 * structurally satisfy it, so `getAIClient` can return either transparently.
 * Signatures are deliberately permissive (`any`) because the OpenAI SDK's
 * `create`/`list` are heavily overloaded and would not otherwise be assignable.
 */
export interface AIClient {
  chat: {
    completions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create(body: any, options?: any): Promise<any>;
    };
  };
  models: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list(options?: any): Promise<any>;
  };
}

// Per-request timeout. The OpenAI SDK default is 10 minutes, which masks
// hangs — a stuck specialist sits there for ages before erroring. 3 minutes
// is long enough for slow models on large prompts but short enough that a
// dead connection surfaces quickly. Ollama gets longer because local models
// on CPU can legitimately take 5+ minutes per call.
const DEFAULT_TIMEOUT_MS = 180_000;
const OLLAMA_TIMEOUT_MS = 600_000;
// Retried on 429/5xx (incl. Anthropic's 529 "overloaded") with exponential
// backoff by the underlying SDK. 5 rides out most transient provider overload.
const DEFAULT_MAX_RETRIES = 5;

export function getAIClient(provider: Provider, config?: ProviderConfig): AIClient {
  if (provider === "anthropic") {
    const key = config?.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    if (!key) {
      throw new Error(
        "Anthropic API key not configured. Add it in Settings (or set ANTHROPIC_API_KEY on the API server). Get one at https://console.anthropic.com/settings/keys."
      );
    }
    return createAnthropicClient(key);
  }

  if (provider === "openrouter") {
    const key = config?.openrouterKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!key) {
      throw new Error(
        "OpenRouter API key not configured. Go to Settings and add your OpenRouter API key (free at openrouter.ai/keys)."
      );
    }
    return new OpenAI({
      apiKey: key,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "X-Title": "BOQ Intelligence Platform",
      },
      timeout: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
  }

  if (provider === "groq") {
    const key = config?.groqKey ?? process.env.GROQ_API_KEY ?? "";
    if (!key) {
      throw new Error(
        "Groq API key not configured. Go to Settings and add your Groq API key (free at console.groq.com/keys)."
      );
    }
    return new OpenAI({
      apiKey: key,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
  }

  if (provider === "ollama") {
    const base = (config?.ollamaUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
    if (!base) throw new Error("Ollama URL not configured. Go to Settings to set your Ollama server URL.");
    return new OpenAI({
      apiKey: "ollama",
      baseURL: `${base}/v1`,
      timeout: OLLAMA_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
  }

  // Default: OpenAI
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY not set. Either set it in the server env or pick a different provider (Ollama, Groq, OpenRouter) in the model dropdown."
    );
  }
  return new OpenAI({
    apiKey: key,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  });
}

/**
 * Models we know fail the multi-agent structured-JSON + tool-calling workflow.
 * The pipeline emits a warning when one of these is selected, and (via
 * pickCapableOllamaModel) will silently swap to a capable model if one is
 * available on the same Ollama server.
 */
const WEAK_OLLAMA_PATTERNS: RegExp[] = [
  /^llama3\.2:1b/i, /^llama3\.2:3b/i, /^llama3:8b/i,
  /^mistral:7b/i, /^gemma:2b/i, /^gemma:7b/i,
  /^phi3:mini/i, /^phi3:3\.8b/i, /^tinyllama/i,
];

/** Ordered preference: pick the first one that's installed locally. */
const PREFERRED_CAPABLE_MODELS = [
  "qwen2.5:32b", "qwen2.5:14b", "qwen2.5:7b",
  "llama3.1:70b", "llama3.1:8b",
  "mixtral:8x7b", "mistral-nemo",
];

export function isWeakOllamaModel(model: string): boolean {
  return WEAK_OLLAMA_PATTERNS.some(re => re.test(model));
}

/**
 * Probe an Ollama server's /api/tags and return the first PREFERRED_CAPABLE_MODELS
 * entry that's installed. Returns null on connection failure or when no preferred
 * model is present. Used to silently upgrade users away from llama3.2:3b without
 * forcing them to touch Settings.
 */
export async function pickCapableOllamaModel(baseUrl: string, timeoutMs = 4_000): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { models?: Array<{ name: string }> };
    const installed = new Set((body.models ?? []).map(m => m.name));
    for (const candidate of PREFERRED_CAPABLE_MODELS) {
      if (installed.has(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe an Ollama server for the first locally-installed vision-language
 * model. Used by the multimodal pre-pass. Returns null if none of the known
 * vision tags are pulled or the server is unreachable.
 */
// Ordered smallest-fits-first. Larger VLMs (7B+) need ~13GB to run; many
// laptop GPUs (6GB VRAM) can't fit them and Ollama OOMs on CPU fallback.
// Prefer 3B-class models when both are installed — they fit comfortably on
// most machines and are still useful for extracting BOQ-relevant content.
// Users on workstations who want the 7B can `ollama rm qwen2.5vl:3b`.
const PREFERRED_VISION_MODELS = [
  "moondream", "moondream:latest",                       // ~1.8B, ~2GB — smallest competent VLM
  "llava-phi3:3.8b", "llava-phi3",                       // ~3.8B, ~3GB — small llava variant
  "qwen2.5vl:3b",                                        // ~3B, ~3GB — recommended for 6GB VRAM
  "minicpm-v:8b", "minicpm-v",                           // ~8B, ~5GB — strong on docs/OCR
  "llava-llama3:8b",                                     // ~8B, ~5GB
  "llava:7b", "llava:13b", "llava:34b",                  // classic llava family
  "qwen2.5vl:7b", "qwen2.5vl:32b",                       // bigger qwen vision — workstations only
  "bakllava",
];

export async function pickVisionOllamaModel(baseUrl: string, timeoutMs = 4_000): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { models?: Array<{ name: string }> };
    const installed = new Set((body.models ?? []).map(m => m.name));
    for (const candidate of PREFERRED_VISION_MODELS) {
      if (installed.has(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

export const ANTHROPIC_MODELS = [
  // Direct Anthropic API (official @anthropic-ai/sdk). Opus 4.8 is the
  // recommended default for BOQ generation — best SOW→quantity reasoning,
  // most reliable tool-calling, 1M context, native vision for the pre-pass.
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Recommended)", contextWindow: "1M" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Faster / Cheaper)", contextWindow: "1M" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Fastest)", contextWindow: "200K" },
];

export const OPENAI_MODELS = [
  { id: "gpt-5.1", name: "GPT-5.1 (Latest)", contextWindow: "1M" },
  { id: "gpt-4.1", name: "GPT-4.1", contextWindow: "1M" },
  { id: "gpt-4o", name: "GPT-4o", contextWindow: "128K" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini (Fast)", contextWindow: "128K" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (Fast)", contextWindow: "1M" },
];

export const OPENROUTER_MODELS = [
  // Strong free models (capable of tool calling + JSON output for BOQ work).
  // OpenRouter free tier: 50 req/day across all :free models (1000/day if you
  // have ever deposited $10). For a 150+ call BOQ run, prefer Groq's free tier.
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)", contextWindow: "128K" },
  { id: "qwen/qwen-2.5-72b-instruct:free", name: "Qwen 2.5 72B (Free)", contextWindow: "128K" },
  { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (Free)", contextWindow: "64K" },
  { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash Experimental (Free)", contextWindow: "1M" },
  // Weak free models — kept for completeness but not recommended for BOQ work.
  { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (Free)", contextWindow: "128K" },
  { id: "mistralai/mistral-7b-instruct:free", name: "Mistral 7B (Free)", contextWindow: "32K" },
  { id: "google/gemini-flash-1.5", name: "Gemini 1.5 Flash (Free)", contextWindow: "1M" },
  // Paid models — recommended for production BOQ runs.
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", contextWindow: "200K" },
  { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku (Fast)", contextWindow: "200K" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", contextWindow: "1M" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", contextWindow: "64K" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: "128K" },
  { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: "128K" },
  { id: "mistralai/mixtral-8x7b-instruct", name: "Mixtral 8x7B", contextWindow: "32K" },
];

// Groq's free tier (rate-limited). Static fallback; live list is fetched when a key is provided.
export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Versatile)", contextWindow: "128K" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Instant)", contextWindow: "128K" },
  { id: "llama3-70b-8192", name: "Llama 3 70B", contextWindow: "8K" },
  { id: "llama3-8b-8192", name: "Llama 3 8B", contextWindow: "8K" },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: "32K" },
  { id: "gemma2-9b-it", name: "Gemma 2 9B", contextWindow: "8K" },
];
