/**
 * BIM — persistence for user-authored tools.
 *
 * Thin on purpose. Everything that decides whether a definition is acceptable
 * lives in authoring.ts, so validation cannot differ between the save path and
 * the run path — a tool that saved must be a tool that runs, and a tool that
 * stops being valid must be skipped rather than crash the assistant.
 */

import { uuidv7 } from "uuidv7";
import { query, queryOne } from "../db";
import { errBadRequest, errNotFound } from "../errors";
import type { AuthoredToolDef } from "./authoring";
import type { ToolParam } from "./registry";

interface Row {
  id: string;
  name: string;
  label: string;
  module: string;
  description: string;
  params: ToolParam[] | string;
  steps: AuthoredToolDef["steps"] | string;
  keywords: string[] | string | null;
  owner_id: string;
  updated_at: string;
}

/** MySQL JSON columns come back parsed on some drivers and as text on others. */
const asJson = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

const toDef = (r: Row): AuthoredToolDef => ({
  name: r.name,
  label: r.label,
  module: r.module,
  description: r.description,
  owner: r.owner_id,
  params: asJson<ToolParam[]>(r.params, []),
  steps: asJson<AuthoredToolDef["steps"]>(r.steps, []),
  keywords: asJson<string[]>(r.keywords, []),
});

/** Everything this user may run. Personal scope means owner-only, by query. */
export async function loadAuthoredTools(tenantId: string, userId: string): Promise<AuthoredToolDef[]> {
  const rows = await query<Row>(
    "SELECT id, name, label, module, description, params, steps, keywords, owner_id, updated_at FROM bim_authored_tool WHERE tenant_id = ? AND owner_id = ? ORDER BY updated_at DESC",
    [tenantId, userId],
  );
  return rows.map(toDef);
}

export async function listAuthoredTools(tenantId: string, userId: string): Promise<(AuthoredToolDef & { id: string; updatedAt: string })[]> {
  const rows = await query<Row>(
    "SELECT id, name, label, module, description, params, steps, keywords, owner_id, updated_at FROM bim_authored_tool WHERE tenant_id = ? AND owner_id = ? ORDER BY updated_at DESC",
    [tenantId, userId],
  );
  return rows.map((r) => ({ ...toDef(r), id: r.id, updatedAt: r.updated_at }));
}

export async function saveAuthoredTool(input: {
  tenantId: string;
  userId: string;
  def: AuthoredToolDef;
}): Promise<string> {
  const { tenantId, userId, def } = input;

  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM bim_authored_tool WHERE tenant_id = ? AND owner_id = ? AND name = ?",
    [tenantId, userId, def.name],
  );

  const params = JSON.stringify(def.params ?? []);
  const steps = JSON.stringify(def.steps ?? []);
  const keywords = JSON.stringify(def.keywords ?? []);

  if (existing) {
    await query(
      "UPDATE bim_authored_tool SET label = ?, module = ?, description = ?, params = ?, steps = ?, keywords = ? WHERE id = ? AND tenant_id = ?",
      [def.label, def.module || "My Tools", def.description, params, steps, keywords, existing.id, tenantId],
    );
    return existing.id;
  }

  const id = uuidv7();
  await query(
    "INSERT INTO bim_authored_tool (id, tenant_id, name, label, module, description, params, steps, keywords, owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, tenantId, def.name, def.label, def.module || "My Tools", def.description, params, steps, keywords, userId],
  );
  return id;
}

export async function deleteAuthoredTool(tenantId: string, userId: string, id: string): Promise<void> {
  // Scoped by owner as well as tenant: deleting by id alone would let one user
  // remove another's tool if an id ever leaked.
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM bim_authored_tool WHERE id = ? AND tenant_id = ? AND owner_id = ?",
    [id, tenantId, userId],
  );
  if (!row) throw errNotFound("That tool does not exist.");
  await query("DELETE FROM bim_authored_tool WHERE id = ? AND tenant_id = ?", [id, tenantId]);
}

/** Guard the shape before it reaches validation, so a bad body is a 400. */
export function parseDef(body: unknown, owner: string): AuthoredToolDef {
  const b = body as Partial<AuthoredToolDef>;
  if (!b || typeof b !== "object") throw errBadRequest("A tool definition is required.");
  if (!Array.isArray(b.steps)) throw errBadRequest("steps must be an array.");
  return {
    name: String(b.name ?? ""),
    label: String(b.label ?? ""),
    module: String(b.module ?? "My Tools"),
    description: String(b.description ?? ""),
    owner,
    params: Array.isArray(b.params) ? b.params : [],
    steps: b.steps,
    keywords: Array.isArray(b.keywords) ? b.keywords : [],
  };
}
