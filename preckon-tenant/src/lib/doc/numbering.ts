/**
 * Document numbering — the identity every controlled document hangs off.
 *
 * A construction project's document number is not a label, it is a coordinate.
 * `DXB01-ABC-ZZ-04-DR-M-0103` says which project, who authored it, which volume,
 * which level, what kind of document, which discipline, and which sheet — and
 * every one of those is used to file, route, search and transmit the thing. Get
 * the number wrong and the document is effectively lost, because nobody finds a
 * drawing by its filename.
 *
 * ── THE SCHEME IS DATA ───────────────────────────────────────────────────────
 *
 * Every client has their own convention and a project frequently runs two at
 * once (the employer's for issued documents, the contractor's for internal). So
 * a scheme is a stored record, never code. The same reasoning as the authored
 * tools: a convention expressed as data can be added by an administrator on a
 * live project; a convention expressed as code needs a deploy.
 *
 * ── WHY OPTIONAL SEGMENTS KEEP THEIR PLACE ───────────────────────────────────
 *
 * The obvious design lets an optional segment be omitted, so a document with no
 * level reads `DXB01-ABC-ZZ-DR-M-0103`. That number cannot be parsed back: with
 * a variable number of parts there is no way to tell which segment is missing,
 * and `parse(format(x)) === x` stops holding. Worse, two different documents can
 * format to the same string.
 *
 * So an absent segment emits a placeholder and the separator count stays fixed.
 * This is not a workaround — it is what the industry already does. BS 1192 and
 * ISO 19650 use `ZZ` for "no level" and `XX` for "multiple", precisely so the
 * position survives. The default absent value is `ZZ` for that reason.
 */

/** How one position in a number is filled. */
export type SegmentKind =
  /** A constant — the project code, usually. */
  | "fixed"
  /** One of a closed list (disciplines, document types). */
  | "enum"
  /** Free text matching a pattern (originator codes vary per project). */
  | "free"
  /** The auto-incrementing part. Exactly one per scheme. */
  | "sequence";

export interface Segment {
  key: string;
  label: string;
  kind: SegmentKind;
  /** For `fixed`. */
  value?: string;
  /** For `enum`. */
  values?: string[];
  /** For `free` — anchored when applied. */
  pattern?: string;
  /** For `sequence` — zero-padded width. */
  width?: number;
  /** May be absent; emits `absent` rather than collapsing the position. */
  optional?: boolean;
  /** Placeholder for an absent optional segment. */
  absent?: string;
}

export interface NumberingScheme {
  key: string;
  name: string;
  separator: string;
  segments: Segment[];
  /**
   * Sequence values never to allocate — blocks an employer has reserved, or a
   * legacy range already used on paper. Inclusive on both ends.
   */
  reserved?: { from: number; to: number }[];
}

export interface Issue {
  segment: string;
  message: string;
}

/** Placeholder for an absent optional segment, per BS 1192 / ISO 19650. */
export const DEFAULT_ABSENT = "ZZ";

const absentOf = (s: Segment) => s.absent ?? DEFAULT_ABSENT;

/**
 * Structural problems with the scheme itself, checked before it is ever used.
 *
 * A scheme is authored by a person and stored; validating at save time is the
 * only point where the mistake is cheap. Once documents carry numbers built
 * from a broken scheme, fixing it means renumbering a live project.
 */
export function validateScheme(scheme: NumberingScheme): Issue[] {
  const issues: Issue[] = [];

  if (!scheme.separator) {
    issues.push({ segment: "-", message: "A separator is required." });
  }
  if (!scheme.segments.length) {
    issues.push({ segment: "-", message: "A scheme needs at least one segment." });
  }

  const seen = new Set<string>();
  for (const s of scheme.segments) {
    if (seen.has(s.key)) {
      issues.push({ segment: s.key, message: `Duplicate segment key "${s.key}".` });
    }
    seen.add(s.key);

    if (s.kind === "fixed" && !s.value) {
      issues.push({ segment: s.key, message: "A fixed segment needs a value." });
    }
    if (s.kind === "enum" && !s.values?.length) {
      issues.push({ segment: s.key, message: "An enum segment needs at least one allowed value." });
    }
    if (s.kind === "sequence" && s.optional) {
      issues.push({ segment: s.key, message: "The sequence cannot be optional — it is what makes the number unique." });
    }

    // A value containing the separator would split into two parts on the way
    // back in, so the number could never be parsed. Cheaper to refuse here.
    if (scheme.separator) {
      const literals = [
        ...(s.kind === "fixed" && s.value ? [s.value] : []),
        ...(s.values ?? []),
        ...(s.optional ? [absentOf(s)] : []),
      ];
      for (const lit of literals) {
        if (lit.includes(scheme.separator)) {
          issues.push({
            segment: s.key,
            message: `"${lit}" contains the separator "${scheme.separator}", so the number could not be parsed back.`,
          });
        }
      }
    }

    if (s.kind === "free" && s.pattern) {
      try {
        new RegExp(s.pattern);
      } catch {
        issues.push({ segment: s.key, message: "Pattern is not a valid regular expression." });
      }
    }
  }

  const sequences = scheme.segments.filter((s) => s.kind === "sequence");
  if (sequences.length !== 1) {
    issues.push({
      segment: "-",
      message: `A scheme needs exactly one sequence segment; this has ${sequences.length}.`,
    });
  }

  for (const r of scheme.reserved ?? []) {
    if (r.from > r.to) {
      issues.push({ segment: "-", message: `Reserved range ${r.from}-${r.to} runs backwards.` });
    }
  }

  return issues;
}

