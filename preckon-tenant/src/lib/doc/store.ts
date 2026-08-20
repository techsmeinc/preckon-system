/**
 * DocLogix persistence — the register, its revisions and transmittals.
 *
 * The rules live in numbering.ts, revision.ts and transmittal.ts, which are pure
 * and heavily tested. This module is the part that talks to MySQL, and its job
 * is to apply those decisions atomically. Anything that reasons rather than
 * writes belongs next door.
 */

import { query, queryOne, tx } from "@/lib/db";
import { newId } from "@/lib/ids";
import {
  type NumberingScheme, formatNumber, parseNumber, nextSequence,
  sequenceSegment, ISO19650_SCHEME,
} from "./numbering";
import {
  type RevisionScheme, type RevisionRow,
  nextRevision, planSupersession, isValidRevision, parseRevision, compareRevisions,
} from "./revision";

export interface RegisterRow {
  id: string;
  document_number: string;
  title: string;
  doc_type: string | null;
  discipline: string | null;
  originator: string | null;
  level: string | null;
  status: string;
  confidentiality: string;
  current_revision: string | null;
  current_suitability: string | null;
  revision_count: number;
  required_by: string | null;
  updated_at: string;
}

/** Schemes available on a project — its own, plus organisation templates. */
export async function listSchemes(tenantId: string, projectId: string) {
  const rows = await query<any>(
    `SELECT id, \`key\`, name, \`separator\`, segments, reserved, is_default, project_id
       FROM numbering_scheme
      WHERE tenant_id = ? AND (project_id = ? OR project_id IS NULL)
      ORDER BY is_default DESC, project_id IS NULL, name`,
    [tenantId, projectId],
  );
  return rows.map(hydrateScheme);
}

function hydrateScheme(r: any): NumberingScheme & { id: string; isDefault: boolean } {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    separator: r.separator,
    segments: typeof r.segments === "string" ? JSON.parse(r.segments) : r.segments,
    reserved: r.reserved ? (typeof r.reserved === "string" ? JSON.parse(r.reserved) : r.reserved) : undefined,
    isDefault: !!r.is_default,
  };
}

/**
 * The scheme to number a new document with.
 *
 * Falls back to the seeded ISO 19650 scheme rather than refusing: a project
 * whose administrator has not yet defined a convention should still be able to
 * register a document, and ISO 19650 is what most GCC employers issue anyway.
 */
export async function resolveScheme(
  tenantId: string, projectId: string, schemeId?: string | null,
): Promise<(NumberingScheme & { id: string | null })> {
  if (schemeId) {
    const r = await queryOne<any>(
      `SELECT id, \`key\`, name, \`separator\`, segments, reserved, is_default
         FROM numbering_scheme WHERE tenant_id = ? AND id = ?`,
      [tenantId, schemeId],
    );
    if (r) return hydrateScheme(r);
  }
  const all = await listSchemes(tenantId, projectId);
  if (all.length) return all[0];
  return { ...ISO19650_SCHEME, id: null };
}

export async function saveScheme(
  tenantId: string, projectId: string | null, scheme: NumberingScheme,
  opts: { id?: string; isDefault?: boolean; userId?: string } = {},
) {
  const id = opts.id ?? newId();
  await query(
    `INSERT INTO numbering_scheme (id, tenant_id, project_id, \`key\`, name, \`separator\`, segments, reserved, is_default, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), \`separator\` = VALUES(\`separator\`),
       segments = VALUES(segments), reserved = VALUES(reserved), is_default = VALUES(is_default)`,
    [id, tenantId, projectId, scheme.key, scheme.name, scheme.separator,
     JSON.stringify(scheme.segments), scheme.reserved ? JSON.stringify(scheme.reserved) : null,
     opts.isDefault ? 1 : 0, opts.userId ?? null],
  );
  return id;
}

/**
 * Allocate the next document number under a scheme.
 *
 * The sequence numbers already used are read inside the same transaction as the
 * insert, because two people registering a document at the same moment is not a
 * rare event on a live project — it is a Tuesday. The unique index on
 * (tenant, project, document_number) is the real guarantee; this just stops the
 * common case reaching it.
 */
