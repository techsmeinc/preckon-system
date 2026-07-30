// §X.2 error envelope + canonical status-code map. (No next/server import here so
// the store/runtime import graph stays usable under plain Node / vitest.)
export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "entitlement_required"
  | "seat_limit"
  | "usage_limit"
  | "not_found"
  | "version_conflict"
  | "stale_artifact"
  | "schema_invalid"
  | "rate_limited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  entitlement_required: 403,
  seat_limit: 403,
  usage_limit: 402,
  not_found: 404,
  version_conflict: 409,
  stale_artifact: 409,
  schema_invalid: 422,
  rate_limited: 429,
  internal: 500,
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
export const errEntitlement = (m = "Not licensed for this capability") =>
  new ApiError("entitlement_required", m);
export const errNotFound = (what = "Resource") => new ApiError("not_found", `${what} not found`);
export const errConflict = (m: string, details = {}) => new ApiError("version_conflict", m, details);
export const errStale = (m = "Artifact is superseded or stale") =>
  new ApiError("stale_artifact", m);
export const errSchema = (m: string, details = {}) => new ApiError("schema_invalid", m, details);
export const errBadRequest = (m: string, details = {}) => new ApiError("bad_request", m, details);

/** Map any thrown value to a {status, body} envelope (§X.2). Framework-agnostic. */
export function toErrorEnvelope(err: unknown): { status: number; body: unknown } {
  if (err instanceof ApiError) {
    return {
      status: STATUS[err.code],
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  const anyErr = err as any;
  if (anyErr?.name === "ZodError") {
    return {
      status: 400,
      body: { error: { code: "bad_request", message: "Validation failed", details: { issues: anyErr.issues } } },
    };
  }
  console.error("[unhandled]", err);
  return {
    status: 500,
    body: { error: { code: "internal", message: "Internal server error", details: {} } },
  };
}
