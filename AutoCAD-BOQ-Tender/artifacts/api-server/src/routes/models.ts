import { Router } from "express";
import { getAIClient, OPENAI_MODELS, OPENROUTER_MODELS, GROQ_MODELS, ANTHROPIC_MODELS, type Provider, type ProviderConfig } from "../lib/ai-provider";

const router = Router();
const DEFAULT_OLLAMA_URL = "http://74.208.182.201:11434";

// GET /models?provider=ollama&ollamaUrl=...&openrouterKey=...&groqKey=...
router.get("/models", async (req, res) => {
  const provider = (req.query.provider as Provider) ?? "openai";
  const config: ProviderConfig = {
    ollamaUrl: req.query.ollamaUrl as string | undefined,
    openrouterKey: req.query.openrouterKey as string | undefined,
    groqKey: req.query.groqKey as string | undefined,
    anthropicKey: req.query.anthropicKey as string | undefined,
  };

  try {
    if (provider === "openai") {
      res.json({ provider: "openai", models: OPENAI_MODELS });
      return;
    }

    if (provider === "anthropic") {
      // Static catalog — the Anthropic key lives client-side / in the server
      // env and is only exercised when a BOQ run actually fires, so we don't
      // probe it here (mirrors how OpenAI/OpenRouter return a static list).
      res.json({ provider: "anthropic", models: ANTHROPIC_MODELS });
      return;
    }

    if (provider === "openrouter") {
      res.json({ provider: "openrouter", models: OPENROUTER_MODELS });
      return;
    }

    if (provider === "groq") {
      const key = config.groqKey ?? process.env.GROQ_API_KEY;
      if (!key) {
        res.json({ provider: "groq", models: GROQ_MODELS, connected: false });
        return;
      }
      try {
        const response = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Groq returned ${response.status}`);
        const data = await response.json() as { data?: Array<{ id: string; context_window?: number; active?: boolean }> };
        const models = (data.data ?? [])
          .filter(m => m.active !== false)
          .map(m => ({
            id: m.id,
            name: m.id,
            contextWindow: m.context_window ? `${Math.round(m.context_window / 1024)}K` : undefined,
          }));
        res.json({ provider: "groq", models: models.length ? models : GROQ_MODELS, connected: true });
      } catch {
        res.json({ provider: "groq", models: GROQ_MODELS, connected: false, error: "Could not reach Groq. Check your API key." });
      }
      return;
    }

    if (provider === "ollama") {
      const base = (config.ollamaUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
      try {
        const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Ollama not reachable");
        const data = await response.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
        const models = (data.models ?? []).map(m => ({
          id: m.name,
          name: m.name,
          contextWindow: m.details?.parameter_size ?? "unknown",
        }));
        res.json({ provider: "ollama", models, connected: true });
      } catch {
        res.json({
          provider: "ollama",
          models: [],
          connected: false,
          error: "Cannot connect to Ollama. Make sure it's running and the URL is correct.",
        });
      }
      return;
    }

    res.status(400).json({ error: "Unknown provider" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
