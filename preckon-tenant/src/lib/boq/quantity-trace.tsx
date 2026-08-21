"use client";
// Click a quantity, see where it came from — and whether it adds up.
//
// The interaction estimators ask for first and trust the bill by. A generated
// number nobody can open is a number nobody signs.
//
// What makes this worth building rather than a link: it RECONCILES. Opening a
// quantity shows the measurements behind it AND whether they total the billed
// figure. Where they do not, that is the finding, and it is stated before the
// list rather than left for someone to add up by eye.

import { useMemo, useState } from "react";
import { trace, type BoqQuantity, type MeasurementSource, type Traceback } from "./traceback";

/** Artifact rows → the shape the traceback reads. */
export function measurementsFrom(artifacts: any[]): MeasurementSource[] {
  return (artifacts ?? [])
    .filter((a) => a?.type === "drawing_measurement")
    .map((a) => ({
      artifactId: a.id,
      sheetNo: String(a.payload?.sheet_no ?? "—"),
      item: String(a.payload?.item ?? ""),
      quantity: Number(a.payload?.quantity ?? 0),
      unit: String(a.payload?.unit ?? ""),
      location: a.payload?.location ?? null,
      method: a.payload?.method ?? null,
      sourceLayers: Array.isArray(a.payload?.source_layers) ? a.payload.source_layers : [],
      fileId: a.payload?.file_id ?? null,
      pageNo: a.payload?.page_no ?? null,
    }));
}

export function billLineFrom(row: any): BoqQuantity {
  return {
    artifactId: row.id,
    code: String(row.payload?.code ?? ""),
    description: String(row.payload?.description ?? ""),
    quantity: Number(row.payload?.quantity ?? 0),
    unit: String(row.payload?.unit ?? ""),
    // The chain the ABI recorded, not anything the model asserted afterwards.
    provenance: Array.isArray(row.provenance) ? row.provenance : [],
    measuredFrom: row.payload?.measured_from ?? null,
    unverifiedCitation: row.payload?.review_required ? (row.payload?.review_reason ?? "Citation could not be matched.") : null,
  };
}

/** Colour and wording for each reconciliation outcome. */
const VERDICT: Record<Traceback["reconciliation"], { tone: string; label: string }> = {
  exact: { tone: "ok", label: "Ties back" },
  rounded: { tone: "ok", label: "Ties back (rounding)" },
  bill_exceeds_sources: { tone: "warn", label: "More billed than measured" },
  sources_exceed_bill: { tone: "warn", label: "More measured than billed" },
  unit_mismatch: { tone: "bad", label: "Unit mismatch" },
  no_sources: { tone: "bad", label: "No traceable source" },
};

/**
 * The quantity cell.
 *
 * Rendered as a button because it does something — a number that opens a panel
 * but looks like static text is a feature nobody discovers. The badge only
 * appears when the line does NOT tie back: a mark on every row is decoration,
 * and decoration on every row is ignored on every row.
 */
export function QuantityCell({
  row, artifacts, format, onOpenSheet,
}: {
  row: any;
  artifacts: any[];
  format: (n: any) => string;
  /** Open a sheet in the drawing view, with these layers lit up. */
  onOpenSheet?: (target: { fileId: string | null; pageNo: number | null; sheetNo: string; layers: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const tb = useMemo(
    () => trace(billLineFrom(row), measurementsFrom(artifacts)),
    [row, artifacts],
  );
  const verdict = VERDICT[tb.reconciliation];

  return (
    <>
      <button
        className={"qty-trace" + (tb.needsReview ? " untied" : "")}
        onClick={() => setOpen(true)}
        title={tb.explanation}
      >
        {format(row.payload?.quantity)}
        {tb.needsReview && <span className="qty-flag" aria-hidden>!</span>}
      </button>

      {open && (
        <div className="trace-pop" role="dialog" aria-label="Quantity traceback">
          <div className="trace-head">
            <div>
              <strong>{tb.code}</strong> · {tb.description}
            </div>
            <button className="mini" onClick={() => setOpen(false)}>Close</button>
          </div>

          {/* The reconciliation FIRST. The list of sources is supporting
              evidence; whether the number ties is the answer. */}
          <div className={`trace-verdict ${verdict.tone}`}>
            <div className="tv-label">{verdict.label}</div>
            <div className="tv-nums">
              <span>Billed <b>{tb.billedQuantity} {tb.unit}</b></span>
              <span>Measured <b>{tb.sourceQuantity} {tb.unit}</b></span>
              {tb.differenceQuantity !== 0 && (
                <span className="tv-diff">
                  Difference <b>{tb.differenceQuantity > 0 ? "+" : ""}{tb.differenceQuantity}</b>
                  {tb.differencePct !== 0 && <> ({tb.differencePct > 0 ? "+" : ""}{tb.differencePct}%)</>}
                </span>
              )}
            </div>
          </div>

          <p className="trace-why">{tb.explanation}</p>

          {tb.targets.map((tg) => (
            <div className="trace-sheet" key={tg.sheetNo}>
              <div className="ts-head">
                <button
                  className="linkish"
                  disabled={!onOpenSheet}
                  onClick={() => onOpenSheet?.({
                    fileId: tg.fileId, pageNo: tg.pageNo, sheetNo: tg.sheetNo, layers: tg.layers,
                  })}
                >
                  {tg.sheetNo}
                </button>
                <span className="ts-sub">
                  {tg.subtotal} {tb.unit}
                  {tg.layers.length > 0 && <> · {tg.layers.join(", ")}</>}
                </span>
              </div>
              <table className="ts-table">
                <tbody>
                  {tg.measurements.map((m) => (
                    <tr key={m.artifactId}>
                      <td>{m.item}</td>
                      <td className="ts-loc">{m.location ?? ""}</td>
                      <td className="r">{m.quantity} {m.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {tb.unitMismatches.length > 0 && (
            <div className="trace-note bad">
              {tb.unitMismatches.length} cited measurement(s) in another unit
              ({[...new Set(tb.unitMismatches.map((m) => m.unit))].join(", ")}) were left out of the
              total rather than converted.
            </div>
          )}
          {tb.danglingSources.length > 0 && (
            <div className="trace-note bad">
              {tb.danglingSources.length} cited source(s) could not be found.
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * A bill-wide banner: how many lines do not tie back.
 *
 * Shown above the table because it is the thing to know before reading any
 * individual line, and because a per-line flag is only useful once you know
 * whether there are two of them or two hundred.
 */
export function TraceSummary({ rows, artifacts }: { rows: any[]; artifacts: any[] }) {
  const sources = useMemo(() => measurementsFrom(artifacts), [artifacts]);
  const untied = useMemo(
    () => rows.filter((r) => trace(billLineFrom(r), sources).needsReview).length,
    [rows, sources],
  );
  if (!untied) return null;
  return (
    <div className="trace-banner">
      <b>{untied}</b> of {rows.length} line(s) do not tie back to their measurements.
      Open a quantity to see the difference.
    </div>
  );
}
