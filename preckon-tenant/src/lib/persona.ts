import type { AgentContext } from "./abi";
import { appendAudit, type AuditActor } from "./audit";
import { query, queryOne, tx } from "./db";
import { errNotFound } from "./errors";
import { newId } from "./ids";
import { enqueueJob, recordJobResult, type JobInputArtifact, type JobResult } from "./jobs";
import type { Tier } from "./constants";

// §6 — the Orchestrator role realized on the §5 machinery. A user posts a
// message → Core assembles the whole-run context → enqueues a supervisor job →
// the JobResult returns the assistant turn + any deviation proposals → Core
// appends the message and records deviations. No new execution path.

/**
 * Resolve the supervisor's job (type + tier + prompt_ref) for a conversational
 * turn. Fully pack-driven: every supervisor agent declares its jobs in the
 * catalog (`agent.job_types`), by convention one ending `.respond` and one
 * `.review_run`. Core reads them from the bound pack — no domain agent is named
 * here, so this works for construction, underwriting, or any future vertical.
 * Falls back to a synthesised `<agent>.<kind>` job if the pack omits one.
 */
async function supervisorJob(
  supervisorKey: string,
  kind: "respond" | "review_run"
): Promise<{ type: string; tier: Tier; prompt_ref: string }> {
  const row = await queryOne<{ job_types: any }>(
    "SELECT job_types FROM agent WHERE `key` = ?",
    [supervisorKey]
  );
  const jobs: Array<{ type: string; tier: Tier; prompt_ref: string }> = Array.isArray(row?.job_types)
    ? row!.job_types
    : [];
  const match = jobs.find((j) => j.type === kind || j.type.endsWith(`.${kind}`));
  if (match) return match;
  const short = supervisorKey.replace(/^agent\./, "").split(".").pop() ?? supervisorKey;
  const type = `${short}.${kind}`;
  return { type, tier: "deep", prompt_ref: `${type}@v1` };
}

/** Assemble the whole-run (scope-filtered) context Core inlines into a supervisor envelope (§6.1). */
async function assembleContext(
  tenantId: string,
  projectId: string,
  runId: string | null,
  supervisorKey: string
): Promise<JobInputArtifact[]> {
  const profile = await queryOne<{ scope: any }>(
    "SELECT scope FROM supervisor_profile WHERE agent_key = ?",
    [supervisorKey]
  );
  const scopeTypes: string[] = profile?.scope?.artifact_types ?? [];
  const rows = await query<{ id: string; type_key: string; payload: any }>(
    `SELECT id, type_key, payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND status IN ('confirmed','pending')
      ORDER BY created_at DESC LIMIT 100`,
    [tenantId, projectId]
  );
  const filtered = scopeTypes.length
    ? rows.filter((r) => scopeTypes.some((t) => r.type_key.endsWith(t)))
    : rows;
  return filtered.map((r) => ({ id: r.id, type: r.type_key, payload: r.payload }));
}

async function defaultPersona(): Promise<string> {
  const p = await queryOne<{ agent_key: string }>(
    "SELECT agent_key FROM supervisor_profile WHERE is_default = 1 LIMIT 1"
  );
  if (!p) throw errNotFound("Default supervisor persona");
  return p.agent_key;
}

/** Post a user message → enqueue the persona's respond job. Returns { messageId, jobId }. */
export async function postUserMessage(
  actor: AuditActor,
  args: {
    tenantId: string;
    projectId: string;
    conversationId: string;
    userId: string;
    content: string;
  }
): Promise<{ messageId: string; jobId: string }> {
  const conv = await queryOne<{ run_id: string | null; supervisor_key: string | null }>(
    "SELECT run_id, supervisor_key FROM orchestrator_conversation WHERE id = ? AND tenant_id = ?",
    [args.conversationId, args.tenantId]
  );
  if (!conv) throw errNotFound("Conversation");
  const supervisorKey = conv.supervisor_key ?? (await defaultPersona());

  const messageId = newId();
  await query(
    `INSERT INTO orchestrator_message
       (id, tenant_id, conversation_id, role, content, referenced_artifact_ids, referenced_step_ids, author_user_id)
     VALUES (?,?,?, 'user', ?, '[]', '[]', ?)`,
    [messageId, args.tenantId, args.conversationId, args.content, args.userId]
  );

  const inputs = await assembleContext(args.tenantId, args.projectId, conv.run_id, supervisorKey);
  const ctx: AgentContext = {
    tenantId: args.tenantId,
    projectId: args.projectId,
    runId: conv.run_id ?? "",
    stepId: newId(), // synthetic; supervisor jobs are not workflow steps
    agentKey: supervisorKey,
  };
  const job = await supervisorJob(supervisorKey, "respond");
  const jobId = await enqueueJob({
    ctx,
    agentKind: "supervisor",
    jobType: job.type,
    tier: job.tier as Tier,
    promptRef: job.prompt_ref,
    inputArtifacts: inputs,
    params: { conversation_id: args.conversationId, user_message: args.content },
  });
  return { messageId, jobId };
}

