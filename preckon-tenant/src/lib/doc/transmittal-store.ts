/**
 * Transmittal persistence.
 *
 * The rules live in transmittal.ts and are pure. This applies them.
 *
 * Separate from store.ts because transmittals are the one part of DocLogix that
 * reaches outside the organisation — once sent, the record is evidence, and the
 * write paths that create that evidence are worth keeping in one place where
 * they can be read together.
 */

import { query, queryOne, tx } from "@/lib/db";
import { newId } from "@/lib/ids";
import {
  type Transmittal,
  validateForSending, derivedStatus, acknowledgementSummary, recallBlockedReason,
} from "./transmittal";

/** Load a transmittal with everything needed to reason about it. */
export async function loadTransmittal(tenantId: string, id: string): Promise<Transmittal | null> {
  const head = await queryOne<any>(
    `SELECT id, transmittal_number, status, purpose,
            DATE_FORMAT(sent_at, '%Y-%m-%dT%H:%i:%sZ') AS sent_at,
            DATE_FORMAT(required_response_at, '%Y-%m-%d') AS required_response_at
       FROM transmittal WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  if (!head) return null;

  const items = await query<any>(
    `SELECT i.revision_id, i.document_number, i.revision_code, v.state AS revision_state
       FROM transmittal_item i
       LEFT JOIN document_revision v ON v.id = i.revision_id
      WHERE i.transmittal_id = ? AND i.tenant_id = ?
      ORDER BY i.seq, i.document_number`,
    [id, tenantId],
  );

  const recipients = await query<any>(
    `SELECT party, requires_ack, ack, DATE_FORMAT(ack_at, '%Y-%m-%dT%H:%i:%sZ') AS ack_at
       FROM transmittal_recipient WHERE transmittal_id = ? AND tenant_id = ? ORDER BY kind, party`,
    [id, tenantId],
  );

  return {
    id: head.id,
    number: head.transmittal_number,
    status: head.status,
    purpose: head.purpose,
    sentAt: head.sent_at,
    requiredResponseAt: head.required_response_at,
    items: items.map((i) => ({
      revisionId: i.revision_id,
      documentNumber: i.document_number,
      revisionCode: i.revision_code,
      revisionState: i.revision_state ?? undefined,
    })),
    recipients: recipients.map((r) => ({
      party: r.party,
      requiresAck: !!r.requires_ack,
      ack: r.ack,
      ackAt: r.ack_at,
    })),
  };
}

/** Next transmittal number on the project. */
async function nextTransmittalNumber(tenantId: string, projectId: string): Promise<string> {
  const row = await queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(transmittal_number, '-', -1) AS UNSIGNED)), 0) AS n
       FROM transmittal WHERE tenant_id = ? AND project_id = ?`,
    [tenantId, projectId],
  );
  return `TR-${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}

export interface CreateTransmittalInput {
  purpose: string;
  subject?: string | null;
  instructions?: string | null;
  senderParty?: string | null;
  requiredResponseAt?: string | null;
  revisionIds: string[];
  recipients: { party: string; kind?: "to" | "cc"; email?: string | null }[];
  userId?: string | null;
}

export async function createTransmittal(
  tenantId: string, projectId: string, input: CreateTransmittalInput,
) {
  return tx(async (conn) => {
    const number = await nextTransmittalNumber(tenantId, projectId);
    const id = newId();

    await conn.query(
      `INSERT INTO transmittal
         (id, tenant_id, project_id, transmittal_number, subject, purpose, instructions,
          sender_party, sender_user_id, required_response_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, tenantId, projectId, number, input.subject ?? null, input.purpose,
       input.instructions ?? null, input.senderParty ?? null, input.userId ?? null,
       input.requiredResponseAt ?? null, input.userId ?? null],
    );

    let seq = 0;
    for (const revisionId of input.revisionIds) {
      // Read the document number and revision code across at add time. The line
      // must still read correctly years later even if the register is
      // reorganised around it.
      const [found] = await conn.query<any[]>(
        `SELECT v.id, v.revision_code, d.document_number
           FROM document_revision v JOIN document_register d ON d.id = v.document_id
          WHERE v.tenant_id = ? AND v.id = ?`,
        [tenantId, revisionId],
      );
      const rev = (found as any[])[0];
      if (!rev) throw new Error("One of the selected revisions was not found on this tenant.");
      await conn.query(
        `INSERT INTO transmittal_item
           (id, tenant_id, transmittal_id, revision_id, document_number, revision_code, seq)
         VALUES (?,?,?,?,?,?,?)`,
        [newId(), tenantId, id, rev.id, rev.document_number, rev.revision_code, seq++],
      );
    }

    for (const r of input.recipients) {
      const kind = r.kind ?? "to";
      // A copied-in party is informed, not asked. Making cc owe an
      // acknowledgement holds transmittals open forever on people who were only
      // ever being kept in the loop.
      await conn.query(
        `INSERT INTO transmittal_recipient
           (id, tenant_id, transmittal_id, party, email, kind, requires_ack)
         VALUES (?,?,?,?,?,?,?)`,
        [newId(), tenantId, id, r.party, r.email ?? null, kind, kind === "to" ? 1 : 0],
      );
    }

    return { id, number };
  });
}

