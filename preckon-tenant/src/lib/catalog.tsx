"use client";
import React from "react";
import { StatusChip } from "@/lib/ui";

// Shared construction-domain presentation metadata (labels/descriptions arrive
// as data from the API; this is the friendly copy + purpose-built table columns).

export const MODULE_META: Record<string, { icon: string; kind: string; desc: string }> = {
  tenderlogix: { icon: "🔍", kind: "Tender", desc: "Analyse the tender and assemble the submittable bid." },
  drawlogix: { icon: "📐", kind: "Drawings", desc: "Index the sheet set and take off quantities per drawing." },
  doclogix: { icon: "📄", kind: "Specs", desc: "Extract normative clauses from specification documents." },
  quantlogix: { icon: "🧮", kind: "BOQ", desc: "Derive the bill of quantities from measurements and clauses." },
  costlogix: { icon: "💲", kind: "Estimate", desc: "Price each BOQ line against the rate books." },
  schedulelogix: { icon: "📅", kind: "Schedule", desc: "Sequence activities into a delivery programme." },
  procurelogix: { icon: "🛒", kind: "Procurement", desc: "Group scope into RFQ packages by trade and lead-time." },
  // Underwriting pack (second vertical) — one module.
  underwriting: { icon: "🛡️", kind: "Underwriting", desc: "Triage, rate, price and quote a broker submission." },
};

// Which artifact types each module produces (its output tables). Keys are the
// full (namespaced) artifact-type keys so byType() matches exactly.
export const MODULE_OUTPUTS: Record<string, string[]> = {
  tenderlogix: ["tender_summary", "bid_decision", "proposal_doc", "bid_approval"],
  doclogix: ["spec_clause"],
  drawlogix: ["drawing_index", "drawing_measurement"],
  quantlogix: ["boq_line"],
  costlogix: ["cost_line"],
  schedulelogix: ["schedule_activity"],
  procurelogix: ["procurement_package"],
  underwriting: [
    "underwriting.submission_summary", "underwriting.exposure", "underwriting.loss_run",
    "underwriting.risk_factor", "underwriting.quote_option", "underwriting.referral",
    "underwriting.condition", "underwriting.quote_letter",
  ],
};

export const TYPE_LABEL: Record<string, string> = {
  tender_summary: "Tender summary", bid_decision: "Bid decision", proposal_doc: "Proposal", bid_approval: "Bid approval",
  spec_clause: "Specification clauses", drawing_index: "Drawing index", drawing_measurement: "Measurements",
  boq_line: "Bill of quantities", cost_line: "Cost lines", schedule_activity: "Programme", procurement_package: "Procurement packages",
  risk: "Risk register", rfi: "RFIs", compliance_item: "Compliance", client_query: "Clarifications", document: "Documents",
  standard_violation: "Standard violations",
  // underwriting (short keys — looked up via typeLabel which strips the namespace)
  submission_summary: "Submission summary", exposure: "Exposures", loss_run: "Loss runs", risk_factor: "Risk factors",
  quote_option: "Quote options", referral: "Referrals", condition: "Conditions", uw_query: "Broker queries", quote_letter: "Quote letter",
};

/**
 * Namespace-tolerant type label. Pass the translator to get the localized name;
 * without it (or for a pack type with no translation) it falls back to the
 * English catalog, then to the humanized key.
 */
export function typeLabel(type: string, t?: (k: any) => string): string {
  const short = type.split(".").pop() ?? type;
  if (t) {
    const translated = t(`type.${short}`);
    // `t` echoes the key back when it isn't in the dictionary.
    if (translated && translated !== `type.${short}`) return translated;
  }
  return TYPE_LABEL[type] ?? TYPE_LABEL[short] ?? short;
}

// Fields (in priority order) that best name an artifact across every domain.
const SUMMARY_FIELDS = [
  "title", "name", "project_name", "insured_name", "package_name", "option_name",
  "activity", "factor", "subject", "sheet_no", "code", "requirement_ref", "clause_ref",
  "quote_ref", "reason", "recommendation", "decision", "kind", "description", "text",
];

