import type { AgentContext } from "./abi";
import { emitArtifact } from "./abi";
import { appendAudit, type AuditActor, type AuditSpec } from "./audit";
import { query, queryOne, tx } from "./db";
import { lessonsFor, subjectsOf } from "./learning";
import { errNotFound } from "./errors";
import { newId } from "./ids";
import { enqueueJob, recordJobResult, type JobInputArtifact, type JobResult } from "./jobs";
import type { Tier } from "./constants";
import { cadDigest } from "./cad";
import { join as pathJoin } from "node:path";
import { isTypeMatch, typeMatchSql } from "./artifact-types";

// ── §4 The workflow runtime: Preckon Core's deterministic scheduler. No LLM.
// It materializes a step per node, dispatches steps whose upstream completed,
// pauses at gates (awaiting_review) until the gated artifacts are confirmed,
// fans out/in map nodes, and drives partial re-runs.

interface WfNode {
  id: string;
  kind: "agent" | "gate" | "map";
  agent_key?: string;
  gate_types?: string[];
  over?: string;
  job_type?: string; // optional per-node job selection (e.g. drawing index vs takeoff)
}
interface WfEdge {
  from: string;
  to: string;
}
interface WfDef {
  nodes: WfNode[];
  edges: WfEdge[];
}

interface AgentRow {
  key: string;
  kind: "worker" | "service" | "supervisor";
  consumes: string[];
  produces: string[];
  job_types: Array<{ type: string; tier: Tier; prompt_ref?: string }>;
}

async function getWorkflow(key: string) {
  const wf = await queryOne<{ key: string; version: number; definition: WfDef }>(
    "SELECT `key`, version, definition FROM workflow WHERE `key` = ? AND enabled = 1",
    [key]
  );
  if (!wf) throw errNotFound(`Workflow '${key}'`);
  return wf;
}

async function getAgent(key: string): Promise<AgentRow> {
  const a = await queryOne<AgentRow>(
    "SELECT `key`, kind, consumes, produces, job_types FROM agent WHERE `key` = ?",
    [key]
  );
  if (!a) throw errNotFound(`Agent '${key}'`);
  return a;
}

async function emitEvent(
  tenantId: string,
  projectId: string | null,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  await query(
    "INSERT INTO event_outbox (id, tenant_id, project_id, event_type, payload) VALUES (?,?,?,?,?)",
    [newId(), tenantId, projectId, eventType, JSON.stringify(payload)]
  );
}

/**
 * A gate is resolved when none of its gated types still have a pending proposal
 * in the run and at least one has been confirmed. Under manual review a human
 * confirming the last proposal makes this true; under autopilot the proposals are
 * auto-accepted on emit, so the gate is already resolved when first reached — in
 * both cases the gate completes and the DAG continues (no run left stuck at a
 * gate whose proposals were auto-accepted). Shared by advanceRun + resumeGates.
 */
async function gateResolved(
  tenantId: string,
  runId: string,
  gateTypes: string[],
  allowEmpty = false
): Promise<boolean> {
  if (!gateTypes || gateTypes.length === 0) return false;
  let pendingRemains = false;
  let hasConfirmed = false;
  for (const t of gateTypes) {
    const pending = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM artifact
        WHERE tenant_id = ? AND source_run_id = ? AND ${typeMatchSql("type_key", t).sql} AND status = 'pending'`,
      [tenantId, runId, ...typeMatchSql("type_key", t).params]
    );
    const confirmed = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM artifact
        WHERE tenant_id = ? AND source_run_id = ? AND ${typeMatchSql("type_key", t).sql} AND status = 'confirmed'`,
      [tenantId, runId, ...typeMatchSql("type_key", t).params]
    );
    if (Number(pending?.n ?? 0) > 0) pendingRemains = true;
    if (Number(confirmed?.n ?? 0) > 0) hasConfirmed = true;
  }
  // allowEmpty (autopilot): nothing pending is enough — a gate over a producer
  // that legitimately emitted no artifacts must not stall the automatic pursuit.
  return !pendingRemains && (hasConfirmed || allowEmpty);
}

async function projectAutopilot(tenantId: string, projectId: string): Promise<boolean> {
  const p = await queryOne<{ autopilot: number }>(
    "SELECT autopilot FROM project WHERE tenant_id = ? AND id = ?",
    [tenantId, projectId]
  );
  return !!p && Number(p.autopilot) === 1;
}

