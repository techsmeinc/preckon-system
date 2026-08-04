import ExcelJS from "exceljs";
import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { addLetterhead, centreColumn, longDate, BOX, BOQ_HEAD, BOQ_BAND, BOQ_TBP, BOQ_TITLE } from "@/lib/xlsx-brand";

// GET /projects/{pid}/boq/export.xlsx — the priced bill, one sheet per division.
//
// WHY SHEETS RATHER THAN ONE LONG GRID. Excel freezes everything ABOVE the
// split, so with a letterhead and a seven-row cover block at the top of the
// bill, freezing the column headings also pinned sixteen rows of branding: the
// reader was left scrolling a sliver of the window and the sheet felt stuck.
// Splitting it puts the cover on its own page and starts every division at row
// 1 with only its headings frozen, so each scrolls the full height of the
// screen.
//
// It also matches how a bill is worked: a division is the unit a section
// engineer prices and a reviewer signs off, not a range of rows inside
// something longer.

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

/** Excel forbids : \ / ? * [ ] in a tab name and caps it at 31 characters. */
function tabName(raw: string, taken: Set<string>): string {
  const base = (raw || "Division").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Division";
  let out = base;
  let i = 2;
  while (taken.has(out.toLowerCase())) out = `${base.slice(0, 26)} ${i++}`;
  taken.add(out.toLowerCase());
  return out;
}

/** Long descriptions wrap; without a height the row collapses to one line and
 *  clips the text. Excel does not auto-fit a wrapped cell, so estimate it. */
