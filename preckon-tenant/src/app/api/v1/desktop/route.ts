import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { listBuilds } from "@/lib/desktopBuilds";

// GET /desktop — which desktop builds exist.
//
// Behind the session like everything else in /v1. The desktop app is a tool for
// people who already have a workspace, and an unauthenticated download endpoint
// on a workspace host is a free file-distribution service for anyone who finds
// it. Any signed-in member may take it: it reads nothing on its own — every
// project it opens is still fetched with that person's session and checked
// against their permissions exactly as the browser is.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "artifact.read");
  return ok(await listBuilds());
});
