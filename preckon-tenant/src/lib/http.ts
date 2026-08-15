import { NextResponse } from "next/server";
import { getAuthContext, requireServiceAuth, type AuthContext } from "./context";
import { ApiError, toErrorEnvelope } from "./errors";
import { enrichContext, logFailure, logInfo, requestIdFrom, runWithContext } from "./log";

/**
 * Turn a thrown value into a response, and make it findable.
 *
 * Every failure gets the request id — in the body so the UI can show it, and in
 * a header so it is visible in the network tab without parsing. That id is on
 * every log line the request produced, which is the difference between "it said
 * something went wrong" and a support question somebody can actually answer.
 *
 * Expected failures (a missing permission, a stale artifact) are logged at warn:
 * they are the system working. Unexpected ones get the stack.
 */
function toErrorResponse(err: unknown, requestId: string): NextResponse {
  const { status, body } = toErrorEnvelope(err);

  if (err instanceof ApiError) {
    logInfo("request failed", { code: err.code, status, message: err.message });
  } else {
    logFailure("unhandled error", err, { status });
  }

  const withId =
    body && typeof body === "object"
      ? { ...(body as object), error: { ...((body as any).error ?? {}), requestId } }
      : body;

  return NextResponse.json(withId, { status, headers: { "x-request-id": requestId } });
}

/** Wrap a user-authenticated route handler: resolve ctx, run, envelope errors. */
export function route<T = unknown>(
  handler: (req: Request, ctx: AuthContext, params: T) => Promise<NextResponse | Response>
) {
  return async (req: Request, context: { params: Promise<T> }) => {
    const requestId = requestIdFrom(req);
    const started = Date.now();
    // The route is the path with ids stripped: /projects/abc/bim and
    // /projects/def/bim are the same route, and grouping by the raw path would
    // make every request unique and the field useless.
    const routeName = new URL(req.url).pathname.replace(/\/[0-9a-f-]{8,}/gi, "/:id");

    return runWithContext({ requestId, route: `${req.method} ${routeName}` }, async () => {
      try {
        const ctx = await getAuthContext(req);
        enrichContext({ tenantId: ctx.tenantId, userId: ctx.user?.id });
        const params = ((await context?.params) ?? ({} as T)) as T;
        const res = await handler(req, ctx, params);
        res.headers.set("x-request-id", requestId);
        // Only the slow ones. A line per request buries the signal, and the
        // question worth answering from logs is "what was slow", not "what ran".
        const ms = Date.now() - started;
        if (ms > 2000) logInfo("slow request", { ms, status: res.status });
        return res;
      } catch (err) {
        return toErrorResponse(err, requestId);
      }
    });
  };
}

/** Wrap a service-to-service (/internal) route handler. */
export function serviceRoute<T = unknown>(
  handler: (req: Request, params: T) => Promise<NextResponse | Response>
) {
  return async (req: Request, context: { params: Promise<T> }) => {
    // The worker sends back the id it was given, so its half of the work joins
    // the same trace as the request that started it.
    const requestId = requestIdFrom(req);
    const routeName = new URL(req.url).pathname.replace(/\/[0-9a-f-]{8,}/gi, "/:id");

    return runWithContext({ requestId, route: `${req.method} ${routeName}` }, async () => {
      try {
        requireServiceAuth(req);
        const params = ((await context?.params) ?? ({} as T)) as T;
        const res = await handler(req, params);
        res.headers.set("x-request-id", requestId);
        return res;
      } catch (err) {
        return toErrorResponse(err, requestId);
      }
    });
  };
}

export function ok(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

/**
 * Cache headers for something derived from a file that never changes.
 *
 * A drawing's parsed reading and its rendered sheet are a pure function of
 * bytes that were uploaded once. Re-fetching them on every visit costs the
 * estimator seconds per sheet on a thirteen-sheet set, for a payload that is
 * byte-identical every time. `private` because it is one tenant's drawing and
 * has no business in a shared cache.
 */
export function immutableFor(seconds: number, tag?: string): HeadersInit {
  const h: Record<string, string> = {
    "cache-control": `private, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
  };
  if (tag) h.etag = `"${tag}"`;
  return h;
}