const rowHeight = (text: string, colChars = 60) =>
  Math.min(90, Math.max(15, Math.ceil((text || "").length / colChars) * 12 + 3));

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const P = await queryOne<any>(
    `SELECT name, code, client_name, location, submitted_to, ref_no
       FROM project WHERE id = ? AND tenant_id = ?`,
    [pid, ctx.tenantId]
  );

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

  // ── Cover ─────────────────────────────────────────────────────────────────
  const cover = wb.addWorksheet("Cover", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  cover.columns = WIDTHS.map((w) => ({ width: w }));

  const medium = { style: "medium" as const, color: { argb: "FF000000" } };
  cover.mergeCells(2, 1, 6, HEAD.length);
  cover.getCell(2, 1).border = { top: medium, left: medium, bottom: medium, right: medium };
  for (let r = 2; r <= 6; r++) cover.getRow(r).height = 22;
  await addLetterhead(wb, cover, {
    centreCol: centreColumn(WIDTHS, 340), topRow: 2, width: 340, height: 78,
  });

  cover.mergeCells(8, 1, 8, HEAD.length);
  const title = cover.getCell(8, 1);
  title.value = "BILL OF QUANTITIES";
  title.font = { bold: true, size: 16, color: { argb: BOQ_TITLE } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = BOX;
  cover.getRow(8).height = 28;

  const meta: Array<[string, string]> = [
    ["Ref No.", String(P?.ref_no ?? "")],
    ["Project Number", String(P?.code ?? "")],
    ["Project Name", String(P?.name ?? "")],
    ["Project Location", String(P?.location ?? "")],
    ["Client", String(P?.client_name ?? "")],
    ["Submission Date", longDate(new Date())],
    ["Submitted to", String(P?.submitted_to ?? "")],
  ];
  meta.forEach(([k, v], i) => {
    const r = 10 + i;
    cover.mergeCells(r, 1, r, 4);
    const kc = cover.getCell(r, 1);
    kc.value = k;
    kc.font = { bold: true, size: 10 };
    kc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
    kc.border = BOX;
    cover.mergeCells(r, 5, r, HEAD.length);
    const vc = cover.getCell(r, 5);
    vc.value = v;
    vc.font = { size: 10 };
    vc.border = BOX;
    cover.getRow(r).height = 18;
  });

  // ── One sheet per division ────────────────────────────────────────────────
  const taken = new Set<string>();
  const summary: Array<[string, number, number]> = [];
  let grand = 0;
  let unpricedAll = 0;

  trades.forEach(([trade, items], secIdx) => {
    const ws = wb.addWorksheet(tabName(trade, taken), {
      // Only the heading row is frozen, so the whole division scrolls.
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = WIDTHS.map((w) => ({ width: w }));

    ws.mergeCells(1, 1, 1, HEAD.length);
    const band = ws.getCell(1, 1);
    band.value = `${secIdx + 1}.  ${trade}`;
    band.font = { bold: true, size: 11 };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
    band.alignment = { horizontal: "center", vertical: "middle" };
    band.border = BOX;
    ws.getRow(1).height = 20;

    HEAD.forEach((h, i) => {
      const c = ws.getCell(2, i + 1);
      c.value = i === 7 ? `RATE (IN ${currency || "—"})` : i === 8 ? `AMOUNT (IN ${currency || "—"})` : h;
      c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_HEAD } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
    });
    ws.getRow(2).height = 30;

    let r = 3;
    let total = 0;
    let unpriced = 0;

    items.forEach((l, k) => {
      const cost = rate.get(String(l.code));
      const rateMinor = cost ? Number(cost.rate_minor) : NaN;
      const amtMinor = cost ? Number(cost.amount_minor) : NaN;
      if (Number.isFinite(amtMinor)) { total += amtMinor; grand += amtMinor; }
      else { unpriced++; unpricedAll++; }

      const remark = l.review_required
        ? "Review — citation unverified"
        : l.measured_from ? `Measured from ${l.measured_from}` : (l.notes ?? "");
      const vals: any[] = [
        secIdx + 1, secIdx + 1, `${secIdx + 1}.${k + 1}`, `${secIdx + 1}.${k + 1}.1`,
        l.description ?? "", l.unit ?? "", Number(l.quantity) || 0,
        Number.isFinite(rateMinor) ? rateMinor / 100 : "To be priced",
        Number.isFinite(amtMinor) ? amtMinor / 100 : "To be priced",
        remark,
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        const tbp = (i === 7 || i === 8) && typeof v === "string";
        c.font = { size: 9, italic: tbp || i === 9, color: l.review_required && i === 9 ? { argb: "FFC00000" } : undefined };
        c.border = BOX;
        c.alignment = {
          vertical: "top",
          wrapText: i === 4 || i === 9,
          horizontal: i <= 3 ? "center" : i >= 5 && i <= 8 ? "right" : "left",
        };
        if (tbp) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_TBP } };
        if (i === 6) c.numFmt = "#,##0.00";
        if ((i === 7 || i === 8) && typeof v === "number") c.numFmt = "#,##0.000";
      });
      ws.getRow(r).height = Math.max(rowHeight(l.description ?? "", 60), rowHeight(remark, 22));
      r++;
    });

    ws.mergeCells(r, 1, r, 8);
    const tl = ws.getCell(r, 1);
    tl.value = `Total Amount in ${currency || "—"} for ${secIdx + 1}`;
    tl.font = { bold: true, size: 10 };
    tl.alignment = { horizontal: "right" };
    const tv = ws.getCell(r, 9);
    tv.value = total / 100;
    tv.numFmt = "#,##0.000";
    tv.font = { bold: true, size: 10 };
    for (let c = 1; c <= HEAD.length; c++) {
      ws.getCell(r, c).border = BOX;
      ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
    }
    if (r > 3) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: r - 1, column: HEAD.length } };
    summary.push([trade, total, unpriced]);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const sum = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 2 }] });
  sum.columns = [{ width: 6 }, { width: 52 }, { width: 20 }, { width: 16 }];
  sum.mergeCells(1, 1, 1, 4);
  const sh = sum.getCell(1, 1);
  sh.value = "SUMMARY OF DIVISIONS";
  sh.font = { bold: true, size: 12, color: { argb: BOQ_TITLE } };
  sh.alignment = { horizontal: "center" };
  sh.border = BOX;
  ["No.", "Division", `Amount (${currency || "—"})`, "Unpriced items"].forEach((h, i) => {
    const c = sum.getCell(2, i + 1);
    c.value = h;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_HEAD } };
    c.alignment = { horizontal: "center" };
    c.border = BOX;
  });
  summary.forEach(([trade, total, unpriced], i) => {
    const r = 3 + i;
    [i + 1, trade, total / 100, unpriced || ""].forEach((v, k) => {
      const c = sum.getCell(r, k + 1);
      c.value = v as any;
      c.font = { size: 10, color: k === 3 && unpriced ? { argb: "FFC00000" } : undefined };
      c.border = BOX;
      if (k === 2) c.numFmt = "#,##0.000";
      c.alignment = { horizontal: k === 1 ? "left" : k === 2 ? "right" : "center" };
    });
  });
  const gr = 3 + summary.length;
  sum.mergeCells(gr, 1, gr, 2);
  const gl = sum.getCell(gr, 1);
  gl.value = `GRAND TOTAL AMOUNT IN ${currency || "—"}`;
  gl.font = { bold: true, size: 11 };
  gl.alignment = { horizontal: "right" };
  const gv = sum.getCell(gr, 3);
  gv.value = grand / 100;
  gv.numFmt = "#,##0.000";
  gv.font = { bold: true, size: 11 };
  for (let c = 1; c <= 4; c++) {
    sum.getCell(gr, c).border = BOX;
    sum.getCell(gr, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
  }
  if (unpricedAll) {
    const dr = gr + 2;
    sum.mergeCells(dr, 1, dr, 4);
    const d = sum.getCell(dr, 1);
    d.value = `DISCLAIMER: ${unpricedAll} item(s) marked "To be priced" have no rate entered. The grand total above is provisional and excludes them.`;
    d.font = { size: 9, italic: true, color: { argb: "FFC00000" } };
    d.alignment = { wrapText: true, vertical: "top" };
    sum.getRow(dr).height = 30;
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = String(P?.name ?? "project").replace(/[^\w.-]+/g, "_");
  return new Response(buf as any, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Priced-BOQ-${safe}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
