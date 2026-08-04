import ExcelJS from "exceljs";
import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { addLetterhead, shortDate, longDate, BOX as RULED, BOQ_HEAD, BOQ_BAND, BOQ_TITLE } from "@/lib/xlsx-brand";

// POST /projects/{pid}/programme/export.xlsx — the work programme as a
// contractor's Gantt workbook.
//
// The rows arrive from the client rather than being recomputed here. The
// critical path, floats and dates are derived by the CPM pass in gantt.tsx, and
// a second implementation server-side would drift from it — the export would
// quietly disagree with the screen it claims to be a copy of. The client sends
// what it drew; this formats it.

interface Row {
  wbs: string;
  name: string;
  depth: number;
  isSection: boolean;
  sowRef: string;
  start: number;      // day offset from commencement
  finish: number;
  dur: number;
  critical: boolean;
  milestone: boolean;
  percent: number;
  assignee: string;
  predecessors: string;
  basis: string;
}

/** One colour per phase, cycled by section. A programme is read by phase — the
 *  eye follows a band of colour down the sheet — so the bars carry the section's
 *  identity rather than a single accent for everything. */
const PHASE = [
  "FF4A90D9",  // preliminaries — light blue
  "FF7030A0",  // demolition / site prep — purple
  "FF1F8A8A",  // substructure — teal
  "FF2E9B7F",  // superstructure — green-teal
  "FFE36C09",  // building envelope — orange
  "FFC0165B",  // roofing & waterproofing — magenta
  "FF3C9E3C",  // façade — green
  "FF5B4FC7",  // MEP — indigo
  "FF2E86C1",  // external works — steel blue
  "FFB8860B",  // testing & commissioning — gold
  "FFC00000",  // handover — red
];
const GREY_SECTION = BOQ_BAND;   // same pale blue as the bill — one office, one palette
const HEAD_FILL = BOQ_HEAD;
const CRIT_EDGE = "FFC00000";