/** Proactive consistency sweep (§6.2 copilot.review_run). */
export async function reviewRun(
  args: { tenantId: string; projectId: string; runId: string; supervisorKey?: string }
): Promise<string> {
  const supervisorKey = args.supervisorKey ?? (await defaultPersona());
  // ensure a conversation exists to hold the sweep summary
  let conv = await queryOne<{ id: string }>(
    "SELECT id FROM orchestrator_conversation WHERE tenant_id = ? AND run_id = ? AND (supervisor_key = ? OR supervisor_key IS NULL) LIMIT 1",
    [args.tenantId, args.runId, supervisorKey]
  );
  let conversationId = conv?.id;
  if (!conversationId) {
    conversationId = newId();
    await query(
      "INSERT INTO orchestrator_conversation (id, tenant_id, project_id, run_id, supervisor_key, title) VALUES (?,?,?,?,?,?)",
      [conversationId, args.tenantId, args.projectId, args.runId, supervisorKey, "Run review"]
    );
  }
  const inputs = await assembleContext(args.tenantId, args.projectId, args.runId, supervisorKey);
  const ctx: AgentContext = {
    tenantId: args.tenantId,
    projectId: args.projectId,
    runId: args.runId,
    stepId: newId(),
    agentKey: supervisorKey,
  };
  const job = await supervisorJob(supervisorKey, "review_run");
  return enqueueJob({
    ctx,
    agentKind: "supervisor",
    jobType: job.type,
    tier: job.tier as Tier,
    promptRef: job.prompt_ref,
    inputArtifacts: inputs,
    params: { conversation_id: conversationId },
  });
}

/**
 * Handle a supervisor JobResult: append the assistant turn + record any
 * deviation proposals (§6.1). `flag` auto-applies (no run change); everything
 * else lands `proposed` for a human to approve. Returns true if this was a
 * supervisor job (so the internal route knows not to also run the worker path).
 */
export async function handleSupervisorResult(
  actor: AuditActor,
  result: JobResult
): Promise<boolean> {
  const job = await queryOne<any>("SELECT * FROM ai_job WHERE id = ?", [result.job_id]);
  if (!job) return false;
  const conversationId = job.envelope?.inputs?.params?.conversation_id;
  if (!conversationId) return false; // not a supervisor/conversation job

  await tx(async (conn) => {
    await recordJobResult(result);
    if (result.message) {
      await query(
        `INSERT INTO orchestrator_message
           (id, tenant_id, conversation_id, role, content, referenced_artifact_ids, referenced_step_ids, job_id)
         VALUES (?,?,?, 'assistant', ?, ?, '[]', ?)`,
        [
          newId(),
          job.tenant_id,
          conversationId,
          result.message.content,
          JSON.stringify(result.message.referenced_artifact_ids ?? []),
          job.id,
        ]
      );
    }
    for (const d of result.deviations ?? []) {
      const status = d.kind === "flag" ? "auto_applied" : "proposed";
      await query(
        `INSERT INTO run_deviation
           (id, tenant_id, project_id, run_id, proposed_by, kind, target_step_id, rationale, payload, status, applied_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, ${d.kind === "flag" ? "NOW(3)" : "NULL"})`,
        [
          newId(),
          job.tenant_id,
          job.project_id,
          job.run_id,
          job.agent_key,
          d.kind,
          d.target_step_id ?? null,
          d.rationale,
          JSON.stringify(d.payload ?? {}),
          status,
        ]
      );
      await query(
        "INSERT INTO event_outbox (id, tenant_id, project_id, event_type, payload) VALUES (?,?,?, 'deviation.proposed', ?)",
        [newId(), job.tenant_id, job.project_id, JSON.stringify({ run_id: job.run_id, kind: d.kind })]
      );
    }
    await appendAudit(conn, actor, {
      action: "supervisor.responded",
      actorKind: "agent",
      actorId: job.agent_key,
      targetKind: "conversation",
      targetId: conversationId,
      projectId: job.project_id,
      summary: { deviations: (result.deviations ?? []).length },
    });
  });
  return true;
}
