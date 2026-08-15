// Every query against a tenant-scoped table must constrain the tenant.
//
// The integration suite proves isolation holds for the paths it exercises. This
// proves something different and, for a boundary like this one, more useful: that
// no query ANYWHERE reads or writes a tenant-scoped table without saying which
// tenant. It reads the source rather than the database, so it runs in CI with no
// MySQL, on every pull request, and it fails on a query that was never given a
// test rather than only on one that was.
//
// A cross-tenant leak is the failure this product cannot have. It is also the
// one least likely to be noticed in review: `WHERE project_id = ?` looks
// complete, reads naturally, and is wrong only because of what it omits.
//
// Exceptions are allowed but must be DECLARED, with a reason, below. That is the
// point — an exception someone had to write down is an exception someone
// thought about.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SCHEMA = join(ROOT, "db", "schema.sql");

// ── What is tenant-scoped ────────────────────────────────────────────────────

/** Tables carrying a tenant_id column, read from the schema rather than listed. */
function tenantScopedTables(): Set<string> {
  const sql = readFileSync(SCHEMA, "utf8");
  const out = new Set<string>();
  let current: string | null = null;
  for (const line of sql.split("\n")) {
    const create = line.match(/^CREATE TABLE(?: IF NOT EXISTS)? `?([a-z_]+)`?/i);
    if (create) current = create[1];
    if (current && /^\s*`?tenant_id`?\s/i.test(line)) {
      out.add(current);
      current = null;
    }
    if (/^\)/.test(line)) current = null;
  }
  return out;
}

// ── Source files that talk to the database ───────────────────────────────────

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

/**
 * Statements a file issues against the database.
 *
 * Taken as a window from the verb rather than by matching a closing delimiter:
 * SQL is full of single quotes (`status = 'confirmed'`) and backticked
 * identifiers (`` `key` ``), and a delimiter-matching scan cuts the statement in
 * half at the first of them — losing exactly the tail where the WHERE clause
 * lives. The window is trimmed at the argument break that follows the SQL.
 */
