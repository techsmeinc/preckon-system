import { getAuthContext, requirePermission } from "@/lib/context";
import { handle, ok } from "@/lib/http";

// GET /observability/queues — queue depths + worker heartbeats (§10.3)
// Read-through facade over arq/Redis. Until that's wired, we return a realistic
// mock shaped exactly like the production payload so the console is exercisable.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "observability.read");

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  return ok({
    generated_at: new Date(now).toISOString(),
    source: "mock", // 'redis' once arq is wired
    queues: [
      { name: "default", depth: 12, in_flight: 3, pending: 9 },
      { name: "ingestion", depth: 47, in_flight: 8, pending: 39 },
      { name: "ai", depth: 5, in_flight: 2, pending: 3 },
      { name: "email", depth: 0, in_flight: 0, pending: 0 },
    ],
    workers: [
      { id: "worker-01", last_seen: iso(2_000), status: "busy" },
      { id: "worker-02", last_seen: iso(1_500), status: "idle" },
      { id: "worker-03", last_seen: iso(90_000), status: "stale" },
    ],
  });
});