// ── Resolver (§4.1): acyclicity + known agents/types. Used at seed/registration.
export function validateWorkflow(def: WfDef): string[] {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!ids.has(e.from)) errors.push(`edge from unknown node '${e.from}'`);
    if (!ids.has(e.to)) errors.push(`edge to unknown node '${e.to}'`);
  }
  // cycle check (Kahn's algorithm)
  const indeg = new Map<string, number>();
  def.nodes.forEach((n) => indeg.set(n.id, 0));
  def.edges.forEach((e) => indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1));
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (q.length) {
    const n = q.shift()!;
    seen++;
    def.edges
      .filter((e) => e.from === n)
      .forEach((e) => {
        indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1);
        if (indeg.get(e.to) === 0) q.push(e.to);
      });
  }
  if (seen !== def.nodes.length) errors.push("workflow definition is cyclic");
  return errors;
}

// ── Start a run: materialize a step per node, then tick the scheduler.
export async function startRun(
  actor: AuditActor,
  args: { tenantId: string; projectId: string; userId: string; workflowKey: string }
): Promise<string> {
  const wf = await getWorkflow(args.workflowKey);
  const runId = newId();

  await tx(async (conn) => {
    await query(
      `INSERT INTO workflow_run (id, tenant_id, project_id, workflow_key, workflow_version, status, context, started_by)
       VALUES (?,?,?,?,?, 'running', '{}', ?)`,
      [runId, args.tenantId, args.projectId, wf.key, wf.version, args.userId]
    );
    for (const node of wf.definition.nodes) {
      await query(
        `INSERT INTO workflow_run_step
           (id, tenant_id, run_id, node_id, kind, agent_key, status, input_artifact_ids, output_artifact_ids, gate_types)
         VALUES (?,?,?,?,?,?, 'pending', '[]', '[]', ?)`,
        [
          newId(),
          args.tenantId,
          runId,
          node.id,
          node.kind,
          node.agent_key ?? null,
          node.gate_types ? JSON.stringify(node.gate_types) : null,
        ]
      );
    }
    await appendAudit(conn, actor, {
      action: "run.start",
      targetKind: "run",
      targetId: runId,
      projectId: args.projectId,
      summary: { workflow: wf.key },
    });
  });

  await advanceRun(args.tenantId, runId);
  return runId;
}

// ── The scheduler tick. Dispatch every pending step whose predecessors are all
// completed/skipped; then compute the run's terminal/awaiting status.
export async function advanceRun(tenantId: string, runId: string): Promise<void> {
  const run = await queryOne<{ workflow_key: string; project_id: string; status: string }>(
    "SELECT workflow_key, project_id, status FROM workflow_run WHERE id = ? AND tenant_id = ?",
    [runId, tenantId]
  );
  if (!run) return;
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;

  const wf = await getWorkflow(run.workflow_key);
  const def = wf.definition;
  const preds = (nodeId: string) => def.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  const isDone = (st: string) => st === "completed" || st === "skipped";

  // Fixpoint: process ONE ready node, then re-read fresh state and repeat. This
  // is why a `map` node that completes mid-tick immediately lets its downstream
  // agent fan out in the next iteration — and it stays correct under the nested
  // reentrancy of the in-process (sync) dispatcher, since every iteration reads
  // committed truth rather than a stale snapshot.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const steps = await query<any>(
      "SELECT * FROM workflow_run_step WHERE run_id = ? AND tenant_id = ? AND parent_step_id IS NULL",
      [runId, tenantId]
    );
    const byNode = new Map(steps.map((s) => [s.node_id, s]));

    for (const node of def.nodes) {
      const step = byNode.get(node.id);
      if (!step || step.status !== "pending") continue;
      if (!preds(node.id).every((p) => isDone(byNode.get(p)?.status))) continue;

      if (node.kind === "gate") {
        // If the gate's proposals are already resolved (autopilot auto-accept, or
        // a prior human confirm), complete it and let the DAG continue. Otherwise
        // pause for review.
        const auto = await projectAutopilot(tenantId, run.project_id);
        if (await gateResolved(tenantId, runId, node.gate_types ?? [], auto)) {
          await query(
            "UPDATE workflow_run_step SET status = 'completed', started_at = NOW(3), ended_at = NOW(3) WHERE id = ?",
            [step.id]
          );
        } else {
          await query(
            "UPDATE workflow_run_step SET status = 'awaiting_review', started_at = NOW(3) WHERE id = ?",
            [step.id]
          );
          await query("UPDATE workflow_run SET status = 'awaiting_review' WHERE id = ?", [runId]);
          await emitEvent(tenantId, run.project_id, "gate.awaiting", {
            run_id: runId,
            node: node.id,
            gate_types: node.gate_types,
          });
        }
      } else if (node.kind === "map") {
        const overType = node.over!;
        const items = await query<{ id: string }>(
          `SELECT id FROM artifact
            WHERE tenant_id = ? AND project_id = ? AND ${typeMatchSql("type_key", overType).sql} AND status = 'confirmed'`,
          [tenantId, run.project_id, ...typeMatchSql("type_key", overType).params]
        );
        await query(
          "UPDATE workflow_run_step SET status = 'completed', output_artifact_ids = ?, started_at = NOW(3), ended_at = NOW(3) WHERE id = ?",
          [JSON.stringify(items.map((i) => i.id)), step.id]
        );
      } else {
        await dispatchAgentStep(tenantId, run.project_id, runId, node, step, def, byNode);
      }
      progressed = true;
      break; // re-read fresh state before the next decision
    }
  }

  await recomputeRunStatus(tenantId, runId, run.project_id);

  // Autopilot: when a run finishes, hand control to the pursuit orchestrator to
  // advance the lifecycle and start the next workflow. Dynamic import avoids a
  // static runtime↔pursuit cycle; it is a no-op unless the project is on autopilot.
  const finished = await queryOne<{ status: string }>(
    "SELECT status FROM workflow_run WHERE id = ? AND tenant_id = ?",
    [runId, tenantId]
  );
  if (finished?.status === "completed") {
    const { continuePursuit } = await import("./pursuit");
    await continuePursuit(tenantId, run.project_id);
  }
}

