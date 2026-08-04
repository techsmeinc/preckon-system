import ExcelJS from "exceljs";
import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { addLetterhead, longDate, BOX, BOQ_HEAD, BOQ_BAND, BOQ_TBP, BOQ_TITLE } from "@/lib/xlsx-brand";

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
    views: [{ state: "frozen", ySplit: 15 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = WIDTHS.map((w) => ({ width: w }));

  // ── Reference + letterhead box ────────────────────────────────────────────
  const ref = ws.getCell(2, 1);
  ref.value = `Ref No: QO/${(project as any)?.code ?? "—"}/${String(new Date().getFullYear()).slice(2)}`;
  ref.font = { bold: true, size: 9 };

  // The mark sits inside a ruled box, centred — the reference submission leads
  // with it, and a tender is judged on presentation before a quantity is read.
  ws.mergeCells(4, 1, 7, HEAD.length);
  const box = ws.getCell(4, 1);
  box.border = {
    top: { style: "medium", color: { argb: "FF000000" } },
    left: { style: "medium", color: { argb: "FF000000" } },
    bottom: { style: "medium", color: { argb: "FF000000" } },
    right: { style: "medium", color: { argb: "FF000000" } },
  };
  for (let r0 = 4; r0 <= 7; r0++) ws.getRow(r0).height = 20;
  await addLetterhead(wb, ws, { centreCol: HEAD.length / 2 - 1.6, topRow: 4, width: 300, height: 62 });

  // ── Title ─────────────────────────────────────────────────────────────────
  ws.mergeCells(9, 1, 9, HEAD.length);
  const title = ws.getCell(9, 1);
  title.value = "BILL OF QUANTITIES";
  title.font = { bold: true, size: 13, color: { argb: BOQ_TITLE } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = BOX;
  ws.getRow(9).height = 22;

  // ── Meta block: label cells banded, values plain ──────────────────────────
  const meta: Array<[string, string]> = [
    ["Project Number", String((project as any)?.code ?? "")],
    ["Project Name", String((project as any)?.name ?? "")],
    ["Project Location", ""],
    ["Submission Date", longDate(new Date())],
    ["Submitted to", String((project as any)?.client_name ?? "")],
  ];
  meta.forEach(([k, v], i) => {
    const r0 = 10 + i;
    ws.mergeCells(r0, 1, r0, 4);
    const kc = ws.getCell(r0, 1);
    kc.value = k;
    kc.font = { bold: true, size: 9 };
    kc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
    kc.border = BOX;
    ws.mergeCells(r0, 5, r0, HEAD.length);
    const vc = ws.getCell(r0, 5);
    vc.value = v;
    vc.font = { size: 9 };
    vc.border = BOX;
    ws.getRow(r0).height = 15;
  });

  // ── Column headings ───────────────────────────────────────────────────────
  const HR = 15;
  HEAD.forEach((h, i) => {
    const c = ws.getCell(HR, i + 1);
    c.value = i === 7 ? `RATE (IN ${currency || "—"})` : i === 8 ? `AMOUNT (IN ${currency || "—"})` : h;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_HEAD } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  ws.getRow(HR).height = 30;

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
    sc.alignment = { horizontal: "center", vertical: "middle" };
    for (let c = 1; c <= HEAD.length; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
      cell.border = BOX;
      if (c <= 2) cell.alignment = { horizontal: "center" };
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
        const tbp = (i === 7 || i === 8) && typeof v === "string";
        c.font = {
          size: 9,
          italic: tbp || i === 9,
          color: l.review_required && i === 9 ? { argb: "FFC00000" } : undefined,
        };
        c.border = BOX;
        c.alignment = {
          vertical: "top",
          wrapText: i === 4 || i === 9,
          horizontal: i <= 3 ? "center" : i >= 5 && i <= 8 ? "right" : "left",
        };
        // An unpriced cell is tinted rather than left blank: a reader scanning
        // the bill can see at a glance how much of it is still to be priced.
        if (tbp) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_TBP } };
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
    ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
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
