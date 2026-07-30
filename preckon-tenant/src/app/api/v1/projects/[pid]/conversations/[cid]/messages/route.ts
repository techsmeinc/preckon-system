import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { postUserMessage } from "@/lib/persona";

// §6.3 POST /projects/{pid}/conversations/{cid}/messages — append user turn +
// enqueue the persona's respond job (the assistant turn lands on the callback).
const Body = z.object({ content: z.string().min(1) });

export const POST = route<{ pid: string; cid: string }>(async (req, ctx, { pid, cid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const body = Body.parse(await req.json());
  const { messageId, jobId } = await postUserMessage(actorFromCtx(ctx), {
    tenantId: ctx.tenantId,
    projectId: pid,
    conversationId: cid,
    userId: ctx.user.id,
    content: body.content,
  });
  return ok({ messageId, jobId }, 202);
});
