import { useCallback, useSyncExternalStore } from "react";

export type Provider = "openai" | "ollama" | "openrouter" | "groq" | "anthropic";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
// Old default — silently migrate users away from the dead VPS on next load.
const LEGACY_VPS_OLLAMA_URL = "http://74.208.182.201:11434";

export interface ModelPreference {
  provider: Provider;
  model: string;
  ollamaUrl: string;
  openrouterKey: string;
  groqKey: string;
  anthropicKey: string;
}

const STORAGE_KEY = "boq_model_preference";

const DEFAULTS: ModelPreference = {
  provider: "ollama",
  // llama3.2:3b is too weak for the multi-agent BOQ JSON schema — it routinely
  // echoes the schema placeholders. Default to qwen2.5:14b which has been
  // validated against the AIGCC exemplar prompts.
  model: "qwen2.5:14b",
  ollamaUrl: DEFAULT_OLLAMA_URL,
  openrouterKey: "",
  groqKey: "",
  anthropicKey: "",
};

function load(): ModelPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = { ...DEFAULTS, ...JSON.parse(raw) } as ModelPreference;
      // Auto-migrate anyone whose preference still points at the unreachable
      // VPS — silently bump them back to localhost on next page load.
      if (stored.ollamaUrl === LEGACY_VPS_OLLAMA_URL) {
        stored.ollamaUrl = DEFAULT_OLLAMA_URL;
      }
      return stored;
    }
  } catch {}
  return DEFAULTS;
}

// Module-level shared store. Plain `useState` gave every component its own
// copy of the preference, synced only via localStorage on the next mount — so
// picking a model in the header dropdown didn't reach an already-mounted
// project page, which then generated with the STALE provider (e.g. it kept
// sending "openrouter" after you'd switched to Anthropic). A tiny external
// store keeps every mounted component in lockstep within the tab.
let store: ModelPreference = load();
const listeners = new Set<() => void>();

function getSnapshot(): ModelPreference {
  return store;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setPrefGlobal(updates: Partial<ModelPreference>) {
  store = { ...store, ...updates };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  for (const l of listeners) l();
}

export function useModelPreference() {
  const pref = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPref = useCallback((updates: Partial<ModelPreference>) => {
    setPrefGlobal(updates);
  }, []);

  const providerConfig = {
    ollamaUrl: pref.ollamaUrl,
    openrouterKey: pref.openrouterKey,
    groqKey: pref.groqKey,
    anthropicKey: pref.anthropicKey,
  };

  return { pref, setPref, providerConfig };
}
