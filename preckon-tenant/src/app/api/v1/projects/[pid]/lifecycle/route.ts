import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { availableTransitions, getLifecycle, orderedStates } from "@/lib/lifecycle";

// §1.6 GET /projects/{pid}/lifecycle — current state, the ordered states (for a
// generic stepper, any domain), and the transitions available to the caller.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "project.read");
  const project = await requireProject(ctx, pid);
  if (!project.lifecycle_key)
    return ok({ lifecycleKey: null, state: project.lifecycle_state, states: [], transitions: [] });

  const lc = await getLifecycle(ctx.tenantId, project.lifecycle_key);
  const all = await availableTransitions(ctx.tenantId, project.lifecycle_key, project.lifecycle_state);
  const transitions = all
    .filter((t) => ctx.permissions.has(t.required_permission))
    .map((t) => ({ to: t.to, triggerType: t.trigger_type, requiredPermission: t.required_permission }));
  return ok({
    lifecycleKey: project.lifecycle_key,
    state: project.lifecycle_state,
    states: lc ? orderedStates(lc) : [],
    transitions,
  });
});
