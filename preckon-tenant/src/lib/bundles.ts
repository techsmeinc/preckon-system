"use client";
// A project "bundle" — the project row plus everything the list and dashboard
// views need to say where it sits in the chain: its artifacts, its runs, the
// derived stage states, its priced value and its tender deadline.
//
// The API is per-project by design (tenancy is enforced at the project choke
// point), so the overview screens fan out. The fan-out is capped, and screens
// say plainly when they are showing a subset.

import { useEffect, useState } from "react";
import { api } from "./apiclient";
import { useApi } from "./ui";
import { buildChain, chainProgress, currentStage, type ChainStage, type LicensedModule } from "./chain";

export interface Bundle {
  project: any;
  artifacts: any[];      // excludes superseded versions
  runs: any[];
  stages: ChainStage[];
  progress: number;
  stage: ChainStage | null;
  pending: any[];
  value: { minor: number; ccy: string } | null;
  deadline: string | null;
  /** False until this project's artifacts and runs have arrived. */
  hydrated: boolean;
}

/** A row we can paint before its graph loads. */
const empty = (project: any): Bundle => ({
  project, artifacts: [], runs: [], stages: [], progress: 0, stage: null,
  pending: [], value: null, deadline: null, hydrated: false,
});

export type BundleStatus = "review" | "processing" | "ready" | "setup" | "active" | "loading";

export function bundleStatus(b: Bundle): BundleStatus {
  if (!b.hydrated) return "loading";
  if (b.pending.length) return "review";
  if (b.runs.some((r) => r.status === "running")) return "processing";
  if (b.progress >= 100) return "ready";
  if (b.artifacts.length === 0) return "setup";
  return "active";
}

export const STATUS_CHIP: Record<BundleStatus, { chip: string; label: string }> = {
  review: { chip: "pending", label: "In review" },
  processing: { chip: "running", label: "Processing" },
  ready: { chip: "confirmed", label: "Ready" },
  setup: { chip: "draft", label: "Setting up" },
  active: { chip: "active", label: "Active" },
  loading: { chip: "draft plain", label: "…" },
};

const short = (t: string) => t.split(".").pop() ?? t;

export function useProjectBundles(limit = 8) {
  const projects = useApi<any[]>("/projects");
  const ent = useApi<{ licensedModules: LicensedModule[] }>("/entitlements");
  const workflows = useApi<{ key: string; moduleKey: string }[]>("/workflows");
  const [bundles, setBundles] = useState<Bundle[] | null>(null);

  useEffect(() => {
    if (!projects.data || !ent.data || !workflows.data) return;
    const modules = ent.data.licensedModules ?? [];
    const wfs = workflows.data ?? [];
    const targets = projects.data.slice(0, limit);
    let alive = true;

    // Paint the rows the moment the project list lands, then fill each one in as
    // its graph arrives. Waiting for the whole fan-out would leave the dashboard
    // on skeletons for as long as its slowest project.
    setBundles(targets.map(empty));

    targets.forEach(async (p, i) => {
      const [artifacts, runs] = await Promise.all([
        api.get<any[]>(`/projects/${p.id}/artifacts`).catch(() => [] as any[]),
        api.get<any[]>(`/projects/${p.id}/runs`).catch(() => [] as any[]),
      ]);
      if (!alive) return;
      const stages = buildChain(modules, artifacts, runs, wfs);
      const live = artifacts.filter((a) => a.status !== "superseded");
      const costs = live.filter((a) => short(a.type_key) === "cost_line" && a.status === "confirmed");
      const tender = live.find((a) => short(a.type_key) === "tender_summary");
      const full: Bundle = {
        project: p,
        artifacts: live,
        runs,
        stages,
        progress: chainProgress(stages),
        stage: currentStage(stages),
        pending: live.filter((a) => a.status === "pending"),
        value: costs.length
          ? { minor: costs.reduce((n, a) => n + Number(a.payload?.amount_minor ?? 0), 0), ccy: costs[0].payload?.currency ?? "" }
          : null,
        // The project's own date wins. It is what somebody typed after an
        // addendum moved the date, and the tender's stated deadline is only
        // what the document said when it was read.
        deadline: (p.due_date as string | null) ?? (tender?.payload?.submission_deadline as string) ?? null,
        hydrated: true,
      };
      setBundles((prev) => (prev ? prev.map((b, j) => (j === i ? full : b)) : prev));
    });

    return () => { alive = false; };
  }, [projects.data, ent.data, workflows.data, limit]);

  return {
    bundles,
    projects: projects.data ?? [],
    modules: ent.data?.licensedModules ?? [],
    /** No rows to show yet. */
    loading: projects.loading || ent.loading || bundles === null,
    /** Rows are on screen but at least one project's graph is still arriving —
     *  panels that would otherwise claim "nothing here" should wait on this. */
    hydrating: bundles === null || bundles.some((b) => !b.hydrated),
    error: projects.error ?? ent.error,
    reload: () => { projects.reload(); setBundles(null); },
  };
}
