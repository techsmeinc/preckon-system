import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";

// GET /projects/{pid}/boq/export.csv — the bill as a spreadsheet.
//
// CSV rather than .xlsx deliberately: Excel opens it natively, it needs no
// dependency in the app image, and — the part that matters for a bill — it is
// diffable. An estimator who exports twice can see exactly which lines moved
// between runs, which a binary workbook makes impossible.
//
// Every column an estimator needs to check the agent's working travels with it:
// the quantity, what it was measured from, the confidence, and the review flag.
// An export that carries only code/description/qty looks tidier and hides the
// one thing a reviewer needs to know — which numbers are load-bearing and which
// are the agent admitting it could not measure.

interface BoqRow {
  payload: any;
  status: string;
  confidence: string | null;
}
interface CostRow {
  payload: any;
}

/** RFC 4180: quote anything containing a comma, quote or newline; double inner quotes. */
function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  const project = await requireProject(ctx, pid);

  const lines = await query<BoqRow>(
    `SELECT payload, status, confidence FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%boq_line'
        AND status <> 'superseded'`,
    [ctx.tenantId, pid]
  );
  const costs = await query<CostRow>(
    `SELECT payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%cost_line'
        AND status <> 'superseded'`,
    [ctx.tenantId, pid]
  );

  const rateFor = new Map<string, any>();
  for (const c of costs) {
    const p = typeof c.payload === "string" ? JSON.parse(c.payload) : c.payload;
    if (p?.boq_code != null) rateFor.set(String(p.boq_code), p);
  }

  const header = [
    "Code", "Trade", "Description", "Unit", "Quantity",
    "Rate", "Amount", "Currency",
    "Measured from", "Review required", "Review reason",
    "Confidence %", "Status", "Notes",
  ];

  const rows = lines
    .map((l) => (typeof l.payload === "string" ? { ...l, payload: JSON.parse(l.payload) } : l))
    .sort((a, b) =>
      String(a.payload?.trade ?? "").localeCompare(String(b.payload?.trade ?? "")) ||
      String(a.payload?.code ?? "").localeCompare(String(b.payload?.code ?? ""))
    )
    .map((l) => {
      const p = l.payload ?? {};
      const c = rateFor.get(String(p.code)) ?? null;
      // Money is stored in minor units. Emitting it as a decimal keeps the
      // column summable in Excel — 123450 in a "Rate" column silently makes
      // every total a hundred times too big.
      const dec = (m: unknown) => (m == null || m === "" ? "" : (Number(m) / 100).toFixed(2));
      return [
        p.code, p.trade, p.description, p.unit, p.quantity,
        dec(c?.rate_minor), dec(c?.amount_minor), c?.currency ?? "",
        p.measured_from ?? "",
        p.review_required ? "YES" : "",
        p.review_reason ?? "",
        l.confidence == null ? "" : Math.round(Number(l.confidence) * 100),
        l.status,
        p.notes ?? "",
      ].map(cell).join(",");
    });

  const name = String((project as any)?.name ?? "project").replace(/[^\w.-]+/g, "_");
  // BOM so Excel reads it as UTF-8 — without it, accented trade names and the
  // m² / m³ unit symbols arrive mojibaked.
  const body = "﻿" + [header.map(cell).join(","), ...rows].join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-boq.csv"`,
      "cache-control": "no-store",
    },
  });
});
