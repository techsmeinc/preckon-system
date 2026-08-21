// Where did this quantity come from?
//
// The question an estimator asks about every number in a bill, and the one a
// generated bill has to be able to answer or it does not get used. "The AI said
// 847 m²" is not an answer. "847 m² is these six measurements off sheets A-201
// and A-202, and here they are highlighted" is.
//
// ── THIS IS A CHECK, NOT A TOUR ──────────────────────────────────────────────
//
// The obvious version of this feature just links a bill line to its sources and
// lights them up. That is a navigation aid, and it is worth something. But the
// valuable part is arithmetic: DO the cited measurements actually add up to the
// stated quantity?
//
// They often will not, for reasons worth knowing:
//
//   The agent cited measurements it did not use, or used ones it did not cite.
//   A unit conversion went missing (a length measured in mm, billed in m).
//   Waste or laps were added to the bill and not recorded anywhere.
//   The line is a genuine composite and the difference is a deliberate
//   adjustment nobody wrote down.
//
// Every one of those is something an estimator wants to see before signing. So
// the traceback reconciles, states the difference, and offers the most likely
// explanation rather than presenting a chain of links and implying agreement.
//
// The unreconciled case is not an error. It is the finding.

/** A measurement artifact, as the traceback needs it. */
export interface MeasurementSource {
  artifactId: string;
  sheetNo: string;
  item: string;
  quantity: number;
  unit: string;
  location?: string | null;
  method?: string | null;
  /** Drawing layers the figure was read from, where recorded. */
  sourceLayers?: string[];
  /** Page in the source file, for opening the right sheet. */
  fileId?: string | null;
  pageNo?: number | null;
}

export interface BoqQuantity {
  artifactId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  /** Artifact ids this line claims to derive from. */
  provenance: string[];
  /** CAD elements confirmed to exist, where the citation audit ran. */
  measuredFrom?: string | null;
  /** Set where the citation audit could not match a cited layer or block. */
  unverifiedCitation?: string | null;
}

/** One thing to light up on a drawing. */
export interface HighlightTarget {
  sheetNo: string;
  fileId: string | null;
  pageNo: number | null;
  layers: string[];
  /** The measurements on this sheet that fed the line. */
  measurements: { artifactId: string; item: string; quantity: number; unit: string; location?: string | null }[];
  /** This sheet's contribution to the billed quantity. */
  subtotal: number;
}

export type Reconciliation =
  | "exact"
  /** Within rounding. */
  | "rounded"
  /** Sources sum to less than the bill — something was added. */
  | "bill_exceeds_sources"
  /** Sources sum to more than the bill — something was excluded. */
  | "sources_exceed_bill"
  /** Sources are in a different unit and cannot be compared. */
  | "unit_mismatch"
  /** Nothing traceable at all. */
  | "no_sources";

export interface Traceback {
  code: string;
  description: string;
  billedQuantity: number;
  unit: string;
  /** Sum of the sources that share the bill's unit. */
  sourceQuantity: number;
  differenceQuantity: number;
  differencePct: number;
  reconciliation: Reconciliation;
  targets: HighlightTarget[];
  /** Sources whose unit differs from the bill's — never silently converted. */
  unitMismatches: MeasurementSource[];
  /** Provenance ids that resolved to nothing. */
  danglingSources: string[];
  /** True where an estimator should look before signing. */
  needsReview: boolean;
  explanation: string;
}

/** Tolerance below which a difference is rounding rather than a discrepancy. */
const ROUNDING_PCT = 0.005;

/** Units that are the same measure written differently. */
const SYNONYM: Record<string, string> = { lm: "m", m1: "m", sqm: "m2", cum: "m3", no: "nr", num: "nr" };
const canonUnit = (u: string) => {
  const k = String(u ?? "").trim().toLowerCase();
  return SYNONYM[k] ?? k;
};

/**
 * Trace a billed quantity back to what it was measured from.
 *
 * Units are compared, never converted. A measurement in mm against a bill in m
 * is a thousand-fold error waiting to happen, and quietly dividing by 1000
 * would fix the arithmetic while hiding the mistake that produced it — the
 * mismatch is reported so somebody decides what it means.
 */
export function trace(line: BoqQuantity, sources: MeasurementSource[]): Traceback {
  const byId = new Map(sources.map((s) => [s.artifactId, s] as const));
  const cited = line.provenance ?? [];

  const resolved: MeasurementSource[] = [];
  const danglingSources: string[] = [];
  for (const id of cited) {
    const s = byId.get(id);
    if (s) resolved.push(s); else danglingSources.push(id);
  }

  const billUnit = canonUnit(line.unit);
  const matching = resolved.filter((s) => canonUnit(s.unit) === billUnit);
  const unitMismatches = resolved.filter((s) => canonUnit(s.unit) !== billUnit);

  const sourceQuantity = round(matching.reduce((t, s) => t + (Number(s.quantity) || 0), 0));
  const billed = Number(line.quantity) || 0;
  const difference = round(billed - sourceQuantity);
  const differencePct = sourceQuantity ? round((difference / sourceQuantity) * 100) : (billed ? 100 : 0);

  // Group into what the drawing view can actually light up: one target per
  // sheet, carrying every layer and measurement that fed the line.
  const sheets = [...new Set(matching.map((s) => s.sheetNo))].sort();
  const targets: HighlightTarget[] = sheets.map((sheetNo) => {
    const mine = matching.filter((s) => s.sheetNo === sheetNo);
    return {
      sheetNo,
      fileId: mine.find((m) => m.fileId)?.fileId ?? null,
      pageNo: mine.find((m) => m.pageNo != null)?.pageNo ?? null,
      layers: [...new Set(mine.flatMap((m) => m.sourceLayers ?? []))].sort(),
      measurements: mine.map((m) => ({
        artifactId: m.artifactId, item: m.item, quantity: m.quantity, unit: m.unit, location: m.location,
      })),
      subtotal: round(mine.reduce((t, m) => t + (Number(m.quantity) || 0), 0)),
    };
  });

  const reconciliation = reconcile(matching.length, unitMismatches.length, billed, sourceQuantity, difference);
  const needsReview =
    reconciliation !== "exact" && reconciliation !== "rounded"
    || danglingSources.length > 0
    || !!line.unverifiedCitation;

  return {
    code: line.code,
    description: line.description,
    billedQuantity: billed,
    unit: line.unit,
    sourceQuantity,
    differenceQuantity: difference,
    differencePct,
    reconciliation,
    targets,
    unitMismatches,
    danglingSources,
    needsReview,
    explanation: explain(line, reconciliation, billed, sourceQuantity, difference, differencePct,
      targets.length, unitMismatches, danglingSources),
  };
}

