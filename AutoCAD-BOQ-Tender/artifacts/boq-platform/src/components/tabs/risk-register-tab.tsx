import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Sparkles, ShieldAlert, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useModelPreference } from "@/hooks/use-model-preference";

interface RiskItem {
  id: number;
  riskCode: string | null;
  title: string;
  description: string | null;
  category: string | null;
  likelihood: string | null;
  impact: string | null;
  mitigation: string | null;
  owner: string | null;
  aiGenerated: string | null;
}

const ratingClass = (level: string | null) => ({
  High: "bg-red-500/15 text-red-400 border-red-500/30",
  Medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
}[level ?? ""] ?? "bg-muted text-muted-foreground");

const CATEGORIES = ["Commercial", "Technical", "Environmental", "Schedule", "Regulatory", "Supply Chain", "Interface", "Financial", "Other"];
const LEVELS = ["Low", "Medium", "High"];

interface Props { projectId: number; }

export function RiskRegisterTab({ projectId }: Props) {
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "Technical", likelihood: "Medium", impact: "Medium", mitigation: "", owner: "" });
  const [submitting, setSubmitting] = useState(false);
  const { pref, providerConfig } = useModelPreference();
  const { toast } = useToast();

  const refresh = () =>
    fetch(`/api/projects/${projectId}/risks`)
      .then(r => r.json())
      .then(setRisks)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { refresh(); }, [projectId]);

  const handleGenerate = async () => {
    setGenerating(true);
    const newRisks: RiskItem[] = [];
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-risks`, {
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
            if (data.type === "risk") {
              newRisks.push(data.risk);
              setRisks(prev => {
                const manual = prev.filter(r => r.aiGenerated !== "true");
                return [...manual, ...newRisks];
              });
            }
            if (data.type === "error") toast({ title: "Error", description: data.message, variant: "destructive" });
          } catch {}
        }
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate risks", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/projects/${projectId}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ title: "", description: "", category: "Technical", likelihood: "Medium", impact: "Medium", mitigation: "", owner: "" });
      setShowForm(false);
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to add risk", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/risks/${id}`, { method: "DELETE" });
    setRisks(prev => prev.filter(r => r.id !== id));
  };

  const highCount = risks.filter(r => r.likelihood === "High" || r.impact === "High").length;

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Risk Register</h3>
          <Badge variant="outline">{risks.length} risks</Badge>
          {highCount > 0 && <Badge className="bg-red-500/15 text-red-400 border-red-500/30">{highCount} high-priority</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForm(v => !v)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Manual
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={generating} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {generating ? "Generating..." : "AI Generate Risks"}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Risk title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="col-span-2" />
              <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="col-span-2 min-h-[60px]" />
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Owner" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
              <Select value={form.likelihood} onValueChange={v => setForm(f => ({ ...f, likelihood: v }))}>
                <SelectTrigger><SelectValue placeholder="Likelihood" /></SelectTrigger>
                <SelectContent>{LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.impact} onValueChange={v => setForm(f => ({ ...f, impact: v }))}>
                <SelectTrigger><SelectValue placeholder="Impact" /></SelectTrigger>
                <SelectContent>{LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea placeholder="Mitigation strategy" value={form.mitigation} onChange={e => setForm(f => ({ ...f, mitigation: e.target.value }))} className="col-span-2 min-h-[60px]" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={submitting || !form.title.trim()}>
                {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Add Risk
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {risks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">No risks identified yet</p>
              <p className="text-sm text-muted-foreground">Use AI to generate project-specific risks or add manually.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Code</TableHead>
                <TableHead>Title &amp; Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Likelihood</TableHead>
                <TableHead className="text-center">Impact</TableHead>
                <TableHead>Mitigation</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {risks.map(risk => (
                <TableRow key={risk.id} className={risk.likelihood === "High" && risk.impact === "High" ? "bg-red-500/5" : ""}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {risk.riskCode}
                    {risk.aiGenerated === "true" && <Sparkles className="h-2.5 w-2.5 text-accent inline ml-1" />}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{risk.title}</div>
                    {risk.description && <div className="text-xs text-muted-foreground mt-0.5">{risk.description}</div>}
                    {risk.owner && <div className="text-xs text-muted-foreground mt-0.5">Owner: {risk.owner}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{risk.category}</Badge></TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={`text-xs ${ratingClass(risk.likelihood)}`}>{risk.likelihood}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={`text-xs ${ratingClass(risk.impact)}`}>{risk.impact}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px]">{risk.mitigation}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(risk.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