/**
 * Everything an agent needs that is NOT an artifact: the project's identity, the
 * uploaded files and their text, the parsed drawings, the rate book.
 *
 * Shared by both dispatch paths on purpose. The map fan-out used to build its
 * own bare params and return early, so every child job — which is how per-sheet
 * takeoff and every other fanned-out stage runs — reached the worker with no
 * documents and no drawings at all. The agent could only invent, and did.
 */
async function buildAgentParams(
  tenantId: string,
  projectId: string,
  agent: AgentRow,
  base: Record<string, unknown>
): Promise<Record<string, unknown>> {
    // §7.4 — the Document agent reads file page text (an ingestion input, not an
    // artifact type). The worker has no store access, so Core inlines the project's
    // ingested files into the envelope params.
    const params: Record<string, unknown> = { ...base };
    // Inline the project's name/client so agents can ground their outputs in the
    // real pursuit (rather than a hardcoded stub label).
    const proj = await queryOne<{ name: string; client_name: string | null }>(
      "SELECT name, client_name FROM project WHERE id = ? AND tenant_id = ?",
      [projectId, tenantId]
    );
    if (proj) { params.project_name = proj.name; params.client_name = proj.client_name ?? ""; }
    // §7.4 — agents that read the document set get the FILES, and the ones that
    // must reason over their contents get the extracted PAGE TEXT inlined too.
    // The worker has no store access by design, so if Core doesn't put the text in
    // the envelope the agent cannot analyse the upload at all — it can only invent.
    //
    // The declared consumes/produces are not sufficient here. The BOQ agent
    // consumes tender_summary and spec_clause, so on that test alone it would
    // read the SOW only second-hand, through another agent's summary of it. That
    // is precisely how scope goes missing: a preliminaries clause or an
    // "as required" instruction that no upstream stage happened to extract can
    // never appear in the bill. Anything that measures, prices or programmes
    // gets the source documents.
    const shortType = (t: string) => t.split(".").pop() ?? t;
    const WORKS_FROM_SOURCE = ["boq_line", "cost_line", "schedule_activity", "drawing_measurement", "procurement_package", "risk", "rfi"];
    const readsDocuments =
      agent.produces.some((p) => shortType(p) === "document") ||
      agent.consumes.some((c) => shortType(c) === "document") ||
      agent.produces.some((p) => WORKS_FROM_SOURCE.includes(shortType(p)));

    if (readsDocuments) {
      const files = await query<{ id: string; filename: string; mime: string; page_count: number }>(
        "SELECT id, filename, mime, page_count FROM file WHERE tenant_id = ? AND project_id = ? AND status = 'ingested' ORDER BY created_at ASC",
        [tenantId, projectId]
      );
      // No doc_type is sent. Stamping one here meant the classifier was told
      // the answer before it looked: the deterministic path echoed it straight
      // back, so a .dwg came out as a "tender letter", and the LLM path was
      // handed a false prior that contradicted its own instruction to judge
      // from content. It also emitted "tender_letter" under the underwriting
      // pack, which is not in that pack's doc_type enum at all.
      // mime is real signal; deciding the type is the agent's job.
      params.files = files.map((f) => ({
        id: f.id,
        filename: f.filename,
        mime: f.mime ?? null,
        page_count: f.page_count ?? 1,
      }));
      params.documents = await inlineDocumentText(tenantId, files);
    }

    // CAD is inlined for anything that measures, prices or programmes — not just
    // the drawings agent. A quantity surveyor pricing blockwork needs the wall
    // runs; a planner sequencing the works needs to know there are 148 luminaires.
    // The digest is already converted to metres and flags which numbers are
    // trustworthy, so the agent never has to interpret raw drawing units.
    const measuresWork = ["drawing_measurement", "boq_line", "cost_line", "schedule_activity", "spec_clause"];
    if (agent.produces.some((p) => measuresWork.includes(shortType(p))) || readsDocuments) {
      // Two queries, deliberately. Selecting c.summary alongside ORDER BY
      // f.created_at makes MySQL sort rows that carry the whole extraction
      // payload; on a real drawing set that exceeds sort_buffer_size and the
      // statement dies with ER_OUT_OF_SORTMEMORY. The run then never advances
      // past this point, so no job is ever enqueued and the BOQ silently stays
      // empty. Ordering a blob-free projection first keeps the sort tiny.
      const drawingFiles = await query<{ id: string; filename: string }>(
        `SELECT f.id, f.filename
           FROM cad_extraction c JOIN file f ON f.id = c.file_id
          WHERE c.tenant_id = ? AND c.project_id = ?
          ORDER BY f.created_at ASC LIMIT 20`,
        [tenantId, projectId]
      );
      let drawings: Array<{ filename: string; summary: any }> = [];
      if (drawingFiles.length) {
        const ph = drawingFiles.map(() => "?").join(",");
        const rows = await query<{ file_id: string; summary: any }>(
          `SELECT file_id, summary FROM cad_extraction
            WHERE tenant_id = ? AND file_id IN (${ph})`,
          [tenantId, ...drawingFiles.map((f) => f.id)]
        );
        const byFile = new Map(rows.map((r) => [r.file_id, r.summary]));
        drawings = drawingFiles
          .map((f) => ({ filename: f.filename, summary: byFile.get(f.id) }))
          .filter((d) => d.summary != null)
          .map((d) => ({
            filename: d.filename,
            // mysql2 gives JSON columns back parsed, but a driver/config change
            // that returns a string shouldn't silently blank the drawings.
            summary: typeof d.summary === "string" ? JSON.parse(d.summary) : d.summary,
          }));
      }
      if (drawings.length) {
        params.cad = cadDigest(drawings, CAD_DIGEST_BUDGET);

        // The bill is the one stage that interrogates the drawings rather than
        // reading a summary of them: its specialists call list_layers /
        // get_layer_geometry / count_blocks across turns. Those handlers run in
        // the worker, which has no database by design (§5.1), so the parsed
        // extractions travel in the envelope. Scoped to the BOQ agent on
        // purpose — every other stage is well served by the digest, and
        // inlining full extractions everywhere would bloat every envelope.
        // PDF drawing sheets, for the vision pre-pass. Only the PATHS travel —
        // rendered pages are hundreds of KB each and ai_job.envelope is a
        // database column, so the worker fetches them from the cad sidecar
        // itself. The sidecar has no database and no credentials either, so
        // nothing about the trust boundary changes; the images simply never
        // touch the row.
        if (agent.produces.some((p) => shortType(p) === "boq_line")) {
          const pdfs = await query<{ filename: string; storage_key: string }>(
            `SELECT filename, storage_key FROM file
              WHERE tenant_id = ? AND project_id = ? AND LOWER(filename) LIKE '%.pdf'
              ORDER BY created_at ASC LIMIT 8`,
            [tenantId, projectId]
          );
          if (pdfs.length) {
            params.drawing_pdfs = pdfs.map((f) => ({
              filename: f.filename,
              path: pathJoin(process.env.FILE_STORAGE_DIR ?? "./.uploads", f.storage_key),
            }));
          }
        }

        if (agent.produces.some((p) => shortType(p) === "boq_line")) {
          const full = drawings.map((d) => ({ ...d.summary, file: d.summary?.file ?? d.filename }));
          const bytes = JSON.stringify(full).length;
          if (bytes <= CAD_EXTRACTION_BUDGET) {
            params.cad_extractions = full;
          } else {
            // Rather than truncate mid-structure — which would hand the toolbox
            // a layer list that looks complete and isn't — drop the heaviest
            // per-entity arrays and keep the aggregates the take-off actually
            // measures from.
            params.cad_extractions = full.map((x) => ({
              ...x,
              textAnnotations: (x.textAnnotations ?? []).slice(0, 200),
              blockInstances: [],
              dimensions: (x.dimensions ?? []).slice(0, 200),
            }));
            params.cad_extractions_trimmed = true;
          }
        }
      }
    }

    /* What this workspace has been corrected on before.
       Matched against the records actually in front of this agent, never
       dumped: handing over everything ever learned would be thousands of tokens
       of preference about work this project does not contain. A handful of
       matched lines is cheaper than the review cycle it prevents. */
    {
      // The subjects come from the project's OWN records — a cost line is looked
      // up by the BOQ code it will price, and that code is already sitting in
      // this project's bill. One query, and a subject that matches no lesson
      // simply returns none.
      const here = await query<{ payload: any }>(
        `SELECT payload FROM artifact
          WHERE tenant_id = ? AND project_id = ? AND status <> 'superseded'
          ORDER BY created_at DESC LIMIT 400`,
        [tenantId, projectId]
      );
      for (const produced of agent.produces) {
        const subjects = subjectsOf(produced, here);
        if (!subjects.length) continue;
        const lessons = await lessonsFor(tenantId, produced, subjects);
        if (lessons.length) {
          params.lessons = [
            ...((params.lessons as any[]) ?? []),
            ...lessons.map((l) => ({ ...l, about: produced.split(".").pop() })),
          ];
        }
      }
    }

    // The estimator prices against the tenant's own rate book (§M). Without it the
    // agent invents rates from general knowledge instead of using the rates this
    // contractor actually wins work at.
    if (agent.produces.some((p) => p.split(".").pop() === "cost_line")) {
      params.rate_book = await query(
        `SELECT entry_key, payload FROM library_entry
          WHERE tenant_id = ? AND status = 'active' AND collection IN ('rate_book','standard')
          ORDER BY collection, entry_key LIMIT 400`,
        [tenantId]
      );
    }

    return params;
}