const thin = { style: "thin" as const, color: { argb: "FF9E9E9E" } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * DAY);
const fmt = shortDate;

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  const project = await requireProject(ctx, pid);

  const body = (await req.json()) as {
    rows: Row[];
    commencement: string;
    projectName?: string;
    projectCode?: string;
    client?: string;
    location?: string;
  };
  const rows = body.rows ?? [];
  const start = body.commencement || new Date().toISOString().slice(0, 10);

  const spanDays = Math.max(7, ...rows.map((r) => r.finish));
  const weeks = Math.ceil(spanDays / 7) + 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Preckon";
  const ws = wb.addWorksheet("Programme", {
    views: [{ state: "frozen", xSplit: 7, ySplit: 11 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const LABEL = ["No.", "Activity", "SOW Ref", "Duration", "Start", "Finish", "Predecessors"];
  const W0 = LABEL.length;                       // first Gantt column index (0-based)
  ws.columns = [
    { width: 5 }, { width: 46 }, { width: 8 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 13 },
    ...Array.from({ length: weeks }, () => ({ width: 2.6 })),
  ];

  // ── Reference + letterhead box ────────────────────────────────────────────
  const ref = ws.getCell(1, 1);
  ref.value = `Ref No: QO/${body.projectCode ?? "—"}/${String(new Date().getFullYear()).slice(2)}`;
  ref.font = { bold: true, size: 8, color: { argb: CRIT_EDGE } };

  const medium = { style: "medium" as const, color: { argb: "FF000000" } };
  ws.mergeCells(2, 1, 5, W0 + weeks);
  ws.getCell(2, 1).border = { top: medium, left: medium, bottom: medium, right: medium };
  for (let r0 = 2; r0 <= 5; r0++) ws.getRow(r0).height = 16;
  await addLetterhead(wb, ws, { centreCol: (W0 + weeks) / 2 - 3, topRow: 2, width: 300, height: 58 });

  // ── Title ─────────────────────────────────────────────────────────────────
  ws.mergeCells(6, 1, 6, W0 + weeks);
  const title = ws.getCell(6, 1);
  title.value = "PROJECT WORK PROGRAMME";
  title.font = { bold: true, size: 13, color: { argb: BOQ_TITLE } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = RULED;
  ws.getRow(6).height = 22;

  // ── Header block — the facts an evaluator checks before reading a bar ─────
  const info: Array<[string, string, string, string]> = [
    ["Project No.", body.projectCode ?? "", "Location", body.location ?? ""],
    ["Project", body.projectName ?? (project as any)?.name ?? "", "Submission", longDate(new Date())],
    ["Client", body.client ?? "", "Duration", `${spanDays} calendar days  (≈ ${Math.ceil(spanDays / 7)} weeks)`],
  ];
  info.forEach(([k1, v1, k2, v2], i) => {
    const r0 = 7 + i;
    const band = (c: any) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOQ_BAND } };
      c.font = { bold: true, size: 8.5 };
      c.border = RULED;
    };
    ws.getCell(r0, 1).value = k1; band(ws.getCell(r0, 1));
    ws.mergeCells(r0, 2, r0, 5);
    ws.getCell(r0, 2).value = v1;
    ws.getCell(r0, 2).font = { size: 8.5 };
    ws.getCell(r0, 2).border = RULED;
    ws.getCell(r0, 6).value = k2; band(ws.getCell(r0, 6));
    ws.mergeCells(r0, 7, r0, Math.min(W0 + weeks, 7 + 30));
    ws.getCell(r0, 7).value = v2;
    ws.getCell(r0, 7).font = { size: 8.5 };
    ws.getCell(r0, 7).border = RULED;
    ws.getRow(r0).height = 14;
  });

  // ── Month band + week numbers ────────────────────────────────────────────
  // Rows 1-9 carry the reference, letterhead, title and header block.
  const MONTH_ROW = 10, WEEK_ROW = 11;
  LABEL.forEach((h, i) => {
    ws.mergeCells(MONTH_ROW, i + 1, WEEK_ROW, i + 1);
    const c = ws.getCell(MONTH_ROW, i + 1);
    c.value = h;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
  });

  let mStart = 0;
  let mLabel = "";
  for (let w = 0; w < weeks; w++) {
    const d = addDays(start, w * 7);
    const label = `${d.toLocaleString("en", { month: "short" }).toUpperCase()} ${String(d.getFullYear()).slice(2)}`;
    if (label !== mLabel) {
      if (mLabel) {
        ws.mergeCells(MONTH_ROW, W0 + 1 + mStart, MONTH_ROW, W0 + w);
        const c = ws.getCell(MONTH_ROW, W0 + 1 + mStart);
        c.value = mLabel;
        c.font = { bold: true, size: 8 };
        c.alignment = { horizontal: "center" };
        c.border = BOX;
      }
      mLabel = label;
      mStart = w;
    }
    const wc = ws.getCell(WEEK_ROW, W0 + 1 + w);
    wc.value = `W${w + 1}`;
    wc.font = { size: 7, color: { argb: "FFFFFFFF" } };
    wc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    wc.alignment = { horizontal: "center" };
    wc.border = BOX;
  }
  if (mLabel) {
    ws.mergeCells(MONTH_ROW, W0 + 1 + mStart, MONTH_ROW, W0 + weeks);
    const c = ws.getCell(MONTH_ROW, W0 + 1 + mStart);
    c.value = mLabel;
    c.font = { bold: true, size: 8 };
    c.alignment = { horizontal: "center" };
    c.border = BOX;
  }
  ws.getRow(MONTH_ROW).height = 15;
  ws.getRow(WEEK_ROW).height = 13;

  // ── Activity rows ────────────────────────────────────────────────────────
  let r = WEEK_ROW + 1;
  let phase = -1;
  let no = 0;

  for (const row of rows) {
    const rowRef = ws.getRow(r);
    rowRef.height = 13.5;

    if (row.isSection) {
      phase++;
      // Section band: name plus the weeks it spans, which is how a planner
      // scans a programme before reading any individual activity.
      const w1 = Math.floor(row.start / 7) + 1;
      const w2 = Math.ceil(row.finish / 7);
      ws.mergeCells(r, 1, r, W0);
      const c = ws.getCell(r, 1);
      c.value = `${row.name}   (Wk ${w1}-${w2})`;
      c.font = { bold: true, size: 9 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_SECTION } };
      c.alignment = { indent: 0 };
      for (let cc = 1; cc <= W0 + weeks; cc++) {
        const cell = ws.getCell(r, cc);
        cell.border = BOX;
        // Only the label side is banded. Carrying the fill across the chart
        // draws a solid stripe through the timeline and the bars stop reading
        // as bars — the section is a heading, not an activity.
        if (cc <= W0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_SECTION } };
      }
      r++;
      continue;
    }

    no++;
    const colour = PHASE[Math.max(0, phase) % PHASE.length];
    const vals = [
      no,
      "  ".repeat(Math.max(0, row.depth - 1)) + row.name,
      row.sowRef || "",
      row.milestone ? "—" : row.dur,
      fmt(addDays(start, row.start)),
      row.milestone ? "" : fmt(addDays(start, row.finish)),
      row.predecessors || "",
    ];
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v as any;
      cell.font = { size: 8 };
      cell.border = BOX;
      cell.alignment = { vertical: "middle", wrapText: i === 1, horizontal: i === 1 ? "left" : "center" };
    });

    for (let w = 0; w < weeks; w++) {
      const cell = ws.getCell(r, W0 + 1 + w);
      cell.border = BOX;
      const dayFrom = w * 7, dayTo = dayFrom + 6;
      const covered = row.start <= dayTo && row.finish >= dayFrom;
      if (row.milestone) {
        // A milestone has no duration, so it is a marker, not a bar.
        if (Math.floor(row.start / 7) === w) {
          cell.value = "◆";
          cell.font = { size: 9, color: { argb: CRIT_EDGE }, bold: true };
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      } else if (covered) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
        const white = { style: "thin" as const, color: { argb: "FFFFFFFF" } };
        cell.border = { ...BOX, left: white, right: white };
        if (row.critical) {
          // Critical activities carry a red top/bottom edge as well as colour,
          // so the critical path survives a monochrome print.
          const white = { style: "thin" as const, color: { argb: "FFFFFFFF" } };
          cell.border = {
            top: { style: "medium", color: { argb: CRIT_EDGE } },
            bottom: { style: "medium", color: { argb: CRIT_EDGE } },
            left: white, right: white,
          };
        }
      }
    }
    r++;
  }

  // Legend, below the grid.
  const legendRow = r + 1;
  const swatch = ws.getCell(legendRow, 1);
  swatch.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CRIT_EDGE } };
  swatch.border = RULED;
  ws.getCell(legendRow, 2).value = "Critical path";
  ws.getCell(legendRow, 2).font = { size: 8, bold: true };
  ws.getCell(legendRow, 5).value = "◆ Milestone";
  ws.getCell(legendRow, 5).font = { size: 8, bold: true, color: { argb: CRIT_EDGE } };
  ws.mergeCells(legendRow + 1, 1, legendRow + 1, W0 + weeks);
  const note = ws.getCell(legendRow + 1, 1);
  note.value = "Activity bars are colour-coded by section / phase; activities on the critical path are highlighted in red.";
  note.font = { size: 8, italic: true, color: { argb: "FF616161" } };
  ws.getCell(legendRow + 3, 1).value = `Generated by Preckon · ${longDate(new Date())}`;
  ws.getCell(legendRow + 3, 1).font = { size: 8, italic: true, color: { argb: "FF9E9E9E" } };

  const buf = await wb.xlsx.writeBuffer();
  const safe = String(body.projectName ?? (project as any)?.name ?? "project").replace(/[^\w.-]+/g, "_");
  return new Response(buf as any, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${safe}-work-programme.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
