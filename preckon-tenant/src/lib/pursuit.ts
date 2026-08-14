import { query, queryOne, tx } from "./db";
import { appendAudit, type AuditActor, type AuditSpec } from "./audit";
import { errNotFound } from "./errors";
import { licensedWorkflows } from "./entitlements";
import { getLifecycle, advanceLifecycle } from "./lifecycle";
import { startRun } from "./runtime";
import type { Artifact } from "./store";
import { typeMatchSql } from "./artifact-types";

// ── Pursuit orchestrator (autopilot). Domain-NEUTRAL: it reads the tenant's bound
// pack purely as data (licensed workflows, their agents' consumes/produces, and
// the declared lifecycle) and drives a project end-to-end with no manual gate
// confirmation. Nothing here names construction or any vertical — the exact same
// code runs the underwriting pursuit, or any future domain's.
//
// Model: run every licensed workflow ONCE, in data-dependency (topological)
// order, with the project on autopilot so every proposal auto-accepts (§5.6). As
// each run completes, runtime.advanceRun calls continuePursuit(), which advances
// the lifecycle from the confirmed artifacts and starts the next workflow, until
// all workflows have completed.

const short = (t: string) => t.split(".").pop() ?? t;

interface OrderedWf {
  key: string;
  name: string;
  module_key: string;
  produces: Set<string>; // short type keys
  consumes: Set<string>;
}

/**
 * Licensed workflows, topologically ordered so a workflow that consumes a type
 * runs after the workflow that produces it. Generic: dependencies are computed
 * from the catalog (agent consumes/produces + gate types), never hardcoded.
 * Cycles/independents fall back to a stable (module, key) order.
 */
export async function orderedWorkflows(tenantId: string): Promise<OrderedWf[]> {
  const licensed = await licensedWorkflows(tenantId);
  if (licensed.length === 0) return [];
  const keys = licensed.map((w) => w.key);
  const placeholders = keys.map(() => "?").join(",");
  const defs = await query<{ key: string; module_key: string; definition: any }>(
    `SELECT \`key\`, module_key, definition FROM workflow WHERE \`key\` IN (${placeholders})`,
    keys
  );
  const agents = await query<{ key: string; consumes: string[]; produces: string[] }>(
    "SELECT `key`, consumes, produces FROM agent"
  );
  const agentByShort = new Map<string, { consumes: string[]; produces: string[] }>();
  for (const a of agents) agentByShort.set(short(a.key), { consumes: a.consumes ?? [], produces: a.produces ?? [] });

  const nameByKey = new Map(licensed.map((w) => [w.key, w.name]));
  const moduleByKey = new Map(licensed.map((w) => [w.key, w.module_key]));

  const wfs: OrderedWf[] = defs.map((d) => {
    const produces = new Set<string>();
    const consumes = new Set<string>();
    for (const n of d.definition?.nodes ?? []) {
      if (n.kind === "agent" && n.agent_key) {
        const a = agentByShort.get(short(n.agent_key));
        for (const p of a?.produces ?? []) if (p !== "*") produces.add(short(p));
        for (const c of a?.consumes ?? []) if (c !== "*") consumes.add(short(c));
      }
    }
    return { key: d.key, name: nameByKey.get(d.key) ?? d.key, module_key: moduleByKey.get(d.key) ?? "", produces, consumes };
  });

  // Edge A→B when B consumes a type A produces (and B does not itself produce it).
  const byKey = new Map(wfs.map((w) => [w.key, w]));
  const indeg = new Map<string, number>(wfs.map((w) => [w.key, 0]));
  const adj = new Map<string, Set<string>>(wfs.map((w) => [w.key, new Set<string>()]));
  for (const a of wfs) {
    for (const b of wfs) {
      if (a.key === b.key) continue;
      const dependsOnA = [...b.consumes].some((c) => a.produces.has(c) && !b.produces.has(c));
      if (dependsOnA && !adj.get(a.key)!.has(b.key)) {
        adj.get(a.key)!.add(b.key);
        indeg.set(b.key, (indeg.get(b.key) ?? 0) + 1);
      }
    }
  }

  // Kahn with a stable tiebreak (module, key) among the currently-ready set.
  const cmp = (x: string, y: string) => {
    const wx = byKey.get(x)!, wy = byKey.get(y)!;
    return wx.module_key === wy.module_key ? x.localeCompare(y) : wx.module_key.localeCompare(wy.module_key);
  };
  const ready = wfs.filter((w) => (indeg.get(w.key) ?? 0) === 0).map((w) => w.key).sort(cmp);
  const out: OrderedWf[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const k = ready.shift()!;
    if (emitted.has(k)) continue;
    emitted.add(k);
    out.push(byKey.get(k)!);
    for (const m of [...adj.get(k)!].sort(cmp)) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) { ready.push(m); ready.sort(cmp); }
    }
  }
  // Any remaining (part of a cycle) appended in stable order so nothing is dropped.
  for (const w of wfs.slice().sort((a, b) => cmp(a.key, b.key)))
    if (!emitted.has(w.key)) out.push(w);
  return out;
}