async function dispatchAgentStep(
  tenantId: string,
  projectId: string,
  runId: string,
  node: WfNode,
  step: any,
  def: WfDef,
  byNode: Map<string, any>
): Promise<void> {
  const agent = await getAgent(node.agent_key!);
  const jt =
    agent.job_types.find((j) => j.type === node.job_type) ??
    agent.job_types.find((j) => (node.job_type ? isTypeMatch(j.type, node.job_type) : false)) ??
    agent.job_types[0];
  const tier: Tier = jt?.tier ?? "deep";
  const promptRef = jt?.prompt_ref ?? `${jt?.type ?? node.agent_key}@v1`;
  const jobType = jt?.type ?? `${node.agent_key}.run`;

  // Inline the produced types + their JSON schemas so a domain-agnostic worker can
  // synthesize schema-valid outputs for ANY domain — including user-configured ones
  // the worker has never seen (there is no hardcoded case for them).
  const producedTypes = agent.produces.filter((p) => p !== "*");
  let produceSpec: Array<{ type: string; schema: any }> = [];
  if (producedTypes.length) {
    const ph = producedTypes.map(() => "?").join(",");
    const schemas = await query<{ key: string; payload_schema: any }>(
      `SELECT \`key\`, payload_schema FROM artifact_type WHERE \`key\` IN (${ph})`,
      producedTypes
    );
    produceSpec = schemas.map((s) => ({ type: s.key, schema: s.payload_schema }));
  }

  // Gather confirmed, current inputs for the agent's consumes types (§5.2 inlines).
  async function gatherInputs(extraIds?: string[]): Promise<JobInputArtifact[]> {
    const out: JobInputArtifact[] = [];
    for (const c of agent.consumes) {
      if (c === "*") continue;
      const rows = await query<{ id: string; type_key: string; payload: any }>(
        `SELECT id, type_key, payload FROM artifact
          WHERE tenant_id = ? AND project_id = ? AND ${typeMatchSql("type_key", c).sql} AND status = 'confirmed'`,
        [tenantId, projectId, ...typeMatchSql("type_key", c).params]
      );
      for (const r of rows) out.push({ id: r.id, type: r.type_key, payload: r.payload });
    }
    if (extraIds?.length) {
      const placeholders = extraIds.map(() => "?").join(",");
      const rows = await query<{ id: string; type_key: string; payload: any }>(
        `SELECT id, type_key, payload FROM artifact WHERE tenant_id = ? AND id IN (${placeholders})`,
        [tenantId, ...extraIds]
      );
      for (const r of rows)
        if (!out.find((o) => o.id === r.id))
          out.push({ id: r.id, type: r.type_key, payload: r.payload });
    }
    return out;
  }

  // Map fan-out: if a predecessor is a map node, run one child step per item.
  const mapPred = def.edges
    .filter((e) => e.to === node.id)
    .map((e) => def.nodes.find((n) => n.id === e.from))
    .find((n) => n?.kind === "map");

  if (mapPred) {
    const mapStep = byNode.get(mapPred.id);
    const items: string[] = mapStep?.output_artifact_ids ?? [];
    if (items.length === 0) {
      // §X.6 empty map — the fan-in agent completes with no children.
      await query(
        "UPDATE workflow_run_step SET status = 'completed', started_at = NOW(3), ended_at = NOW(3) WHERE id = ?",
        [step.id]
      );
      return;
    }
    await query("UPDATE workflow_run_step SET status = 'running', started_at = NOW(3) WHERE id = ?", [
      step.id,
    ]);
    let idx = 0;
    for (const itemId of items) {
      const childId = newId();
      await query(
        `INSERT INTO workflow_run_step
           (id, tenant_id, run_id, node_id, kind, agent_key, parent_step_id, map_index, status, input_artifact_ids, output_artifact_ids)
         VALUES (?,?,?,?, 'agent', ?, ?, ?, 'running', ?, '[]')`,
        [
          childId,
          tenantId,
          runId,
          node.id,
          node.agent_key,
          step.id,
          idx,
          JSON.stringify([itemId]),
        ]
      );
      const ctx: AgentContext = { tenantId, projectId, runId, stepId: childId, agentKey: node.agent_key! };
      const inputs = await gatherInputs([itemId]);
      const jobId = await enqueueJob({
        ctx,
        agentKind: agent.kind,
        jobType,
        tier,
        promptRef,
        inputArtifacts: inputs,
        params: await buildAgentParams(tenantId, projectId, agent, {
          map_index: idx,
          map_item_id: itemId,
          __produce: produceSpec,
        }),
        idempotencyKey: `${childId}:${jobType}:0`,
      });
      await query("UPDATE workflow_run_step SET job_id = ? WHERE id = ?", [jobId, childId]);
      idx++;
    }
    return;
  }

  // Single dispatch.
  await query("UPDATE workflow_run_step SET status = 'running', started_at = NOW(3), input_artifact_ids = ? WHERE id = ?", [
    JSON.stringify([]),
    step.id,
  ]);
  const ctx: AgentContext = { tenantId, projectId, runId, stepId: step.id, agentKey: node.agent_key! };
  const inputs = await gatherInputs();
  await query("UPDATE workflow_run_step SET input_artifact_ids = ? WHERE id = ?", [
    JSON.stringify(inputs.map((i) => i.id)),
    step.id,
  ]);

  const params = await buildAgentParams(tenantId, projectId, agent, { __produce: produceSpec });

  const jobId = await enqueueJob({
    ctx,
    agentKind: agent.kind,
    jobType,
    tier,
    promptRef,
    inputArtifacts: inputs,
    params,
    idempotencyKey: `${step.id}:${jobType}:${step.attempt ?? 0}`,
  });
  await query("UPDATE workflow_run_step SET job_id = ? WHERE id = ?", [jobId, step.id]);
}

