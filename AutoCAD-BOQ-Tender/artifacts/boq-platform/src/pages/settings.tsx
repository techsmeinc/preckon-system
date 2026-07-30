import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useModelPreference } from "@/hooks/use-model-preference";
import { Loader2, Wifi, WifiOff, ExternalLink, Building2 } from "lucide-react";

type CompanyProfile = {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  website: string;
  refPrefix: string;
  currencyCode: string;
  notes: string | null;
};

const EMPTY_COMPANY: CompanyProfile = {
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  phone: "",
  email: "",
  website: "",
  refPrefix: "QO",
  currencyCode: "KWD",
  notes: "",
};

export function Settings() {
  const { pref, setPref } = useModelPreference();
  const { toast } = useToast();
  const [ollamaUrl, setOllamaUrl] = useState(pref.ollamaUrl);
  const [openrouterKey, setOpenrouterKey] = useState(pref.openrouterKey);
  const [groqKey, setGroqKey] = useState(pref.groqKey);
  const [anthropicKey, setAnthropicKey] = useState(pref.anthropicKey);
  const [testingOllama, setTestingOllama] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "connected" | "failed">("unknown");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testingGroq, setTestingGroq] = useState(false);
  const [groqStatus, setGroqStatus] = useState<"unknown" | "connected" | "failed">("unknown");

  const [company, setCompany] = useState<CompanyProfile>(EMPTY_COMPANY);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companySaving, setCompanySaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/company-profile")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setCompany({
          companyName: data.companyName ?? "",
          addressLine1: data.addressLine1 ?? "",
          addressLine2: data.addressLine2 ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
          refPrefix: data.refPrefix || "QO",
          currencyCode: data.currencyCode || "KWD",
          notes: data.notes ?? "",
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCompanyLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const saveCompany = async () => {
    setCompanySaving(true);
    try {
      const res = await fetch("/api/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Company profile saved", description: "Will be used as the letterhead on exported BOQs." });
    } catch {
      toast({ title: "Save failed", description: "Could not save company profile.", variant: "destructive" });
    } finally {
      setCompanySaving(false);
    }
  };

  const testOllama = async () => {
    setTestingOllama(true);
    try {
      const res = await fetch(`/api/models?provider=ollama&ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
      const data = await res.json();
      if (data.connected) {
        setOllamaStatus("connected");
        setOllamaModels(data.models.map((m: { id: string }) => m.id));
        toast({ title: "Connected!", description: `Found ${data.models.length} model(s) installed.` });
      } else {
        setOllamaStatus("failed");
        toast({ title: "Cannot connect", description: data.error ?? "Ollama is not reachable at that URL.", variant: "destructive" });
      }
    } catch {
      setOllamaStatus("failed");
      toast({ title: "Connection failed", description: "Check the URL and try again.", variant: "destructive" });
    } finally {
      setTestingOllama(false);
    }
  };

  const testGroq = async () => {
    if (!groqKey) {
      toast({ title: "Missing key", description: "Paste your Groq API key first.", variant: "destructive" });
      return;
    }
    setTestingGroq(true);
    try {
      const res = await fetch(`/api/models?provider=groq&groqKey=${encodeURIComponent(groqKey)}`);
      const data = await res.json();
      if (data.connected) {
        setGroqStatus("connected");
        toast({ title: "Connected!", description: `Groq is reachable. ${data.models?.length ?? 0} model(s) available.` });
      } else {
        setGroqStatus("failed");
        toast({ title: "Cannot connect", description: data.error ?? "Check your Groq API key.", variant: "destructive" });
      }
    } catch {
      setGroqStatus("failed");
      toast({ title: "Connection failed", description: "Check your key and try again.", variant: "destructive" });
    } finally {
      setTestingGroq(false);
    }
  };

  const saveSettings = () => {
    setPref({ ollamaUrl, openrouterKey, groqKey, anthropicKey });
    toast({ title: "Settings saved", description: "Your provider configuration has been updated." });
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your company profile and AI providers.</p>
      </div>

      {/* Company Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-accent" />
            Company Profile
          </CardTitle>
          <CardDescription>
            Used as the letterhead on every exported BOQ (Excel). Leave blank if you don't want a header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {companyLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input
                  value={company.companyName}
                  onChange={e => setCompany(c => ({ ...c, companyName: e.target.value }))}
                  placeholder="e.g. Acme Building & Contracting Co."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Address Line 1</Label>
                  <Input
                    value={company.addressLine1}
                    onChange={e => setCompany(c => ({ ...c, addressLine1: e.target.value }))}
                    placeholder="Office No. 7, Mezzanine Floor"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address Line 2</Label>
                  <Input
                    value={company.addressLine2}
                    onChange={e => setCompany(c => ({ ...c, addressLine2: e.target.value }))}
                    placeholder="District, City, Country"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={company.phone}
                    onChange={e => setCompany(c => ({ ...c, phone: e.target.value }))}
                    placeholder="+965 ..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={company.email}
                    onChange={e => setCompany(c => ({ ...c, email: e.target.value }))}
                    placeholder="tenders@yourcompany.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input
                    value={company.website}
                    onChange={e => setCompany(c => ({ ...c, website: e.target.value }))}
                    placeholder="www.yourcompany.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Quotation Ref Prefix</Label>
                  <Input
                    value={company.refPrefix}
                    onChange={e => setCompany(c => ({ ...c, refPrefix: e.target.value }))}
                    placeholder="QO"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Used as default prefix for quotation references (e.g. <code className="bg-muted px-1 rounded">QO/12/26</code>).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Currency Code</Label>
                  <Input
                    value={company.currencyCode}
                    onChange={e => setCompany(c => ({ ...c, currencyCode: e.target.value }))}
                    placeholder="KWD"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Footer Notes (optional)</Label>
                <Textarea
                  value={company.notes ?? ""}
                  onChange={e => setCompany(c => ({ ...c, notes: e.target.value }))}
                  placeholder="Terms, payment terms, validity, etc."
                  rows={3}
                />
              </div>
              <div>
                <Button onClick={saveCompany} disabled={companySaving} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  {companySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Company Profile
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ollama */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-blue-400">Ollama — Local Models</CardTitle>
            {ollamaStatus === "connected" && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><Wifi className="h-3 w-3 mr-1" />Connected</Badge>}
            {ollamaStatus === "failed" && <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />Not reachable</Badge>}
          </div>
          <CardDescription>
            Run models like Llama 3, Mistral, and CodeLlama locally. No API key needed.{" "}
            <a href="https://ollama.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              Download Ollama <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Ollama Base URL</Label>
            <div className="flex gap-2">
              <Input
                value={ollamaUrl}
                onChange={e => setOllamaUrl(e.target.value)}
                placeholder="http://74.208.182.201:11434"
                className="font-mono text-sm"
              />
              <Button variant="outline" onClick={testOllama} disabled={testingOllama}>
                {testingOllama ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              When the API server runs on a different host than this UI, expose Ollama via a tunnel (ngrok, Cloudflare) and paste that URL here.
            </p>
          </div>

          {ollamaModels.length > 0 && (
            <div className="space-y-2">
              <Label>Installed Models</Label>
              <div className="flex flex-wrap gap-2">
                {ollamaModels.map(m => (
                  <Badge key={m} variant="secondary" className="font-mono text-xs">{m}</Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                To install more: <code className="bg-muted px-1 rounded">ollama pull mistral</code>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Groq */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-orange-400">Groq — Free Llama/Mixtral/Gemma</CardTitle>
            {groqStatus === "connected" && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><Wifi className="h-3 w-3 mr-1" />Connected</Badge>}
            {groqStatus === "failed" && <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />Not reachable</Badge>}
          </div>
          <CardDescription>
            Free tier with generous rate limits. Inference is extremely fast (LPU hardware).{" "}
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              Get free API Key <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Groq API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={groqKey}
                onChange={e => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                className="font-mono text-sm"
              />
              <Button variant="outline" onClick={testGroq} disabled={testingGroq}>
                {testingGroq ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored locally in your browser. Sent only to Groq.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Anthropic (Claude) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-amber-400">Anthropic (Claude) — Recommended for BOQ</CardTitle>
          <CardDescription>
            Direct Claude API. Best quality for BOQ generation — Opus 4.8 leads on SOW→quantity
            reasoning, tool-calling, long context, and reading drawing/scan images.{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              Get API Key <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Anthropic API Key</Label>
            <Input
              type="password"
              value={anthropicKey}
              onChange={e => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Stored locally in your browser. Sent only to Anthropic. Models: Claude Opus 4.8, Sonnet 4.6, Haiku 4.5.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* OpenRouter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-purple-400">OpenRouter — 100+ Models</CardTitle>
          <CardDescription>
            Access GPT, Claude, Gemini, Llama, Mistral and more via a single API key. Many models are free.{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              Get API Key <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>OpenRouter API Key</Label>
            <Input
              type="password"
              value={openrouterKey}
              onChange={e => setOpenrouterKey(e.target.value)}
              placeholder="sk-or-..."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Stored locally in your browser. Never sent to any server except OpenRouter.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* OpenAI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-emerald-400">OpenAI</CardTitle>
          <CardDescription>
            To use OpenAI directly, set <code className="bg-muted px-1 rounded font-mono text-xs">OPENAI_API_KEY</code> in the API server environment and restart it. The UI does not store this key — it lives only on the server.{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              Get API Key <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Models available once configured: GPT-5.1, GPT-4.1, GPT-4o, GPT-4o Mini, GPT-4.1 Mini</p>
        </CardContent>
      </Card>

      <Separator />

      <Button onClick={saveSettings} className="bg-accent text-accent-foreground hover:bg-accent/90">
        Save Settings
      </Button>
    </div>
  );
}