/** The one auto-incrementing segment. */
export function sequenceSegment(scheme: NumberingScheme): Segment | undefined {
  return scheme.segments.find((s) => s.kind === "sequence");
}

/**
 * Problems with a proposed set of values, against the scheme.
 *
 * Returned as a list rather than throwing on the first: a person filling in a
 * registration form should see everything wrong at once, not play whack-a-mole.
 */
export function validateValues(scheme: NumberingScheme, values: Record<string, string>): Issue[] {
  const issues: Issue[] = [];

  for (const s of scheme.segments) {
    const raw = values[s.key];
    const given = raw !== undefined && raw !== null && String(raw).trim() !== "";

    if (!given) {
      if (s.kind === "fixed") continue;           // supplied by the scheme
      if (s.optional) continue;                    // becomes the placeholder
      issues.push({ segment: s.key, message: `${s.label} is required.` });
      continue;
    }

    const v = String(raw).trim();

    if (scheme.separator && v.includes(scheme.separator)) {
      issues.push({ segment: s.key, message: `${s.label} cannot contain "${scheme.separator}".` });
      continue;
    }

    if (s.kind === "enum" && !(s.values ?? []).includes(v)) {
      issues.push({
        segment: s.key,
        message: `"${v}" is not one of the allowed values for ${s.label}.`,
      });
    }

    if (s.kind === "free" && s.pattern) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(`^(?:${s.pattern})$`);
      } catch {
        re = null;
      }
      if (re && !re.test(v)) {
        issues.push({ segment: s.key, message: `${s.label} does not match the required format.` });
      }
    }

    if (s.kind === "sequence") {
      if (!/^\d+$/.test(v)) {
        issues.push({ segment: s.key, message: `${s.label} must be a number.` });
      } else if (isReserved(scheme, Number(v))) {
        issues.push({ segment: s.key, message: `${v} falls in a reserved range.` });
      }
    }
  }

  return issues;
}

/** Whether a sequence number falls inside a reserved block. */
export function isReserved(scheme: NumberingScheme, n: number): boolean {
  return (scheme.reserved ?? []).some((r) => n >= r.from && n <= r.to);
}

/**
 * The next free sequence number, skipping reserved blocks and anything taken.
 *
 * `taken` is passed in rather than queried so this stays pure and the caller
 * decides the isolation it needs — the register takes a lock, an import does
 * not.
 */
export function nextSequence(scheme: NumberingScheme, taken: Iterable<number>, start = 1): number {
  const used = new Set(taken);
  let n = Math.max(1, Math.floor(start));
  // Bounded so a scheme whose reserved ranges swallow everything fails loudly
  // rather than spinning.
  const ceiling = n + 1_000_000;
  while (n < ceiling) {
    if (!used.has(n) && !isReserved(scheme, n)) return n;
    n++;
  }
  throw new Error("No free sequence number available in this scheme.");
}

/** Render one segment's stored value into its printed form. */
function renderSegment(s: Segment, values: Record<string, string>): string {
  if (s.kind === "fixed") return s.value ?? "";

  const raw = values[s.key];
  const given = raw !== undefined && raw !== null && String(raw).trim() !== "";
  if (!given) return s.optional ? absentOf(s) : "";

  const v = String(raw).trim();
  if (s.kind === "sequence") {
    const width = s.width ?? 0;
    return width > 0 ? v.padStart(width, "0") : v;
  }
  return v;
}

