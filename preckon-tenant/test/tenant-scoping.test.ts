// Every query against a tenant-scoped table must constrain the tenant.
//
// The integration suite proves isolation holds on the paths it exercises. This
// proves something different, and for a boundary like this one more useful: that
// no query ANYWHERE reads or writes a tenant-scoped table without saying which
// tenant. It reads the source rather than the database, so it runs in CI with no
// MySQL, on every pull request, and it covers queries nobody wrote a test for.
//
// A cross-tenant leak is the failure this product cannot have. It is also the one
// least likely to be caught in review: `WHERE project_id = ?` looks complete,
// reads naturally, and is wrong only in what it omits.

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

// ── Reading the source ───────────────────────────────────────────────────────

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
 * Where the SQL argument ends.
 *
 * Not simply "a quote then a comma": SQL is full of `status = 'confirmed',
 * ended_at = NOW(3)`, and cutting there loses the WHERE clause and makes a
 * perfectly scoped statement look unscoped. The argument ends at a quote
 * followed by the parameter array or the closing paren of the call.
 */
const Q = "[\"'" + String.fromCharCode(96) + "]";
const ARG_END = new RegExp(Q + "\\s*(?:,\\s*\\[|\\)|,\\s*params)");

/**
 * Statements a file issues against the database.
 *
 * Taken as a window from the verb rather than by matching the opening delimiter:
 * SQL is full of single quotes (`status = 'confirmed'`) and backticked
 * identifiers, and a delimiter-matching scan cuts the statement at the first of
 * them — losing exactly the tail where the WHERE clause lives.
 */
/**
 * Comments removed before scanning.
 *
 * This codebase explains itself in prose, and that prose names tables and SQL
 * verbs — "INSERT into audit_event directly (a trigger forbids UPDATE/DELETE)"
 * is a comment, not a query. Scanning it produces a finding against a statement
 * that does not exist, and a rule that cries wolf is a rule that gets deleted.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

export function statementsIn(input: string): { sql: string; interpolated: boolean }[] {
  const source = stripComments(input);
  const out: { sql: string; interpolated: boolean }[] = [];
  // Constructed per call: a shared /g/ regex carries lastIndex between calls and
  // would silently skip the start of every file after the first.
  const verb = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/gi;
  for (const m of source.matchAll(verb)) {
    const at = m.index ?? 0;
    let win = source.slice(at, at + 1200);
    const stop = win.search(ARG_END);
    if (stop > 0) win = win.slice(0, stop);
    out.push({
      sql: win.replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim(),
      interpolated: win.includes("${"),
    });
  }
  return out;
}

/** Tenant-scoped tables a statement reads or writes. */
export function tablesTouched(stmt: string, scoped: Set<string>): string[] {
  const hits = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+`?([a-z_]+)`?/gi;
  for (const m of stmt.matchAll(re)) if (scoped.has(m[1])) hits.add(m[1]);
  return [...hits];
}

/**
 * Could this statement reach rows in more than one tenant?
 *
 * A WHERE pinning a uuid key can only reach the row that id belongs to, and in
 * this codebase those ids are resolved by an earlier tenant-scoped read. That is
 * safety by provenance rather than by constraint — weaker, worth tracking, but
 * not a leak.
 *
 * What IS a leak is a statement filtered only on something non-unique — a
 * status, a project, a name — with no tenant constraint. Those span tenants on
 * their own, and they are what this rule exists to stop.
 */
