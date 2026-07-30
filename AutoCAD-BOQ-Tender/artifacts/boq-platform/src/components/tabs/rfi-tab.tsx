import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Sparkles, MessageSquareText, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useModelPreference } from "@/hooks/use-model-preference";

interface RfiItem {
  id: number;
  projectId: number;
  queryNumber: string | null;
  query: string;
  answer: string | null;
  status: string;
  raisedBy: string | null;
  deadline: string | null;
}

const statusConfig: Record<string, { label: string; class: string }> = {
  open: { label: "Open", class: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  answered: { label: "Answered", class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  closed: { label: "Closed", class: "bg-muted text-muted-foreground" },
};

interface Props { projectId: number; }

export function RfiTab({ projectId }: Props) {
  const [rfis, setRfis] = useState<RfiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newQuery, setNewQuery] = useState("");
  const [newRaisedBy, setNewRaisedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draftingId, setDraftingId] = useState<number | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState<Record<number, string>>({});
  const { pref, providerConfig } = useModelPreference();
  const { toast } = useToast();

  const refresh = () =>
    fetch(`/api/projects/${projectId}/rfi`)
      .then(r => r.json())
      .then(setRfis)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { refresh(); }, [projectId]);

  const handleAdd = async () => {
    if (!newQuery.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/projects/${projectId}/rfi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: newQuery, raisedBy: newRaisedBy || null }),
      });
      setNewQuery(""); setNewRaisedBy(""); setShowForm(false);
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to add RFI", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/rfi/${id}`, { method: "DELETE" });
    setRfis(prev => prev.filter(r => r.id !== id));
  };

  const handleDraftAnswer = async (rfi: RfiItem) => {
    setDraftingId(rfi.id);
    setExpandedId(rfi.id);
    setStreamingAnswer(prev => ({ ...prev, [rfi.id]: "" }));
    try {
      const res = await fetch(`/api/projects/${projectId}/rfi/${rfi.id}/draft-answer`, {
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
            if (data.type === "delta") setStreamingAnswer(prev => ({ ...prev, [rfi.id]: (prev[rfi.id] ?? "") + data.content }));
            if (data.type === "done") refresh();
            if (data.type === "error") toast({ title: "Error", description: data.message, variant: "destructive" });
          } catch {}
        }
      }
    } catch {
      toast({ title: "Error", description: "Failed to draft answer", variant: "destructive" });
    } finally {
      setDraftingId(null);
    }
  };

  const openCount = rfis.filter(r => r.status === "open").length;
  const answeredCount = rfis.filter(r => r.status === "answered").length;

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Query &amp; RFI Log</h3>
          <Badge variant="outline">{rfis.length} total</Badge>
          {openCount > 0 && <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30">{openCount} open</Badge>}
          {answeredCount > 0 && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{answeredCount} answered</Badge>}
        </div>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Query
        </Button>
      </div>

      {showForm && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="pt-4 space-y-3">
            <Textarea
              placeholder="Enter your query or question for the employer/consultant..."
              value={newQuery}
              onChange={e => setNewQuery(e.target.value)}
              className="min-h-[80px]"
            />
            <div className="flex gap-2">
              <Input placeholder="Raised by (optional)" value={newRaisedBy} onChange={e => setNewRaisedBy(e.target.value)} className="max-w-[200px]" />
              <Button size="sm" onClick={handleAdd} disabled={submitting || !newQuery.trim()}>
                {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Submit RFI
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rfis.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
            <MessageSquareText className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">No queries yet</p>
              <p className="text-sm text-muted-foreground">Add RFIs and let AI draft professional answers.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rfis.map(rfi => {
            const isExpanded = expandedId === rfi.id;
            const isDrafting = draftingId === rfi.id;
            const streaming = streamingAnswer[rfi.id];
            const cfg = statusConfig[rfi.status] ?? statusConfig.open;
            const displayAnswer = isDrafting || streaming ? (streaming ?? "") : (rfi.answer ?? "");

            return (
              <Card key={rfi.id} className={isExpanded ? "border-accent/30" : ""}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs text-muted-foreground pt-0.5 shrink-0">{rfi.queryNumber}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{rfi.query}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.class}`}>{cfg.label}</Badge>
                        {rfi.raisedBy && <span className="text-xs text-muted-foreground">by {rfi.raisedBy}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleDraftAnswer(rfi)}
                        disabled={isDrafting}
                        className="h-7 px-2 text-xs text-accent hover:text-accent"
                      >
                        {isDrafting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                        Draft AI Answer
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpandedId(isExpanded ? null : rfi.id)}>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(rfi.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && displayAnswer && (
                  <CardContent className="px-4 pb-4 pt-0 border-t">
                    <div className="mt-3">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Answer</p>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap bg-muted/30 rounded-lg p-3 border">
                        {displayAnswer}
                        {isDrafting && <span className="inline-block w-1 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