/**
 * Build the document number.
 *
 * Throws on invalid input rather than returning a broken number, because a
 * malformed document number that reaches the register is far more expensive
 * than a rejected form submission.
 */
export function formatNumber(scheme: NumberingScheme, values: Record<string, string>): string {
  const issues = validateValues(scheme, values);
  if (issues.length) {
    throw new Error(`Cannot build a document number: ${issues.map((i) => i.message).join(" ")}`);
  }
  return scheme.segments.map((s) => renderSegment(s, values)).join(scheme.separator);
}

export interface ParseResult {
  ok: boolean;
  values: Record<string, string>;
  issues: Issue[];
}

/**
 * Read an existing number back into its parts.
 *
 * Needed for two things the documents both require: validating a number typed
 * by hand, and migrating a legacy register where the numbers already exist and
 * the parts have to be recovered from the string.
 *
 * Absent optional segments come back absent rather than as their placeholder,
 * so `parse(format(x))` round-trips to the input the caller gave.
 */
export function parseNumber(scheme: NumberingScheme, text: string): ParseResult {
  const issues: Issue[] = [];
  const values: Record<string, string> = {};
  const parts = String(text ?? "").trim().split(scheme.separator);

  if (parts.length !== scheme.segments.length) {
    return {
      ok: false,
      values: {},
      issues: [{
        segment: "-",
        message: `Expected ${scheme.segments.length} parts separated by "${scheme.separator}", found ${parts.length}.`,
      }],
    };
  }

  scheme.segments.forEach((s, i) => {
    const part = parts[i];

    if (s.kind === "fixed") {
      if (part !== s.value) {
        issues.push({ segment: s.key, message: `Expected "${s.value}" but found "${part}".` });
      }
      return;
    }

    if (s.optional && part === absentOf(s)) return;   // legitimately absent

    if (part === "") {
      issues.push({ segment: s.key, message: `${s.label} is empty.` });
      return;
    }

    if (s.kind === "enum" && !(s.values ?? []).includes(part)) {
      issues.push({ segment: s.key, message: `"${part}" is not an allowed value for ${s.label}.` });
      return;
    }

    if (s.kind === "sequence") {
      if (!/^\d+$/.test(part)) {
        issues.push({ segment: s.key, message: `${s.label} must be numeric, found "${part}".` });
        return;
      }
      // Strip the padding so the parsed value is the number, not its rendering.
      values[s.key] = String(Number(part));
      return;
    }

    if (s.kind === "free" && s.pattern) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(`^(?:${s.pattern})$`);
      } catch {
        re = null;
      }
      if (re && !re.test(part)) {
        issues.push({ segment: s.key, message: `${s.label} does not match the required format.` });
        return;
      }
    }

    values[s.key] = part;
  });

  return { ok: issues.length === 0, values, issues };
}

/** A worked example of the scheme, for the administrator editing it. */
export function exampleNumber(scheme: NumberingScheme): string {
  const values: Record<string, string> = {};
  for (const s of scheme.segments) {
    if (s.kind === "enum") values[s.key] = s.values?.[0] ?? "";
    else if (s.kind === "sequence") values[s.key] = "1";
    else if (s.kind === "free") values[s.key] = s.optional ? "" : "ABC";
  }
  try {
    return formatNumber(scheme, values);
  } catch {
    return "";
  }
}

/**
 * ISO 19650 / BS 1192 style scheme, as a starting point.
 *
 * Seeded rather than hard-coded: a project can edit or replace it, and most GCC
 * employers issue something close to this.
 */
export const ISO19650_SCHEME: NumberingScheme = {
  key: "iso19650",
  name: "ISO 19650 (project-originator-volume-level-type-role-number)",
  separator: "-",
  segments: [
    { key: "project", label: "Project", kind: "free", pattern: "[A-Z0-9]{2,10}" },
    { key: "originator", label: "Originator", kind: "free", pattern: "[A-Z0-9]{2,6}" },
    { key: "volume", label: "Volume / System", kind: "free", pattern: "[A-Z0-9]{1,3}", optional: true },
    { key: "level", label: "Level", kind: "free", pattern: "[A-Z0-9]{1,3}", optional: true },
    {
      key: "type", label: "Type", kind: "enum",
      values: ["DR", "MD", "SP", "SH", "CA", "RP", "SC", "CO", "PP"],
    },
    {
      key: "role", label: "Discipline / Role", kind: "enum",
      values: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M", "P", "Q", "S", "T", "W", "X", "Y", "Z"],
    },
    { key: "number", label: "Number", kind: "sequence", width: 4 },
  ],
};
