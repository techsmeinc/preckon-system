import { and, eq } from "drizzle-orm";
import { schema } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { type LifecycleState, nextStates } from "./lifecycle-states";

export { LIFECYCLE_STATES, type LifecycleState, nextStates } from "./lifecycle-states";

export async function transitionDrawing(orgId: string, drawingId: string, to: LifecycleState) {
  await withTenant(orgId, async (tx) => {
    const row = (
      await tx
        .select({ state: schema.drawings.lifecycleState })
        .from(schema.drawings)
        .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.id, drawingId)))
        .limit(1)
    )[0];
    if (!row) throw new Error("drawing not found");
    if (!nextStates(row.state).includes(to)) throw new Error(`can't move from ${row.state} to ${to}`);
    await tx
      .update(schema.drawings)
      .set({ lifecycleState: to, updatedAt: new Date() })
      .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.id, drawingId)));
  });
}
