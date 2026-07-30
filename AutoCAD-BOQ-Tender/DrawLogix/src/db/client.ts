import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { schema } from "./schema";

/**
 * Pooled connection to the shared construction_intelligence MariaDB. The pool is
 * cached on globalThis so Next.js dev hot-reload reuses one set of sockets (avoids
 * the "Too many connections" buildup).
 */
const connectionString = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/construction_intelligence";

const globalForDb = globalThis as unknown as { __dlPool?: mysql.Pool };

export const pool =
  globalForDb.__dlPool ??
  mysql.createPool({ uri: connectionString, connectionLimit: 8, maxIdle: 4, idleTimeout: 60_000, queueLimit: 0 });

if (process.env.NODE_ENV !== "production") globalForDb.__dlPool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
export type { ScheduleRow } from "./schema";
