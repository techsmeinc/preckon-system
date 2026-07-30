/**
 * Build a formatted, downloadable Word (.docx) of the final Technical Narrative.
 *
 * This is a PURE FORMATTING step — it stitches the already-generated section
 * drafts into a styled document. It makes ZERO model calls, so producing the
 * Word document costs no tokens and works identically with any (free) provider.
 *
 * Light markdown handling is applied to each section body so the LLM's prose
 * (paragraphs, **bold**, bullet "- " / "• " lines, "1." numbered lines, and
 * leading "#" headings) renders cleanly in Word.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

export interface NarrativeSection {
  title: string;
  content: string;
}

export interface NarrativeDocMeta {
  projectName: string;
  client?: string | null;
  location?: string | null;
  quotationRef?: string | null;
  submissionDate?: string | null;
  /** Free-text company name for the footer/cover; optional. */
  companyName?: string | null;
}

const ACCENT = "1F6E7E"; // dark teal, matches the AIGCC BOQ export house colour.
const INK = "1A1A1A";
const MUTED = "555555";

/** Is this line part of a markdown table (starts with an unescaped pipe)? */
function isTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

/** A markdown table separator row, e.g. "| --- | :--: |". */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

/** Split a markdown table row "| a | b |" into trimmed cell strings. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(c => c.trim());
}

/** Build a bordered Word table from contiguous markdown table lines. */
function markdownTable(lines: string[]): Table {
  const hasHeader = lines.length > 1 && isTableSeparator(lines[1]);
  const headerCells = splitTableRow(lines[0]);
  const bodyLines = lines.filter((l, i) => i !== 0 && !isTableSeparator(l));

  const border = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const rows: TableRow[] = [];
  if (hasHeader) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: headerCells.map(
          text =>
            new TableCell({
              shading: { fill: "EFF4F5" },
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              borders: cellBorders,
              children: [new Paragraph({ children: inlineRuns(text, { bold: true, color: ACCENT }) })],
            }),
        ),
      }),
    );
  }
  for (const line of bodyLines) {
    const cells = splitTableRow(line);
    // Pad/truncate to the header width so docx renders a clean grid.
    const width = headerCells.length || cells.length;
    const norm = Array.from({ length: width }, (_, i) => cells[i] ?? "");
    rows.push(
      new TableRow({
        children: norm.map(
          text =>
            new TableCell({
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              borders: cellBorders,
              children: [new Paragraph({ children: inlineRuns(text) })],
            }),
        ),
      }),
    );
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

/** Split a run of body text into Word paragraphs/tables with markdown support. */
function bodyToParagraphs(content: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line.trim() === "") continue; // collapse blank lines into paragraph spacing

    // Horizontal rule (---, ***, ___) → skip; it's just a visual divider.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue;

    // Markdown table: gather contiguous table lines and render as a Word table.
    if (isTableLine(line)) {
      const block: string[] = [];
      while (i < lines.length && isTableLine(lines[i].trimEnd())) {
        block.push(lines[i].trimEnd());
        i++;
      }
      i--; // step back; the for-loop will advance past the table
      if (block.length) {
        out.push(markdownTable(block));
        out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      }
      continue;
    }

    // Leading markdown heading (#..######) → sized bold sub-heading.
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 1 ? 26 : level === 2 ? 24 : 22;
      out.push(
        new Paragraph({
          spacing: { before: level <= 2 ? 200 : 160, after: 80 },
          keepNext: true,
          children: inlineRuns(heading[2], { bold: true, color: ACCENT, size }),
        }),
      );
      continue;
    }

    // Bullet line: "- ", "* ", "• " (with optional indentation for nesting).
    const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (bullet) {
      const level = Math.min(2, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2));
      out.push(
        new Paragraph({
          bullet: { level },
          spacing: { after: 60 },
          children: inlineRuns(bullet[2]),
        }),
      );
      continue;
    }

    // Numbered line: "1. ", "2) " — render as a plain paragraph keeping the
    // number (avoids needing a configured numbering instance).
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
        children: inlineRuns(line),
      }),
    );
  }

  if (out.length === 0) {
    out.push(new Paragraph({ children: [new TextRun({ text: "—", color: MUTED })] }));
  }
  return out;
}

/** Parse inline markdown (**bold**, *italic*, `code`) within a line into TextRuns. */
function inlineRuns(
  text: string,
  base?: { bold?: boolean; italics?: boolean; color?: string; size?: number },
): TextRun[] {
  const runs: TextRun[] = [];
  const color = base?.color ?? INK;
  // Tokenise on bold / italic / inline-code markers, keeping the delimiters so
  // we can classify each span. Order matters: ** before * so bold wins.
  const parts = text
    .split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g)
    .filter(s => s !== "");
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^(?:\*\*|__)([\s\S]+)(?:\*\*|__)$/))) {
      runs.push(new TextRun({ text: m[1], bold: true, italics: base?.italics, color, size: base?.size }));
    } else if ((m = part.match(/^(?:\*|_)([\s\S]+)(?:\*|_)$/))) {
      runs.push(new TextRun({ text: m[1], italics: true, bold: base?.bold, color, size: base?.size }));
    } else if ((m = part.match(/^`([\s\S]+)`$/))) {
      runs.push(new TextRun({ text: m[1], font: "Consolas", color: MUTED, size: base?.size }));
    } else {
      runs.push(
        new TextRun({ text: part, bold: base?.bold ?? false, italics: base?.italics ?? false, color, size: base?.size }),
      );
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: "", color })];
}

/** A 2-column borderless meta row (label / value). */
function metaRow(label: string, value: string): TableRow {
  const cell = (children: TextRun[], width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: "DDDDDD" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      children: [new Paragraph({ children })],
    });
  return new TableRow({
    children: [
      cell([new TextRun({ text: label, bold: true, color: MUTED, size: 20 })], 28),
      cell([new TextRun({ text: value, color: INK, size: 20 })], 72),
    ],
  });
}

export async function buildNarrativeDocx(
  sections: NarrativeSection[],
  meta: NarrativeDocMeta,
): Promise<Buffer> {
  const metaRows: TableRow[] = [];
  if (meta.client) metaRows.push(metaRow("Client", meta.client));
  if (meta.location) metaRows.push(metaRow("Location", meta.location));
  if (meta.quotationRef) metaRows.push(metaRow("Reference", meta.quotationRef));
  if (meta.submissionDate) metaRows.push(metaRow("Submission Date", meta.submissionDate));

  const children: (Paragraph | Table)[] = [];

  // ── Title block ──────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 40 },
      children: [
        new TextRun({ text: "TECHNICAL PROPOSAL", bold: true, color: ACCENT, size: 40 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: "Technical Narrative", color: MUTED, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: meta.projectName, bold: true, color: INK, size: 28 })],
    }),
  );

  if (metaRows.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: metaRows,
      }),
      new Paragraph({ spacing: { after: 200 }, children: [] }),
    );
  }

  // ── Sections ─────────────────────────────────────────────────────────
  let n = 0;
  for (const sec of sections) {
    if (!sec.content || !sec.content.trim()) continue;
    n++;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        keepNext: true,
        children: [
          new TextRun({ text: `${n}.  ${sec.title}`, bold: true, color: ACCENT, size: 28 }),
        ],
      }),
      ...bodyToParagraphs(sec.content),
    );
  }

  if (n === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No narrative sections have been drafted yet.",
            italics: true,
            color: MUTED,
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    creator: meta.companyName ?? "TenderLogix",
    title: `Technical Narrative — ${meta.projectName}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
