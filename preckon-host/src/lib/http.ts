import { NextResponse } from "next/server";
import { z } from "zod";
import { errBadRequest, toErrorResponse } from "./errors";

/** Wrap a route handler so any thrown ApiError/ZodError becomes the §0.5 envelope. */
export function handle<Ctx = any>(
  fn: (req: Request, ctx: Ctx) => Promise<NextResponse | Response>
) {
  return async (req: Request, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** List envelope: { data, next_cursor } (§0.5). */
export function list(data: unknown[], nextCursor: string | null): NextResponse {
  return NextResponse.json({ data, next_cursor: nextCursor });
}

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw errBadRequest("Body must be valid JSON");
  }
  return schema.parse(body);
}

// ── Cursor pagination (§0.5) ────────────────────────────────────────────────
// Cursors are opaque, keyed off the UUIDv7 PK. Lists are reverse-chronological
// (ORDER BY id DESC); the cursor is the last id seen → `WHERE id < cursor`.
export interface Page {
  limit: number;
  cursor: string | null;
}

export function parsePage(req: Request): Page {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 25);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 25));
  const cursor = url.searchParams.get("cursor");
  return { limit, cursor: cursor || null };
}

export function q(req: Request, key: string): string | null {
  return new URL(req.url).searchParams.get(key) || null;
}

/**
 * Given rows fetched with `limit + 1`, slice to `limit` and compute the next
 * cursor. `idOf` extracts the PK used for the keyset.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  idOf: (row: T) => string
): { data: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const data = rows.slice(0, limit);
    return { data, nextCursor: idOf(data[data.length - 1]) };
  }
  return { data: rows, nextCursor: null };
}
