/**
 * Structured logging, and a request id that survives the whole round trip.
 *
 * The failure this fixes: a user reports "it said something went wrong", and
 * there is no way to find which of the day's log lines was theirs. Every failure
 * now carries an id the user can read off the screen and quote, and that id is
 * on every line the request produced — including the ones the AI worker wrote,
 * because the id travels in the job envelope and comes back on the callback.
 *
 * ── WHAT MUST NEVER BE LOGGED ────────────────────────────────────────────────
 *
 * Payloads, secrets and personal data. A construction project's artifacts are
 * the customer's commercial position — rates, margins, subcontractor prices —
 * and a log aggregator is not where that belongs. `redact()` is applied to every
 * field, and it strips by KEY NAME rather than by trying to recognise a secret
 * in a value: a token is only identifiable as a token by where it sits.
 *
 * The tenant id is logged deliberately. It is an opaque uuid, it carries nothing
 * about the customer, and without it a support question cannot be answered at
 * all — which is the whole point of the exercise.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface LogContext {
  /** Follows the request from route to job to worker and back. */
  requestId: string;
  tenantId?: string;
  userId?: string;
  route?: string;
}

const store = new AsyncLocalStorage<LogContext>();

/** Short, unambiguous, and readable down a phone line. */
export function newRequestId(): string {
  return `rq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * An inbound id is honoured so a trace spans services, but only if it looks
 * like one of ours. An id echoed straight from a header is attacker-controlled
 * and would let anyone forge or poison another request's trace.
 */
export function requestIdFrom(req: { headers: { get(name: string): string | null } }): string {
  const given = req.headers.get("x-request-id");
  return given && /^rq_[a-z0-9]{6,40}$/i.test(given) ? given : newRequestId();
}

export const runWithContext = <T,>(ctx: LogContext, fn: () => T): T => store.run(ctx, fn);
export const currentContext = (): LogContext | undefined => store.getStore();
export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

/** Enrich the ambient context once more is known — the user, say, after auth. */
export function enrichContext(patch: Partial<LogContext>): void {
  const ctx = store.getStore();
  if (ctx) Object.assign(ctx, patch);
}

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * Keys whose values never reach a log.
 *
 * Matched as substrings of the lowercased key, so `anthropic_api_key`,
 * `BETTER_AUTH_SECRET` and `passwordHash` are all caught by one entry each.
 */
const SECRET_KEY = /(pass|secret|token|api_?key|authorization|cookie|credential|private)/i;

/** Keys that hold customer content rather than identifiers. */
const CONTENT_KEY = /^(payload|doc|document|body|content|outputs?|entities|elements|rows|svg|dxf|text)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[deep]";

  if (Array.isArray(value)) {
    // Length rather than contents: "18 doors" is the useful part, and the doors
    // themselves are the customer's drawing.
    return value.length <= 8 ? value.map((v) => redact(v, depth + 1)) : `[${value.length} items]`;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) out[k] = "[redacted]";
      else if (CONTENT_KEY.test(k)) out[k] = summarise(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }

  if (typeof value === "string") {
    // A long string in a log field is a payload that got there by accident.
    return value.length > 300 ? `${value.slice(0, 300)}… [${value.length} chars]` : value;
  }
  return value;
}

/** Shape without contents: enough to debug, not enough to leak. */
function summarise(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "string") return `[${v.length} chars]`;
  if (typeof v === "object") return `{${Object.keys(v as object).length} keys}`;
  return typeof v;
}

// ── Emitting ─────────────────────────────────────────────────────────────────

export type Level = "debug" | "info" | "warn" | "error";

/**
 * One JSON object per line.
 *
 * Machine-readable because the point is to filter by request id across a day of
 * traffic, which is not something anybody does by eye. Development gets the same
 * shape rather than a prettier one — a format only used in production is a
 * format nobody notices is broken until it matters.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const ctx = store.getStore();
  const line = {
    level,
    msg: message,
    ...(ctx ? { rq: ctx.requestId, tenant: ctx.tenantId, user: ctx.userId, route: ctx.route } : {}),
    ...(redact(fields) as Record<string, unknown>),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logDebug = (m: string, f?: Record<string, unknown>) => log("debug", m, f);
export const logInfo = (m: string, f?: Record<string, unknown>) => log("info", m, f);
export const logWarn = (m: string, f?: Record<string, unknown>) => log("warn", m, f);
export const logError = (m: string, f?: Record<string, unknown>) => log("error", m, f);

/**
 * An error, logged with its stack and nothing of the request body.
 *
 * Returns the request id so the caller can put it in front of the user — the
 * whole chain only works if the id on screen is the id in the log.
 */
export function logFailure(message: string, err: unknown, fields: Record<string, unknown> = {}): string | undefined {
  const e = err as { message?: string; stack?: string; code?: string; name?: string };
  log("error", message, {
    ...fields,
    err: e?.message ?? String(err),
    kind: e?.name ?? e?.code,
    // Trimmed: the frames that matter are the first few, and a full stack in a
    // structured field is what makes people stop reading logs.
    stack: e?.stack?.split("\n").slice(0, 6).join(" | "),
  });
  return currentRequestId();
}