// ── Job result (§4.3 step 3 / §5.1): materialize the worker's proposals through
// the ABI, complete the step, advance. Idempotent by job status.
/**
 * Inline the ingested page text of a project's files into a job envelope.
 *
 * Bounded on purpose. The envelope is POSTed to the worker and then embedded in
 * a model prompt, so an unbounded 400-page spec would blow both the request and
 * the context window. Each file gets a share of the budget and is truncated with
 * a marker, so an agent can SEE that it is working from an excerpt rather than
 * silently reasoning over a third of the document.
 */
const DOC_TEXT_BUDGET = Number(process.env.AGENT_DOC_TEXT_BUDGET ?? 120_000);
// The CAD digest is dense — every line is a number the agent may price from —
// so it gets its own budget rather than competing with the specification text.
const CAD_DIGEST_BUDGET = Number(process.env.AGENT_CAD_BUDGET ?? 20_000);
// Ceiling on the parsed extractions inlined into a BOQ envelope. This is stored
// in ai_job.envelope, so it is a row size as much as a prompt size; past this
// the per-entity arrays are dropped and the aggregates kept.
const CAD_EXTRACTION_BUDGET = Number(process.env.AGENT_CAD_EXTRACTION_BUDGET ?? 4_000_000);

async function inlineDocumentText(
  tenantId: string,
  files: { id: string; filename: string; mime: string; page_count: number }[]
): Promise<{ file_id: string; filename: string; page_count: number; text: string; truncated: boolean }[]> {
  if (files.length === 0) return [];
  const perFile = Math.max(4_000, Math.floor(DOC_TEXT_BUDGET / files.length));
  const out = [];
  for (const f of files) {
    const pages = await query<{ page_no: number; text: string }>(
      "SELECT page_no, text FROM file_page WHERE tenant_id = ? AND file_id = ? ORDER BY page_no ASC",
      [tenantId, f.id]
    );
    // Page markers survive truncation, so a clause the agent cites can still be
    // traced back to a page number.
    const joined = pages.map((p) => `\n[page ${p.page_no}]\n${p.text ?? ""}`).join("").trim();
    const truncated = joined.length > perFile;
    out.push({
      file_id: f.id,
      filename: f.filename,
      page_count: f.page_count ?? pages.length,
      text: truncated ? joined.slice(0, perFile) + "\n…[truncated]" : joined,
      truncated,
    });
  }
  return out;
}

