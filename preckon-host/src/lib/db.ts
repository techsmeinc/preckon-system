import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2/promise";

// When a use case is running inside tx(), reads issued via query()/queryOne()
// should go through the SAME connection so they see the in-flight (uncommitted)
// mutation — otherwise a post-mutation readback on a pooled connection returns
// stale data. This store carries the active transaction connection.
const txStore = new AsyncLocalStorage<mysql.PoolConnection>();

// Columns declared JSON in the schema. On MySQL 8 the driver auto-parses the
// native JSON type; on MariaDB (what XAMPP ships) JSON is an alias for LONGTEXT
// and comes back as a string. The typeCast below parses these on BOTH engines
// so route code always receives objects/arrays. Parsing is guarded — a value
// that isn't valid JSON is returned as-is, so a same-named text column is safe.
const JSON_COLUMNS = new Set([
  "metadata",
  "value",
  "theme_tokens",
  "allowed_values",
  "audience_filter",
  "params",
  "dns_records",
  "envelope",
  "response_body",
  "payload",
]);

// Single shared MySQL pool for the whole app (Better Auth reuses it too).
// Reused across hot-reloads in dev via a global to avoid connection leaks.
const globalForDb = globalThis as unknown as { _preckonPool?: mysql.Pool };

export const pool: mysql.Pool =
  globalForDb._preckonPool ??
  mysql.createPool({
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER ?? "root",
    password: process.env.DATABASE_PASSWORD ?? "",
    database: process.env.DATABASE_NAME ?? "preckon_host",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    timezone: "Z", // read/write DATETIME as UTC (§0.3)
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    typeCast(field, next) {
      if (field.type === "JSON" || JSON_COLUMNS.has(field.name)) {
        const s = field.string();
        if (s == null) return null;
        try {
          return JSON.parse(s);
        } catch {
          return s; // not JSON (e.g. a same-named text column) — leave it
        }
      }
      return next();
    },
  });

if (process.env.NODE_ENV !== "production") globalForDb._preckonPool = pool;

/** Run a query and return typed rows. Uses the active tx connection if inside tx(). */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const runner = txStore.getStore() ?? pool;
  const [rows] = await runner.query(sql, params);
  return rows as T[];
}

/** Return the first row or null. */
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a single transaction (the §0.4 use-case skeleton commits the
 * mutation and its audit event together). The connection is passed to `fn`.
 */
export async function tx<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  // Bind this connection to the async context so query()/queryOne() reads inside
  // `fn` (e.g. post-mutation readbacks) use it and see the uncommitted changes.
  return txStore.run(conn, async () => {
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        /* ignore rollback errors */
      }
      throw err;
    } finally {
      conn.release();
    }
  });
}