function statementsIn(source: string): { sql: string; interpolated: boolean }[] {
  const out: { sql: string; interpolated: boolean }[] = [];
  const verb = /(SELECT|INSERT|UPDATE|DELETE)/gi;
  let m: RegExpExecArray | null;
  while ((m = verb.exec(source))) {
    let win = source.slice(m.index, m.index + 1200);
    // Cut at the end of the SQL argument: a closing quote/backtick followed by a
    // comma or the call's closing paren.
    const stop = win.search(/["`']\s*[,)]/);
    if (stop > 0) win = win.slice(0, stop);
    const interpolated = /\$\{/.test(win);
    out.push({ sql: win.replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim(), interpolated });
  }
  return out;
}

/**
 * Could this statement reach rows in more than one tenant?
 *
 * A WHERE that pins a uuid primary or foreign key can only reach the row that id
 * belongs to, and in this codebase those ids are always resolved by an earlier
 * tenant-scoped read. That is safety by provenance rather than by constraint —
 * weaker, worth knowing about, but not a leak.
 *
 * What IS a leak is a statement filtered only on something non-unique — a
 * status, a project, a name — with no tenant constraint. Those can span tenants
 * on their own, and they are what this rule exists to stop.
 */
function keyedById(sql: string): boolean {
  return /(?:[a-z_]*id)\s*=\s*\?/i.test(sql) || /id\s+IN\s*\(/i.test(sql);
}

/**
 * Declared exceptions.
 *
 * Each is a substring of the offending statement plus why it is safe. Keep this
 * list short and argued; a long one means the rule is not being followed.
 */
const ALLOWED: { match: string; why: string }[] = [
  {
    match: "SELECT * FROM ai_job WHERE id = ?",
    why: "Worker result callback. Keyed by an unguessable uuid the worker was handed; the tenant is read FROM this row to build the audit actor, so it cannot also be a precondition.",
  },
  {
    match: "SELECT id, envelope, attempt, max_attempts FROM ai_job WHERE id = ?",
    why: "Queue claim, immediately after a conditional UPDATE on the same id. Reconciliation is a system-level sweep across tenants by design.",
  },
  {
    match: "SELECT attempt, max_attempts FROM ai_job WHERE id = ?",
    why: "Queue retry accounting, same sweep.",
  },
  {
    match: "UPDATE ai_job SET lease_until = NULL, next_attempt_at = NULL WHERE id = ?",
    why: "Clears the queue lease when a result lands. System-level, by job id.",
  },
  {
    match: "FROM ai_job WHERE status = 'running'",
    why: "Reconciler scan for expired leases — deliberately across all tenants.",
  },
  {
    match: "FROM ai_job WHERE status = 'queued'",
    why: "Reconciler scan for due jobs — deliberately across all tenants.",
  },
  {
    match: "UPDATE ai_job SET status = 'failed'",
    why: "Reconciler abandoning jobs that exhausted their attempts, across all tenants.",
  },
  {
    match: "UPDATE ai_job SET status = 'running'",
    why: "Reconciler claim, guarded on id and status.",
  },
  {
    match: "UPDATE ai_job SET status = 'queued'",
    why: "Reconciler requeue, guarded on id.",
  },
];

const isAllowed = (stmt: string) => ALLOWED.some((a) => stmt.includes(a.match));

interface Finding {
  file: string;
  table: string;
  statement: string;
}

function audit(): { leaks: Finding[]; byProvenance: Finding[]; unresolved: number; statements: number } {
  const scoped = tenantScopedTables();
  const files = walk(join(ROOT, "src"));
  const leaks: Finding[] = [];
  const byProvenance: Finding[] = [];
  let unresolved = 0;
  let statements = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/(?:query|queryOne)\s*[<(]/.test(source)) continue;
    const rel = relative(ROOT, file).split("\\").join("/");

    for (const { sql, interpolated } of statementsIn(source)) {
      const tables = tablesTouched(sql, scoped);
      if (!tables.length) continue;
      statements++;
      if (/tenant_id/i.test(sql) || isAllowed(sql)) continue;
      // The constraint may live inside an interpolated fragment, which cannot be
      // resolved by reading the text. Counted, not judged.
      if (interpolated) { unresolved++; continue; }

      for (const table of tables) {
        const f = { file: rel, table, statement: sql.slice(0, 150) };
        (keyedById(sql) ? byProvenance : leaks).push(f);
      }
    }
  }
  return { leaks, byProvenance, unresolved, statements };
}

// ── The rule ─────────────────────────────────────────────────────────────────

describe("tenant scoping", () => {
  const scoped = tenantScopedTables();

  it("reads the scoped tables from the schema, not from a hand-kept list", () => {
    // A list would drift the first time somebody adds a table.
    expect(scoped.size).toBeGreaterThan(20);
    expect(scoped.has("artifact")).toBe(true);
    expect(scoped.has("project")).toBe(true);
    expect(scoped.has("ai_job")).toBe(true);
  });

  it("does not treat the pack catalogs as tenant-scoped", () => {
    // agent, artifact_type, workflow and the permission catalogue are global on
    // purpose: they are the domain pack, identical for every tenant.
    for (const t of ["agent", "artifact_type", "workflow", "tenant_permission", "supervisor_profile"]) {
      expect(scoped.has(t), t).toBe(false);
    }
  });

  it("finds the queries at all, so a silent pass means the rule ran", () => {
    // A scanner that matches nothing passes for the wrong reason. This asserts
    // it is actually reading real statements before the rule below is trusted.
    const { statements } = audit();
    expect(statements).toBeGreaterThan(40);
  });

  it("constrains the tenant on every query against a tenant-scoped table", () => {
    const { findings } = audit();
    const report = findings
      .map((f) => `\n  ${f.file}\n    ${f.table}: ${f.statement}`)
      .join("");
    expect(
      findings,
      findings.length
        ? `${findings.length} quer${findings.length === 1 ? "y" : "ies"} touch a tenant-scoped table without constraining tenant_id.` +
            ` Add the constraint, or declare it in ALLOWED with a reason.${report}`
        : "",
    ).toEqual([]);
  });

  it("keeps the exception list short and reasoned", () => {
    // A long allowlist means the rule is being worked around rather than kept.
    expect(ALLOWED.length).toBeLessThanOrEqual(15);
    for (const a of ALLOWED) {
      expect(a.why.length, `${a.match} needs a real reason`).toBeGreaterThan(40);
    }
  });
});
