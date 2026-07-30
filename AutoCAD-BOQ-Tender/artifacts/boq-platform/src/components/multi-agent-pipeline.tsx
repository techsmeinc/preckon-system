import {
  CheckCircle2, Loader2, AlertCircle, Clock,
  FileSearch, ShieldCheck, GitMerge, ListTree,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type AgentStatus = "idle" | "queued" | "running" | "complete" | "warning" | "error";

export interface AgentState {
  status: AgentStatus;
  message: string;
}

/**
 * One agent card descriptor announced by the backend's `pipeline-init` event.
 * The agents are dynamic now because the section list comes from the SOW
 * outline at runtime — a Lift Station project might have 6 sections, a
 * warehouse 25, and the frontend renders cards for whichever the backend declares.
 */
export interface AgentDescriptor {
  key: string;
  label: string;
  subtitle: string;
  role: "preamble" | "section" | "verifier";
  sowRef?: string;
  ourRef?: string;
  disciplines?: string[];
}

/**
 * Live pipeline state. `agents` is the descriptor registry (set once per run
 * via pipeline-init); `states` is the running status keyed by agent.key.
 *
 * `outline` and `verifier` keys are guaranteed to exist by the backend
 * contract but we render them as just-another descriptor.
 */
export interface PipelineState {
  agents: AgentDescriptor[];
  states: Record<string, AgentState>;
}

export const EMPTY_PIPELINE: PipelineState = { agents: [], states: {} };

export interface VerificationSummary {
  totalItems: number;
  agreedCount: number;
  discrepancyCount: number;
  primaryOnlyCount: number;
  secondaryOnlyCount: number;
  overallConfidence: number;
  domainsRepresented?: number;
  sectionsCovered?: number;
  itemsWithDrawingRefs?: number;
}

interface AgentCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  state: AgentState;
  accentClass: string;
  compact?: boolean;
}