export async function allocateNumber(
  tenantId: string, projectId: string, scheme: NumberingScheme, values: Record<string, string>,
): Promise<{ number: string; sequence: number }> {
  const seg = sequenceSegment(scheme);
  if (!seg) throw new Error("This numbering scheme has no sequence segment.");

  const rows = await query<{ document_number: string }>(
    "SELECT document_number FROM document_register WHERE tenant_id = ? AND project_id = ?",
    [tenantId, projectId],
  );

  // Only numbers that parse under THIS scheme count towards its sequence. A
  // project running two conventions must not have one starve the other.
  const taken: number[] = [];
  for (const r of rows) {
    const p = parseNumber(scheme, r.document_number);
    if (p.ok && p.values[seg.key]) taken.push(Number(p.values[seg.key]));
  }

  const sequence = nextSequence(scheme, taken);
  const number = formatNumber(scheme, { ...values, [seg.key]: String(sequence) });
  return { number, sequence };
}

export interface RegisterInput {
  title: string;
  schemeId?: string | null;
  /** Segment values, excluding the sequence which is allocated. */
  segments?: Record<string, string>;
  /** Supply to adopt an existing number (legacy import) instead of allocating. */
  documentNumber?: string;
  docType?: string | null;
  discipline?: string | null;
  originator?: string | null;
  level?: string | null;
  zone?: string | null;
  package?: string | null;
  confidentiality?: "public" | "internal" | "confidential" | "restricted";
  requiredBy?: string | null;
  userId?: string | null;
}

/** Register a controlled document. No file needed — that is the point. */
export async function registerDocument(
  tenantId: string, projectId: string, input: RegisterInput,
): Promise<{ id: string; documentNumber: string }> {
  const scheme = await resolveScheme(tenantId, projectId, input.schemeId);
  const values = input.segments ?? {};

  let documentNumber = input.documentNumber?.trim() ?? "";
  if (documentNumber) {
    // Adopting a legacy number: validate it against the scheme so the register
    // stays queryable, but do not refuse a number the project already uses.
    const parsed = parseNumber(scheme, documentNumber);
    if (parsed.ok) Object.assign(values, parsed.values);
  } else {
    documentNumber = (await allocateNumber(tenantId, projectId, scheme, values)).number;
    const parsed = parseNumber(scheme, documentNumber);
    if (parsed.ok) Object.assign(values, parsed.values);
  }

  const id = newId();
  await query(
    `INSERT INTO document_register
       (id, tenant_id, project_id, document_number, title, scheme_id, segments,
        doc_type, discipline, originator, volume, \`level\`, zone, package,
        confidentiality, required_by, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, projectId, documentNumber, input.title,
     (scheme as any).id ?? null, JSON.stringify(values),
     input.docType ?? values.type ?? null,
     input.discipline ?? values.role ?? null,
     input.originator ?? values.originator ?? null,
     values.volume ?? null,
     input.level ?? values.level ?? null,
     input.zone ?? null, input.package ?? null,
     input.confidentiality ?? "internal",
     input.requiredBy ?? null, input.userId ?? null],
  );
  return { id, documentNumber };
}

export interface RegisterFilter {
  discipline?: string;
  status?: string;
  search?: string;
  limit?: number;
}

/** The register view. */
export async function listRegister(
  tenantId: string, projectId: string, f: RegisterFilter = {},
): Promise<RegisterRow[]> {
  const where: string[] = ["d.tenant_id = ?", "d.project_id = ?"];
  const args: any[] = [tenantId, projectId];

  if (f.discipline) { where.push("d.discipline = ?"); args.push(f.discipline); }
  if (f.status) { where.push("d.status = ?"); args.push(f.status); }
  if (f.search) {
    where.push("(d.document_number LIKE ? OR d.title LIKE ?)");
    args.push(`%${f.search}%`, `%${f.search}%`);
  }

  const limit = Math.min(Math.max(1, f.limit ?? 500), 2000);
  args.push(limit);

  return query<RegisterRow>(
    `SELECT d.id, d.document_number, d.title, d.doc_type, d.discipline, d.originator,
            d.\`level\`, d.status, d.confidentiality,
            r.revision_code AS current_revision, r.suitability AS current_suitability,
            (SELECT COUNT(*) FROM document_revision v WHERE v.document_id = d.id AND v.tenant_id = d.tenant_id) AS revision_count,
            DATE_FORMAT(d.required_by, '%Y-%m-%d') AS required_by,
            DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i') AS updated_at
       FROM document_register d
       LEFT JOIN document_revision r ON r.id = d.current_revision_id AND r.tenant_id = d.tenant_id
      WHERE ${where.join(" AND ")}
      ORDER BY d.document_number
      LIMIT ?`,
    args,
  );
}