export async function onJobResult(actor: AuditActor, result: JobResult): Promise<void> {
  const outcome = await tx(async (conn) => {
    const { job, alreadyDone } = await recordJobResult(result);
    if (alreadyDone) return null;

    const step = await queryOne<any>(
      "SELECT * FROM workflow_run_step WHERE job_id = ? AND tenant_id = ?",
      [result.job_id, job.tenant_id]
    );
    if (!step) return { tenantId: job.tenant_id, runId: job.run_id }; // supervisor/no-step job

    if (result.status === "failed") {
      await query("UPDATE workflow_run_step SET status = 'failed', ended_at = NOW(3) WHERE id = ?", [
        step.id,
      ]);
      await query("UPDATE workflow_run SET status = 'failed', ended_at = NOW(3) WHERE id = ?", [
        job.run_id,
      ]);
      await emitEvent(job.tenant_id, job.project_id, "run.failed", { run_id: job.run_id });
      return { tenantId: job.tenant_id, runId: job.run_id, terminal: true };
    }

    const ctx: AgentContext = {
      tenantId: job.tenant_id,
      projectId: job.project_id,
      runId: job.run_id,
      stepId: step.id,
      agentKey: job.agent_key,
    };
    const outIds: string[] = [];
    const specs: AuditSpec[] = [];
    for (const o of result.outputs ?? []) {
      const emitted = await emitArtifact(
        ctx,
        { type: o.type, payload: o.payload, provenance: o.provenance ?? [], confidence: o.confidence },
        (s) => specs.push(s)
      );
      outIds.push(emitted.id);
      if (emitted.status === "pending")
        await emitEvent(job.tenant_id, job.project_id, "proposal.pending", {
          artifact_id: emitted.id,
          type: o.type,
        });
    }
    for (const s of specs) await appendAudit(conn, actor, s);

    await query(
      "UPDATE workflow_run_step SET status = 'completed', output_artifact_ids = ?, ended_at = NOW(3) WHERE id = ?",
      [JSON.stringify(outIds), step.id]
    );

    // Map fan-in: if this was a child, roll up when all siblings complete.
    // FOR UPDATE is essential: two children completing concurrently would each
    // read the other as still-running under REPEATABLE READ and neither would
    // roll the parent up (run hangs). The locking read serializes them and sees
    // the latest committed sibling state, so the last child always rolls up.
    if (step.parent_step_id) {
      const siblings = await query<any>(
        "SELECT status, output_artifact_ids FROM workflow_run_step WHERE parent_step_id = ? AND tenant_id = ? FOR UPDATE",
        [step.parent_step_id, job.tenant_id]
      );
      const allDone = siblings.every((s) => s.status === "completed" || s.status === "skipped");
      if (allDone) {
        const agg = siblings.flatMap((s) => s.output_artifact_ids ?? []);
        await query(
          "UPDATE workflow_run_step SET status = 'completed', output_artifact_ids = ?, ended_at = NOW(3) WHERE id = ?",
          [JSON.stringify(agg), step.parent_step_id]
        );
      }
    }

    return { tenantId: job.tenant_id, runId: job.run_id };
  });

  if (outcome && !("terminal" in outcome) && outcome.runId)
    await advanceRun(outcome.tenantId, outcome.runId);
}

