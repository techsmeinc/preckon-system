import { useState, useEffect } from "react";
import { Bot, ChevronDown, Loader2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModelPreference, type Provider } from "@/hooks/use-model-preference";

interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: string;
}

interface ModelsResponse {
  provider: string;
  models: ModelInfo[];
  connected?: boolean;
  error?: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  ollama: "Ollama (Local)",
  openrouter: "OpenRouter",
  groq: "Groq",
  anthropic: "Anthropic (Claude)",
};

const PROVIDER_COLORS: Record<Provider, string> = {
  openai: "text-emerald-400",
  ollama: "text-blue-400",
  openrouter: "text-purple-400",
  groq: "text-orange-400",
  anthropic: "text-amber-400",
};

export function ModelSelector() {
  const { pref, setPref, providerConfig } = useModelPreference();
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelInfo[]>>({});
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [groqConnected, setGroqConnected] = useState<boolean | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const fetchModels = async (provider: Provider) => {
    setLoadingProvider(provider);
    try {
      const params = new URLSearchParams({ provider });
      if (provider === "ollama" && providerConfig.ollamaUrl) {
        params.set("ollamaUrl", providerConfig.ollamaUrl);
      }
      if (provider === "openrouter" && providerConfig.openrouterKey) {
        params.set("openrouterKey", providerConfig.openrouterKey);
      }
      if (provider === "groq" && providerConfig.groqKey) {
        params.set("groqKey", providerConfig.groqKey);
      }
      if (provider === "anthropic" && providerConfig.anthropicKey) {
        params.set("anthropicKey", providerConfig.anthropicKey);
      }
      const res = await fetch(`/api/models?${params}`);
      const data: ModelsResponse = await res.json();
      setModelsByProvider(prev => ({ ...prev, [provider]: data.models }));
      if (provider === "ollama") {
        setOllamaConnected(data.connected ?? false);
      }
      if (provider === "groq") {
        setGroqConnected(data.connected ?? false);
      }
    } catch {
      if (provider === "ollama") setOllamaConnected(false);
      if (provider === "groq") setGroqConnected(false);
    } finally {
      setLoadingProvider(null);
    }
  };

  useEffect(() => {
    fetchModels("anthropic");
    fetchModels("openai");
    fetchModels("openrouter");
    fetchModels("groq");
    fetchModels("ollama");
  }, []);

  const currentModels = modelsByProvider[pref.provider] ?? [];
  const currentModelName = currentModels.find(m => m.id === pref.model)?.name ?? pref.model;

  const handleSelectModel = (provider: Provider, modelId: string) => {
    setPref({ provider, model: modelId });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium">
          <Bot className="h-3.5 w-3.5" />
          <span className={PROVIDER_COLORS[pref.provider]}>
            {PROVIDER_LABELS[pref.provider]}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="max-w-[120px] truncate">{currentModelName}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">

        {/* Anthropic (Claude) — recommended for BOQ generation */}
        <DropdownMenuLabel className="flex items-center gap-2 text-amber-400">
          <span>Anthropic (Claude)</span>
          {loadingProvider === "anthropic" && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="ml-auto text-xs text-muted-foreground font-normal">Recommended</span>
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {(modelsByProvider["anthropic"] ?? []).map(m => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => handleSelectModel("anthropic", m.id)}
              className={pref.provider === "anthropic" && pref.model === m.id ? "bg-accent/20 font-medium" : ""}
            >
              <div className="flex flex-col w-full">
                <span>{m.name}</span>
                {m.contextWindow && <span className="text-xs text-muted-foreground">Context: {m.contextWindow}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* OpenAI */}
        <DropdownMenuLabel className="flex items-center gap-2 text-emerald-400">
          <span>OpenAI</span>
          {loadingProvider === "openai" && <Loader2 className="h-3 w-3 animate-spin" />}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {(modelsByProvider["openai"] ?? []).map(m => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => handleSelectModel("openai", m.id)}
              className={pref.provider === "openai" && pref.model === m.id ? "bg-accent/20 font-medium" : ""}
            >
              <div className="flex flex-col w-full">
                <span>{m.name}</span>
                {m.contextWindow && <span className="text-xs text-muted-foreground">Context: {m.contextWindow}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* OpenRouter */}
        <DropdownMenuLabel className="flex items-center gap-2 text-purple-400">
          <span>OpenRouter</span>
          {loadingProvider === "openrouter" && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="ml-auto text-xs text-muted-foreground font-normal">100+ models</span>
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {(modelsByProvider["openrouter"] ?? []).map(m => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => handleSelectModel("openrouter", m.id)}
              className={pref.provider === "openrouter" && pref.model === m.id ? "bg-accent/20 font-medium" : ""}
            >
              <div className="flex flex-col w-full">
                <span>{m.name}</span>
                {m.contextWindow && <span className="text-xs text-muted-foreground">Context: {m.contextWindow}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Groq */}
        <DropdownMenuLabel className="flex items-center gap-2 text-orange-400">
          <span>Groq (Free tier)</span>
          {loadingProvider === "groq" ? (
            <Loader2 className="h-3 w-3 animate-spin ml-auto" />
          ) : groqConnected ? (
            <Wifi className="h-3 w-3 text-emerald-400 ml-auto" />
          ) : (
            <WifiOff className="h-3 w-3 text-destructive ml-auto" />
          )}
        </DropdownMenuLabel>
        {groqConnected === false && (
          <div className="px-2 pb-2 text-xs text-muted-foreground">
            Add a free API key in Settings.
          </div>
        )}
        <DropdownMenuGroup>
          {(modelsByProvider["groq"] ?? []).map(m => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => handleSelectModel("groq", m.id)}
              className={pref.provider === "groq" && pref.model === m.id ? "bg-accent/20 font-medium" : ""}
            >
              <div className="flex flex-col w-full">
                <span>{m.name}</span>
                {m.contextWindow && <span className="text-xs text-muted-foreground">Context: {m.contextWindow}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Ollama */}
        <DropdownMenuLabel className="flex items-center gap-2 text-blue-400">
          <span>Ollama (Local)</span>
          {loadingProvider === "ollama" ? (
            <Loader2 className="h-3 w-3 animate-spin ml-auto" />
          ) : ollamaConnected ? (
            <Wifi className="h-3 w-3 text-emerald-400 ml-auto" />
          ) : (
            <WifiOff className="h-3 w-3 text-destructive ml-auto" />
          )}
        </DropdownMenuLabel>
        {ollamaConnected === false && (
          <div className="px-2 pb-2 text-xs text-muted-foreground">
            Not connected. Configure URL in Settings.
          </div>
        )}
        <DropdownMenuGroup>
          {(modelsByProvider["ollama"] ?? []).map(m => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => handleSelectModel("ollama", m.id)}
              className={pref.provider === "ollama" && pref.model === m.id ? "bg-accent/20 font-medium" : ""}
            >
              <div className="flex flex-col w-full">
                <span>{m.name}</span>
                {m.contextWindow && m.contextWindow !== "unknown" && (
                  <span className="text-xs text-muted-foreground">{m.contextWindow}</span>
                )}
              </div>
            </DropdownMenuItem>
          ))}
          {ollamaConnected && (modelsByProvider["ollama"] ?? []).length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              No models installed. Run: <code className="bg-muted px-1 rounded">ollama pull llama3.2</code>
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