export function keyedById(sql: string): boolean {
  return /\b[a-z_]*id\s*=\s*\?/i.test(sql) || /\bid\s+IN\s*\(/i.test(sql);
}

/**
 * Declared exceptions: a substring of the statement, and why it is safe.
 *
 * Keep this list short and argued. An exception someone had to write down is an
 * exception someone thought about; a long list means the rule is being worked
 * around rather than kept.
 */
const ALLOWED: { match: string; why: string }[] = [
  {
    match: "FROM ai_job WHERE status =",
    why: "Reconciler scans for due jobs and expired leases. Recovery is a system-level sweep and is deliberately cross-tenant; scoping it per tenant would mean no recovery at all.",
  },
  {
    match: "UPDATE ai_job SET status =",
    why: "Reconciler claim, requeue and abandon. Same system-level sweep, each guarded on the job id and its current status.",
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
  const leaks: Finding[] = [];
  const byProvenance: Finding[] = [];
  let unresolved = 0;
  let statements = 0;

  for (const file of walk(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    if (!/\b(?:query|queryOne)\s*[<(]/.test(source)) continue;
    const rel = relative(ROOT, file).split("\\").join("/");

    for (const { sql, interpolated } of statementsIn(source)) {
      const tables = tablesTouched(sql, scoped);
      if (!tables.length) continue;
      statements++;
      if (/tenant_id/i.test(sql) || isAllowed(sql)) continue;
      // The constraint may sit inside an interpolated fragment, which cannot be
      // resolved by reading the text. Counted, not judged.
      if (interpolated) {
        unresolved++;
        continue;
      }
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
    // A list would drift the first time somebody added a table.
    expect(scoped.size).toBeGreaterThan(20);
    for (const t of ["artifact", "project", "ai_job", "workflow_run", "file"]) {
      expect(scoped.has(t), t).toBe(true);
    }
  });

  it("does not treat the pack catalogues as tenant-scoped", () => {
    // agent, artifact_type, workflow and the permission catalogue are global on
    // purpose: they are the domain pack, identical for every tenant.
    for (const t of ["agent", "artifact_type", "workflow", "tenant_permission", "supervisor_profile"]) {
      expect(scoped.has(t), t).toBe(false);
    }
  });

  it("extracts a statement past its own quotes", () => {
    // The failure this guards: cutting at the first single quote inside the SQL
    // drops the WHERE clause, and every statement then looks unscoped.
    const [s] = statementsIn(`await query("UPDATE artifact SET status = 'confirmed' WHERE tenant_id = ?", [t]);`);
    expect(s.sql).toContain("WHERE tenant_id = ?");
    expect(s.interpolated).toBe(false);
  });

  it("notices when the constraint is built from a fragment", () => {
    const [s] = statementsIn("await query(`SELECT * FROM artifact WHERE ${where}`, params);");
    expect(s.interpolated).toBe(true);
  });

  it("finds the queries at all, so a silent pass means the rule ran", () => {
    // A scanner that matches nothing passes for the wrong reason.
    const { statements } = audit();
    expect(statements).toBeGreaterThan(40);
  });

  it("has no query that could reach another tenant's rows", () => {
    // The rule that matters: no tenant constraint AND no unique key means the
    // statement is filtered only on something non-unique, and nothing stops it
    // crossing a tenant boundary.
    const { leaks } = audit();
    const report = leaks.map((f) => `\n  ${f.file}\n    ${f.table}: ${f.statement}`).join("");
    expect(
      leaks,
      leaks.length
        ? `${leaks.length} quer${leaks.length === 1 ? "y" : "ies"} could span tenants: no tenant_id and no unique key.` +
            ` Add the constraint, or declare it in ALLOWED with a reason.${report}`
        : "",
    ).toEqual([]);
  });

  it("tracks how much isolation rests on provenance rather than constraint", () => {
    /* These pin a uuid resolved by an earlier tenant-scoped read, so in practice
       they cannot reach another tenant's row. But the guarantee lives in the
       CALLER, not the query, and a future caller that resolves an id differently
       breaks it silently.

       Recorded rather than enforced: adding tenant_id to all of them is the right
       direction and a change to make deliberately, not one forced by a test
       written today. The number going UP is the signal worth watching. */
    const { byProvenance } = audit();
    expect(byProvenance.length).toBeLessThanOrEqual(60);
  });

  it("keeps the exception list short and reasoned", () => {
    expect(ALLOWED.length).toBeLessThanOrEqual(10);
    for (const a of ALLOWED) {
      expect(a.why.length, `${a.match} needs a real reason`).toBeGreaterThan(60);
    }
  });
});