/**
 * Send it.
 *
 * Freezing every revision on the transmittal is the point of the operation:
 * from this moment somebody outside holds a copy, and the register must not be
 * able to disagree with what is on their desk.
 */
export async function sendTransmittal(tenantId: string, id: string) {
  const t = await loadTransmittal(tenantId, id);
  if (!t) throw new Error("Transmittal not found.");

  const issues = validateForSending(t);
  if (issues.length) {
    const err = new Error(issues.map((i) => i.message).join(" ")) as Error & { issues?: unknown };
    err.issues = issues;
    throw err;
  }

  return tx(async (conn) => {
    await conn.query(
      `UPDATE transmittal SET status = 'sent', sent_at = NOW(3)
        WHERE tenant_id = ? AND id = ? AND status = 'draft'`,
      [tenantId, id],
    );

    const revisionIds = t.items.map((i) => i.revisionId);
    if (revisionIds.length) {
      await conn.query(
        `UPDATE document_revision
            SET frozen = 1, issued_at = COALESCE(issued_at, NOW(3))
          WHERE id IN (?)`,
        [revisionIds],
      );
    }

    return { id, number: t.number, items: revisionIds.length, recipients: t.recipients.length };
  });
}

export async function acknowledgeTransmittal(
  tenantId: string, id: string, party: string,
  ack: "acknowledged" | "declined" = "acknowledged", note?: string | null,
) {
  const res = await query<any>(
    `UPDATE transmittal_recipient
        SET ack = ?, ack_at = NOW(3), ack_note = ?
      WHERE tenant_id = ? AND transmittal_id = ? AND party = ?`,
    [ack, note ?? null, tenantId, id, party],
  );
  if (!(res as any)?.affectedRows) {
    throw new Error(`${party} is not a recipient of this transmittal.`);
  }

  // Keep the stored status in step with the acknowledgements that justify it —
  // a status that disagrees with its own evidence is the kind of thing nobody
  // notices until an audit.
  const t = await loadTransmittal(tenantId, id);
  if (!t) return { status: "sent" as const, summary: "" };

  const derived = derivedStatus(t);
  if (derived !== t.status) {
    await query("UPDATE transmittal SET status = ? WHERE tenant_id = ? AND id = ?", [derived, tenantId, id]);
  }
  return { status: derived, ...acknowledgementSummary(t) };
}

export async function recallTransmittal(tenantId: string, id: string, reason: string) {
  const t = await loadTransmittal(tenantId, id);
  if (!t) throw new Error("Transmittal not found.");

  const blocked = recallBlockedReason(t);
  if (blocked) throw new Error(blocked);

  // Recall never deletes. The recipient received it, and pretending otherwise is
  // exactly the falsehood the transmittal record exists to prevent.
  await query(
    `UPDATE transmittal SET status = 'recalled', recalled_at = NOW(3), recall_reason = ?
      WHERE tenant_id = ? AND id = ?`,
    [reason, tenantId, id],
  );
  return { id, number: t.number };
}

/** The transmittal register. */
export async function listTransmittals(tenantId: string, projectId: string) {
  return query<any>(
    `SELECT t.id, t.transmittal_number, t.status, t.purpose, t.subject, t.sender_party,
            DATE_FORMAT(t.sent_at, '%Y-%m-%d %H:%i') AS sent_at,
            DATE_FORMAT(t.required_response_at, '%Y-%m-%d') AS required_response_at,
            (SELECT COUNT(*) FROM transmittal_item i WHERE i.transmittal_id = t.id AND i.tenant_id = t.tenant_id) AS item_count,
            (SELECT COUNT(*) FROM transmittal_recipient r WHERE r.transmittal_id = t.id AND r.tenant_id = t.tenant_id) AS recipient_count,
            (SELECT COUNT(*) FROM transmittal_recipient r
              WHERE r.transmittal_id = t.id AND r.tenant_id = t.tenant_id AND r.requires_ack = 1 AND r.ack = 'pending') AS pending_ack
       FROM transmittal t
      WHERE t.tenant_id = ? AND t.project_id = ?
      ORDER BY t.transmittal_number DESC`,
    [tenantId, projectId],
  );
}