// ── Recompute run status: awaiting gate, completed, or failed.
async function recomputeRunStatus(
  tenantId: string,
  runId: string,
  projectId: string
): Promise<void> {
  const steps = await query<{ status: string }>(
    "SELECT status FROM workflow_run_step WHERE run_id = ? AND tenant_id = ? AND parent_step_id IS NULL",
    [runId, tenantId]
  );
  if (steps.some((s) => s.status === "failed")) return; // already failed
  if (steps.some((s) => s.status === "awaiting_review")) {
    await query(
      "UPDATE workflow_run SET status = 'awaiting_review' WHERE id = ? AND status NOT IN ('completed','failed','cancelled')",
      [runId]
    );
    return;
  }
  const allDone = steps.every((s) => s.status === "completed" || s.status === "skipped");
  if (allDone && steps.length > 0) {
    await query(
      "UPDATE workflow_run SET status = 'completed', ended_at = NOW(3) WHERE id = ? AND status NOT IN ('completed','failed','cancelled')",
      [runId]
    );
    await emitEvent(tenantId, projectId, "run.completed", { run_id: runId });
  } else {
    await query(
      "UPDATE workflow_run SET status = 'running' WHERE id = ? AND status NOT IN ('completed','failed','cancelled','awaiting_review')",
      [runId]
    );
  }
}

