import fs from "node:fs/promises";
import path from "node:path";
import type ExcelJS from "exceljs";

// Shared letterhead for the exported workbooks.
//
// Read from public/ at runtime rather than base64-inlined: the standalone Next
// build copies public/ into the image, the file is 20 KB, and inlining it would
// put a base64 blob in a source file that nobody can review in a diff. If it is
// ever missing the export still produces a workbook — a logo is presentation,
// and losing it must not cost an estimator their bill of quantities.

const LOGO = path.join(process.cwd(), "public", "brand", "techsme-logo.png");

export const INK = "FF1F3864";       // programme header fill
export const GREY = "FFD9D9D9";      // programme section band
export const CRIT = "FFC00000";      // critical path / milestones
// Submission palette, taken from the reference priced BOQ.
export const BOQ_HEAD = "FF31708E";  // column headings — dark slate teal
export const BOQ_BAND = "FFDCE6F1";  // section / sub-section bands — pale blue
export const BOQ_TBP  = "FFFDE9D9";  // "To be priced" cells — pale peach
export const BOQ_TITLE = "FF1F4E79"; // "BILL OF QUANTITIES" — blue
export const RULE = { style: "thin" as const, color: { argb: "FF9E9E9E" } };
export const BOX = { top: RULE, left: RULE, bottom: RULE, right: RULE };

/** Place the letterhead in the top-left. Returns false when the asset is absent. */
export async function addLetterhead(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  opts: { centreCol?: number; topRow?: number; width?: number; height?: number } = {}
): Promise<boolean> {
  try {
    const buffer = await fs.readFile(LOGO);
    const id = wb.addImage({ buffer: buffer as any, extension: "png" });
    // Anchored across the first rows the header block leaves free, so the sheet
    // opens looking like a letterhead rather than a data dump.
    // Centred in the letterhead box rather than tucked in a corner: the
    // reference submission leads with the mark, and a tender document is judged
    // on presentation before anyone reads a quantity.
    ws.addImage(id, {
      tl: { col: opts.centreCol ?? 0.3, row: (opts.topRow ?? 1) + 0.25 },
      ext: { width: opts.width ?? 300, height: opts.height ?? 52 },
      editAs: "oneCell",
    });
    return true;
  } catch {
    return false;
  }
}

/** "05 Jul 26" — the format the reference programme uses. */
export const shortDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en", { month: "short" })} ${String(d.getFullYear()).slice(2)}`;

/** Long form for the header block: "24 June 2026". */
export const longDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en", { month: "long" })} ${d.getFullYear()}`;
