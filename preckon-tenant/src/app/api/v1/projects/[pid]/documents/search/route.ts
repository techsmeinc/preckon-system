import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { search, indexStatus } from "@/lib/doc/index-store";

// Project search over indexed document text.
//
// Answers come back as passages with the document number, revision and page they
// came from, so every one can be opened and checked. An answer that cannot be
// traced to a page is an assertion, not evidence.
//
// Current revisions only unless history is asked for explicitly — answering from
// a superseded revision is worse than not answering, because the document did
// say that once and repeating it now is a claim about the project that is no
// longer true.

const Query = z.object({
  q: z.string().min(1).max(1000),
  include_history: z.boolean().default(false),
  budget_tokens: z.number().int().min(200).max(20000).default(2000),
});

export const GET = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const url = new URL(req.url);
  const q = url.searchParams.get("q");

  // No question: report what is indexed. This is the answer to "why did it find
  // nothing", which is otherwise indistinguishable from "there is nothing".
  if (!q) return ok({ status: await indexStatus(ctx.tenantId, pid) });

  const parsed = Query.parse({
    q,
    include_history: url.searchParams.get("history") === "true",
    budget_tokens: Number(url.searchParams.get("budget") ?? 2000),
  });

  const result = await search(ctx.tenantId, pid, parsed.q, {
    includeHistory: parsed.include_history,
    budgetTokens: parsed.budget_tokens,
  });

  return ok(result);
});
