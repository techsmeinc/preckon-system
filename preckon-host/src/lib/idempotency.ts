import { NextResponse } from "next/server";
import { pool, queryOne } from "./db";
import { newId } from "./ids";

/**
 * §0.5 idempotency: mutating endpoints that create resources / trigger side
 * effects de-duplicate on the `Idempotency-Key` header for 24h. If the same key
 * hits the same route again, we replay the stored response instead of re-running.
 */
export async function withIdempotency(
  req: Request,
  route: string,
  hostUserId: string | null,
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key");
  if (!key) return fn(); // optional; endpoints that *require* it validate separately

  const existing = await queryOne<{ response_code: number; response_body: any }>(
    "SELECT response_code, response_body FROM idempotency_key WHERE `key` = ? AND route = ? AND expires_at > NOW()",
    [key, route]
  );
  if (existing) {
    return NextResponse.json(existing.response_body, {
      status: existing.response_code,
      headers: { "idempotent-replay": "true" },
    });
  }

  const res = await fn();
  // Only cache successful, JSON responses.
  if (res.status < 300) {
    const clone = res.clone();
    let body: unknown = null;
    try {
      body = await clone.json();
    } catch {
      /* non-JSON, skip caching */
    }
    if (body !== null) {
      await pool
        .query(
          "INSERT INTO idempotency_key (id,`key`,route,host_user_id,response_code,response_body,expires_at) VALUES (?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 24 HOUR))",
          [newId(), key, route, hostUserId, res.status, JSON.stringify(body)]
        )
        .catch(() => {
          /* race: another request stored it first — ignore */
        });
    }
  }
  return res;
}