function reconcile(
  matchCount: number, mismatchCount: number, billed: number, sourceQty: number, difference: number,
): Reconciliation {
  if (!matchCount) return mismatchCount ? "unit_mismatch" : "no_sources";
  if (difference === 0) return "exact";
  const relative = sourceQty ? Math.abs(difference / sourceQty) : 1;
  if (relative <= ROUNDING_PCT) return "rounded";
  return difference > 0 ? "bill_exceeds_sources" : "sources_exceed_bill";
}

/**
 * Say what the difference probably is.
 *
 * Offered as a likely cause, never as a conclusion. A traceback that announced
 * "this is a 5% waste allowance" would be guessing with authority, and the
 * estimator reading it is far better placed to know.
 */
function explain(
  line: BoqQuantity, r: Reconciliation, billed: number, sourceQty: number,
  difference: number, differencePct: number, sheetCount: number,
  mismatches: MeasurementSource[], dangling: string[],
): string {
  const parts: string[] = [];

  switch (r) {
    case "exact":
      parts.push(`${billed} ${line.unit} traced exactly to ${sheetCount} sheet(s).`);
      break;
    case "rounded":
      parts.push(`${billed} ${line.unit} against ${sourceQty} measured — a rounding difference of ${Math.abs(difference)}.`);
      break;
    case "bill_exceeds_sources": {
      parts.push(`The bill shows ${billed} ${line.unit} but the cited measurements total ${sourceQty} — ${Math.abs(difference)} more than was measured (${Math.abs(differencePct)}%).`);
      // Common allowances land near recognisable percentages. Naming the
      // possibility helps; asserting it would not.
      const p = Math.abs(differencePct);
      if (p >= 2.5 && p <= 15) {
        parts.push("A difference of this size is often a waste, lap or cutting allowance added at billing. If that is what it is, it belongs in the measurement or the rate rather than appearing here unexplained.");
      } else {
        parts.push("Check whether a measurement was used but not cited, or whether the quantity was adjusted after measurement.");
      }
      break;
    }
    case "sources_exceed_bill":
      parts.push(`The cited measurements total ${sourceQty} ${line.unit} but only ${billed} is billed — ${Math.abs(difference)} measured and not billed (${Math.abs(differencePct)}%).`);
      parts.push("Either some of the cited measurements belong to a different bill line, or part of the measured work has been left out of the bill.");
      break;
    case "unit_mismatch":
      parts.push(`Every cited measurement is in a different unit from the bill (${mismatches.map((m) => m.unit).join(", ")} against ${line.unit}). Nothing was converted — a unit difference is usually an error, and converting it would hide the error while fixing the sum.`);
      break;
    case "no_sources":
      parts.push(`This quantity cites no measurement that could be found. There is nothing behind the number.`);
      break;
  }

  if (mismatches.length && r !== "unit_mismatch") {
    parts.push(`${mismatches.length} cited measurement(s) are in another unit (${[...new Set(mismatches.map((m) => m.unit))].join(", ")}) and were excluded from the total rather than converted.`);
  }
  if (dangling.length) {
    parts.push(`${dangling.length} cited source(s) could not be found at all.`);
  }
  if (line.unverifiedCitation) {
    parts.push(`The citation audit could not match this line to a parsed drawing: ${line.unverifiedCitation}`);
  }
  return parts.join(" ");
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Trace a whole bill, worst first.
 *
 * The screen an estimator actually wants before signing: not "here is the
 * bill", but "here are the eleven lines whose numbers do not tie back".
 */
export function traceAll(
  lines: BoqQuantity[], sources: MeasurementSource[],
): { traces: Traceback[]; needingReview: Traceback[]; summary: string } {
  const traces = lines.map((l) => trace(l, sources));
  const needingReview = traces
    .filter((t) => t.needsReview)
    .sort((a, b) => Math.abs(b.differencePct) - Math.abs(a.differencePct));

  const untraceable = traces.filter((t) => t.reconciliation === "no_sources").length;
  const summary = !traces.length
    ? "No bill lines to trace."
    : needingReview.length === 0
      ? `All ${traces.length} line(s) tie back to their measurements.`
      : `${needingReview.length} of ${traces.length} line(s) do not tie back to their measurements${untraceable ? `, including ${untraceable} with no traceable source at all` : ""}.`;

  return { traces, needingReview, summary };
}
