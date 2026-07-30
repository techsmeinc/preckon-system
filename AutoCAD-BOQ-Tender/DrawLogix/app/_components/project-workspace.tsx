"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, type SVGProps, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  archiveDocumentAction,
  exportCadAction,
  generateConceptAction,
  sendCopilotAction,
  transcribeAudioAction,
  uploadDocumentsAction,
} from "@/server/actions";
import { Badge, Button, Card, Input, StatusBadge, Textarea } from "@/ui";

export interface DocRow {
  id: string;
  name: string;
  docType: string;
  content: string | null;
}
export interface DrawingRow {
  id: string;
  title: string;
  kind: string;
  svg: string | null;
  dxf: string | null;
  lifecycleState: string;
}
export interface MessageRow {
  id: string;
  role: string;
  content: string;
}

const ACCEPT = ".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.xls,image/*";

// Quick-start briefs — lower the barrier for scratch (site-plan / GA) drawings.
const EXAMPLE_BRIEFS: { label: string; text: string }[] = [
  { label: "Warehouse yard", text: "Construction of a 50,000 m² open storage yard: perimeter Kirby fence on concrete post foundations, main gate (manually operated) with security cabin, graded and compacted gatch surface, an 800 m² covered shed, 4× 40 ft AC containers with shelving, a generator zone, a site office for 4 desks, and light poles along the perimeter." },
  { label: "Clinic floor plan", text: "Single-storey medical clinic on a 15 × 25 m plot: reception and waiting area, 3 consulting rooms, a treatment room, a small laboratory, a pharmacy, staff room, store, and 2 WCs, connected by a central corridor." },
  { label: "Equipment yard", text: "Fenced equipment yard: entry/exit gates with guard cabin, a workshop, fuel store, generator zone, wash bay, laydown area, and a portacabin office. Draw as a site plan with dimensions." },
  { label: "Car park", text: "Open surface car park for 60 cars: marked bays, one-way circulation aisles, entry and exit gates, guard cabin, and two landscaped islands. Site plan with overall dimensions." },
];

// One-tap edit suggestions for the assistant.
const EDIT_SUGGESTIONS = ["Add overall dimensions", "Add a north arrow", "Add a gate on the south side", "Label all zones", "Remove the generator zone"];

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/**
 * Retry a Server Action that transiently fails. In dev, Next compiles server actions
 * on-demand, so the first call after a route (re)compiles can throw "An unexpected
 * response was received from the server"; a retry succeeds. Also covers proxy/network blips.
 */
async function retryAction<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? "";
      if (!/unexpected response|Failed to fetch|NetworkError|load failed|ECONN|fetch failed/i.test(msg) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Icons (inline, currentColor) ─────────────────────────────────────────────
const Svg = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p} />
);
const IcUpload = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 16V4M12 4l-4 4M12 4l4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>;
const IcMic = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
const IcAudio = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M3 14v-4M7 18V6M11 15V9M15 20V4M19 14v-4M23 12h0" /></Svg>;
const IcSparkles = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></Svg>;
const IcImage = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-6 6" /></Svg>;
const IcSheet = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M10 3v18" /></Svg>;
const IcText = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h10" /></Svg>;
const IcDownload = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 4v11M12 15l-4-4M12 15l4-4" /><path d="M4 19h16" /></Svg>;
const IcPencil = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 20h4L20 8l-4-4L4 16v4z" /><path d="M14 6l4 4" /></Svg>;
const IcSend = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 12l16-8-6 16-3-7-7-1z" /></Svg>;
const IcRobot = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M12 5v3M9 13h.01M15 13h.01M2 12v3M22 12v3" /></Svg>;
const IcBrief = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 5V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M8 11h8M8 15h5" /></Svg>;
const IcRuler = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="2" y="7" width="20" height="10" rx="1.5" transform="rotate(0)" /><path d="M6 7v3M10 7v4M14 7v3M18 7v4" /></Svg>;

