import { getSessionUser } from "@/auth/session";
import { canAccessProject } from "@/domain/access";
import { subscribeCollab } from "@/domain/collab-bus";

/**
 * Live collaboration stream (Server-Sent Events) for one project: chat messages and
 * model-change nudges, pushed the instant they happen. Auth + per-project access are
 * enforced before the stream opens. `X-Accel-Buffering: no` keeps nginx/proxies from
 * buffering the stream (otherwise events arrive in batches, not live).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (!(await canAccessProject(user, projectId))) return new Response("forbidden", { status: 403 });

  const encoder = new TextEncoder();
  let unsub: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* stream already closed */
        }
      };
      send("retry: 3000\n\n"); // client reconnect backoff
      send(": connected\n\n");

      unsub = subscribeCollab(user.orgId, projectId, (ev) => send(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
      heartbeat = setInterval(() => send(": ping\n\n"), 25000); // keep the connection alive through idle proxies

      const close = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
