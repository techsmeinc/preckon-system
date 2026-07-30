import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2/promise";

// Reads issued via query()/queryOne() inside tx() must go through the SAME
// connection so they see the in-flight (uncommitted) mutation.
const txStore = new AsyncLocalStorage<mysql.PoolConnection>();

// Columns declared JSON in the tenant schema. On MySQL 8 the driver auto-parses
// native JSON; this typeCast makes both the native type and any same-named
// column come back as objects/arrays (guarded, so a stray text column is safe).
const JSON_COLUMNS = new Set([
  "manifest",
  "payload_schema",
  "consumes",
  "produces",
  "job_types",
  "permission_keys",
  "definition",
  "scope",
  "deviation_kinds",
  "type_thresholds",
  "extra",
  "payload",
  "context",
  "input_artifact_ids",
  "output_artifact_ids",
  "gate_types",
  "envelope",
  "result",
  "error",
  "referenced_artifact_ids",
  "referenced_step_ids",
  "licensed_modules",
  "limits",
  "features",
  "forbidden_deviations",
  "summary",
  "embedding",
  "signals",
]);

const globalForDb = globalThis as unknown as { _preckonTenantPool?: mysql.Pool };

export const pool: mysql.Pool =
  globalForDb._preckonTenantPool ??
  mysql.createPool({
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER ?? "root",
    password: process.env.DATABASE_PASSWORD ?? "",
    database: process.env.DATABASE_NAME ?? "preckon_tenant",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    timezone: "Z", // read/write DATETIME as UTC
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    typeCast(field, next) {
      if (field.type === "JSON" || JSON_COLUMNS.has(field.name)) {
        const s = field.string("utf8");
        if (s == null) return null;
        try {
          return JSON.parse(s);
        } catch {
          return s;
        }
      }
      return next();
    },
  });

if (process.env.NODE_ENV !== "production") globalForDb._preckonTenantPool = pool;

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
 * Run `fn` inside a single transaction (the §X use-case skeleton commits the
 * mutation and its audit event together). The connection is bound to the async
 * context so nested query()/queryOne() reads see the uncommitted changes.
 */
export async function tx<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const existing = txStore.getStore();
  if (existing) return fn(existing); // already inside a transaction — reuse it
  const conn = await pool.getConnection();
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
