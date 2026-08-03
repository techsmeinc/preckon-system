"use client";
// One route, seven surfaces. The chain tab bar links here per licensed module;
// this picks the purpose-built screen for it and falls back to the domain-neutral
// one for any module Core hosts but the Construction pack didn't define.

import { use } from "react";
import Link from "next/link";
import { useProject } from "@/lib/project";
import { Skeleton } from "@/lib/ui";
import { stageArtifacts, type ChainStage } from "@/lib/chain";
import { useI18n } from "@/lib/i18n";
import type { SurfaceProps } from "@/lib/surfaces/common";
import TenderSurface from "@/lib/surfaces/tender";
import DrawingsSurface from "@/lib/surfaces/drawings";
import SpecsSurface from "@/lib/surfaces/specs";
import BoqSurface from "@/lib/surfaces/boq";
import EstimateSurface from "@/lib/surfaces/estimate";
import ScheduleSurface from "@/lib/surfaces/schedule";
import NarrativeSurface from "@/lib/surfaces/narrative";
import ProcurementSurface from "@/lib/surfaces/procurement";
import GenericSurface from "@/lib/surfaces/generic";

const SURFACES: Record<string, React.ComponentType<SurfaceProps>> = {
  tenderlogix: TenderSurface,
  drawlogix: DrawingsSurface,
  doclogix: SpecsSurface,
  quantlogix: BoqSurface,
  costlogix: EstimateSurface,
  schedulelogix: ScheduleSurface,
  narrativelogix: NarrativeSurface,
  procurelogix: ProcurementSurface,
};

export default function ModuleWorkspace({ params }: { params: Promise<{ pid: string; key: string }> }) {
  const { pid, key } = use(params);
  const { artifacts, runs, workflows, stages, loading, reload } = useProject();
  const { t } = useI18n();

  const stage: ChainStage | undefined = stages.find((s) => s.key === key);

  if (loading && !stage) return <Skeleton rows={5} />;

  // Not licensed (or not in this domain) — say so instead of rendering an empty
  // module, and point at the plan that decides it.
  if (!stage) {
    return (
      <div className="placeholder">
        <div className="pic">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        </div>
        <h3>{t("stage.notLicensed")}</h3>
        <p>{t("stage.notLicensedSub", { key })}</p>
        <div style={{ marginTop: 18 }}><Link className="mini" href="/admin">{t("stage.seePlan")}</Link></div>
      </div>
    );
  }

  const Surface = SURFACES[stage.key] ?? GenericSurface;
  const rows = stageArtifacts(artifacts, stage.outputs);

  return (
    <Surface
      pid={pid}
      stage={stage}
      artifacts={artifacts}
      rows={rows}
      workflows={workflows}
      runs={runs}
      reload={reload}
    />
  );
}
