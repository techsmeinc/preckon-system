import { z } from "zod";
import { serviceRoute, ok } from "@/lib/http";
import { query, queryOne } from "@/lib/db";
import { errBadRequest, errNotFound } from "@/lib/errors";

// POST /internal/projects/{pid}/query — the Copilot's read access to a project.
//
// WHY THIS EXISTS
//
// The Copilot used to be handed the last 100 artifacts, truncated to 45,000
// characters, and asked to answer from that. On a project with a 200-line bill
// it was already reading a fragment — and it answered anyway, confidently, from
// whichever fragment it got. An assistant that cannot see line 101 but talks as
// though it can is worse than one that says it cannot see.
//
// So it asks instead. The worker runs a tool-calling loop and these are the
// tools: search the records, read a document, read the audit trail, total the
// bill. It sees everything, and a question costs less than the old blind dump
// because only what was asked for is fetched.
//
// TRUST BOUNDARY (§5.1) IS UNCHANGED
//
// The worker still holds no database handle and no credential. It asks Core,
// over the service token it already uses to post job results back, and Core
// answers only for the tenant and project named here. Every query below is
// parameterised on both — a tool cannot be talked into reading another
// tenant's bill, because the tenant is not something the model can say.
//
// READ ONLY. Nothing here writes. The Copilot proposes; a human decides.

const Body = z.object({
  tenant_id: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

/** Hard ceilings on every list. A tool that can return a whole bill in one call
 *  just moves the truncation problem into the model's context window. */
const MAX_ROWS = 60;
const MAX_TEXT = 12_000;

export const POST = serviceRoute<{ pid: string }>(async (req, { pid }) => {
  const { tenant_id: tenantId, tool, args } = Body.parse(await req.json());

  const project = await queryOne<{ id: string; name: string }>(
    "SELECT id, name FROM project WHERE tenant_id = ? AND id = ?",
    [tenantId, pid]
  );
  if (!project) throw errNotFound("project");

  const str = (k: string, d = "") => String((args as any)[k] ?? d);
  const int = (k: string, d: number, cap: number) =>
    Math.min(cap, Math.max(1, Number((args as any)[k]) || d));

  switch (tool) {
    /* What kinds of record exist and how many of each. The Copilot's first
       call, usually: it tells the model what is worth asking for next without
       reading a single payload. */
    case "project_overview": {
      const [counts, files, runs] = await Promise.all([
        query(
          `SELECT type_key, status, COUNT(*) AS n FROM artifact
            WHERE tenant_id = ? AND project_id = ? GROUP BY type_key, status ORDER BY type_key`,
          [tenantId, pid]
        ),
        query(
          "SELECT filename, status, page_count FROM file WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 40",
          [tenantId, pid]
        ),
        query(
          `SELECT workflow_key, status, created_at FROM workflow_run
            WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 10`,
          [tenantId, pid]
        ),
      ]);
      return ok({ project: project.name, records: counts, files, runs });
    }

    /* Records by type, newest first. `q` filters on the payload as text, which
       is crude and honest — MySQL has no vector index here and a LIKE over a
       JSON column finds "blockwork" in a description perfectly well. */
    case "search_records": {
      const type = str("type").split(".").pop() ?? "";
      const q = str("q").trim();
      const limit = int("limit", 20, MAX_ROWS);
      const rows = await query(
        `SELECT id, type_key, status, confidence, payload FROM artifact
          WHERE tenant_id = ? AND project_id = ?
            ${type ? "AND type_key LIKE ?" : ""}
            ${q ? "AND CAST(payload AS CHAR) LIKE ?" : ""}
            AND status <> 'superseded'
          ORDER BY created_at DESC LIMIT ${limit}`,
        [tenantId, pid, ...(type ? [`%${type}`] : []), ...(q ? [`%${q}%`] : [])]
      );
      return ok({ count: rows.length, records: rows });
    }

    /* One record in full, with the run and the agent that produced it — which
       is what somebody asking "where did this number come from" wants. */
    case "get_record": {
      const id = str("id");
      if (!id) throw errBadRequest("id is required");
      const row = await queryOne(
        `SELECT a.id, a.type_key, a.status, a.confidence, a.payload, a.provenance,
                a.created_at, a.source, r.workflow_key
           FROM artifact a
           LEFT JOIN workflow_run r ON r.id = a.source_run_id
          WHERE a.tenant_id = ? AND a.project_id = ? AND a.id = ?`,
        [tenantId, pid, id]
      );
      if (!row) throw errNotFound("record");
      return ok(row);
    }

    /* The documents themselves. The Copilot could not read a single uploaded
       file before — it only ever saw other agents' summaries of them, which is
       how a preliminaries clause goes missing and nobody can say why. */
    case "read_document": {
      const name = str("filename");
      if (!name) throw errBadRequest("filename is required");
      const file = await queryOne<{ id: string; filename: string }>(
        "SELECT id, filename FROM file WHERE tenant_id = ? AND project_id = ? AND filename LIKE ? LIMIT 1",
        [tenantId, pid, `%${name}%`]
      );
      if (!file) throw errNotFound("document");
      const from = int("from_page", 1, 500);
      const pages = await query<{ page_no: number; text: string }>(
        `SELECT page_no, text FROM file_page
          WHERE file_id = ? AND page_no >= ? ORDER BY page_no LIMIT 5`,
        [file.id, from]
      );
      let text = pages.map((p) => `[page ${p.page_no}]\n${p.text ?? ""}`).join("\n\n");
      const truncated = text.length > MAX_TEXT;
      if (truncated) text = text.slice(0, MAX_TEXT);
      // Saying so matters: silently cut text is how a model concludes a clause
      // is absent when it is merely past the cut.
      return ok({ filename: file.filename, from_page: from, text, truncated, more_pages: pages.length === 5 });
    }

    /* Who did what. This is the "the Copilot knows what I did" part, and it was
       never wired to anything — the audit chain has recorded every action since
       day one and nothing has ever read it back. */
    case "recent_activity": {
      const limit = int("limit", 25, MAX_ROWS);
      const rows = await query(
        `SELECT e.created_at, e.action, e.target_kind, e.target_id, e.summary, u.name AS actor
           FROM audit_event e
           LEFT JOIN user u ON u.id = e.actor_user_id
          WHERE e.tenant_id = ? AND (e.project_id = ? OR e.project_id IS NULL)
          ORDER BY e.created_at DESC LIMIT ${limit}`,
        [tenantId, pid]
      );
      return ok({ events: rows });
    }

    /* Arithmetic belongs in SQL, not in a model reading 200 rows and adding
       them up. Asked "what is the bill worth", this answers exactly. */
    case "boq_totals": {
      const rows = await query(
        `SELECT
            COUNT(*) AS lines,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
            SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
            SUM(COALESCE(JSON_EXTRACT(payload, '$.amount_minor'), 0)) AS total_minor
           FROM artifact
          WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%cost_line' AND status <> 'superseded'`,
        [tenantId, pid]
      );
      const bySection = await query(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.section')) AS section, COUNT(*) AS lines
           FROM artifact
          WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%boq_line' AND status <> 'superseded'
          GROUP BY section ORDER BY lines DESC LIMIT 30`,
        [tenantId, pid]
      );
      return ok({ cost: rows[0] ?? null, boq_sections: bySection });
    }

    default:
      throw errBadRequest(`Unknown tool: ${tool}`);
  }
});
