import { NextResponse } from "next/server";

// §0.5 error envelope + status-code map.
export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  server_error: 500,
};

export class ApiError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const errUnauthenticated = (m = "Authentication required") =>
  new ApiError("unauthenticated", m);
export const errForbidden = (permission: string) =>
  new ApiError("forbidden", `Missing permission: ${permission}`, { permission });
export const errNotFound = (what = "Resource") => new ApiError("not_found", `${what} not found`);
export const errConflict = (m: string, details = {}) => new ApiError("conflict", m, details);
export const errUnprocessable = (m: string, details = {}) =>
  new ApiError("unprocessable", m, details);
export const errBadRequest = (m: string, details = {}) => new ApiError("bad_request", m, details);

/** Turn any thrown value into the §0.5 error envelope response. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: STATUS[err.code] }
    );
  }
  // Zod validation errors carry `.issues`.
  const anyErr = err as any;
  if (anyErr?.name === "ZodError") {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Validation failed", details: { issues: anyErr.issues } } },
      { status: 400 }
    );
  }
  console.error("[unhandled]", err);
  return NextResponse.json(
    { error: { code: "server_error", message: "Internal server error", details: {} } },
    { status: 500 }
  );
}
