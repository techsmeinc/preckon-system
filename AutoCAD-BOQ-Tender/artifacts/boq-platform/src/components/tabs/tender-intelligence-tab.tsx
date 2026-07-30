import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, BrainCircuit, TrendingUp, AlertTriangle, HelpCircle, Trophy, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useModelPreference } from "@/hooks/use-model-preference";

interface TenderIntelligence {
  id: number;
  goNoGoScore: number | null;
  recommendation: string | null;
  scopeSummary: string | null;
  keyStrengths: string | null;
  keyRisks: string | null;
  requiredClarifications: string | null;
  competitiveAdvantages: string | null;
  estimatedValue: string | null;
  complexity: string | null;
  generatedAt: string;
}

function parseJson(str: string | null): string[] {
  if (!str) return [];
  try { return JSON.parse(str) as string[]; } catch { return []; }
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 45 ? "text-amber-400" : "text-red-400";
  const bgColor = score >= 70 ? "bg-emerald-400/10 border-emerald-400/30" : score >= 45 ? "bg-amber-400/10 border-amber-400/30" : "bg-red-400/10 border-red-400/30";
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border-2 p-6 ${bgColor}`}>
      <div className={`text-6xl font-black ${color}`}>{score}</div>
      <div className="text-sm text-muted-foreground mt-1">out of 100</div>
    </div>
  );
}

function RecommendationBadge({ rec }: { rec: string }) {
  if (rec === "Go") return (
    <div className="flex items-center gap-2 text-emerald-400">
      <CheckCircle2 className="h-5 w-5" />
      <span className="text-xl font-bold">GO</span>
    </div>
  );
  if (rec === "No-Go") return (
    <div className="flex items-center gap-2 text-red-400">
      <XCircle className="h-5 w-5" />
      <span className="text-xl font-bold">NO-GO</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2 text-amber-400">
      <AlertCircle className="h-5 w-5" />
      <span className="text-xl font-bold">CONDITIONAL GO</span>
    </div>
  );
}

interface Props { projectId: number; }

export function TenderIntelligenceTab({ projectId }: Props) {
  const [intel, setIntel] = useState<TenderIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const { pref, providerConfig } = useModelPreference();
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/projects/${projectId}/intelligence`)
      .then(r => r.json())
      .then(d => setIntel(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: pref.provider, model: pref.model, providerConfig }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "done" && data.intelligence) setIntel(data.intelligence);
            if (data.type === "error") toast({ title: "Error", description: data.message, variant: "destructive" });
          } catch {}
        }
      }
    } catch {
      toast({ title: "Error", description: "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (!intel) return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <BrainCircuit className="h-12 w-12 text-accent/50" />
        <div>
          <h3 className="text-lg font-semibold">No Go/No-Go Analysis Yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">Run the AI analysis to get a scored Go/No-Go recommendation, scope summary, strengths, risks, and required clarifications.</p>
        </div>
        <Button onClick={handleAnalyze} disabled={analyzing} className="bg-accent text-accent-foreground hover:bg-accent/90">
          {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
          {analyzing ? "Analysing..." : "Analyse Tender"}
        </Button>
      </CardContent>
    </Card>
  );

  const strengths = parseJson(intel.keyStrengths);
  const risks = parseJson(intel.keyRisks);
  const clarifications = parseJson(intel.requiredClarifications);
  const advantages = parseJson(intel.competitiveAdvantages);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Tender Intelligence Report</h3>
        <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />}
          {analyzing ? "Re-analysing..." : "Re-analyse"}
        </Button>
      </div>

      {/* Score + recommendation + meta */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ScoreGauge score={intel.goNoGoScore ?? 0} />
        <div className="sm:col-span-2 flex flex-col justify-center space-y-3">
          <RecommendationBadge rec={intel.recommendation ?? "Conditional Go"} />
          {intel.scopeSummary && <p className="text-sm text-muted-foreground leading-relaxed">{intel.scopeSummary}</p>}
          <div className="flex flex-wrap gap-2">
            {intel.estimatedValue && (
              <Badge variant="outline" className="text-xs">
                <TrendingUp className="h-3 w-3 mr-1" />{intel.estimatedValue}
              </Badge>
            )}
            {intel.complexity && (
              <Badge variant="outline" className="text-xs">Complexity: {intel.complexity}</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Strengths */}
        <Card className="border-emerald-400/20 bg-emerald-400/5">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-emerald-400">
              <TrendingUp className="h-4 w-4" /> Key Strengths
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ul className="space-y-1.5">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Risks */}
        <Card className="border-red-400/20 bg-red-400/5">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-4 w-4" /> Key Risks
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ul className="space-y-1.5">
              {risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Clarifications */}
        <Card className="border-amber-400/20 bg-amber-400/5">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
              <HelpCircle className="h-4 w-4" /> Required Clarifications
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ul className="space-y-1.5">
              {clarifications.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-400 font-mono text-xs mt-0.5 shrink-0">Q{i + 1}.</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Competitive Advantages */}
        <Card className="border-blue-400/20 bg-blue-400/5">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-400">
              <Trophy className="h-4 w-4" /> Competitive Advantages
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ul className="space-y-1.5">
              {advantages.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Trophy className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