/** Title-case a raw key/state (strips namespace, underscores → spaces). */
export function humanize(s: string): string {
  if (!s) return "";
  const short = s.split(".").pop() ?? s;
  return short.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const money2 = (m: number, ccy = "") =>
  (m == null ? "—" : (ccy ? ccy + " " : "") + (Number(m) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Render an artifact/rule payload as a readable key/value list (never raw JSON). */
export function PayloadView({ payload }: { payload: any }) {
  if (payload == null) return <span className="csub">—</span>;
  if (typeof payload !== "object") return <span>{String(payload)}</span>;
  const entries = Object.entries(payload).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return <span className="csub">—</span>;
  const ccy = (payload as any).currency ?? "";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 12.5 }}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--slate-400)", paddingTop: 1 }}>{k.replace(/_/g, " ")}</div>
          <div style={{ color: "var(--ink)", minWidth: 0, overflowWrap: "anywhere" }}>
            {typeof v === "object" ? <span className="mono" style={{ fontSize: 11.5, color: "var(--slate-600)" }}>{JSON.stringify(v)}</span>
              : /_minor$/.test(k) ? money2(v as number, ccy) : String(v)}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/** A short, human label for an artifact payload — domain-neutral (picks the first
 *  meaningful field). Turns an opaque UUID row into e.g. "In-situ concrete to foundations". */
export function summarize(payload: any): string {
  if (!payload || typeof payload !== "object") return "";
  for (const f of SUMMARY_FIELDS) {
    const v = payload[f];
    if (v != null && v !== "") return String(v).slice(0, 64);
  }
  const first = Object.values(payload).find((v) => typeof v === "string" && v);
  return first ? String(first).slice(0, 64) : "";
}

interface Col { key: string; label?: string; r?: boolean; money?: boolean; }
const money = (m: number, ccy = "") => (m == null ? "—" : (ccy ? ccy + " " : "") + (Number(m) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const COLS: Record<string, Col[]> = {
  tender_summary: [{ key: "project_name", label: "project" }, { key: "submission_format", label: "format" }, { key: "submission_deadline", label: "deadline" }],
  spec_clause: [{ key: "section" }, { key: "clause_ref", label: "ref" }, { key: "title" }],
  drawing_index: [{ key: "sheet_no", label: "sheet" }, { key: "title" }, { key: "discipline" }],
  drawing_measurement: [{ key: "sheet_no", label: "sheet" }, { key: "item" }, { key: "quantity", r: true }, { key: "unit" }],
  // measured_from names the CAD layers/blocks a quantity was actually measured
  // from, confirmed to exist; review_reason is populated only when the citation
  // audit could not match what the line claimed. Showing the reason rather than
  // the review_required boolean means the column is blank for sound lines and
  // self-explanatory for the ones worth opening — a QS scanning the bill sees
  // exactly the lines that need them and nothing else.
  boq_line: [{ key: "code" }, { key: "description" }, { key: "quantity", r: true }, { key: "unit" }, { key: "measured_from", label: "measured from" }, { key: "review_reason", label: "review" }],
  cost_line: [{ key: "boq_code", label: "boq" }, { key: "rate_minor", label: "rate", r: true, money: true }, { key: "amount_minor", label: "amount", r: true, money: true }, { key: "currency", label: "ccy" }],
  schedule_activity: [{ key: "activity" }, { key: "duration_days", label: "days", r: true }, { key: "trade" }],
  procurement_package: [{ key: "package_name", label: "package" }, { key: "trade" }, { key: "estimated_value_minor", label: "value", r: true, money: true }],
  bid_decision: [{ key: "decision" }, { key: "rationale" }],
  proposal_doc: [{ key: "title" }, { key: "total_amount_minor", label: "total", r: true, money: true }, { key: "currency", label: "ccy" }],
  bid_approval: [{ key: "recommendation" }, { key: "margin_pct", label: "margin %", r: true }, { key: "total_amount_minor", label: "total", r: true, money: true }],
  risk: [{ key: "category" }, { key: "title" }, { key: "likelihood" }, { key: "impact" }],
  rfi: [{ key: "subject" }, { key: "severity" }],
  compliance_item: [{ key: "requirement_ref", label: "req" }, { key: "status" }],
  client_query: [{ key: "direction" }, { key: "subject" }, { key: "status" }],
  document: [{ key: "doc_type", label: "type" }, { key: "title" }],
  // underwriting (short keys)
  submission_summary: [{ key: "insured_name", label: "insured" }, { key: "class_of_business", label: "class" }, { key: "requested_limit_minor", label: "limit", r: true, money: true }],
  exposure: [{ key: "location" }, { key: "peril" }, { key: "value_minor", label: "value", r: true, money: true }],
  loss_run: [{ key: "policy_year", label: "year" }, { key: "claim_count", label: "claims", r: true }, { key: "incurred_minor", label: "incurred", r: true, money: true }],
  risk_factor: [{ key: "factor" }, { key: "category" }, { key: "score", r: true }, { key: "appetite" }],
  quote_option: [{ key: "option_name", label: "option" }, { key: "premium_minor", label: "premium", r: true, money: true }, { key: "limit_minor", label: "limit", r: true, money: true }],
  referral: [{ key: "reason" }, { key: "authority_breach", label: "breach" }, { key: "decision" }],
  condition: [{ key: "kind" }, { key: "text" }],
  uw_query: [{ key: "direction" }, { key: "subject" }, { key: "status" }],
  quote_letter: [{ key: "quote_ref", label: "ref" }, { key: "insured_name", label: "insured" }, { key: "total_premium_minor", label: "premium", r: true, money: true }],
};

function cell(c: Col, payload: any): React.ReactNode {
  const v = payload?.[c.key];
  if (v == null) return "—";
  if (c.money) return money(v, payload.currency);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v);
}

/** A purpose-built table for a single artifact type. */
export function ArtifactTable({ type, rows, onRow }: { type: string; rows: any[]; onRow?: (a: any) => void }) {
  const cols = COLS[type] ?? COLS[type.split(".").pop() ?? type] ?? [{ key: "type_key", label: "value" }];
  if (rows.length === 0) return <p className="csub" style={{ margin: 0 }}>No {typeLabel(type)} yet.</p>;
  return (
    <table>
      <thead><tr>{cols.map((c) => <th key={c.key} className={c.r ? "r" : ""}>{c.label ?? c.key.replace(/_/g, " ")}</th>)}<th className="r">status</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} className={onRow ? "clickable" : ""} onClick={onRow ? () => onRow(a) : undefined}>
            {cols.map((c) => <td key={c.key} className={c.r ? "r num" : ""}>{cell(c, a.payload)}</td>)}
            <td className="r"><StatusChip status={a.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
