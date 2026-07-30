"use client";
// Shell-level context, kept out of the route files so any screen can reach it
// without importing a layout module.

import { createContext, useContext } from "react";
import type { Locale } from "./i18n";

/** Opens the docked Copilot from anywhere ("Ask Copilot" in a project header). */
export const CopilotCtx = createContext<() => void>(() => {});
export function useCopilot(): () => void {
  return useContext(CopilotCtx);
}

export interface WorkspaceSettings {
  workspaceName: string | null;
  brandColor: string | null;
  /** Workspace default language; a person may override it for themselves. */
  locale: Locale | null;
}
export const WorkspaceCtx = createContext<WorkspaceSettings & { reload: () => void }>({
  workspaceName: null,
  brandColor: null,
  locale: null,
  reload: () => {},
});
export function useWorkspace() {
  return useContext(WorkspaceCtx);
}