async function getProject(tenantId: string, projectId: string) {
  return queryOne<{ id: string; lifecycle_key: string | null; lifecycle_state: string; autopilot: number; created_by: string | null }>(
    "SELECT id, lifecycle_key, lifecycle_state, autopilot, created_by FROM project WHERE tenant_id = ? AND id = ?",
    [tenantId, projectId]
  );
}

/** Advance the lifecycle as far as the project's confirmed artifacts allow
 *  (autopilot has no human confirm to drive advanceLifecycle, so we drive it). */
async function autoAdvanceLifecycle(tenantId: string, projectId: string): Promise<void> {
  const p0 = await getProject(tenantId, projectId);
  if (!p0?.lifecycle_key) return;
  const lc = await getLifecycle(tenantId, p0.lifecycle_key);
  if (!lc) return;
  const allPerms = new Set(lc.transitions.map((t) => t.required_permission)); // system-authorized

  for (let guard = 0; guard < lc.transitions.length + 2; guard++) {
    const p = await getProject(tenantId, projectId);
    if (!p) return;
    const outgoing = lc.transitions.filter((t) => t.from === p.lifecycle_state);
    if (outgoing.length === 0) return; // terminal
    let advanced = false;
    for (const t of outgoing) {
      const rows = await query<Artifact>(
        `SELECT * FROM artifact WHERE tenant_id = ? AND project_id = ? AND ${typeMatchSql("type_key", t.trigger_type).sql} AND status = 'confirmed' ORDER BY created_at DESC`,
        [tenantId, projectId, ...typeMatchSql("type_key", t.trigger_type).params]
      );
      const match = rows.find((r) =>
        Object.entries(t.trigger_match ?? {}).every(([k, v]) => r.payload?.[k] === v)
      );
      if (!match) continue;
      const res = await tx(async (conn) => {
        const specs: AuditSpec[] = [];
        const r = await advanceLifecycle(
          tenantId,
          { id: p.id, lifecycle_key: p.lifecycle_key, lifecycle_state: p.lifecycle_state },
          match,
          allPerms,
          (spec) => { specs.push(spec); } // collected synchronously, appended in-tx below
        );
        for (const s of specs) await appendAudit(conn, { tenantId, actorId: "autopilot", actorKind: "system" }, s);
        return r;
      });
      if (res.advanced) { advanced = true; break; }
    }
    if (!advanced) return;
  }
}

/** Start autopilot: mark the project, audit, and kick off the first workflow. */
export async function startAutopilot(
  actor: AuditActor,
  tenantId: string,
  projectId: string,
  userId: string
): Promise<{ started: string | null; total: number }> {
  const project = await getProject(tenantId, projectId);
  if (!project) throw errNotFound("Project");
  await query("UPDATE project SET autopilot = 1 WHERE tenant_id = ? AND id = ?", [tenantId, projectId]);
  await tx(async (conn) => {
    await appendAudit(conn, actor, {
      action: "pursuit.autopilot_start",
      targetKind: "project",
      targetId: projectId,
      projectId,
      summary: {},
    });
  });
  const ordered = await orderedWorkflows(tenantId);
  // continuePursuit will (re)advance lifecycle and start the first uncompleted wf.
  await continuePursuit(tenantId, projectId, userId);
  return { started: ordered[0]?.key ?? null, total: ordered.length };
}