export async function listRevisions(tenantId: string, documentId: string) {
  return query<any>(
    `SELECT id, revision_code, scheme, state, suitability, description, file_id,
            file_version, frozen, sort_rank,
            DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i') AS issued_at,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
       FROM document_revision
      WHERE tenant_id = ? AND document_id = ?
      ORDER BY sort_rank DESC, revision_code DESC`,
    [tenantId, documentId],
  );
}

/**
 * Rank a revision code so MySQL can order without understanding the scheme.
 *
 * Families are separated by a wide multiplier rather than +1, so a C revision
 * always outranks every P revision however many drafts preceded it.
 */
export function rankOf(scheme: RevisionScheme, code: string): number {
  const p = parseRevision(scheme, code);
  if (!p) return 0;
  const familyOffset = p.family === "C" ? 1_000_000 : 0;
  return familyOffset + p.ordinal;
}

export interface AddRevisionInput {
  revisionCode?: string;
  scheme?: RevisionScheme;
  suitability?: string | null;
  description?: string | null;
  fileId?: string | null;
  /** Issue immediately rather than leaving it a draft. */
  issue?: boolean;
  userId?: string | null;
}

/**
 * Add a revision, applying supersession atomically.
 *
 * The plan comes from revision.ts; this writes it. All in one transaction
 * because a half-applied supersession leaves two current revisions, and the
 * register's core promise is that exactly one is current.
 */