function docIcon(d: DocRow) {
  const n = d.name.toLowerCase();
  if (d.content?.startsWith("data:image/") || /\.(png|jpe?g|gif|webp)$/.test(n)) return { icon: <IcImage className="h-4 w-4" />, tint: "text-accent", label: "Image" };
  if (/\.(xlsx|xls|csv)$/.test(n)) return { icon: <IcSheet className="h-4 w-4" />, tint: "text-success", label: "Sheet" };
  return { icon: <IcText className="h-4 w-4" />, tint: "text-primary", label: "Text" };
}

// ── Section shell ────────────────────────────────────────────────────────────
function Panel({ icon, title, subtitle, actions, children, className }: { icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`overflow-hidden rounded-xl border-border/80 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

export function ProjectWorkspace({
  project,
  documents,
  drawing,
  messages,
}: {
  project: { id: string; name: string; status: string; client: string | null };
  documents: DocRow[];
  drawing: DrawingRow | null;
  messages: MessageRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => startTransition(() => router.refresh());

  async function uploadFiles(files: FileList | File[] | null, content = "") {
    const list = files ? Array.from(files) : [];
    if (list.length === 0 && !content.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("docType", "sow");
    if (content.trim()) fd.set("content", content.trim());
    for (const f of list) fd.append("files", f);
    try {
      const res = await retryAction(() => uploadDocumentsAction(fd));
      if (res.skipped?.length) setError(`Skipped: ${res.skipped.join("; ")}`);
      setNote("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/30">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(340px,400px)_1fr]">
        {/* ── Left: brief + assistant ─────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <Panel icon={<IcBrief className="h-5 w-5" />} title="Project brief" subtitle="Everything you add feeds the AI">
            <div className="space-y-4 p-4">
              {/* Drop zone */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  uploadFiles(e.dataTransfer.files);
                }}
                disabled={pending}
                className={`flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/50"
                }`}
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <IcUpload className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium">Drop files or click to upload</span>
                <span className="text-xs text-muted-foreground">Drawings &amp; photos · Excel schedules · PDFs · text</span>
              </button>
              <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => uploadFiles(e.target.files)} />

              {/* Note + voice */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Describe or dictate</span>
                  <div className="flex items-center gap-1.5">
                    <MicButton onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} />
                    <AudioUpload onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} onError={setError} />
                  </div>
                </div>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Single-storey warehouse yard, 49,000 m² open yard, Kirby fence, main gate + security cabin, 800 m² shed…"
                  className="min-h-28"
                />
                <Button size="sm" variant="outline" className="w-full" disabled={pending || !note.trim()} onClick={() => uploadFiles(null, note)}>
                  Add to brief
                </Button>

                {documents.length === 0 && (
                  <div className="space-y-1.5 pt-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Or start from an example</span>
                    <div className="flex flex-wrap gap-1.5">
                      {EXAMPLE_BRIEFS.map((ex) => (
                        <button
                          key={ex.label}
                          type="button"
                          onClick={() => setNote(ex.text)}
                          className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
                        >
                          {ex.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{error}</p>}

              {/* Attached items */}
              {documents.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attached ({documents.length})</span>
                  <ul className="space-y-1.5">
                    {documents.map((d) => {
                      const di = docIcon(d);
                      return (
                        <li key={d.id} className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-2.5 py-2">
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted ${di.tint}`}>{di.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{d.name}</span>
                            <span className="text-[11px] text-muted-foreground">{di.label}</span>
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            onClick={() => startTransition(async () => {
                              await archiveDocumentAction(d.id);
                              router.refresh();
                            })}
                            aria-label={`Remove ${d.name}`}
                          >
                            <Svg className="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></Svg>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Generate */}
              <Button
                className="h-11 w-full gap-2 text-sm font-semibold shadow-sm"
                disabled={pending || documents.length === 0}
                onClick={() => startTransition(async () => {
                  setError(null);
                  try {
                    await retryAction(() => generateConceptAction(project.id));
                    router.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                })}
              >
                <IcSparkles className="h-5 w-5" />
                {pending ? "Generating drawing…" : drawing ? "Regenerate drawing" : "Generate drawing"}
              </Button>
              {documents.length === 0 && <p className="text-center text-xs text-muted-foreground">Add at least one file or note to begin.</p>}
            </div>
          </Panel>

          <AssistantPanel projectId={project.id} messages={messages} disabled={!drawing} onDone={refresh} />
        </div>

        {/* ── Right: drawing ──────────────────────────────────────────────── */}
        <Panel
          icon={<IcRuler className="h-5 w-5" />}
          title={drawing?.title ?? "Drawing"}
          subtitle={drawing ? "Concept drawing — edit or export to AutoCAD / Revit" : "Your generated drawing appears here"}
          className="flex min-h-[70vh] flex-col"
          actions={
            drawing ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={drawing.lifecycleState} />
                  <Badge variant="outline">{drawing.kind === "freeform_sketch" ? "Site / GA" : "Floor plan"}</Badge>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      if (!drawing.dxf) return;
                      sessionStorage.setItem("drawlogix:openDxf", drawing.dxf);
                      sessionStorage.setItem("drawlogix:openName", drawing.title || project.name);
                      router.push("/");
                    }}
                    title="Open in the full CAD editor"
                  >
                    <IcPencil className="h-4 w-4" /> Edit in CAD
                  </Button>
                  <ExportBar projectId={project.id} />
                </div>
              </div>
            ) : undefined
          }
        >
          <div className="relative min-h-0 flex-1 p-4">
            {pending && <GeneratingOverlay hasDrawing={!!drawing} />}
            {drawing?.svg ? (
              <DrawingViewer svg={drawing.svg} />
            ) : (
              <GuidedEmpty hasDocs={documents.length > 0} />
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ── Assistant chat ───────────────────────────────────────────────────────────
function AssistantPanel({ projectId, messages, disabled, onDone }: { projectId: string; messages: MessageRow[]; disabled: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy || (!text.trim() && attachments.length === 0)) return;
    setBusy(true);
    try {
      await retryAction(() => sendCopilotAction(projectId, text, attachments));
      setText("");
      setAttachments([]);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function addImages(files: FileList | null) {
    if (!files) return;
    const urls = await Promise.all([...files].filter((f) => f.type.startsWith("image/")).map(toDataUrl));
    setAttachments((a) => [...a, ...urls]);
  }

  return (
    <Panel icon={<IcRobot className="h-5 w-5" />} title="AI Assistant" subtitle="Refine the drawing — attach a markup and say “match this”" className="flex min-h-[320px] flex-1 flex-col">
      <div className="flex flex-1 flex-col p-4">
        <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <p className="max-w-[240px] text-sm text-muted-foreground">{disabled ? "Generate a drawing first, then refine it here in plain language." : "Ask for changes — e.g. “add a 12 m² store next to reception”."}</p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <span className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-muted/60"}`}>
                  {m.content}
                </span>
              </div>
            ))
          )}
        </div>

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              // biome-ignore lint/performance/noImgElement: data-URL thumbnail
              <img key={a.slice(-24)} src={a} alt="attachment" className="h-11 w-11 rounded-lg border border-border object-cover" />
            ))}
            <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setAttachments([])}>
              clear
            </button>
          </div>
        )}

        {!disabled && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EDIT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => setText(s)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={send} className="mt-3 flex items-center gap-2">
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
          <Button type="button" variant="outline" size="icon" disabled={disabled || busy} onClick={() => imgRef.current?.click()} title="Attach image / markup">
            <IcImage className="h-4 w-4" />
          </Button>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={disabled ? "Generate a drawing first…" : "Describe a change…"} disabled={disabled || busy} />
          <Button type="submit" size="icon" disabled={disabled || busy || (!text.trim() && attachments.length === 0)} title="Send">
            {busy ? <span className="text-xs">…</span> : <IcSend className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </Panel>
  );
}

