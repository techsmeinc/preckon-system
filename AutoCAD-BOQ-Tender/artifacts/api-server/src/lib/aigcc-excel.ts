/**
 * AIGCC Priced-BOQ Excel builder.
 *
 * Produces the exact layout the QS team uses (matches the layout of the
 * 1158/1159/1162 sample priced BOQs in archive (3)):
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │ Ref No: AIGCC/AASAB/QO/{quotation-ref}                                 │
 *   │ Project Number      │ {project number}                                 │
 *   │ Project Name        │ {project name}                                   │
 *   │ Project Location    │ {project location}                               │
 *   │ Submission Date     │ {submission date}                                │
 *   │ Submitted to        │ {client}                                         │
 *   ├──────────┬──────────┬──────────┬──────┬─────────────┬──────┬──────────┤
 *   │ SOW Ref. │ Our Ref. │ Sub. Ref │ Sr.No│ DESCRIPTION │ UNIT │ ...      │
 *   ├──────────┴──────────┴──────────┴──────┴─────────────┴──────┴──────────┤
 *   │ 2.0  Contractor Design & Construction Tasks                            │
 *   │ 2.1  1.0    Performing a comprehensive Site Survey                     │
 *   │             1.1  Site Supervision and engineering          LS  1       │
 *   │             1.2  Site Investigation / Site Survey          LS  1       │
 *   │             Total Amount in K.D For 2.1                              X │
 *   │  ...                                                                   │
 *   │             GRAND TOTAL AMOUNT IN KWD                                X │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * Items are slotted by their sowRef/ourRef/subRef/srNo fields. Items missing
 * SOW refs (e.g. from the legacy single-LLM pipeline) get appended at the
 * bottom under an "Unclassified" section so the export still produces a
 * complete BOQ.
 */
import ExcelJS from "exceljs";
import type { boqItemsTable, companyProfileTable, projectResourcesTable, projectsTable, scheduleActivitiesTable, sowSectionsTable, projectCalendarsTable, resourceLeaveTable, activityResourcesTable } from "@workspace/db";
import { LETTERHEAD_LOGO } from "./boq-logos";
import { UNCLASSIFIED_DEPARTMENT } from "./discipline-checklist";
import { normalizeUnit } from "./boq-units";
import { isTbdQuantity, quantityBasis } from "./estimator-style";
import { computeCpm, parseDependencies, relLabel, type CpmResult } from "@workspace/db/schedule-cpm";
import { placeWork, workingByOffset, defaultCalendar, leaveDateSet, assignmentCost, type WorkCalendar } from "@workspace/db/calendar-engine";

type BoqItem = typeof boqItemsTable.$inferSelect;
type CompanyProfile = typeof companyProfileTable.$inferSelect;
type Project = typeof projectsTable.$inferSelect;
type ScheduleActivity = typeof scheduleActivitiesTable.$inferSelect;
type ProjectResource = typeof projectResourcesTable.$inferSelect;
type ProjectCalendar = typeof projectCalendarsTable.$inferSelect;
type ResourceLeave = typeof resourceLeaveTable.$inferSelect;
type ActivityResource = typeof activityResourcesTable.$inferSelect;
type SowSection = typeof sowSectionsTable.$inferSelect;

/**
 * Lookup of the documents' own division/section headings, keyed by both the
 * SOW ref and our internal ref so a line item can be resolved by whichever it
 * carries. Built from the persisted SOW outline (see persistOutline in the
 * multi-agent route). Empty when no outline was saved (legacy/single-shot
 * projects) — callers then fall back to the item's category tag.
 */
interface OutlineTitles {
  bySowRef: Map<string, string>;
  byOurRef: Map<string, string>;
}

function buildOutlineTitles(sections: SowSection[] | undefined): OutlineTitles {
  const bySowRef = new Map<string, string>();
  const byOurRef = new Map<string, string>();
  for (const s of sections ?? []) {
    const title = (s.title ?? "").trim();
    if (!title) continue;
    const sow = (s.sowRef ?? "").trim();
    const our = (s.ourRef ?? "").trim();
    if (sow && !bySowRef.has(sow)) bySowRef.set(sow, title);
    if (our && !byOurRef.has(our)) byOurRef.set(our, title);
  }
  return { bySowRef, byOurRef };
}

export interface AigccExportOpts {
  project: Project;
  items: BoqItem[];
  company: CompanyProfile | null | undefined;
  quotationRef?: string;
  submittingTo?: string;
  projectLocation?: string;
  projectNumber?: string;
  submissionDate?: string;
  /** AI-generated work-programme activities. When present, a "Programme" sheet is appended. */
  schedule?: ScheduleActivity[];
  /** Project resources/team — used to label each activity's assignee on the Programme sheet. */
  resources?: ProjectResource[];
  /** Default work calendar (weekends/holidays/hours) — makes the Programme dates calendar-aware. */
  calendar?: ProjectCalendar | null;
  /** Resource leave/vacation rows — extend the driving resource's activities. */
  leave?: ResourceLeave[];
  /** Multi-resource assignments — drive multi-assignee labels + cost roll-up. */
  assignments?: ActivityResource[];
  /** Persisted SOW outline — supplies the documents' own division/section headings. */
  sowSections?: SowSection[];
}

/** Parse a stored calendar row into the engine's WorkCalendar shape. */
function calendarFromRow(row: ProjectCalendar | null | undefined): WorkCalendar {
  if (!row) return defaultCalendar();
  let weekendDays: number[] = [5, 6];
  let holidays: WorkCalendar["holidays"] = [];
  try { const w = JSON.parse(row.weekendDays || "[]"); if (Array.isArray(w)) weekendDays = w; } catch { /* default */ }
  try { const h = JSON.parse(row.holidays || "[]"); if (Array.isArray(h)) holidays = h; } catch { /* default */ }
  return { weekendDays, hoursPerDay: Number(row.hoursPerDay) || 8, holidays };
}

/** Lighten an 8-digit ARGB toward white by `amt` (0..1). Used to tint the
 *  not-yet-done remainder of a progress bar a paler shade of its base colour. */
function lightenArgb(argb: string, amt: number): string {
  const a = argb.slice(0, 2);
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt).toString(16).padStart(2, "0");
  return `${a}${mix(r)}${mix(g)}${mix(b)}`.toUpperCase();
}

