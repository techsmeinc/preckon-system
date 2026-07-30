import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Copy, CheckCheck, FileText, FileDown, Upload, Save, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useModelPreference } from "@/hooks/use-model-preference";

const SECTIONS = [
  { key: "executive-summary", title: "Executive Summary", description: "Compelling overview: understanding, approach, differentiators" },
  { key: "company-profile", title: "Company Profile", description: "Track record, experience, certifications, capabilities" },
  { key: "technical-approach", title: "Technical Approach", description: "Methodology, sequencing, technical solutions, innovation" },
  { key: "programme", title: "Project Programme", description: "Schedule, milestones, critical path, early procurement" },
  { key: "quality", title: "Quality Assurance", description: "QA/QC framework, ITPs, non-conformance, standards" },
  { key: "hse", title: "HSE Plan", description: "Safety management, HIRAC, environmental controls, emergency" },
  { key: "risk-management", title: "Risk Management", description: "Top 5 project risks with specific mitigations" },
];

interface SectionState {
  content: string;
  generating: boolean;
  copied: boolean;
  downloading: boolean;
  saving: boolean;
  verified: boolean;
  dirty: boolean; // unsaved edits since the last save/load
}

interface Props { projectId: number; }

export function TechnicalNarrativeTab({ projectId }: Props) {
  const [sections, setSections] = useState<Record<string, SectionState>>(() =>
    Object.fromEntries(SECTIONS.map(s => [s.key, {
      content: "", generating: false, copied: false, downloading: false, saving: false, verified: false, dirty: false,
    }]))
  );
  const { pref, providerConfig } = useModelPreference();
  const { toast } = useToast();

  // One hidden file input, reused for whichever section's Upload button is clicked.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);

  // Load any previously-saved drafts (and their verified status) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/narrative`);
        if (!res.ok) return;
        const rows: { sectionKey: string; content: string | null; verified: boolean }[] = await res.json();
        if (cancelled || !Array.isArray(rows)) return;
        setSections(prev => {
          const next = { ...prev };
          for (const row of rows) {
            if (!next[row.sectionKey]) continue;
            next[row.sectionKey] = {
              ...next[row.sectionKey],
              content: row.content ?? "",
              verified: !!row.verified,
              dirty: false,
            };
          }
          return next;
        });
      } catch {
        /* offline / not saved yet — start blank */
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const updateSection = (key: string, update: Partial<SectionState>) =>
    setSections(prev => ({ ...prev, [key]: { ...prev[key], ...update } }));

  // Persist a section's content + verified flag directly (used by both the Save
  // button and the post-generation auto-save). Kept separate from `saveSection`
  // because that one reads `content` from React state, which isn't flushed yet
  // right after streaming — here we pass the exact content to store.
  const persistSection = async (key: string, title: string, content: string, verified: boolean) => {
    const res = await fetch(`/api/projects/${projectId}/narrative/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, verified }),
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(msg.error ?? "Save failed");
    }
  };

  // Generate a section by streaming the model output into the textarea, then
  // AUTO-SAVE the finished draft so it survives switching tabs / closing the
  // page (the tab unmounts on switch and reloads its content from the DB).
  const handleGenerateFixed = async (sectionKey: string) => {
    const title = SECTIONS.find(s => s.key === sectionKey)?.title ?? sectionKey;
    setSections(prev => ({ ...prev, [sectionKey]: { ...prev[sectionKey], generating: true, content: "", verified: false, dirty: true } }));
    let accumulated = "";
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-narrative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey, provider: pref.provider, model: pref.model, providerConfig }),
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
            if (data.type === "delta") {
              accumulated += data.content;
              setSections(prev => ({
                ...prev,
                [sectionKey]: { ...prev[sectionKey], content: prev[sectionKey].content + data.content },
              }));
            }
            if (data.type === "error") toast({ title: "Error", description: data.message, variant: "destructive" });
          } catch {}
        }
      }
      setSections(prev => ({ ...prev, [sectionKey]: { ...prev[sectionKey], generating: false } }));
      // Auto-save the generated draft so it isn't lost on tab switch / reload.
      if (accumulated.trim()) {
        try {
          await persistSection(sectionKey, title, accumulated, false);
          setSections(prev => ({ ...prev, [sectionKey]: { ...prev[sectionKey], dirty: false } }));
        } catch {
          // Saved-on-screen but not persisted — keep the "Unsaved" badge so the
          // user knows to hit Save manually.
          toast({ title: "Draft not saved", description: "Generated but couldn't auto-save — click Save.", variant: "destructive" });
        }
      }
    } catch {
      setSections(prev => ({ ...prev, [sectionKey]: { ...prev[sectionKey], generating: false } }));
      toast({ title: "Error", description: "Generation failed", variant: "destructive" });
    }
  };

  const handleCopy = async (key: string, content: string) => {
    await navigator.clipboard.writeText(content);
    updateSection(key, { copied: true });
    setTimeout(() => updateSection(key, { copied: false }), 2000);
  };

  const [downloading, setDownloading] = useState(false);

  // POST a set of section drafts to the pure-formatting endpoint (NO model call,
  // zero tokens) and trigger a browser download of the returned Word document.
  // We post the drafts currently on screen so the user gets exactly what they
  // see/edited, and honour the server's suggested filename.
  const exportDocx = async (drafted: { title: string; content: string }[], fallbackName: string) => {
    const res = await fetch(`/api/projects/${projectId}/narrative/export.docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: drafted }),
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: "Export failed" }));
      throw new Error(msg.error ?? "Export failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Download a SINGLE section as its own formatted Word document.
  const handleDownloadSection = async (key: string, title: string) => {
    const content = sections[key]?.content ?? "";
    if (!content.trim()) {
      toast({ title: "Nothing to export", description: "This section is empty.", variant: "destructive" });
      return;
    }
    updateSection(key, { downloading: true });
    try {
      await exportDocx([{ title, content }], `${title.replace(/[^a-z0-9]+/gi, "-")}.docx`);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Export failed", variant: "destructive" });
    } finally {
      updateSection(key, { downloading: false });
    }
  };

  // Compile ALL drafted sections into one formatted Word document.
  const handleDownloadWord = async () => {
    const drafted = SECTIONS
      .map(s => ({ title: s.title, content: sections[s.key]?.content ?? "" }))
      .filter(s => s.content.trim());
    if (drafted.length === 0) {
      toast({ title: "Nothing to export", description: "Generate at least one section first.", variant: "destructive" });
      return;
    }
    setDownloading(true);
    try {
      await exportDocx(drafted, "Technical-Narrative.docx");
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Export failed", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  // Open the hidden file picker, remembering which section to load into.
  const handleUploadClick = (key: string) => {
    uploadTargetRef.current = key;
    fileInputRef.current?.click();
  };

  // Read the chosen markdown/text file into the target section for editing.
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const key = uploadTargetRef.current;
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !key) return;
    try {
      const text = await file.text();
      // New content replaces the draft and invalidates any prior verification.
      updateSection(key, { content: text, dirty: true, verified: false });
      toast({ title: "Content loaded", description: `Loaded ${file.name} — edit, save and download when ready.` });
    } catch {
      toast({ title: "Error", description: "Could not read that file.", variant: "destructive" });
    }
  };

  // Persist a section's content + verified flag to the server. Returns true on
  // success. `verified` overrides the stored flag (used by the Verify button).
  const saveSection = async (key: string, title: string, verifiedOverride?: boolean) => {
    const cur = sections[key];
    if (!cur) return false;
    const verified = verifiedOverride ?? cur.verified;
    updateSection(key, { saving: true });
    try {
      await persistSection(key, title, cur.content, verified);
      updateSection(key, { saving: false, dirty: false, verified });
      return true;
    } catch (err) {
      updateSection(key, { saving: false });
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
      return false;
    }
  };

  // Toggle the verified flag and persist it in one step.
  const handleToggleVerified = async (key: string, title: string) => {
    const ok = await saveSection(key, title, !sections[key]?.verified);
    if (ok && !sections[key]?.verified) {
      toast({ title: "Section verified", description: `${title} marked as verified and saved.` });
    }
  };

  const completedCount = SECTIONS.filter(s => sections[s.key]?.content.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Technical Narrative</h3>
          <Badge variant="outline">{completedCount}/{SECTIONS.length} sections drafted</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={handleDownloadWord}
            disabled={downloading || completedCount === 0}
            title="Compile all drafted sections into one formatted Word document (no AI, no tokens)"
          >
            {downloading
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
            Download All
          </Button>
        </div>
      </div>

      {/* Single hidden file input, reused by every section's Upload button. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChosen}
      />

      <div className="grid grid-cols-1 gap-3">
        {SECTIONS.map(section => {
          const state = sections[section.key];
          const wordCount = state.content.trim().split(/\s+/).filter(Boolean).length;
          return (
            <Card key={section.key} className={state.content ? "border-accent/20" : ""}>
              <CardHeader className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {section.title}
                      {state.verified ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-emerald-400 border-emerald-500/30">
                          <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Verified
                        </Badge>
                      ) : state.content ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-sky-400 border-sky-500/30">Drafted</Badge>
                      ) : null}
                      {state.dirty && state.content && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-400 border-amber-500/30">Unsaved</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">{section.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {state.content && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleCopy(section.key, state.content)} title="Copy text">
                        {state.copied ? <CheckCheck className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleUploadClick(section.key)}
                      disabled={state.generating}
                      title="Upload existing content (.md / .txt) to edit"
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                    {state.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleDownloadSection(section.key, section.title)}
                        disabled={state.downloading}
                        title="Download this section as a Word document"
                      >
                        {state.downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
                      </Button>
                    )}
                    {state.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-2 text-xs ${state.dirty ? "text-amber-400" : ""}`}
                        onClick={() => saveSection(section.key, section.title)}
                        disabled={state.saving || state.generating || !state.dirty}
                        title={state.dirty ? "Save edits" : "No unsaved changes"}
                      >
                        {state.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </Button>
                    )}
                    {state.content && (
                      <Button
                        variant={state.verified ? "outline" : "ghost"}
                        size="sm"
                        className={`h-7 px-2 text-xs ${state.verified ? "text-emerald-400 border-emerald-500/30" : ""}`}
                        onClick={() => handleToggleVerified(section.key, section.title)}
                        disabled={state.saving || state.generating}
                        title={state.verified ? "Verified — click to unverify" : "Mark as verified (saves the section)"}
                      >
                        <ShieldCheck className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      variant={state.content ? "outline" : "default"}
                      size="sm"
                      className={`h-7 px-2 text-xs ${!state.content ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                      onClick={() => handleGenerateFixed(section.key)}
                      disabled={state.generating}
                    >
                      {state.generating
                        ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        : <Sparkles className="mr-1 h-3 w-3" />}
                      {state.generating ? "Writing..." : state.content ? "Regenerate" : "Generate"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {(state.content || state.generating) && (
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="relative">
                    <Textarea
                      value={state.content}
                      onChange={e => updateSection(section.key, { content: e.target.value, dirty: true, verified: false })}
                      className="min-h-[160px] text-sm leading-relaxed font-normal resize-y"
                      placeholder={state.generating ? "Writing..." : ""}
                    />
                    {state.generating && (
                      <span className="absolute bottom-3 right-3 inline-block w-1.5 h-4 bg-accent animate-pulse rounded-sm" />
                    )}
                    {state.content && !state.generating && (
                      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                        <span>{wordCount} words · markdown supported</span>
                        <span>
                          {state.saving ? "Saving…" : state.dirty ? "Unsaved changes" : state.verified ? "Saved · verified" : "Saved"}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
