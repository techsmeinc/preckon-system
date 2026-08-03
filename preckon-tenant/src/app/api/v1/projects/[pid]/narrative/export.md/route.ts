import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";

// GET /projects/{pid}/narrative/export.md — the technical submission, one file.
//
// Markdown rather than .docx: it needs no dependency in the app image, it pastes
// into Word with its heading structure intact, and it is diffable — export
// before and after a re-run and you can see exactly which paragraphs moved,
// which a binary document makes impossible.
//
// Sections are emitted in READING order, not the order they were written or
// confirmed. A submission assembled in whatever sequence the agents happened to
// finish is not a submission an evaluator can follow.

const ORDER = [
  "executive_summary",
  "company_profile",
  "technical_approach",
  "programme",
  "quality",
  "hse",
  "risk_management",
];

const TITLES: Record<string, string> = {
  executive_summary: "Executive Summary",
  company_profile: "Company Profile",
  technical_approach: "Technical Approach & Methodology",
  programme: "Project Programme",
  quality: "Quality Assurance Plan",
  hse: "Health, Safety & Environment",
  risk_management: "Risk Management",
};

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  const project = await requireProject(ctx, pid);

  const rows = await query<{ payload: any; status: string }>(
    `SELECT payload, status FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%narrative_section'
        AND status <> 'superseded'
      ORDER BY created_at DESC`,
    [ctx.tenantId, pid]
  );

  const bySection = new Map<string, any>();
  for (const r of rows) {
    const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
    if (p?.section && !bySection.has(p.section)) bySection.set(p.section, { ...p, status: r.status });
  }

  const name = String((project as any)?.name ?? "project");
  const out: string[] = [`# ${name} — Technical Submission`, ""];

  for (const key of ORDER) {
    const s = bySection.get(key);
    out.push(`## ${s?.title ?? TITLES[key]}`, "");
    if (!s || !s.body_md) {
      // Named and marked rather than omitted. A gap an evaluator can see is a
      // gap the bid team can still close; a section quietly missing from the
      // export is one nobody notices until after submission.
      out.push("> **NOT YET WRITTEN** — this section has not been generated.", "");
      continue;
    }
    out.push(String(s.body_md).trim(), "");
    if (s.status !== "confirmed") {
      out.push(`> _Draft — not yet accepted by a reviewer._`, "");
    }
    if (s.grounded_in) {
      out.push(`> _Written from: ${s.grounded_in}_`, "");
    }
  }

  const safe = name.replace(/[^\w.-]+/g, "_");
  return new Response(out.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}-technical-submission.md"`,
      "cache-control": "no-store",
    },
  });
});