/**
 * §4.3 step 4 — after a human confirms an artifact, resume any gate whose gated
 * types are now fully resolved (no pending proposals of those types remain for
 * the run). Confirming the last gated artifact completes the gate + dispatches
 * downstream.
 */
export async function resumeGates(tenantId: string, runId: string): Promise<void> {
  const run = await queryOne<{ project_id: string; status: string }>(
    "SELECT project_id, status FROM workflow_run WHERE id = ? AND tenant_id = ?",
    [runId, tenantId]
  );
  if (!run) return;
  const gateSteps = await query<any>(
    "SELECT * FROM workflow_run_step WHERE run_id = ? AND tenant_id = ? AND kind = 'gate' AND status = 'awaiting_review'",
    [runId, tenantId]
  );
  for (const gate of gateSteps) {
    const types: string[] = gate.gate_types ?? [];
    if (await gateResolved(tenantId, runId, types)) {
      await query(
        "UPDATE workflow_run_step SET status = 'completed', ended_at = NOW(3) WHERE id = ?",
        [gate.id]
      );
    }
  }
  await advanceRun(tenantId, runId);
}

/**
 * §4.4 — partial re-run: re-execute only the steps whose outputs are now stale,
 * superseding those artifacts with fresh versions. The rest of the run is
 * untouched. Returns the number of steps re-dispatched.
 */
export async function rerunStale(
  actor: AuditActor,
  tenantId: string,
  runId: string
): Promise<number> {
  const run = await queryOne<{ project_id: string; workflow_key: string }>(
    "SELECT project_id, workflow_key FROM workflow_run WHERE id = ? AND tenant_id = ?",
    [runId, tenantId]
  );
  if (!run) throw errNotFound("Run");
  const wf = await getWorkflow(run.workflow_key);

  // Steps that produced at least one now-stale artifact.
  const staleSteps = await query<any>(
    `SELECT DISTINCT s.* FROM workflow_run_step s
       JOIN artifact a ON a.source_step_id = s.id
      WHERE s.run_id = ? AND s.tenant_id = ? AND a.status = 'stale' AND s.parent_step_id IS NULL`,
    [runId, tenantId]
  );
  if (staleSteps.length === 0) return 0;

  const byNode = new Map(
    (
      await query<any>(
        "SELECT * FROM workflow_run_step WHERE run_id = ? AND tenant_id = ? AND parent_step_id IS NULL",
        [runId, tenantId]
      )
    ).map((s) => [s.node_id, s])
  );

  for (const step of staleSteps) {
    const node = wf.definition.nodes.find((n) => n.id === step.node_id)!;
    // supersede the step's stale outputs
    await query(
      "UPDATE artifact SET status = 'superseded' WHERE source_step_id = ? AND tenant_id = ? AND status = 'stale'",
      [step.id, tenantId]
    );
    await query(
      "UPDATE workflow_run_step SET status = 'pending', attempt = attempt + 1, job_id = NULL, output_artifact_ids = '[]' WHERE id = ?",
      [step.id]
    );
    step.attempt = (step.attempt ?? 0) + 1; // keep the in-memory step in sync for the idempotency key
    await dispatchAgentStep(tenantId, run.project_id, runId, node, step, wf.definition, byNode);
  }

  await tx(async (conn) => {
    await appendAudit(conn, actor, {
      action: "run.rerun_stale",
      targetKind: "run",
      targetId: runId,
      projectId: run.project_id,
      summary: { steps: staleSteps.length },
    });
  });
  return staleSteps.length;
}

export async function cancelRun(
  actor: AuditActor,
  tenantId: string,
  runId: string
): Promise<void> {
  await tx(async (conn) => {
    await query(
      "UPDATE workflow_run SET status = 'cancelled', ended_at = NOW(3) WHERE id = ? AND tenant_id = ?",
      [runId, tenantId]
    );
    await query(
      "UPDATE ai_job SET status = 'cancelled' WHERE run_id = ? AND tenant_id = ? AND status IN ('queued','running')",
      [runId, tenantId]
    );
    await appendAudit(conn, actor, {
      action: "run.cancel",
      targetKind: "run",
      targetId: runId,
      summary: {},
    });
  });
}
