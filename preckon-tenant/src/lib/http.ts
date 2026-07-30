import { NextResponse } from "next/server";
import { getAuthContext, requireServiceAuth, type AuthContext } from "./context";
import { toErrorEnvelope } from "./errors";

function toErrorResponse(err: unknown): NextResponse {
  const { status, body } = toErrorEnvelope(err);
  return NextResponse.json(body, { status });
}

/** Wrap a user-authenticated route handler: resolve ctx, run, envelope errors. */
export function route<T = unknown>(
  handler: (req: Request, ctx: AuthContext, params: T) => Promise<NextResponse | Response>
) {
  return async (req: Request, context: { params: Promise<T> }) => {
    try {
      const ctx = await getAuthContext(req);
      const params = ((await context?.params) ?? ({} as T)) as T;
      return await handler(req, ctx, params);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Wrap a service-to-service (/internal) route handler. */
export function serviceRoute<T = unknown>(
  handler: (req: Request, params: T) => Promise<NextResponse | Response>
) {
  return async (req: Request, context: { params: Promise<T> }) => {
    try {
      requireServiceAuth(req);
      const params = ((await context?.params) ?? ({} as T)) as T;
      return await handler(req, params);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
