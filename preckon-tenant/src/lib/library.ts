import { uuidv7 } from "uuidv7";
import { query, queryOne, tx } from "./db";
import { appendAudit, type AuditActor } from "./audit";
import { errBadRequest, errNotFound } from "./errors";

// ── The tenant Library (§M): cross-project reference data + memory the assistant
// draws on — rate books, glossaries, policies, standards, promoted precedent.
// Domain-neutral: a "collection" is any label the tenant chooses, an "entry" is a
// key + a JSON payload. Edits version (supersede), so history is preserved. Every
// change is audited on the tenant chain.

export async function listCollections(tenantId: string): Promise<Array<{ collection: string; entries: number }>> {
  return query(
    "SELECT collection, COUNT(*) AS entries FROM library_entry WHERE tenant_id = ? AND status = 'active' GROUP BY collection ORDER BY collection",
    [tenantId]
  );
}

const cleanCollection = (c: string) => c.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

export interface EntryInput { collection: string; entryKey?: string; payload: Record<string, unknown>; }

/** Add a reference entry to a collection. */
export async function addEntry(actor: AuditActor, tenantId: string, userId: string, input: EntryInput): Promise<{ id: string }> {
  const collection = cleanCollection(input.collection ?? "");
  if (!collection) throw errBadRequest("A collection is required");
  if (!input.payload || typeof input.payload !== "object") throw errBadRequest("Payload must be an object");
  const id = uuidv7();
  await tx(async (conn) => {
    await conn.query(
      "INSERT INTO library_entry (id, tenant_id, collection, entry_key, payload, status, created_by) VALUES (?,?,?,?,?, 'active', ?)",
      [id, tenantId, collection, input.entryKey?.trim() || null, JSON.stringify(input.payload), userId]
    );
    await appendAudit(conn, actor, { action: "library.add", targetKind: "library_entry", targetId: id, summary: { collection, entry_key: input.entryKey ?? null } });
  });
  return { id };
}

/** Edit an entry — supersede the current version and write a new one (v+1). */
export async function updateEntry(
  actor: AuditActor,
  tenantId: string,
  id: string,
  userId: string,
  patch: { entryKey?: string | null; payload?: Record<string, unknown> }
): Promise<{ id: string }> {
  const cur = await queryOne<{ id: string; collection: string; entry_key: string | null; payload: any; version: number }>(
    "SELECT id, collection, entry_key, payload, version FROM library_entry WHERE id = ? AND tenant_id = ? AND status = 'active'",
    [id, tenantId]
  );
  if (!cur) throw errNotFound("Library entry");
  const newId = uuidv7();
  const entryKey = patch.entryKey !== undefined ? (patch.entryKey?.trim() || null) : cur.entry_key;
  const payload = patch.payload ?? cur.payload;
  await tx(async (conn) => {
    await conn.query("UPDATE library_entry SET status = 'superseded', updated_at = NOW(3) WHERE id = ? AND tenant_id = ?", [id, tenantId]);
    await conn.query(
      "INSERT INTO library_entry (id, tenant_id, collection, entry_key, payload, version, supersedes_id, status, created_by) VALUES (?,?,?,?,?,?,?, 'active', ?)",
      [newId, tenantId, cur.collection, entryKey, JSON.stringify(payload), cur.version + 1, id, userId]
    );
    await appendAudit(conn, actor, { action: "library.edit", targetKind: "library_entry", targetId: newId, summary: { collection: cur.collection, supersedes: id, version: cur.version + 1 } });
  });
  return { id: newId };
}

/** Remove an entry from the active set (soft — history is kept). */
export async function removeEntry(actor: AuditActor, tenantId: string, id: string): Promise<void> {
  const cur = await queryOne<{ id: string; collection: string }>(
    "SELECT id, collection FROM library_entry WHERE id = ? AND tenant_id = ? AND status = 'active'",
    [id, tenantId]
  );
  if (!cur) throw errNotFound("Library entry");
  await tx(async (conn) => {
    await conn.query("UPDATE library_entry SET status = 'superseded', updated_at = NOW(3) WHERE id = ? AND tenant_id = ?", [id, tenantId]);
    await appendAudit(conn, actor, { action: "library.remove", targetKind: "library_entry", targetId: id, summary: { collection: cur.collection } });
  });
}