/** Spreadsheet column name for a 1-based column index (1→A, 26→Z, 27→AA…). */
function colName(n: number): string {
  let out = "";
  let rem = n;
  while (rem > 0) {
    const r = (rem - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    rem = Math.floor((rem - 1) / 26);
  }
  return out;
}

interface Group<T> { key: string; title: string; sortKey: string; items: T[]; subs: Map<string, Group<T>>; }

function makeGroup<T>(key: string, title: string, sortKey: string): Group<T> {
  return { key, title, sortKey, items: [], subs: new Map() };
}

function refSortKey(ref: string | null | undefined): string {
  if (!ref) return "z-unclassified";
  // Pad each numeric segment to 4 chars so "2.10" sorts after "2.2".
  return ref.replace(/\d+/g, n => n.padStart(4, "0"));
}

/** Separators between segments of a SOW/our ref ("2.4", "4-1", "D 1"). */
const REF_SEGMENT_SPLIT = /[.\-\s/]/;

/**
 * The top-level SOW division an item belongs to — the leading segment of its
 * sowRef ("2.4" → "2", "D" → "D"). Falls back to ourRef, then "Unclassified".
 * This is the key the export splits sheets on: one sheet per SOW division,
 * following the document's own numbering rather than a keyword-guessed trade.
 */
function divisionKeyOf(item: BoqItem): string {
  const sow = (item.sowRef ?? "").trim();
  if (sow) return sow.split(REF_SEGMENT_SPLIT)[0] || sow;
  const our = (item.ourRef ?? "").trim();
  if (our) return our.split(REF_SEGMENT_SPLIT)[0] || our;
  return "Unclassified";
}

/**
 * Human display name for a division. Preference order:
 *   1. the documents' OWN heading for this division (from the persisted SOW
 *      outline) — matched on the division's sowRef, then any item's ourRef;
 *   2. the most common non-empty item category (the AI's short trade tag);
 *   3. a "Division {key}" fallback.
 */
function divisionTitleOf(key: string, list: BoqItem[], titles: OutlineTitles): string {
  if (key === "Unclassified") return UNCLASSIFIED_DEPARTMENT;

  // 1. The document's own division heading.
  const fromSow = titles.bySowRef.get(key);
  if (fromSow) return fromSow;
  for (const it of list) {
    const our = (it.ourRef ?? "").trim();
    const t = our ? titles.byOurRef.get(our) : undefined;
    if (t) return t;
  }

  // 2. Most common category tag.
  const counts = new Map<string, number>();
  for (const it of list) {
    const c = (it.category ?? "").trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) { bestN = n; best = c; }

  // 3. Fallback.
  return best || `Division ${key}`;
}

/** Resolve the heading for one item's SOW section: prefer the document's own
 *  heading (by sowRef, then ourRef), else fall back to the supplied default. */
function sectionTitleFor(
  sowRef: string | null | undefined,
  ourRef: string | null | undefined,
  titles: OutlineTitles,
  fallback: string,
): string {
  const sow = (sowRef ?? "").trim();
  if (sow && titles.bySowRef.has(sow)) return titles.bySowRef.get(sow)!;
  const our = (ourRef ?? "").trim();
  if (our && titles.byOurRef.has(our)) return titles.byOurRef.get(our)!;
  return fallback;
}

/** Resolve the shared header/meta context (currency, refs, project meta) used
 *  by every sheet. Shared by the BOQ and the standalone Programme workbooks so
 *  both carry an identical letterhead/meta block. */
function resolveContext(opts: AigccExportOpts): SheetContext {
  const { project, company } = opts;
  const currency = company?.currencyCode || "KWD";
  const today = new Date();
  const submissionDate = opts.submissionDate
    || today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const year = String(today.getFullYear()).slice(-2);
  const quotationRef = opts.quotationRef
    || `${company?.companyName ? `AIGCC/${(company.refPrefix || "QO")}/${project.id}/${year}` : `${(company?.refPrefix || "QO")}/${project.id}/${year}`}`;
  return {
    currency, submissionDate, quotationRef,
    submittingTo: opts.submittingTo || "",
    projectLocation: opts.projectLocation || "",
    projectNumber: opts.projectNumber || String(project.id),
    projectName: project.name ?? "",
    commencementDate: project.commencementDate ?? null,
  };
}

export async function buildAigccWorkbook(opts: AigccExportOpts): Promise<ExcelJS.Workbook> {
  const { project, items, company } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator = company?.companyName || "TenderLogix";
  wb.created = new Date();

  // ── Split items into SOW divisions ───────────────────────────────────────
  // One sheet per top-level SOW division (the leading segment of each item's
  // sowRef — see divisionKeyOf). Sheets follow the SOW's own numbering instead
  // of a keyword-guessed trade; each division's display name is derived from the
  // items' own category tags. Divisions are ordered by their natural ref order
  // ("2" before "10", numbers before letters), with "Unclassified" last.
  const divKeys: string[] = [];
  const divItems = new Map<string, BoqItem[]>();
  for (const item of items) {
    const key = divisionKeyOf(item);
    if (!divItems.has(key)) { divItems.set(key, []); divKeys.push(key); }
    divItems.get(key)!.push(item);
  }
  // Always produce at least one sheet, even for an empty project.
  if (divKeys.length === 0) { divKeys.push("Unclassified"); divItems.set("Unclassified", []); }

  divKeys.sort((a, b) => {
    if (a === "Unclassified") return 1;
    if (b === "Unclassified") return -1;
    return refSortKey(a).localeCompare(refSortKey(b));
  });

  const ctx = resolveContext(opts);

  // The documents' own division/section headings (empty for legacy projects
  // with no persisted outline — renderers then fall back to category tags).
  const titles = buildOutlineTitles(opts.sowSections);

  const usedNames = new Set<string>();
  for (const key of divKeys) {
    const divList = divItems.get(key)!;
    const title = divisionTitleOf(key, divList, titles);
    const ws = wb.addWorksheet(uniqueSheetName(title, usedNames));
    renderDepartmentSheet(wb, ws, divList, title, ctx, titles);
  }

  // NOTE: The work programme is intentionally NOT added here. It is exported as a
  // SEPARATE workbook (see buildScheduleWorkbook + the /programme/export.xlsx
  // route) so the priced BOQ and the time schedule are distinct downloads.
  return wb;
}

/**
 * Standalone work-programme (time schedule) workbook — a single "Programme" sheet
 * rendered as a week-by-week Gantt. Kept as its own download, separate from the
 * priced BOQ workbook, so users get two distinct files.
 */
export async function buildScheduleWorkbook(opts: AigccExportOpts): Promise<ExcelJS.Workbook> {
  const { company } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = company?.companyName || "TenderLogix";
  wb.created = new Date();

  const ctx = resolveContext(opts);
  const ws = wb.addWorksheet("Programme");
  renderScheduleSheet(wb, ws, opts.schedule ?? [], ctx, opts.resources ?? [], opts.calendar ?? null, opts.leave ?? [], opts.assignments ?? []);
  return wb;
}

interface SheetContext {
  currency: string;
  submissionDate: string;
  quotationRef: string;
  submittingTo: string;
  projectLocation: string;
  projectNumber: string;
  projectName: string;
  /** Project commencement (day-0) as "YYYY-MM-DD", or null if not set. Drives
   *  real calendar month bands + start/finish dates on the Programme sheet. */
  commencementDate: string | null;
}

/** Sanitise a department label into a valid, unique Excel sheet name (≤31 chars,
 *  none of the reserved characters * ? : \ / [ ]). */
function uniqueSheetName(label: string, used: Set<string>): string {
  let base = label.replace(/[\\/?*:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Render one department's priced BOQ onto a worksheet: letterhead, title,
 *  project-meta block, column headers, SOW-grouped line items with per-section
 *  subtotals, and a department grand total. */
function renderDepartmentSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  items: BoqItem[],
  department: string,
  ctx: SheetContext,
  titles: OutlineTitles,
): void {
  const { currency, submissionDate, quotationRef, submittingTo, projectLocation, projectNumber, projectName } = ctx;

  // Column widths matching the 1158/1159/1162 samples. Column A is an empty
  // left-margin column; the 9-column table lives in B–J. Column A is widened to
  // LEFT_MARGIN so the whole sheet (logo + title + table) is indented toward the
  // middle of the page instead of hugging the left edge. The logo, which centres
  // within the B:J span, shifts with it and stays centred over the table.
  const LEFT_MARGIN = 45;   // width units of empty column A (≈ middle indent)
  ws.columns = [
    { width: LEFT_MARGIN },  // A — empty left margin (indents the sheet)
    { width: 11 },  // B — SOW Ref. No.
    { width: 11 },  // C — Our Ref. No.
    { width: 10 },  // D — Sub. Ref.
    { width: 10 },  // E — Sr.No.
    { width: 68 },  // F — DESCRIPTION
    { width: 8 },   // G — UNIT
    { width: 12 },  // H — QUANTITY
    { width: 15 },  // I — RATE (IN KWD)
    { width: 17 },  // J — AMOUNT (IN KWD)
    { width: 22 },  // K — REMARKS (scope-type / QS notes from the AIGCC template)
  ];

  // Every styled row spans these 10 columns (B–K). Column A is left empty.
  // Centralised so the table stays rectangular when the column set changes.
  const COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;
  const FIRST = COLS[0];                 // "B" — first table column (SOW Ref)
  const LAST = COLS[COLS.length - 1];    // "K" — last table column (REMARKS, right edge)
  const AMOUNT_COL = "J";                // the AMOUNT column — totals land here, NOT in LAST

  const thin = { style: "thin", color: { argb: "FF000000" } } as const;
  const thick = { style: "thick", color: { argb: "FF000000" } } as const;
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: "center", vertical: "middle", wrapText: true } as const;
  const left = { horizontal: "left", vertical: "middle", wrapText: true } as const;
  const right = { horizontal: "right", vertical: "middle", wrapText: true } as const;

  // AIGCC house colour scheme (matches the priced-BOQ template):
  //   • dark teal column-header band with white text
  //   • pale-blue project-meta labels and sub-section bands
  //   • mid-blue SOW section bands
  //   • peach per-section subtotals, orange grand total
  const TEAL = "FF1F6E7E";        // column-header band
  const TEAL_ACCENT = "FF155E6E"; // title rule line
  const WHITE = "FFFFFFFF";
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } } as const;
  const metaLabelFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } } as const;
  const sectionFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } } as const;
  const subSectionFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } } as const;
  const subtotalFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } } as const;
  const grandFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8CBAD" } } as const;
  const unpricedFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } as const; // pale amber
  const tealRule = { style: "medium", color: { argb: TEAL_ACCENT } } as const;

  // Placeholder + note shown on every line item that has no rate entered yet, so
  // the exported BOQ makes clear the price must still be filled in via the portal.
  const RATE_PLACEHOLDER = "To be priced";
  const RATE_NOTE = "This rate / amount needs to be updated in the portal before submission.";
  let unpricedCount = 0;  // number of line items exported without a rate
  let tbdCount = 0;       // number of line items whose quantity is TBD (no evidence)

  let row = 1;

  // ── Logo letterhead band ─────────────────────────────────────────────────
  // Combined techSME + AIGCC letterhead (2130×334 px, ≈6.4:1), rendered at a
  // FIXED size (via ext) so it is compact, and CENTRED over the table.
  //   • ext = explicit pixel size → deterministic, undistorted (LOGO_W/H keep
  //     the 6.4:1 ratio), independent of column widths.
  //   • the band is 3 rows tall; the image is vertically + horizontally centred
  //     inside it using fractional tl col/row offsets.
  // (editAs:"oneCell" with NO ext renders at full natural size — that was the
  // earlier oversize bug. With ext the size is whatever we set here.)
  // The logo band is 4 rows tall so the letterhead image has clear vertical
  // padding inside its frame (it no longer touches the top/bottom border).
  const LOGO_ROWS = 4;     // logo band occupies rows 1–4
  const SPACER_ROW = LOGO_ROWS + 1;   // first empty spacer row (derived)
  const SPACER_ROWS = 2;   // empty spacer rows before the title
  const LOGO_ROW_H = 30;   // pt; 4 rows ≈ 160 px tall band (logo sits centred with margin)
  // The image is kept comfortably narrower than the B:J band so it never reaches
  // the left/right frame borders — the box reads as a clean rectangle around it.
  const LOGO_W = 640;      // px — letterhead width (padded inside the frame)
  const LOGO_H = Math.round(LOGO_W * LETTERHEAD_LOGO.height / LETTERHEAD_LOGO.width); // keep true ratio
  ws.mergeCells(`${FIRST}1:${LAST}${LOGO_ROWS}`);  // white background band B:J
  for (let r = 1; r <= LOGO_ROWS; r++) ws.getRow(r).height = LOGO_ROW_H;
  for (let s = 0; s < SPACER_ROWS; s++) ws.getRow(SPACER_ROW + s).height = 12;  // empty spacer rows

  // Thick black box around the letterhead band (B1:J{LOGO_ROWS}). ExcelJS treats
  // a merged range as ONE shared style, so per-perimeter-cell borders just clobber
  // each other (only the last-written edges survive). The reliable way to frame a
  // merged region is to set all four borders on the MASTER cell — Excel then draws
  // the complete outline around the whole merged block.
  ws.getCell(`${FIRST}1`).border = { top: thick, left: thick, bottom: thick, right: thick };

  // Centre the LOGO_W×LOGO_H image inside the table band. Column pixel widths use
  // Excel's width→px (≈ units*7 + 5). Table B:J spans px [tableL, tableR].
  const colPx = (w: number) => Math.round(w * 7) + 5;
  const tableColWidths = [11, 11, 10, 10, 68, 8, 12, 15, 17, 22]; // B..K
  const aPx = colPx(LEFT_MARGIN);                         // column A margin width
  let edge = aPx;                                         // running left edge (px) from sheet origin
  const colLeft: number[] = [];                           // left px of each table col B..K
  for (const w of tableColWidths) { colLeft.push(edge); edge += colPx(w); }
  const tableL = colLeft[0];                              // left px of B
  const tableR = edge;                                    // right px of K
  const imgL = (tableL + tableR) / 2 - LOGO_W / 2;        // centred left px
  // Resolve imgL to a {col index, fractional offset} for the tl anchor.
  let tlCol = 1;                                          // 0-based: A=0, B=1 …
  for (let i = 0; i < tableColWidths.length; i++) {
    const wpx = colPx(tableColWidths[i]);
    if (imgL < colLeft[i] + wpx || i === tableColWidths.length - 1) { tlCol = (i + 1) + (imgL - colLeft[i]) / wpx; break; }
  }
  const bandPx = LOGO_ROWS * Math.round(LOGO_ROW_H * 4 / 3); // band height px
  const rowFrac = Math.max(0, (bandPx - LOGO_H) / 2) / Math.round(LOGO_ROW_H * 4 / 3);

  const letterheadId = wb.addImage({ base64: LETTERHEAD_LOGO.base64, extension: LETTERHEAD_LOGO.extension });
  ws.addImage(letterheadId, {
    tl: { col: tlCol, row: rowFrac } as ExcelJS.Anchor,
    ext: { width: LOGO_W, height: LOGO_H },
  });

  row = SPACER_ROW + SPACER_ROWS;  // content (title) starts below the spacer rows

  // ── Title row: full-width, bold "BILL OF QUANTITIES" under the logo ──────
  // Framed top & bottom with a teal rule to match the AIGCC template. The
  // division is identified by the sheet tab + the section header rows, so the
  // title stays clean (no suffix), exactly like the printed sample.
  ws.mergeCells(`${FIRST}${row}:${LAST}${row}`);
  const titleCell = ws.getCell(`${FIRST}${row}`);
  titleCell.value = "BILL OF QUANTITIES";
  titleCell.font = { name: "Arial", bold: true, size: 16, color: { argb: TEAL_ACCENT } };
  titleCell.alignment = center;
  for (const col of COLS) ws.getCell(`${col}${row}`).border = { ...border, top: tealRule, bottom: tealRule };
  ws.getRow(row).height = 28;
  row++;

  // ── Project meta block: 5 rows (label on the left, value on the right) ──
  const writeMeta = (label: string, value: string) => {
    ws.mergeCells(`B${row}:E${row}`);
    ws.mergeCells(`F${row}:${LAST}${row}`);
    ws.getCell(`B${row}`).value = label;
    ws.getCell(`F${row}`).value = value;
    ws.getCell(`B${row}`).font = { name: "Arial", bold: true, size: 10 };
    ws.getCell(`F${row}`).font = { name: "Arial", size: 10 };
    ws.getCell(`B${row}`).alignment = left;
    ws.getCell(`F${row}`).alignment = left;
    ws.getCell(`B${row}`).fill = metaLabelFill;   // pale-blue label band
    for (const col of COLS) ws.getCell(`${col}${row}`).border = border;
    row++;
  };
  writeMeta("Project Number", projectNumber);
  writeMeta("Project Name", projectName);
  writeMeta("Project Location", projectLocation);
  writeMeta("Submission Date", submissionDate);
  writeMeta("Submitted to", submittingTo);

  // ── Column headers ───────────────────────────────────────────────────────
  const headerRow = row;
  const headerLabels = [
    "SOW Ref. No.", "Our Ref.No.", "Sub. Ref.", "Sr.No.",
    "DESCRIPTION", "UNIT", "QUANTITY",
    `RATE (IN ${currency})`, `AMOUNT (IN ${currency})`, "REMARKS",
  ];
  headerLabels.forEach((label, idx) => {
    const col = COLS[idx];
    const cell = ws.getCell(`${col}${row}`);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 10, color: { argb: WHITE } };
    cell.alignment = center;
    cell.fill = headerFill;
    cell.border = border;
  });
  ws.getRow(row).height = 32;
  row++;

  // ── Group items into the 4-level hierarchy ──────────────────────────────
  // Strategy:
  //   level-1 by sowRef (or "Unclassified" if missing)
  //   level-2 by subRef under that sowRef
  //   line items inside each level-2 group
  // Within level-1 we also remember the ourRef so the section header row can show it.

  type SectionGroup = Group<BoqItem> & { ourRef: string | null };

  const sections = new Map<string, SectionGroup>();
  for (const item of items) {
    const sowRef = item.sowRef ?? "Unclassified";
    const subRef = item.subRef ?? "_default";
    if (!sections.has(sowRef)) {
      // Title from the document's own heading (by sowRef/ourRef), else category.
      const sectionTitle = sowRef === "Unclassified"
        ? "Unclassified items"
        : sectionTitleFor(item.sowRef, item.ourRef, titles, item.category || `Section ${sowRef}`);
      const g = makeGroup<BoqItem>(sowRef, sectionTitle, refSortKey(sowRef)) as SectionGroup;
      g.ourRef = item.ourRef ?? null;
      sections.set(sowRef, g);
    }
    const sec = sections.get(sowRef)!;
    if (!sec.ourRef && item.ourRef) sec.ourRef = item.ourRef;
    // Track a title heuristic — first non-empty item description's leading
    // chunk is rarely a good title, so we leave title generation to category.
    if (!sec.subs.has(subRef)) sec.subs.set(subRef, makeGroup<BoqItem>(subRef, item.category || "", refSortKey(subRef)));
    sec.subs.get(subRef)!.items.push(item);
  }

  const subtotalCells: Array<{ sectionRef: string; ourRef: string | null; cell: string }> = [];

  const sortedSections = Array.from(sections.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let unclassifiedOurIdx = sortedSections.length;

  for (const section of sortedSections) {
    const sowRefDisplay = section.key === "Unclassified" ? "" : section.key;
    const ourRefDisplay = section.ourRef ?? (section.key === "Unclassified" ? String(++unclassifiedOurIdx) : "");

    // Section header row
    ws.getCell(`B${row}`).value = sowRefDisplay;
    ws.getCell(`C${row}`).value = ourRefDisplay;
    ws.mergeCells(`F${row}:${LAST}${row}`);
    ws.getCell(`F${row}`).value = section.key === "Unclassified"
      ? "Unclassified items"
      : section.title;
    for (const col of COLS) {
      const cell = ws.getCell(`${col}${row}`);
      cell.font = { name: "Arial", bold: true, size: 11 };
      cell.fill = sectionFill;
      cell.alignment = (col === "F") ? left : center;
      cell.border = border;
    }
    ws.getRow(row).height = 22;
    row++;

    const itemFormulaCells: string[] = [];
    const sortedSubs = Array.from(section.subs.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    for (const sub of sortedSubs) {
      // Optional sub-header (only when subRef is meaningful). Prefer the
      // document's own sub-section heading; else fall back to the category tag,
      // suppressed when it merely restates the section title (avoids rendering
      // "Electrical / Electrical" twice for a single-trade division).
      if (sub.key !== "_default" && sub.items.length > 0) {
        const subItem = sub.items[0];
        const subCategory = (subItem.category || "").trim();
        const subFallback = subCategory && subCategory !== section.title ? subCategory : "";
        const subTitle = sectionTitleFor(subItem.subRef, sub.key, titles, subFallback);
        ws.getCell(`D${row}`).value = sub.key;
        ws.mergeCells(`F${row}:${LAST}${row}`);
        ws.getCell(`F${row}`).value = subTitle === section.title ? "" : subTitle;
        for (const col of COLS) {
          const cell = ws.getCell(`${col}${row}`);
          cell.font = { name: "Arial", bold: true, italic: true, size: 10 };
          cell.fill = subSectionFill;
          cell.alignment = (col === "F") ? left : center;
          cell.border = border;
        }
        row++;
      }

      // Line items, sorted by srNo
      const sortedItems = sub.items.slice().sort((a, b) => refSortKey(a.srNo).localeCompare(refSortKey(b.srNo)));
      for (const it of sortedItems) {
        const qty = it.quantity ? parseFloat(it.quantity) : 0;
        const rate = it.unitPrice ? parseFloat(it.unitPrice) : null;
        const amount = it.totalPrice ? parseFloat(it.totalPrice) : (rate !== null ? qty * rate : null);

        ws.getCell(`B${row}`).value = it.sowRef ?? "";
        ws.getCell(`C${row}`).value = it.ourRef ?? "";
        ws.getCell(`D${row}`).value = it.subRef ?? "";
        ws.getCell(`E${row}`).value = it.srNo ?? "";
        ws.getCell(`F${row}`).value = it.description ?? "";
        ws.getCell(`G${row}`).value = normalizeUnit(it.unit);
        // Evidence gate (design Primary Position): a measurable line with no
        // traceable evidence shows TBD, never a credible-looking number.
        const refCount = Array.isArray((it as { drawingReferences?: unknown[] }).drawingReferences)
          ? ((it as { drawingReferences?: unknown[] }).drawingReferences as unknown[]).length : 0;
        const evItem = {
          description: it.description, category: it.category, unit: it.unit,
          notes: it.notes, quantity: it.quantity, drawingRefCount: refCount,
        };
        const isTbd = isTbdQuantity(evItem);
        const effAmount = isTbd ? null : amount;

        ws.getCell(`H${row}`).value = isTbd ? "TBD" : qty;
        if (!isTbd && rate !== null) ws.getCell(`I${row}`).value = rate;
        if (!isTbd && rate !== null) ws.getCell(`J${row}`).value = { formula: `H${row}*I${row}`, result: effAmount ?? 0 };
        // REMARKS — scope-type tag, or the quantity basis for a TBD line.
        ws.getCell(`K${row}`).value = isTbd ? `TBD — ${quantityBasis(evItem)}` : (it.remarks ?? "");

        if (!isTbd && effAmount !== null && rate !== null) itemFormulaCells.push(`J${row}`);

        if (isTbd) {
          // Quantity not yet measured — flag it for takeoff; it carries no amount.
          tbdCount++;
          ws.getCell(`H${row}`).note = "Quantity is TBD — no traceable CAD / schedule / SOW evidence yet. Take off from the drawings before pricing.";
          ws.getCell(`J${row}`).value = "TBD";
          if (rate === null) { const r = ws.getCell(`I${row}`); r.value = RATE_PLACEHOLDER; r.note = RATE_NOTE; }
        } else if (rate === null) {
          // Unpriced item: flag RATE/AMOUNT so the QS sees price is still needed.
          unpricedCount++;
          const rateCell = ws.getCell(`I${row}`);
          const amtCell = ws.getCell(`J${row}`);
          rateCell.value = RATE_PLACEHOLDER;
          rateCell.note = RATE_NOTE;
          amtCell.value = RATE_PLACEHOLDER;
          amtCell.note = RATE_NOTE;
        }

        for (const col of COLS) {
          const cell = ws.getCell(`${col}${row}`);
          cell.font = { name: "Arial", size: 10 };
          cell.border = border;
          cell.alignment = (col === "F" || col === "K") ? left : (col === "H" || col === "I" || col === "J" ? right : center);
          if (col === "K") cell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF555555" } };
          if ((col === "I" || col === "J") && !isTbd) cell.numFmt = "#,##0.000;[Red]-#,##0.000";
          if (col === "H" && !isTbd) cell.numFmt = "#,##0.###";
        }
        if (isTbd) {
          // Bold amber TBD quantity + amount so it stands out for takeoff.
          for (const col of ["H", "J"] as const) {
            const cell = ws.getCell(`${col}${row}`);
            cell.font = { name: "Arial", size: 9, bold: true, italic: true, color: { argb: "FFB45309" } };
            cell.fill = unpricedFill;
            cell.numFmt = "General";
          }
        } else if (rate === null) {
          // Italic amber text for the "To be priced" placeholders.
          for (const col of ["I", "J"] as const) {
            const cell = ws.getCell(`${col}${row}`);
            cell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FFB45309" } };
            cell.fill = unpricedFill;
            cell.numFmt = "General";
          }
        }
        row++;
      }
    }

    // Subtotal row for this section. The amount lands in the AMOUNT column (J),
    // NOT the table's right edge (K is REMARKS); the label spans B:I.
    const subtotalCell = `${AMOUNT_COL}${row}`;
    ws.mergeCells(`${FIRST}${row}:I${row}`);
    const subtotalLabel = section.key === "Unclassified"
      ? `Total Amount in ${currency} for Unclassified`
      : `Total Amount in ${currency} for ${section.key}`;
    ws.getCell(`${FIRST}${row}`).value = subtotalLabel;
    ws.getCell(`${FIRST}${row}`).font = { name: "Arial", bold: true, size: 10 };
    ws.getCell(`${FIRST}${row}`).alignment = right;
    ws.getCell(`${FIRST}${row}`).fill = subtotalFill;
    if (itemFormulaCells.length > 0) {
      ws.getCell(subtotalCell).value = { formula: itemFormulaCells.join("+"), result: 0 };
    } else {
      ws.getCell(subtotalCell).value = 0;
    }
    ws.getCell(subtotalCell).numFmt = "#,##0.000;[Red]-#,##0.000";
    ws.getCell(subtotalCell).font = { name: "Arial", bold: true, size: 10 };
    ws.getCell(subtotalCell).fill = subtotalFill;
    ws.getCell(subtotalCell).alignment = right;
    for (const col of COLS) ws.getCell(`${col}${row}`).border = border;
    ws.getCell(`K${row}`).fill = subtotalFill;  // keep the REMARKS cell in-band
    subtotalCells.push({ sectionRef: section.key, ourRef: section.ourRef, cell: subtotalCell });
    row += 2; // blank spacer row after the subtotal
  }

  // ── Grand total ──────────────────────────────────────────────────────────
  ws.mergeCells(`${FIRST}${row}:I${row}`);
  ws.getCell(`${FIRST}${row}`).value = `GRAND TOTAL AMOUNT IN ${currency}`;
  ws.getCell(`${FIRST}${row}`).font = { name: "Arial", bold: true, size: 12 };
  ws.getCell(`${FIRST}${row}`).alignment = right;
  ws.getCell(`${FIRST}${row}`).fill = grandFill;
  const grandCell = ws.getCell(`${AMOUNT_COL}${row}`);
  if (subtotalCells.length > 0) {
    grandCell.value = { formula: subtotalCells.map(s => s.cell).join("+"), result: 0 };
  } else {
    grandCell.value = 0;
  }
  grandCell.numFmt = "#,##0.000;[Red]-#,##0.000";
  grandCell.font = { name: "Arial", bold: true, size: 12 };
  grandCell.alignment = right;
  grandCell.fill = grandFill;
  for (const col of COLS) ws.getCell(`${col}${row}`).border = border;
  ws.getCell(`K${row}`).fill = grandFill;  // keep the REMARKS cell in-band
  ws.getRow(row).height = 26;
  row++;

  // ── Disclaimer ─────────────────────────────────────────────────────────────
  // When the BOQ is exported before all rates are entered, append a prominent
  // amber disclaimer row so the recipient knows the totals are provisional and
  // the outstanding rates must be updated in the portal. (Thin border only — the
  // thick box frame is reserved for the logo letterhead band at the top.)
  if (unpricedCount > 0 || tbdCount > 0) {
    row++; // blank spacer
    ws.mergeCells(`${FIRST}${row}:${LAST}${row}`);
    const note = ws.getCell(`${FIRST}${row}`);
    const parts: string[] = [];
    if (tbdCount > 0) {
      parts.push(
        `${tbdCount} item${tbdCount === 1 ? "" : "s"} show quantity "TBD" — these have no traceable `
        + `CAD / schedule / SOW evidence yet and must be taken off from the drawings before pricing (see the Remarks column for the basis).`,
      );
    }
    if (unpricedCount > 0) {
      parts.push(
        `${unpricedCount} item${unpricedCount === 1 ? "" : "s"} marked "${RATE_PLACEHOLDER}" have no rate entered.`,
      );
    }
    note.value = `DISCLAIMER: ${parts.join(" ")} The grand total above is provisional and excludes them.`;
    note.font = { name: "Arial", bold: true, size: 10, color: { argb: "FF9C4221" } };
    note.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    note.fill = unpricedFill;
    for (const col of COLS) ws.getCell(`${col}${row}`).border = border;
    ws.getRow(row).height = 40;
  }

  // Print setup
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.paperSize = 9; // A4
  ws.pageSetup.horizontalCentered = true;  // centre the table on the page
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  // Exclude the wide empty margin column A from the print area so the printed /
  // PDF output centres the TABLE (fills the page width) instead of baking in a
  // left-only gap — consistent with the Programme sheet. Screen keeps the indent.
  ws.pageSetup.printArea = `${FIRST}1:${LAST}${row}`;
  // Quotation ref lives in the print header now (clean on screen, on paper for
  // the QS) since the on-sheet Ref-No banner was dropped to match the samples.
  ws.headerFooter.oddHeader = `&L&"Arial,Bold"&10Ref No: ${quotationRef}`;
}

/** Render the project work programme as a clean, presentable week-by-week Gantt
 *  on its own sheet: a framed letterhead, a project title/meta box, a two-tier
 *  Month → Week time axis, phase rows carrying a dark summary bar across their
 *  span, zebra-striped activities with coloured work bars + milestone diamonds,
 *  a legend, frozen header/info panes and a hidden default grid. */
function renderScheduleSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  activities: ScheduleActivity[],
  ctx: SheetContext,
  resources: ProjectResource[] = [],
  calendarRow: ProjectCalendar | null = null,
  leave: ResourceLeave[] = [],
  assignments: ActivityResource[] = [],
): void {
  const { quotationRef, submissionDate, projectLocation, projectNumber, projectName, commencementDate } = ctx;
  const resourceById = new Map<number, ProjectResource>(resources.map((r) => [r.id, r]));

  // ── Calendar + leave + assignments (P6 resource loading) ─────────────────────
  const workCalendar = calendarFromRow(calendarRow);
  const hoursPerDay = workCalendar.hoursPerDay || 8;
  // resourceId → its leave dates (for auto-extend of the driving resource).
  const leaveByResource = new Map<number, Set<string>>();
  for (const l of leave) {
    const cur = leaveByResource.get(l.resourceId) ?? new Set<string>();
    for (const d of leaveDateSet([{ fromDate: l.fromDate, toDate: l.toDate }])) cur.add(d);
    leaveByResource.set(l.resourceId, cur);
  }
  // activityId → assignments (driving first).
  const assignsByActivity = new Map<number, ActivityResource[]>();
  for (const x of assignments) { const a = assignsByActivity.get(x.activityId) ?? []; a.push(x); assignsByActivity.set(x.activityId, a); }
  for (const arr of assignsByActivity.values()) arr.sort((x, y) => (y.isDriving - x.isDriving) || (x.id - y.id));
  const drivingResId = (a: ScheduleActivity): number | null => {
    const arr = assignsByActivity.get(a.id);
    if (arr && arr.length) return (arr.find((x) => x.isDriving === 1) ?? arr[0]).resourceId;
    return a.resourceId;
  };
  const projectCurrency = resources.find((r) => r.currency)?.currency ?? ctx.currency ?? "KWD";
  const moneyFmt = (n: number): string => {
    if (!Number.isFinite(n) || n <= 0) return "";
    const dp = projectCurrency === "KWD" || projectCurrency === "BHD" || projectCurrency === "OMR" ? 3 : 2;
    return `${projectCurrency} ${n.toLocaleString("en-US", { maximumFractionDigits: dp })}`;
  };

  // The programme timeline is WEEK-based: one column per calendar week, grouped
  // under real calendar-month bands (when a commencement date is set). `weeks`
  // counts WEEK columns; `WEEK_FIRST` / `lastWeekCol` / `weekRow` are the first
  // timeline column / last column / the week-label axis row.
  const MAX_WEEKS = 104;      // cap (~2 years) so a runaway duration can't blow up the sheet

  // ── Calendar helpers (commencement is an ISO "YYYY-MM-DD" anchor at day 0) ──
  const MS_DAY = 86_400_000;
  const dateAtDay = (dayIdx: number): Date | null => {
    if (!commencementDate) return null;
    const base = new Date(`${commencementDate}T00:00:00`).getTime();
    return new Date(base + dayIdx * MS_DAY);
  };
  const fmtDay = (dayIdx: number): string => {
    const d = dateAtDay(dayIdx);
    return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : `Day ${dayIdx + 1}`;
  };

  // ── Phase / section colour palette — mirrors the on-screen Work Programme so
  // the exported Gantt carries the SAME colours: each section gets its own tint
  // (assigned in first-seen order) and the critical path overrides them in red.
  const PHASE_ARGB = [
    "FF2563EB", "FF7C3AED", "FF0891B2", "FF0D9488", "FFD97706",
    "FFDB2777", "FF16A34A", "FF4F46E5", "FF0284C7", "FFCA8A04",
  ];
  const CRITICAL_ARGB = "FFDC2626";   // critical-path bar + milestone (app red)
  const phaseColorIdx = new Map<string, number>();
  for (const a of activities) {
    const ph = a.phase || "General";
    if (!phaseColorIdx.has(ph)) phaseColorIdx.set(ph, phaseColorIdx.size);
  }
  const phaseArgbOf = (phase: string) => PHASE_ARGB[(phaseColorIdx.get(phase) ?? 0) % PHASE_ARGB.length];

  // ── CPM pass: derive every activity's dates from its typed dependency links
  // (FS/SS/FF/SF + lag) and flag the critical path. Activities with no links
  // anchor at their stored start offset; everything downstream is computed, so a
  // delayed predecessor pushes its successors — exactly as a P6 programme does.
  // Calendar mode (matches the on-screen Work Programme): with a commencement date
  // the durations are working-day effort and the bars skip weekends/holidays + the
  // driving resource's leave. Without it, the legacy calendar-day behaviour holds.
  const actMap = new Map(activities.map((a) => [a.id, a] as const));
  let cpmOpts: Parameters<typeof computeCpm>[1];
  if (commencementDate) {
    const predCache = new Map<number | null, (off: number) => boolean>();
    const getPred = (rid: number | null) => {
      if (!predCache.has(rid)) {
        const lv = rid != null ? leaveByResource.get(rid) : undefined;
        predCache.set(rid, workingByOffset(workCalendar, commencementDate, lv));
      }
      return predCache.get(rid)!;
    };
    cpmOpts = {
      isWorking: (id: number) => { const a = actMap.get(id); return getPred(a ? drivingResId(a) : null); },
      placeWork,
    };
  }
  const cpm = computeCpm(
    activities.map((a) => ({
      id: a.id,
      durationDays: a.durationDays ?? 0,
      isMilestone: a.isMilestone === 1,
      startOffsetDays: a.startOffsetDays ?? 0,
      dependencies: parseDependencies(a),
    })),
    cpmOpts,
  );
  const cpmOf = (a: ScheduleActivity): CpmResult | undefined => cpm.results.get(a.id);

  // Start / finish DAY index (0-based) for an activity — CPM-computed. The finish
  // uses the CPM calendar span (inclusive), so a bar spans the weekends/holidays
  // it straddles, identically to the live Gantt.
  const startDayOf = (a: ScheduleActivity) => Math.max(0, cpmOf(a)?.start ?? a.startOffsetDays ?? 0);
  const finishDayOf = (a: ScheduleActivity) => {
    const isMs = a.isMilestone === 1;
    if (isMs) return startDayOf(a);
    const r = cpmOf(a);
    if (r) return Math.max(startDayOf(a), r.finish - 1);
    return startDayOf(a) + Math.max((a.durationDays ?? 1) - 1, 0);
  };

  // Per-activity cost (assigned resources × working-day effort × allocation).
  const costOf = (a: ScheduleActivity): number => {
    if (a.isMilestone === 1) return 0;
    const wd = Math.max(0, a.durationDays ?? 0);
    let asg = assignsByActivity.get(a.id) ?? [];
    if (asg.length === 0 && a.resourceId != null) asg = [{ id: 0, projectId: a.projectId, activityId: a.id, resourceId: a.resourceId, allocationPct: 100, unitsPerDay: "1", isDriving: 1, createdAt: new Date() } as ActivityResource];
    let cost = 0;
    for (const x of asg) {
      const r = resourceById.get(x.resourceId);
      if (!r) continue;
      cost += assignmentCost({ rate: r.rate ? Number(r.rate) : 0, rateBasis: r.rateBasis }, wd, hoursPerDay, x.allocationPct, Number(x.unitsPerDay) || 1);
    }
    return cost;
  };
  // Multi-assignee label: "Ahmed (Engineer) +2".
  const assigneeLabel = (a: ScheduleActivity): string => {
    const asg = assignsByActivity.get(a.id) ?? [];
    if (asg.length === 0) {
      const r = a.resourceId != null ? resourceById.get(a.resourceId) : undefined;
      return r ? `${r.name}${r.role ? ` (${r.role})` : ""}` : "";
    }
    const lead = resourceById.get((asg.find((x) => x.isDriving === 1) ?? asg[0]).resourceId);
    if (!lead) return "";
    const extra = asg.length - 1;
    return `${lead.name}${lead.role ? ` (${lead.role})` : ""}${extra > 0 ? ` +${extra}` : ""}`;
  };
  const totalDays = cpm.projectEnd || activities.reduce((m, a) => Math.max(m, finishDayOf(a) + 1), 0);

  // 1-based programme line number per activity id (for P6-style predecessor refs).
  const lineNoById = new Map<number, number>();
  {
    let n = 0;
    for (const a of activities.slice().sort((x, y) => (x.seq - y.seq) || (x.startOffsetDays - y.startOffsetDays))) {
      lineNoById.set(a.id, ++n);
    }
  }
  // P6-style predecessor cell text, e.g. "3, 5SS+2, 7FF".
  const predText = (a: ScheduleActivity): string =>
    parseDependencies(a)
      .map((d) => {
        const ln = lineNoById.get(d.id);
        if (!ln) return "";
        const rel = relLabel(d.type, d.lag);
        return rel === "FS" ? String(ln) : `${ln}${rel}`;
      })
      .filter(Boolean)
      .join(", ");
  // 0-based START / FINISH week index for an activity.
  const startWeekOf = (a: ScheduleActivity) => Math.floor(startDayOf(a) / 7);
  const finishWeekOf = (a: ScheduleActivity) => Math.floor(finishDayOf(a) / 7);
  const maxWeekIdx = activities.reduce((m, a) => Math.max(m, finishWeekOf(a)), 0);
  const weeks = Math.max(1, Math.min(MAX_WEEKS, maxWeekIdx + 1));  // number of WEEK columns

  // Month bands over the week axis. With a commencement date we use REAL calendar
  // months (each band spans the weeks whose start date falls in that month);
  // otherwise we fall back to fixed 4-week blocks labelled "MONTH n".
  type MonthBand = { label: string; start: number; count: number };
  const monthBands: MonthBand[] = [];
  if (commencementDate) {
    let cur: (MonthBand & { key: string }) | null = null;
    for (let w = 0; w < weeks; w++) {
      const d = dateAtDay(w * 7)!;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!cur || cur.key !== key) {
        cur = { key, label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).toUpperCase(), start: w, count: 1 };
        monthBands.push(cur);
      } else cur.count++;
    }
  } else {
    for (let m = 0; m * 4 < weeks; m++) {
      const start = m * 4;
      monthBands.push({ label: `MONTH ${m + 1}`, start, count: Math.min(4, weeks - start) });
    }
  }
  const monthStartSet = new Set(monthBands.map((b) => b.start));
  const months = monthBands.length;

  // Per-phase span (earliest start week → latest finish week), in first-seen
  // order, so the phase header can carry a summary bar across its activities.
  const phaseSpan = new Map<string, { s: number; f: number }>();
  for (const a of activities) {
    const ph = a.phase || "General";
    const s = startWeekOf(a);
    const f = finishWeekOf(a);
    const cur = phaseSpan.get(ph);
    if (!cur) phaseSpan.set(ph, { s, f });
    else { cur.s = Math.min(cur.s, s); cur.f = Math.max(cur.f, f); }
  }

  // Column geometry: A = margin; B..H = info; I.. = one column per DAY.
  const INFO_FIRST = 2;            // column B
  const WEEK_FIRST = 9;            // column I — first day column
  const lastWeekCol = WEEK_FIRST + weeks - 1;
  const FIRST = colName(INFO_FIRST);     // "B"
  const LAST = colName(lastWeekCol);     // last day column
  const INFO_LAST = colName(WEEK_FIRST - 1); // "H"

  const ACTIVITY_W = 48;   // C — Activity column width (chars)
  const SOWREF_W = 14;     // D — SOW Ref column width (chars; refs can be compound)
  const PRED_W = 14;       // H — Predecessors (P6-style links, e.g. "3, 5SS+2")
  const WEEK_COL_W = 4.3;  // I.. — per-week timeline column (wider than the old day grid)
  // Wide empty column A indents the whole table toward the middle of the page so
  // it reads as centred (matches the BOQ sheets) rather than hugging the left edge.
  const LEFT_MARGIN = 30;
  ws.columns = [
    { width: LEFT_MARGIN }, // A — empty left margin (centres the table)
    { width: 5 },           // B — No.
    { width: ACTIVITY_W },  // C — Activity
    { width: SOWREF_W },    // D — SOW Ref
    { width: 9 },           // E — Duration (days)
    { width: 11 },          // F — Start (date / day)
    { width: 11 },          // G — Finish (date / day)
    { width: PRED_W },      // H — Predecessors
    ...Array.from({ length: weeks }, () => ({ width: WEEK_COL_W })),  // I.. — one per week
  ];

  // ── Palette (AIGCC house teal, matching the BOQ sheets) ───────────────────
  const TEAL = "FF1F6E7E";
  const TEAL_DARK = "FF124A56";
  const WHITE = "FFFFFFFF";
  const fill = (argb: string) => ({ type: "pattern", pattern: "solid", fgColor: { argb } } as const);
  const headerFill = fill(TEAL);          // column-header band
  const monthFillA = fill("FFDDEBF7");    // alternating month bands
  const monthFillB = fill("FFC9DCEC");
  const phaseFill = fill("FFBDD7EE");        // phase row band
  const criticalFill = fill(CRITICAL_ARGB);  // critical-path key swatch (app red)
  const zebraFill = fill("FFF3F7F9");        // alternating activity rows
  const metaLabelFill = fill("FFDDEBF7");

  const thinDark = { style: "thin", color: { argb: "FF808080" } } as const;   // info-table grid
  const thinGrid = { style: "thin", color: { argb: "FFDCE6EB" } } as const;   // faint timeline grid
  const monthSep = { style: "medium", color: { argb: "FFBFD2DA" } } as const; // month boundary
  const thick = { style: "thick", color: { argb: "FF000000" } } as const;
  const infoBorder = { top: thinDark, left: thinDark, bottom: thinDark, right: thinDark };
  const center = { horizontal: "center", vertical: "middle", wrapText: true } as const;
  const left = { horizontal: "left", vertical: "middle", wrapText: true } as const;
  // Axis/legend labels must NOT wrap (narrow columns would otherwise break a word
  // across lines, e.g. "MONT H 6"). They clip / overflow into empty cells instead.
  const centerNoWrap = { horizontal: "center", vertical: "middle", wrapText: false } as const;
  const leftNoWrap = { horizontal: "left", vertical: "middle", wrapText: false } as const;

  let row = 1;

  // ── Framed letterhead band (rows 1–3): logo CENTRED over the full schedule ──
  const LOGO_ROWS = 3;
  const LOGO_ROW_H = 26;
  ws.mergeCells(`${FIRST}1:${LAST}${LOGO_ROWS}`);
  for (let r = 1; r <= LOGO_ROWS; r++) ws.getRow(r).height = LOGO_ROW_H;
  // Thick frame on the master cell (ExcelJS draws the merged-region outline from it).
  ws.getCell(`${FIRST}1`).border = { top: thick, left: thick, bottom: thick, right: thick };

  const LOGO_W = 540;
  const LOGO_H = Math.round(LOGO_W * LETTERHEAD_LOGO.height / LETTERHEAD_LOGO.width);
  // Centre the image horizontally over the whole table span (B..LAST). Resolve the
  // centred pixel position to a {col index, fractional offset} tl anchor, the same
  // approach the BOQ sheet uses, so the logo sits in the middle of the schedule.
  const colPx = (w: number) => Math.round(w * 7) + 5;
  const tableColWidths = [5, ACTIVITY_W, SOWREF_W, 9, 11, 11, PRED_W, ...Array.from({ length: weeks }, () => WEEK_COL_W)];
  const aPx = colPx(LEFT_MARGIN);                        // column A margin
  let edgePx = aPx;
  const colLeft: number[] = [];
  for (const w of tableColWidths) { colLeft.push(edgePx); edgePx += colPx(w); }
  const tableL = colLeft[0];                             // left px of B
  const tableR = edgePx;                                 // right px of LAST
  const imgL = (tableL + tableR) / 2 - LOGO_W / 2;       // centred left px
  let tlCol = INFO_FIRST - 1;                            // 0-based fallback (col B)
  for (let i = 0; i < tableColWidths.length; i++) {
    const wpx = colPx(tableColWidths[i]);
    if (imgL < colLeft[i] + wpx || i === tableColWidths.length - 1) { tlCol = (INFO_FIRST - 1 + i) + (imgL - colLeft[i]) / wpx; break; }
  }
  const bandPx = LOGO_ROWS * Math.round(LOGO_ROW_H * 4 / 3);
  const rowFrac = Math.max(0, (bandPx - LOGO_H) / 2) / Math.round(LOGO_ROW_H * 4 / 3);
  const logoId = wb.addImage({ base64: LETTERHEAD_LOGO.base64, extension: LETTERHEAD_LOGO.extension });
  ws.addImage(logoId, {
    tl: { col: tlCol, row: rowFrac } as ExcelJS.Anchor,
    ext: { width: LOGO_W, height: LOGO_H },
  });
  ws.getRow(LOGO_ROWS + 1).height = 6;  // thin spacer
  row = LOGO_ROWS + 2;

  // ── Title row ─────────────────────────────────────────────────────────────
  ws.mergeCells(`${FIRST}${row}:${LAST}${row}`);
  const titleCell = ws.getCell(`${FIRST}${row}`);
  titleCell.value = "PROJECT WORK PROGRAMME";
  titleCell.font = { name: "Arial", bold: true, size: 16, color: { argb: TEAL_DARK } };
  titleCell.alignment = center;
  for (let c = INFO_FIRST; c <= lastWeekCol; c++) {
    ws.getCell(`${colName(c)}${row}`).border = { bottom: { style: "medium", color: { argb: TEAL } } };
  }
  ws.getRow(row).height = 26;
  row++;

  // ── Meta block (compact: 2 fields per row) ─────────────────────────────────
  const writeMetaPair = (l1: string, v1: string, l2: string, v2: string) => {
    // Left pair spans info columns; right pair spans the timeline columns.
    ws.mergeCells(`${FIRST}${row}:${colName(INFO_FIRST + 1)}${row}`);
    ws.mergeCells(`${colName(INFO_FIRST + 2)}${row}:${INFO_LAST}${row}`);
    const half = Math.floor((WEEK_FIRST + lastWeekCol) / 2);
    ws.mergeCells(`${colName(WEEK_FIRST)}${row}:${colName(half)}${row}`);
    ws.mergeCells(`${colName(half + 1)}${row}:${LAST}${row}`);
    const cells: Array<[string, string, boolean]> = [
      [`${FIRST}${row}`, l1, true], [`${colName(INFO_FIRST + 2)}${row}`, v1, false],
      [`${colName(WEEK_FIRST)}${row}`, l2, true], [`${colName(half + 1)}${row}`, v2, false],
    ];
    for (const [addr, val, isLabel] of cells) {
      const cell = ws.getCell(addr);
      cell.value = val;
      cell.font = { name: "Arial", bold: isLabel, size: 9 };
      cell.alignment = left;
      if (isLabel) cell.fill = metaLabelFill;
    }
    for (let c = INFO_FIRST; c <= lastWeekCol; c++) ws.getCell(`${colName(c)}${row}`).border = infoBorder;
    ws.getRow(row).height = 17;
    row++;
  };
  writeMetaPair("Project No.", projectNumber, "Location", projectLocation);
  writeMetaPair("Project", projectName, "Submission", submissionDate);
  writeMetaPair("Client", ctx.submittingTo, "Duration", `${totalDays} calendar days  (≈ ${Math.ceil(totalDays / 7)} week${Math.ceil(totalDays / 7) === 1 ? "" : "s"})`);
  // Cost + connected-load totals (only when resources carry rates / power).
  const totalCost = activities.reduce((m, a) => m + costOf(a), 0);
  let totalPower = 0;
  for (const r of resources) if (r.kind === "equipment" && r.powerKw) totalPower += Number(r.powerKw) * (r.capacity ?? 1);
  if (totalCost > 0 || totalPower > 0) {
    writeMetaPair("Total Cost", moneyFmt(totalCost) || "—", "Connected Load", totalPower > 0 ? `${totalPower.toLocaleString("en-US")} kW` : "—");
  }

  // ── Two-tier time axis: Month band (row 1) over Week numbers (row 2) ───────
  const monthRow = row;
  const weekRow = row + 1;
  // Info-column headers span both axis rows.
  const infoLabels = ["No.", "Activity", "SOW Ref", "Duration (days)", "Start", "Finish", "Predecessors"];
  infoLabels.forEach((label, i) => {
    const col = colName(INFO_FIRST + i);
    ws.mergeCells(`${col}${monthRow}:${col}${weekRow}`);
    const cell = ws.getCell(`${col}${monthRow}`);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = center;
    cell.fill = headerFill;
    cell.border = infoBorder;
  });
  // Month band — each spans the weeks of one calendar month (or a 4-week block).
  monthBands.forEach((band, m) => {
    const c0 = WEEK_FIRST + band.start;
    const c1 = c0 + band.count - 1;
    if (c1 > c0) ws.mergeCells(`${colName(c0)}${monthRow}:${colName(c1)}${monthRow}`);
    const cell = ws.getCell(`${colName(c0)}${monthRow}`);
    cell.value = band.count >= 2 ? band.label : band.label.replace(/\s+/g, " ");
    cell.font = { name: "Arial", bold: true, size: 8, color: { argb: TEAL_DARK } };
    cell.alignment = centerNoWrap;
    cell.fill = (m % 2 === 0) ? monthFillA : monthFillB;
    for (let c = c0; c <= c1; c++) ws.getCell(`${colName(c)}${monthRow}`).border = { top: thinDark, bottom: thinDark, left: c === c0 ? monthSep : thinGrid, right: thinGrid };
  });
  // Week numbers — every week column is labelled "W1, W2, …"; every column gets a
  // grid line so the bars align to the exact week.
  for (let w = 0; w < weeks; w++) {
    const c = WEEK_FIRST + w;
    const cell = ws.getCell(`${colName(c)}${weekRow}`);
    cell.value = `W${w + 1}`;
    cell.alignment = centerNoWrap;
    cell.fill = headerFill;
    cell.font = { name: "Arial", bold: true, size: 7, color: { argb: WHITE } };
    cell.border = { top: thinDark, bottom: thinDark, left: monthStartSet.has(w) ? monthSep : thinGrid, right: thinGrid };
  }
  ws.getRow(monthRow).height = 16;
  ws.getRow(weekRow).height = 14;
  row = weekRow + 1;

  // Faint timeline grid + month/week separators applied to every body row.
  const styleTimelineCell = (c: number, r: number) => {
    const w = c - WEEK_FIRST;
    ws.getCell(`${colName(c)}${r}`).border = { left: monthStartSet.has(w) ? monthSep : thinGrid, right: thinGrid, top: thinGrid, bottom: thinGrid };
  };

  // ── Phase groups + activity rows ───────────────────────────────────────────
  const sorted = activities.slice().sort((a, b) => (a.seq - b.seq) || (a.startOffsetDays - b.startOffsetDays));
  let lastPhase: string | null = null;
  let lineNo = 0;
  let zebra = false;
  for (const a of sorted) {
    const phase = a.phase || "General";
    if (phase !== lastPhase) {
      // Phase header: label across the info columns + a dark summary bar across
      // the phase's week span in the timeline.
      ws.mergeCells(`${FIRST}${row}:${INFO_LAST}${row}`);
      const pc = ws.getCell(`${FIRST}${row}`);
      const span = phaseSpan.get(phase);
      pc.value = span ? `${phase}   (Wk ${span.s + 1}–${span.f + 1})` : phase;
      pc.font = { name: "Arial", bold: true, size: 10, color: { argb: TEAL_DARK } };
      pc.alignment = left;
      pc.fill = phaseFill;
      ws.getCell(`${FIRST}${row}`).border = infoBorder;
      // Section summary bar carries the SECTION's own colour (matching the UI).
      const phaseSummaryFill = fill(phaseArgbOf(phase));
      for (let c = WEEK_FIRST; c <= lastWeekCol; c++) {
        styleTimelineCell(c, row);
        const w = c - WEEK_FIRST;
        if (span && w >= span.s && w <= span.f) ws.getCell(`${colName(c)}${row}`).fill = phaseSummaryFill;
      }
      ws.getRow(row).height = 18;
      row++;
      lastPhase = phase;
      zebra = false;
    }

    const isMs = a.isMilestone === 1;
    const dur = Math.max(isMs ? 0 : 1, a.durationDays ?? 0);
    const startD = startDayOf(a);    // 0-based start day index
    const finishD = finishDayOf(a);  // 0-based finish day index
    const startWk = startWeekOf(a);  // 0-based start week index
    const finishWk = finishWeekOf(a);// 0-based finish week index

    lineNo++;
    const rowZebra = zebra ? zebraFill : undefined;
    // Assignee(s) + progress + cost for this activity (P6-style), as a 2nd line.
    const pct = Math.min(100, Math.max(0, a.percentComplete ?? 0));
    const who = assigneeLabel(a);
    const costStr = moneyFmt(costOf(a));
    const lineParts: string[] = [];
    if (who) lineParts.push(`👤 ${who}`);
    if (pct) lineParts.push(`${pct}%`);
    if (costStr) lineParts.push(costStr);
    const assigneeLine = lineParts.join("  ·  ");
    const infoVals: Array<[number, string | number, "l" | "c"]> = [
      [INFO_FIRST, lineNo, "c"],
      [INFO_FIRST + 1, a.activity, "l"],
      [INFO_FIRST + 2, a.sowRef ?? "", "c"],
      [INFO_FIRST + 3, isMs ? "—" : dur, "c"],
      [INFO_FIRST + 4, fmtDay(startD), "c"],                       // Start (date or "Day n")
      [INFO_FIRST + 5, isMs ? fmtDay(startD) : fmtDay(finishD), "c"], // Finish
      [INFO_FIRST + 6, predText(a), "l"],                         // Predecessors (P6-style)
    ];
    for (const [c, val, align] of infoVals) {
      const cell = ws.getCell(`${colName(c)}${row}`);
      // Activity cell carries the assignee/progress as a small second line so the
      // export shows WHO is responsible and HOW far along, without a new column.
      if (c === INFO_FIRST + 1 && assigneeLine) {
        cell.value = { richText: [
          { text: String(val), font: { name: "Arial", size: 9 } },
          { text: `\n${assigneeLine}`, font: { name: "Arial", size: 8, italic: true, color: { argb: "FF5B6B73" } } },
        ] };
      } else {
        cell.value = val;
        cell.font = { name: "Arial", size: 9 };
      }
      cell.alignment = align === "l" ? left : center;
      cell.border = infoBorder;
      if (rowZebra) cell.fill = rowZebra;
    }
    // Timeline cells: faint grid everywhere, work bar / milestone where due. The
    // bar is split into a DONE portion (darker) and a remaining portion so the
    // percent-complete reads visually, the way a P6 progress bar does.
    const doneWeeks = isMs ? 0 : Math.round(((finishWk - startWk + 1) * pct) / 100);
    const barArgb = cpmOf(a)?.isCritical ? CRITICAL_ARGB : phaseArgbOf(phase);
    for (let c = WEEK_FIRST; c <= lastWeekCol; c++) {
      styleTimelineCell(c, row);
      const cell = ws.getCell(`${colName(c)}${row}`);
      if (rowZebra) cell.fill = rowZebra;
      const w = c - WEEK_FIRST;
      if (isMs) {
        if (w === Math.min(startWk, weeks - 1)) {
          cell.value = pct >= 100 ? "◆" : "◇";
          cell.font = { name: "Arial", bold: true, size: 9, color: { argb: CRITICAL_ARGB } };
          cell.alignment = center;
        }
      } else if (w >= startWk && w <= finishWk) {
        // Done portion uses the solid section/critical colour; the not-yet-done
        // remainder uses a lighter tint of the same colour.
        const isDone = w - startWk < doneWeeks;
        cell.fill = fill(isDone ? barArgb : lightenArgb(barArgb, 0.55));
      }
    }
    // Row height fits the wrapped Activity / SOW-Ref text so long descriptions no
    // longer overlap the next row. ≈1 char per width-unit; +12pt per extra line.
    const actLines = Math.ceil((a.activity || "").length / (ACTIVITY_W - 2));
    const sowLines = Math.ceil((a.sowRef || "").length / (SOWREF_W - 1));
    const lines = Math.min(5, Math.max(1, actLines, sowLines)) + (assigneeLine ? 1 : 0);
    ws.getRow(row).height = 15 + (lines - 1) * 12;
    row++;
    zebra = !zebra;
  }

  // ── Legend ─────────────────────────────────────────────────────────────────
  // Laid out entirely within the wide info columns (B–G) with NO wrapping, so a
  // narrow column can't break a label (the old "Milest one"). A coloured swatch
  // sits next to each label; the milestone uses its diamond glyph as the swatch.
  row++;
  const legendRow = row;
  const legendRow2 = row + 1;
  const swatchAt = (col: number, r: number, f: ReturnType<typeof fill>) => {
    const c = ws.getCell(`${colName(col)}${r}`);
    c.fill = f; c.border = infoBorder;
  };
  const lblAt = (col: number, r: number, text: string, argb?: string) => {
    const c = ws.getCell(`${colName(col)}${r}`);
    c.value = text;
    c.font = { name: "Arial", size: 9, bold: !!argb, color: argb ? { argb } : undefined };
    c.alignment = leftNoWrap;
  };
  // Row 1: the two fixed keys (critical path + milestone). Row 2: a note that
  // every other bar is tinted by its section — the section colours are shown
  // inline on each phase's summary bar, so no per-section swatch list is needed.
  swatchAt(INFO_FIRST, legendRow, criticalFill);  lblAt(INFO_FIRST + 1, legendRow, "Critical path");
  lblAt(INFO_FIRST + 4, legendRow, "◆ Milestone", CRITICAL_ARGB);
  ws.mergeCells(`${FIRST}${legendRow2}:${INFO_LAST}${legendRow2}`);
  lblAt(INFO_FIRST, legendRow2, "Activity bars are colour-coded by section / phase; activities on the critical path are highlighted in red.");
  ws.getRow(legendRow).height = 16;
  ws.getRow(legendRow2).height = 16;

  // ── Views: hide gridlines, freeze ONLY the header rows (rows 1..weekRow). ───
  // A column freeze (xSplit) is deliberately NOT used: the full-width merged
  // header cells (logo band, title, meta, legend) would otherwise be rendered in
  // BOTH the frozen and scrolling panes — the duplicated title / doubled columns
  // / repeated logo seen earlier. Row-only freeze keeps the letterhead + time
  // axis pinned while scrolling the activity list, with no duplication.
  ws.views = [{ state: "frozen", ySplit: weekRow, showGridLines: false }];

  // Print setup
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.paperSize = 9; // A4
  ws.pageSetup.horizontalCentered = true;
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  ws.pageSetup.printTitlesRow = `${monthRow}:${weekRow}`;
  // Exclude the wide empty margin column A from the print area so the printed /
  // PDF output centres the TABLE itself (fills the page width) rather than baking
  // in a left-only gap. The on-screen view still shows the margin indent.
  ws.pageSetup.printArea = `${FIRST}1:${LAST}${legendRow2}`;
  ws.headerFooter.oddHeader = `&L&"Arial,Bold"&10Ref No: ${quotationRef}`;
}