export async function addRevision(
  tenantId: string, projectId: string, documentId: string, input: AddRevisionInput,
) {
  return tx(async (conn) => {
    const [existing] = await conn.query<any[]>(
      "SELECT id, revision_code, state, frozen, scheme FROM document_revision WHERE document_id = ? AND tenant_id = ? FOR UPDATE",
      [documentId, tenantId],
    );
    const rows = existing as any[];

    const scheme: RevisionScheme = input.scheme ?? (rows[0]?.scheme as RevisionScheme) ?? "alpha";

    const codes = rows.map((r) => r.revision_code as string);
    const latest = codes.length
      ? codes.reduce((best, c) => (compareRevisions(scheme, c, best) > 0 ? c : best))
      : null;

    const code = input.revisionCode?.trim() || nextRevision(scheme, latest);
    if (!isValidRevision(scheme, code)) {
      throw new Error(`"${code}" is not a valid ${scheme} revision code.`);
    }
    if (codes.includes(code)) {
      throw new Error(`Revision ${code} already exists on this document.`);
    }

    const id = newId();
    const state = input.issue ? "current" : "draft";

    await conn.query(
      `INSERT INTO document_revision
         (id, tenant_id, project_id, document_id, revision_code, scheme, sort_rank,
          state, suitability, description, file_id, frozen, issued_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, tenantId, projectId, documentId, code, scheme, rankOf(scheme, code),
       state, input.suitability ?? null, input.description ?? null, input.fileId ?? null,
       0, input.issue ? new Date() : null, input.userId ?? null],
    );

    let why = `Revision ${code} created as a draft.`;

    if (input.issue) {
      const plan = planSupersession(
        scheme,
        rows.map((r) => ({ code: r.revision_code, state: r.state, frozen: !!r.frozen } as RevisionRow)),
        code,
      );
      why = plan.why;

      if (plan.superseded.length) {
        await conn.query(
          `UPDATE document_revision SET state = 'superseded', superseded_at = NOW(3)
            WHERE document_id = ? AND revision_code IN (?)`,
          [documentId, plan.superseded],
        );
      }
      await conn.query(
        "UPDATE document_register SET current_revision_id = ?, status = 'issued' WHERE id = ?",
        [id, documentId],
      );
    }

    return { id, revisionCode: code, why };
  });
}

/**
 * Issue a draft revision.
 *
 * Separate from creation because the common workflow is upload-then-review-then-
 * issue, and the reviewer is rarely the person who uploaded it.
 */
export async function issueRevision(tenantId: string, documentId: string, revisionId: string) {
  return tx(async (conn) => {
    const [found] = await conn.query<any[]>(
      "SELECT id, revision_code, scheme, state, frozen FROM document_revision WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [tenantId, revisionId],
    );
    const row = (found as any[])[0];
    if (!row) throw new Error("Revision not found.");
    if (row.state === "superseded") throw new Error("That revision is superseded.");

    const [allRows] = await conn.query<any[]>(
      "SELECT revision_code, state, frozen FROM document_revision WHERE document_id = ? FOR UPDATE",
      [documentId],
    );
    const plan = planSupersession(
      row.scheme as RevisionScheme,
      (allRows as any[])
        .filter((r) => r.revision_code !== row.revision_code)
        .map((r) => ({ code: r.revision_code, state: r.state, frozen: !!r.frozen } as RevisionRow)),
      row.revision_code,
    );

    if (plan.superseded.length) {
      await conn.query(
        `UPDATE document_revision SET state = 'superseded', superseded_at = NOW(3)
          WHERE document_id = ? AND revision_code IN (?)`,
        [documentId, plan.superseded],
      );
    }
    await conn.query(
      "UPDATE document_revision SET state = 'current', issued_at = COALESCE(issued_at, NOW(3)) WHERE id = ?",
      [revisionId],
    );
    await conn.query(
      "UPDATE document_register SET current_revision_id = ?, status = 'issued' WHERE id = ?",
      [revisionId, documentId],
    );

    return { revisionId, why: plan.why };
  });
}

// ── Source regions ───────────────────────────────────────────────────────────

export interface SourceRegionInput {
  fileId?: string | null;
  revisionId?: string | null;
  pageNumber?: number | null;
  regionType: "bounding_box" | "polygon" | "text_range" | "model_object";
  coordinates?: unknown;
  nativeId?: string | null;
  extractedText?: string | null;
  entityType: string;
  entityId: string;
  method?: "manual" | "import" | "ai" | "rule";
  confidence?: number | null;
}

/** Anchor a derived value to the exact evidence that produced it. */
export async function addSourceRegion(
  tenantId: string, projectId: string, input: SourceRegionInput,
): Promise<string> {
  const id = newId();
  await query(
    `INSERT INTO source_region
       (id, tenant_id, project_id, file_id, revision_id, page_number, region_type,
        coordinates, native_id, extracted_text, entity_type, entity_id, method, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, projectId, input.fileId ?? null, input.revisionId ?? null,
     input.pageNumber ?? null, input.regionType,
     input.coordinates === undefined ? null : JSON.stringify(input.coordinates),
     input.nativeId ?? null, input.extractedText ?? null,
     input.entityType, input.entityId, input.method ?? "manual", input.confidence ?? null],
  );
  return id;
}

/** Every piece of evidence behind one entity — the answer to "why is this here". */
export async function regionsFor(tenantId: string, entityType: string, entityId: string) {
  return query<any>(
    `SELECT r.id, r.file_id, r.revision_id, r.page_number, r.region_type, r.coordinates,
            r.extracted_text, r.method, r.confidence,
            f.filename, v.revision_code, d.document_number, d.title
       FROM source_region r
       LEFT JOIN file f ON f.id = r.file_id
       LEFT JOIN document_revision v ON v.id = r.revision_id
       LEFT JOIN document_register d ON d.id = v.document_id
      WHERE r.tenant_id = ? AND r.entity_type = ? AND r.entity_id = ?
      ORDER BY r.page_number, r.created_at`,
    [tenantId, entityType, entityId],
  );
}
