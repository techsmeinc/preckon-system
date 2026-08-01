import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — the worker's stub agents are plain JS, imported for the in-process dispatcher.
import { computeJobResult } from "../worker/src/agents.mjs";
import { pool, query, queryOne } from "@/lib/db";
import { newId } from "@/lib/ids";
import { setDispatcher } from "@/lib/jobs";
import { startRun, onJobResult } from "@/lib/runtime";
import { confirmArtifact, editArtifact, listArtifacts, markDownstreamStale } from "@/lib/store";
import { handleSupervisorResult } from "@/lib/persona";
import { verifyChain } from "@/lib/audit";
import type { AuditActor } from "@/lib/audit";

// Two workspace ids are in play across the demo stack: …000001 is the one the
// HOST plane registers, …0000a1 the standalone tenant seed. Which exists depends
// on how this box was seeded, so let the environment say.
const TENANT = process.env.TEST_TENANT_ID ?? "00000000-0000-7000-8000-0000000000a1";
let projectId: string;
let userId: string;
const actor: AuditActor = { tenantId: TENANT, actorId: "test-user", actorKind: "user" };

// In-process dispatcher: run the worker's (deterministic) compute and drive the
// Core-side result handler directly — no worker container, fully deterministic.
setDispatcher(async (env) => {
  const result = await computeJobResult(env);
  const a: AuditActor = { tenantId: env.tenant_id, actorId: env.agent_key, actorKind: "agent" };
  const handled = await handleSupervisorResult(a, result);
  if (!handled) await onJobResult(a, result);
});

async function currentByType(type: string, status?: string) {
  return listArtifacts({ tenantId: TENANT, projectId, typeKey: type, status: status as any });
}

beforeAll(async () => {
  // Requires the catalog + demo tenant to be seeded (npm run seed).
  // The demo workspace has been reseeded under different owner identities
  // (riverside → aigcc → cedarstone), so pin to a role rather than an address:
  // any owner of this tenant can drive the skeleton.
  const owner = await queryOne<{ id: string }>(
    `SELECT u.id FROM app_user u
       JOIN user_role ur ON ur.user_id = u.id
       JOIN tenant_role r ON r.id = ur.role_id
      WHERE u.tenant_id = ? AND r.\`key\` = 'owner' AND u.status = 'active'
      ORDER BY u.created_at ASC LIMIT 1`,
    [TENANT]
  );
  if (!owner) {
    throw new Error(`No active owner on tenant ${TENANT} — run "npm run seed" against the test DB first.`);
  }
  userId = owner.id;
  actor.actorId = userId;

  // A fresh project per run so assertions aren't polluted by prior runs.
  projectId = newId();
  await query(
    "INSERT INTO project (id, tenant_id, name, status, lifecycle_key, lifecycle_state, created_by) VALUES (?,?,?, 'active', 'bid_pursuit', 'received', ?)",
    [projectId, TENANT, "Skeleton Test Project", userId]
  );
  await query("INSERT INTO project_member (tenant_id, project_id, user_id) VALUES (?,?,?)", [TENANT, projectId, userId]);
});

describe("§S walking skeleton — end to end", () => {
  it("drives ingest → tender → gate → boq → gate, with gate pause/resume, provenance, stale re-plan", async () => {
    // 1–3: start the skeleton run. Document (auto-confirmed) → Tender proposes a
    // tender_summary → the run pauses at gate_scope (awaiting_review).
    const runId = await startRun(actor, {
      tenantId: TENANT,
      projectId,
      userId,
      workflowKey: "workflow.tenderlogix.skeleton",
    });

    let run = await queryOne<any>("SELECT status FROM workflow_run WHERE id = ?", [runId]);
    expect(run.status).toBe("awaiting_review"); // paused at the scope gate

    // A tender_summary proposal exists, pending (confidence below auto-accept).
    const pendingSummaries = await currentByType("tender_summary", "pending");
    expect(pendingSummaries.length).toBe(1);
    const summary = pendingSummaries[0];
    expect(summary.status).toBe("pending");

    // 4: confirm scope → the gate resumes → BOQ runs → pauses at gate_boq.
    const { resumeGates } = await import("@/lib/runtime");
    await confirmArtifact(TENANT, summary.id, userId);
    await resumeGates(TENANT, runId);

    const boqLines = await currentByType("boq_line", "pending");
    expect(boqLines.length).toBeGreaterThanOrEqual(2); // 2–3 boq_line proposals

    // provenance: each boq_line derives from the confirmed tender_summary
    const prov = await query<{ source_artifact_id: string }>(
      "SELECT source_artifact_id FROM artifact_provenance WHERE artifact_id = ?",
      [boqLines[0].id]
    );
    expect(prov.map((p) => p.source_artifact_id)).toContain(summary.id);

    // 6: confirm the BOQ lines → run completes.
    for (const l of boqLines) {
      await confirmArtifact(TENANT, l.id, userId);
      await resumeGates(TENANT, runId);
    }
    run = await queryOne<any>("SELECT status FROM workflow_run WHERE id = ?", [runId]);
    expect(run.status).toBe("completed");

    // 7: re-plan. Edit the confirmed tender_summary → downstream boq_line go stale.
    const confirmedSummary = (await currentByType("tender_summary", "confirmed"))[0];
    const edited = await editArtifact(
      TENANT,
      confirmedSummary.id,
      { ...confirmedSummary.payload, scope_summary: "REVISED scope — extra storey added." },
      userId
    );
    expect(edited.staleIds.length).toBeGreaterThanOrEqual(2); // the boq_lines went stale

    const staleLines = await currentByType("boq_line", "stale");
    expect(staleLines.length).toBeGreaterThanOrEqual(2);

    // rerunStale supersedes the stale lines with fresh versions.
    const { rerunStale } = await import("@/lib/runtime");
    const n = await rerunStale(actor, TENANT, runId);
    expect(n).toBeGreaterThanOrEqual(1);

    const superseded = await currentByType("boq_line", "superseded");
    expect(superseded.length).toBeGreaterThanOrEqual(2);
    const freshPending = await currentByType("boq_line", "pending");
    expect(freshPending.length).toBeGreaterThanOrEqual(2); // new versions await review
  });

  it("audit chain verifies for the tenant", async () => {
    const conn = await pool.getConnection();
    try {
      const res = await verifyChain(conn as any, TENANT);
      expect(res.ok).toBe(true);
      expect(res.brokenSeq).toBeNull();
    } finally {
      conn.release();
    }
  });
});
