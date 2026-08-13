import { uuidv7 } from "uuidv7";
import { query, queryOne } from "../db";
import { errBadRequest, errNotFound } from "../errors";
import type { BimDocument } from "./model";

// What the assistant would do, before it does it.
//
// The drawing assistant used to write its result straight into bim_document.
// The user saw the model change and had undo, which is not the same thing as
// having agreed to it — and it is the pattern both blueprints forbid outright:
//
//   "Never let an LLM directly mutate production model state."
//   LLM -> geometry database mutation: FORBIDDEN.
//
// So the result is held here instead. A human reads what changed, and applies
// it or throws it away. The document that gets committed is the one the model
// produced and the reviewer read — kept server-side rather than round-tripped
// through the page, so the two cannot differ.

export interface DocDiff {
  added: Array<{ id: string; label: string }>;
  changed: Array<{ id: string; label: string; fields: string[] }>;
  removed: Array<{ id: string; label: string }>;
  /** A sentence for the button, so a reviewer knows the size of the thing
   *  before opening the detail. */
  summary: string;
}

const label = (el: any): string =>
  el?.name || [el?.discipline, el?.category].filter(Boolean).join(" ") || "element";

/** The fields worth reporting a change in. A repositioned wall matters; an
 *  internal sequence number does not, and listing it trains people to skim. */
const WATCHED = ["category", "discipline", "level", "name", "geom", "params"];

/**
 * What changed between two documents, in the terms a reader thinks in.
 *
 * Deliberately not a JSON diff. "4 walls added, 1 door moved" is a decision
 * somebody can make; a page of nested object deltas is one they will approve
 * without reading, which is worse than not asking them at all.
 */
export function diffDocuments(before: BimDocument, after: BimDocument): DocDiff {
  const b = before?.elements ?? {};
  const a = after?.elements ?? {};

  const added = Object.keys(a).filter((id) => !b[id]).map((id) => ({ id, label: label(a[id]) }));
  const removed = Object.keys(b).filter((id) => !a[id]).map((id) => ({ id, label: label(b[id]) }));

  const changed: DocDiff["changed"] = [];
  for (const id of Object.keys(a)) {
    if (!b[id]) continue;
    const fields = WATCHED.filter((f) => JSON.stringify((b[id] as any)[f]) !== JSON.stringify((a[id] as any)[f]));
    if (fields.length) changed.push({ id, label: label(a[id]), fields });
  }

  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} added`);
  if (changed.length) parts.push(`${changed.length} changed`);
  if (removed.length) parts.push(`${removed.length} removed`);

  return { added, changed, removed, summary: parts.join(", ") || "no change" };
}

export interface Proposal {
  id: string;
  baseVersion: number;
  instruction: string;
  specialist: string | null;
  diff: DocDiff;
  reply: string | null;
  status: string;
  createdAt: string;
}

export async function saveProposal(input: {
  tenantId: string; projectId: string; userId: string;
  baseVersion: number; instruction: string; specialist: string;
  doc: BimDocument; diff: DocDiff; reply: string;
}): Promise<string> {
  const id = uuidv7();
  await query(
    `INSERT INTO bim_proposal
       (id, tenant_id, project_id, base_version, instruction, specialist, doc, diff, reply, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.tenantId, input.projectId, input.baseVersion, input.instruction.slice(0, 2000),
     input.specialist, JSON.stringify(input.doc), JSON.stringify(input.diff), input.reply, input.userId]
  );
  return id;
}

export async function getProposal(tenantId: string, projectId: string, id: string) {
  const row = await queryOne<{
    id: string; base_version: number; instruction: string; specialist: string | null;
    doc: any; diff: any; reply: string | null; status: string;
  }>(
    `SELECT id, base_version, instruction, specialist, doc, diff, reply, status
       FROM bim_proposal WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    [tenantId, projectId, id]
  );
  if (!row) throw errNotFound("proposal");
  if (row.status !== "PROPOSED") {
    throw errBadRequest(`That proposal was already ${row.status.toLowerCase()}.`);
  }
  return {
    ...row,
    doc: (typeof row.doc === "string" ? JSON.parse(row.doc) : row.doc) as BimDocument,
    diff: (typeof row.diff === "string" ? JSON.parse(row.diff) : row.diff) as DocDiff,
  };
}

export async function decideProposal(tenantId: string, id: string, status: "APPLIED" | "DISCARDED") {
  await query(
    "UPDATE bim_proposal SET status = ?, decided_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [status, tenantId, id]
  );
}

/** The one still open, if any — so a reload does not lose an unanswered
 *  proposal, and so two cannot pile up unnoticed. */
export async function openProposal(tenantId: string, projectId: string): Promise<Proposal | null> {
  const row = await queryOne<any>(
    `SELECT id, base_version, instruction, specialist, diff, reply, status, created_at
       FROM bim_proposal
      WHERE tenant_id = ? AND project_id = ? AND status = 'PROPOSED'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, projectId]
  );
  if (!row) return null;
  return {
    id: row.id,
    baseVersion: row.base_version,
    instruction: row.instruction,
    specialist: row.specialist,
    diff: typeof row.diff === "string" ? JSON.parse(row.diff) : row.diff,
    reply: row.reply,
    status: row.status,
    createdAt: row.created_at,
  };
}
