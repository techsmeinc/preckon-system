"use client";
import { createContext, useContext } from "react";
import type { ChainStage } from "./chain";

export interface Project {
  id: string; name: string; code: string | null; client_name: string | null;
  status: string; lifecycle_key: string | null; lifecycle_state: string;
}
export interface LifecycleTransition { to: string; triggerType: string; requiredPermission: string; }
export interface Lifecycle { lifecycleKey: string | null; state: string; states: string[]; transitions: LifecycleTransition[]; }

export interface ProjectCtx {
  project: Project;
  lifecycle: Lifecycle | null;
  /** Every artifact on the project, superseded versions excluded. */
  artifacts: any[];
  runs: any[];
  workflows: { key: string; name: string; moduleKey: string }[];
  /** The chain, in running order, with each stage's derived state. */
  stages: ChainStage[];
  loading: boolean;
  reload: () => void;
}
export const ProjectContext = createContext<ProjectCtx | null>(null);
export function useProject(): ProjectCtx {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject must be used within a project layout");
  return c;
}

/** Artifacts of one type on the current project (namespace-tolerant). */
export function ofType(artifacts: any[], type: string): any[] {
  const t = type.split(".").pop() ?? type;
  return artifacts.filter((a) => (a.type_key.split(".").pop() ?? a.type_key) === t);
}

// The bid-pursuit states, in order (pack §2.1) — for the stepper board.
export const PURSUIT_STATES = ["received", "qualifying", "bidding", "approving", "submitted", "clarifying"];