/** Stop autopilot (leaves any in-flight run to finish on its own). */
export async function stopAutopilot(actor: AuditActor, tenantId: string, projectId: string): Promise<void> {
  await query("UPDATE project SET autopilot = 0 WHERE tenant_id = ? AND id = ?", [tenantId, projectId]);
  await tx(async (conn) => {
    await appendAudit(conn, actor, {
      action: "pursuit.autopilot_stop",
      targetKind: "project",
      targetId: projectId,
      projectId,
      summary: {},
    });
  });
}

/**
 * The orchestration step. Called after every run completes (and by startAutopilot).
 * No-op unless the project is on autopilot and no run is currently in flight.
 * Advances the lifecycle from confirmed artifacts, then starts the next workflow
 * in topological order; when every workflow has a completed run, autopilot ends.
 */
export async function continuePursuit(tenantId: string, projectId: string, userId?: string): Promise<void> {
  const project = await getProject(tenantId, projectId);
  if (!project || Number(project.autopilot) !== 1) return;

  // Serialize: never start a second workflow while one is running/awaiting.
  const active = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM workflow_run WHERE tenant_id = ? AND project_id = ? AND status IN ('running','awaiting_review')",
    [tenantId, projectId]
  );
  if (Number(active?.n ?? 0) > 0) return;

  await autoAdvanceLifecycle(tenantId, projectId);

  const ordered = await orderedWorkflows(tenantId);
  // A workflow is "attempted" once it has any terminal run — completed OR
  // failed/cancelled. Including the failures is what prevents an autopilot from
  // retrying a deterministically-failing workflow forever; it moves on instead.
  const done = await query<{ workflow_key: string }>(
    "SELECT DISTINCT workflow_key FROM workflow_run WHERE tenant_id = ? AND project_id = ? AND status IN ('completed','failed','cancelled')",
    [tenantId, projectId]
  );
  const doneKeys = new Set(done.map((d) => d.workflow_key));
  const next = ordered.find((w) => !doneKeys.has(w.key));

  if (next) {
    const startedBy = userId ?? project.created_by ?? "autopilot";
    await startRun(
      { tenantId, actorId: startedBy, actorKind: "system" },
      { tenantId, projectId, userId: startedBy, workflowKey: next.key }
    );
    return;
  }

  // All workflows have completed — finish autopilot.
  await query("UPDATE project SET autopilot = 0 WHERE tenant_id = ? AND id = ?", [tenantId, projectId]);
  await tx(async (conn) => {
    await appendAudit(conn, { tenantId, actorId: "autopilot", actorKind: "system" }, {
      action: "pursuit.autopilot_complete",
      targetKind: "project",
      targetId: projectId,
      projectId,
      summary: { workflows: ordered.length },
    });
  });
  await query(
    "INSERT INTO event_outbox (id, tenant_id, project_id, event_type, payload) VALUES (UUID(),?,?,?,?)",
    [tenantId, projectId, "pursuit.completed", JSON.stringify({ workflows: ordered.length })]
  );
}

/** Status for the UI: autopilot flag, current stage, and per-workflow progress. */
export async function pursuitStatus(tenantId: string, projectId: string): Promise<any> {
  const project = await getProject(tenantId, projectId);
  if (!project) throw errNotFound("Project");
  const ordered = await orderedWorkflows(tenantId);
  const runs = await query<{ workflow_key: string; status: string }>(
    "SELECT workflow_key, status FROM workflow_run WHERE tenant_id = ? AND project_id = ?",
    [tenantId, projectId]
  );
  const rank = (s: string) => (["completed", "awaiting_review", "running", "queued", "failed", "cancelled"].indexOf(s) + 1) || 99;
  const bestByWf = new Map<string, string>();
  for (const r of runs) {
    const cur = bestByWf.get(r.workflow_key);
    if (!cur || rank(r.status) < rank(cur)) bestByWf.set(r.workflow_key, r.status);
  }
  const plan = ordered.map((w) => ({
    key: w.key,
    name: w.name,
    module: w.module_key,
    status: bestByWf.get(w.key) ?? "pending",
  }));
  return {
    autopilot: Number(project.autopilot) === 1,
    lifecycleKey: project.lifecycle_key,
    lifecycleState: project.lifecycle_state,
    completed: plan.filter((p) => p.status === "completed").length,
    total: plan.length,
    plan,
  };
}
