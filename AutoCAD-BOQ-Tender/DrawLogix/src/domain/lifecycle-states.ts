/**
 * Pure lifecycle constants/helpers — NO server imports, so client components can use
 * them safely. (The DB transition lives in ./lifecycle.ts, which is server-only.)
 */
export const LIFECYCLE_STATES = ["ai_generated", "draft", "under_review", "approved", "published", "archived"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const ALLOWED: Record<LifecycleState, LifecycleState[]> = {
  ai_generated: ["draft", "under_review"],
  draft: ["under_review"],
  under_review: ["approved", "draft"],
  approved: ["published", "under_review"],
  published: ["archived"],
  archived: [],
};

export function nextStates(from: string): LifecycleState[] {
  return ALLOWED[from as LifecycleState] ?? [];
}