// ── Professional CAD export (DWG / DXF / IFC) ─────────────────────────────────
function ExportBar({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(format: "dwg" | "dxf" | "ifc") {
    setBusy(format);
    setErr(null);
    try {
      const { name, mime, b64 } = await retryAction(() => exportCadAction(projectId, format));
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} onClick={() => run("dwg")} disabled={!!busy} title="Native AutoCAD drawing">
          <IcDownload className="h-3.5 w-3.5" /> {busy === "dwg" ? "…" : "DWG"}
        </button>
        <button type="button" className={btn} onClick={() => run("dxf")} disabled={!!busy} title="DXF with real dimensions">
          <IcDownload className="h-3.5 w-3.5" /> {busy === "dxf" ? "…" : "DXF"}
        </button>
        <button type="button" className={btn} onClick={() => run("ifc")} disabled={!!busy} title="BIM model for Revit (Open IFC)">
          <IcDownload className="h-3.5 w-3.5" /> {busy === "ifc" ? "…" : "IFC · Revit"}
        </button>
      </div>
      {busy && <p className="text-[11px] text-muted-foreground">Building {busy.toUpperCase()}…</p>}
      {err && <p className="max-w-[300px] text-right text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

// ── Voice: live dictation (Web Speech API — no key) ──────────────────────────
function MicButton({ onText }: { onText: (t: string) => void }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      const t = e.results?.[0]?.[0]?.transcript;
      if (t) onText(t.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => rec.abort?.();
  }, [onText]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
        listening ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-card hover:bg-muted"
      }`}
      onClick={() => {
        const rec = recRef.current;
        if (!rec) return;
        if (listening) {
          rec.stop();
          setListening(false);
        } else {
          try {
            rec.start();
            setListening(true);
          } catch {
            /* already started */
          }
        }
      }}
    >
      <IcMic className="h-3.5 w-3.5" />
      {listening ? "Stop" : "Dictate"}
    </button>
  );
}

// ── Voice: upload an audio file (Whisper transcription) ──────────────────────
function AudioUpload({ onText, onError }: { onText: (t: string) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    onError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { text } = await transcribeAudioAction(fd);
      onText(text);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept="audio/*" className="hidden" onChange={(e) => onPick(e.target.files)} />
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
        onClick={() => ref.current?.click()}
        disabled={busy}
        title="Upload a voice note (audio file) to transcribe"
      >
        <IcAudio className="h-3.5 w-3.5" />
        {busy ? "Transcribing…" : "Upload audio"}
      </button>
    </>
  );
}

// ── Interactive drawing viewer (zoom / pan / fit / fullscreen) ───────────────
const IcPlus = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IcMinus = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M5 12h14" /></Svg>;
const IcFit = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 0-1 1h-4" /></Svg>;
const IcExpand = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>;
const IcClose = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;

interface View {
  scale: number;
  tx: number;
  ty: number;
}
const clampScale = (s: number) => Math.min(10, Math.max(0.15, s));

function DrawingViewer({ svg }: { svg: string }) {
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef<View>(view);
  const [full, setFull] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const apply = (v: View) => {
    viewRef.current = v;
    setView(v);
  };
  const reset = () => apply({ scale: 1, tx: 0, ty: 0 });

  // Reset the view whenever the drawing changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on new svg
  useEffect(() => reset(), [svg]);

  // Non-passive wheel zoom toward the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { scale, tx, ty } = viewRef.current;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ns = clampScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      const k = ns / scale;
      apply({ scale: ns, tx: mx - (mx - tx) * k, ty: my - (my - ty) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    apply({ scale: viewRef.current.scale, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const zoom = (f: number) => apply({ ...viewRef.current, scale: clampScale(viewRef.current.scale * f) });

  const surface = (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className="relative h-full w-full cursor-grab touch-none overflow-hidden rounded-lg border border-border/70 active:cursor-grabbing"
      style={{ backgroundColor: "#fff", backgroundImage: "radial-gradient(hsl(var(--color-border)) 0.7px, transparent 0.7px)", backgroundSize: "18px 18px" }}
    >
      <div className="absolute left-0 top-0 w-full origin-top-left will-change-transform" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: app-generated SVG string */}
        <div className="p-3 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:drop-shadow" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      <span className="pointer-events-none absolute left-3 top-3 select-none rounded-md bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">Scroll to zoom · drag to pan</span>

      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-md backdrop-blur">
        <ViewerBtn onClick={() => zoom(1 / 1.25)} label="Zoom out"><IcMinus className="h-4 w-4" /></ViewerBtn>
        <span className="w-11 select-none text-center text-xs font-medium tabular-nums text-muted-foreground">{Math.round(view.scale * 100)}%</span>
        <ViewerBtn onClick={() => zoom(1.25)} label="Zoom in"><IcPlus className="h-4 w-4" /></ViewerBtn>
        <span className="mx-1 h-5 w-px bg-border" />
        <ViewerBtn onClick={reset} label="Fit to view"><IcFit className="h-4 w-4" /></ViewerBtn>
        <ViewerBtn onClick={() => setFull((f) => !f)} label={full ? "Exit fullscreen" : "Fullscreen"}>{full ? <IcClose className="h-4 w-4" /> : <IcExpand className="h-4 w-4" />}</ViewerBtn>
      </div>
    </div>
  );

  if (full) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-4">
        <div className="flex shrink-0 items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold"><IcRuler className="h-4 w-4 text-primary" /> Drawing preview</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setFull(false)}><IcClose className="h-4 w-4" /> Close</Button>
        </div>
        <div className="min-h-0 flex-1">{surface}</div>
      </div>,
      document.body,
    );
  }
  return surface;
}

function ViewerBtn({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid h-7 w-7 place-items-center rounded-md text-foreground transition-colors hover:bg-muted">
      {children}
    </button>
  );
}

// ── Generating overlay + guided empty state ──────────────────────────────────
function GeneratingOverlay({ hasDrawing }: { hasDrawing: boolean }) {
  return (
    <div className="absolute inset-4 z-10 grid place-items-center rounded-lg border border-border/70 bg-card/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="relative grid h-12 w-12 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <IcSparkles className="h-6 w-6 animate-pulse" />
          </span>
        </span>
        <div>
          <p className="text-sm font-semibold">{hasDrawing ? "Redrawing…" : "Drafting your drawing…"}</p>
          <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">The AI is reading your brief and laying out a dimensioned drawing. This takes ~20–40 seconds.</p>
        </div>
      </div>
    </div>
  );
}

function GuidedEmpty({ hasDocs }: { hasDocs: boolean }) {
  const steps = [
    { n: 1, t: "Add your brief", d: "Drop files, type, dictate or upload a voice note on the left.", done: hasDocs },
    { n: 2, t: "Generate", d: "The AI drafts a dimensioned concept drawing from everything you added.", done: false },
    { n: 3, t: "Refine & export", d: "Ask the assistant to add/remove anything, then export DWG / DXF / IFC.", done: false },
  ];
  return (
    <div className="grid h-full place-items-center rounded-lg border border-dashed border-border/70 bg-muted/20 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <IcRuler className="h-6 w-6" />
          </span>
          <p className="font-semibold">Let’s draw something</p>
          <p className="text-sm text-muted-foreground">Three steps from a brief to a CAD drawing.</p>
        </div>
        <ol className="space-y-2.5">
          {steps.map((s) => (
            <li key={s.n} className="flex items-start gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-success text-white" : "bg-primary/10 text-primary"}`}>
                {s.done ? "✓" : s.n}
              </span>
              <span>
                <span className="block text-sm font-medium">{s.t}</span>
                <span className="text-xs text-muted-foreground">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// Minimal Web Speech API typings.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionEventLike {
  results?: ArrayLike<ArrayLike<{ transcript: string }>>;
}