function AgentCard({ icon, title, subtitle, state, accentClass, compact = false }: AgentCardProps) {
  const statusIcon = {
    idle: <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
    queued: <Clock className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />,
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />,
    complete: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />,
    warning: <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />,
  }[state.status];

  const borderClass = {
    idle: "border-border/50",
    queued: "border-border/70 bg-muted/20",
    running: "border-amber-400/60 bg-amber-400/5 shadow-[0_0_12px_rgba(251,191,36,0.08)]",
    complete: "border-emerald-400/50 bg-emerald-400/5",
    warning: "border-amber-400/40 bg-amber-400/5",
    error: "border-destructive/50 bg-destructive/5",
  }[state.status];

  return (
    <div className={`rounded-xl border-2 transition-all duration-300 ${borderClass} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-2.5">
        <div className={`p-1.5 rounded-lg ${accentClass} shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1.5">
            <span className={`font-semibold leading-tight ${compact ? "text-xs" : "text-sm"} truncate`} title={title}>{title}</span>
            {statusIcon}
          </div>
          {!compact && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</p>
          )}
          {state.message && state.status !== "idle" && (
            <p className={`mt-1.5 text-foreground/75 leading-tight ${compact ? "text-[10px]" : "text-xs"} line-clamp-2`}>
              {state.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface MultiAgentPipelineProps {
  pipeline: PipelineState;
  summary?: VerificationSummary | null;
  progressLog: string[];
}

const IDLE: AgentState = { status: "idle", message: "" };

export function MultiAgentPipeline({ pipeline, summary, progressLog }: MultiAgentPipelineProps) {
  // Group agents by role so each role renders its own section in the pipeline UI.
  const preambleAgents = pipeline.agents.filter(a => a.role === "preamble");
  const sectionAgents = pipeline.agents.filter(a => a.role === "section");
  const verifierAgents = pipeline.agents.filter(a => a.role === "verifier");

  const runningCount = sectionAgents.filter(a => (pipeline.states[a.key]?.status ?? "idle") === "running").length;
  const doneCount = sectionAgents.filter(a => {
    const s = pipeline.states[a.key]?.status;
    return s === "complete" || s === "warning";
  }).length;

  return (
    <div className="space-y-3">
      {/* Stage 1: Preamble agents (currently just SOW Outline Extractor) */}
      {preambleAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2">Stage 1 — Project Setup</span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          {preambleAgents.map(a => (
            <AgentCard
              key={a.key}
              icon={<ListTree className="h-5 w-5 text-blue-400" />}
              title={a.label}
              subtitle={a.subtitle || "Builds the section tree the BOQ will mirror"}
              state={pipeline.states[a.key] ?? IDLE}
              accentClass="bg-blue-400/10"
            />
          ))}
        </div>
      )}

      {/* Stage 2: SOW-section agents — dynamic, count varies per project */}
      {sectionAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2">
              Stage 2 — {sectionAgents.length} SOW-Section Specialist{sectionAgents.length === 1 ? "" : "s"}
              {runningCount > 0 && (
                <span className="ml-1.5 text-amber-400">({runningCount} active)</span>
              )}
              {doneCount > 0 && runningCount === 0 && (
                <span className="ml-1.5 text-emerald-400">({doneCount}/{sectionAgents.length} complete)</span>
              )}
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sectionAgents.map(a => (
              <AgentCard
                key={a.key}
                icon={<FileSearch className="h-4 w-4 text-cyan-400" />}
                title={a.label}
                subtitle={a.subtitle || ""}
                state={pipeline.states[a.key] ?? IDLE}
                accentClass="bg-cyan-400/10"
                compact
              />
            ))}
          </div>
        </div>
      )}

      {/* Stage 3: Completeness Verifier */}
      {verifierAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2">Stage 3 — Completeness Check</span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          {verifierAgents.map(a => (
            <AgentCard
              key={a.key}
              icon={<ShieldCheck className="h-5 w-5 text-emerald-400" />}
              title={a.label}
              subtitle={a.subtitle || "Cross-checks all sections against the AIGCC discipline checklist"}
              state={pipeline.states[a.key] ?? IDLE}
              accentClass="bg-emerald-400/10"
            />
          ))}
        </div>
      )}

      {/* Pre-init placeholder so user sees something while the outline is being extracted */}
      {pipeline.agents.length === 0 && (
        <div className="rounded-xl border-2 border-border/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          Reading SOW and preparing section agents...
        </div>
      )}

      {/* Verification summary */}
      {summary && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <GitMerge className="h-4 w-4 text-accent" />
            Verification Results
            {summary.sectionsCovered != null && (
              <span className="text-xs font-normal text-muted-foreground ml-auto">{summary.sectionsCovered} SOW section(s)</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="text-center p-2 rounded-lg bg-emerald-400/10 border border-emerald-400/20">
              <div className="text-xl font-bold text-emerald-400">{summary.agreedCount}</div>
              <div className="text-[10px] text-muted-foreground">Section Items</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-purple-400/10 border border-purple-400/20">
              <div className="text-xl font-bold text-purple-400">{summary.secondaryOnlyCount}</div>
              <div className="text-[10px] text-muted-foreground">Verifier Added</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-blue-400/10 border border-blue-400/20">
              <div className="text-xl font-bold text-blue-400">{summary.itemsWithDrawingRefs ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">CAD-Grounded</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-primary/10 border border-primary/20">
              <div className="text-xl font-bold text-primary">{Math.round((summary.overallConfidence ?? 0) * 100)}%</div>
              <div className="text-[10px] text-muted-foreground">Confidence</div>
            </div>
          </div>
        </div>
      )}

      {/* Progress log */}
      {progressLog.length > 0 && (
        <div className="h-28 overflow-y-auto font-mono text-[11px] text-muted-foreground p-3 bg-background rounded-lg border space-y-0.5">
          {progressLog.map((msg, i) => (
            <div key={i}><span className="text-accent/50">&gt;</span> {msg}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Badge for verification status on BOQ table rows
export function VerificationBadge({ status }: { status: string | null }) {
  if (!status || status === "unverified") return null;

  const config: Record<string, { label: string; className: string }> = {
    agreed: { label: "Section", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    discrepancy: { label: "Discrepancy", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    primary_only: { label: "Section", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    secondary_only: { label: "Verifier Added", className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    needs_review: { label: "Needs review", className: "bg-red-500/15 text-red-400 border-red-500/30" },
    reviewed: { label: "Reviewed", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  };

  const cfg = config[status] ?? { label: status, className: "" };

  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.className}`}>
      {cfg.label}
    </Badge>
  );
}
