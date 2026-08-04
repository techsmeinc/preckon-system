import ExcelJS from "exceljs";
import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { addLetterhead, longDate, INK, GREY, BOX } from "@/lib/xlsx-brand";

// GET /projects/{pid}/boq/export.xlsx — the priced bill in submission format.
//
// The CSV export beside this one is for working with the numbers; this is the
// document that goes in the tender. It follows the hierarchy a Gulf submission
// expects — SOW ref, our ref, sub ref, serial — with a per-section total, a
// grand total, and an explicit disclaimer when any line is unpriced.
//
// The disclaimer is not decoration. A bill whose total silently omits fifteen
// unpriced lines reads as complete and is not, and that is the kind of error
// that is only discovered after submission.

interface Line {
  code: string;
  description: string;
  unit: string;
  quantity: number;
  trade: string;
  notes: string;
  measured_from?: string;
  review_required?: boolean;
}

const HEAD = [
  "SOW Ref. No.", "Our Ref.No.", "Sub. Ref.", "Sr.No.", "DESCRIPTION",
  "UNIT", "QUANTITY", "RATE", "AMOUNT", "REMARKS",
];
const WIDTHS = [12, 12, 10, 9, 62, 8, 11, 14, 15, 22];

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  const project = await requireProject(ctx, pid);

  const boq = await query<{ payload: any }>(
    `SELECT payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%boq_line' AND status <> 'superseded'`,
    [ctx.tenantId, pid]
  );
  const costs = await query<{ payload: any }>(
    `SELECT payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%cost_line' AND status <> 'superseded'`,
    [ctx.tenantId, pid]
  );

  const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
  const rate = new Map<string, any>();
  for (const c of costs) {
    const p = parse(c.payload);
    if (p?.boq_code != null) rate.set(String(p.boq_code), p);
  }
  const lines: Line[] = boq.map((b) => parse(b.payload)).filter(Boolean);
  const currency = [...rate.values()][0]?.currency ?? "";

  // Group by trade — the bill's sections. Sorted so the document reads in a
  // stable order however the agents happened to emit the lines.
  const byTrade = new Map<string, Line[]>();
  for (const l of lines) {
    const k = l.trade || "Unclassified";
    if (!byTrade.has(k)) byTrade.set(k, []);
    byTrade.get(k)!.push(l);
  }
  for (const v of byTrade.values()) v.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const trades = [...byTrade.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Preckon";
  const ws = wb.addWorksheet("BOQ", {
    views: [{ state: "frozen", ySplit: 13 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = WIDTHS.map((w) => ({ width: w }));
  await addLetterhead(wb, ws);

  // ── Title + header block (rows 7-12, letterhead occupies the space above) ──
  ws.mergeCells(7, 1, 7, HEAD.length);
  const title = ws.getCell(7, 1);
  title.value = "BILL OF QUANTITIES";
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: "center" };
  ws.getRow(7).height = 24;

  const meta: Array<[string, string]> = [
    ["Project Number", String((project as any)?.code ?? "")],
    ["Project Name", String((project as any)?.name ?? "")],
    ["Project Location", ""],
    ["Submission Date", longDate(new Date())],
    ["Submitted to", String((project as any)?.client_name ?? "")],
  ];
  meta.forEach(([k, v], i) => {
    const r = 8 + i;
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { bold: true, size: 9 };
    ws.mergeCells(r, 5, r, 7);
    ws.getCell(r, 5).value = v;
    ws.getCell(r, 5).font = { size: 9 };
  });

  // ── Column headings ───────────────────────────────────────────────────────
  const HR = 13;
  HEAD.forEach((h, i) => {
    const c = ws.getCell(HR, i + 1);
    c.value = i === 7 ? `RATE (IN ${currency || "—"})` : i === 8 ? `AMOUNT (IN ${currency || "—"})` : h;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  ws.getRow(HR).height = 28;

  // ── Body ──────────────────────────────────────────────────────────────────
  let r = HR + 1;
  let sec = 0;
  let grand = 0;
  let unpriced = 0;

  for (const [trade, items] of trades) {
    sec++;
    // Section band
    ws.getCell(r, 1).value = sec;
    ws.getCell(r, 2).value = sec;
    ws.mergeCells(r, 5, r, HEAD.length);
    const sc = ws.getCell(r, 5);
    sc.value = trade;
    sc.font = { bold: true, size: 9.5 };
    for (let c = 1; c <= HEAD.length; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
      cell.border = BOX;
    }
    r++;

    let sectionTotal = 0;
    items.forEach((l, k) => {
      const cost = rate.get(String(l.code));
      const rateMinor = cost ? Number(cost.rate_minor) : NaN;
      const amtMinor = cost ? Number(cost.amount_minor) : NaN;
      if (Number.isFinite(amtMinor)) { sectionTotal += amtMinor; grand += amtMinor; } else unpriced++;

      const vals: any[] = [
        sec, sec, `${sec}.${k + 1}`, `${sec}.${k + 1}.1`,
        l.description ?? "",
        l.unit ?? "",
        Number(l.quantity) || 0,
        Number.isFinite(rateMinor) ? rateMinor / 100 : "To be priced",
        Number.isFinite(amtMinor) ? amtMinor / 100 : "To be priced",
        // The remark carries the audit result, so a reviewer opening the
        // submission sees which quantities were measured and which were flagged.
        l.review_required ? "Review — citation unverified" : (l.measured_from ? `Measured from ${l.measured_from}` : (l.notes ?? "")),
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        c.font = { size: 9, color: l.review_required && i === 9 ? { argb: "FFC00000" } : undefined };
        c.border = BOX;
        c.alignment = { vertical: "top", wrapText: i === 4 || i === 9, horizontal: i >= 5 && i <= 8 ? "right" : "left" };
        if (i === 6) c.numFmt = "#,##0.00";
        if ((i === 7 || i === 8) && typeof v === "number") c.numFmt = "#,##0.000";
      });
      r++;
    });

    ws.getCell(r, 1).value = `Total Amount in ${currency || "—"} for ${sec}`;
    ws.getCell(r, 1).font = { bold: true, size: 9 };
    ws.mergeCells(r, 1, r, 8);
    const tc = ws.getCell(r, 9);
    tc.value = sectionTotal / 100;
    tc.numFmt = "#,##0.000";
    tc.font = { bold: true, size: 9 };
    for (let c = 1; c <= HEAD.length; c++) ws.getCell(r, c).border = BOX;
    r += 2;
  }

  ws.mergeCells(r, 1, r, 8);
  const g = ws.getCell(r, 1);
  g.value = `GRAND TOTAL AMOUNT IN ${currency || "—"}`;
  g.font = { bold: true, size: 11 };
  const gv = ws.getCell(r, 9);
  gv.value = grand / 100;
  gv.numFmt = "#,##0.000";
  gv.font = { bold: true, size: 11 };
  for (let c = 1; c <= HEAD.length; c++) {
    ws.getCell(r, c).border = BOX;
    ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
  }

  if (unpriced) {
    r += 2;
    ws.mergeCells(r, 1, r, HEAD.length);
    const d = ws.getCell(r, 1);
    d.value = `DISCLAIMER: ${unpriced} item(s) marked "To be priced" have no rate entered. The grand total above is provisional and excludes them.`;
    d.font = { size: 9, italic: true, color: { argb: "FFC00000" } };
    d.alignment = { wrapText: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = String((project as any)?.name ?? "project").replace(/[^\w.-]+/g, "_");
  return new Response(buf as any, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Priced-BOQ-${safe}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
