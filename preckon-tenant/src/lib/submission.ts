// The submission register — what actually goes in the envelope.
//
// Everything upstream of this is derived: quantities come from drawings, rates
// from the bill, the programme from the quantities. None of that is true here.
// A bid bond is chased from a bank, an insurance certificate from a broker, a
// signed form of tender from a director who is in a meeting. They are collected,
// not computed — which is why this is a register on the project rather than
// another stage of the chain, where every record has to be produced by
// something.
//
// The default list is the generic one a contractor submits against almost any
// construction tender. It is a starting point, not a rule: items can be marked
// not-applicable, renamed, or added to, because every client's instructions to
// bidders differ and a checklist you cannot change is a checklist people keep
// on paper instead.

export type ItemState = "pending" | "ready" | "submitted" | "na";

export interface SubmissionItem {
  id: string;
  label: string;
  /** Which part of the bid this belongs to — how a submission is usually split. */
  group: "commercial" | "technical" | "legal" | "company";
  state: ItemState;
  /** Who is chasing it. Free text: it is often not a system user. */
  owner?: string;
  note?: string;
  /** Set when the item is produced by the chain rather than collected. */
  from?: string;
}

export interface SubmissionPack {
  items: SubmissionItem[];
  /** Free text — how it goes: portal, email, sealed envelope, all three. */
  method?: string;
  submittedAt?: string | null;
  submittedBy?: string | null;
}

const it = (
  id: string, label: string, group: SubmissionItem["group"], from?: string
): SubmissionItem => ({ id, label, group, state: "pending", from });

/**
 * The default register.
 *
 * Ordered the way a submission is assembled rather than alphabetically: the
 * commercial envelope first, because it is what gets opened first and what a
 * bid is rejected on.
 */
export const DEFAULT_ITEMS: SubmissionItem[] = [
  // ── commercial ────────────────────────────────────────────────────────
  it("form_of_tender", "Form of tender, signed and sealed", "commercial"),
  it("priced_boq", "Priced bill of quantities", "commercial", "Export from BOQ"),
  it("summary_of_prices", "Summary of prices / grand summary", "commercial", "Export from BOQ"),
  it("rates_schedule", "Schedule of rates and dayworks", "commercial"),
  it("preliminaries", "Preliminaries and general items priced", "commercial"),
  it("addenda", "All addenda acknowledged and signed", "commercial"),
  it("bid_bond", "Bid bond / tender guarantee", "commercial"),
  it("validity", "Bid validity period confirmed", "commercial"),

  // ── technical ─────────────────────────────────────────────────────────
  it("method_statement", "Method statement / technical narrative", "technical", "Export from Technical Narrative"),
  it("programme", "Construction programme", "technical", "Export from Schedule"),
  it("org_chart", "Site organisation chart and key staff CVs", "technical"),
  it("subcontractors", "Proposed subcontractors and suppliers", "technical", "From Procurement"),
  it("materials", "Materials and manufacturers schedule", "technical"),
  it("qa_plan", "Quality assurance plan", "technical"),
  it("hse_plan", "Health, safety and environmental plan", "technical"),
  it("deviations", "Schedule of deviations / qualifications", "technical"),

  // ── legal and compliance ──────────────────────────────────────────────
  it("power_of_attorney", "Power of attorney for the signatory", "legal"),
  it("insurances", "Insurance certificates (CAR, third party, workmen)", "legal"),
  it("conflict", "Conflict of interest / non-collusion declaration", "legal"),
  it("compliance", "Compliance statement against the instructions to bidders", "legal"),

  // ── company ───────────────────────────────────────────────────────────
  it("prequalification", "Prequalification certificate / classification", "company"),
  it("trade_licence", "Trade licence and commercial registration", "company"),
  it("tax", "Tax registration and clearance certificate", "company"),
  it("financials", "Audited financial statements", "company"),
  it("experience", "Similar project experience and references", "company"),
];

export const GROUP_LABEL: Record<SubmissionItem["group"], string> = {
  commercial: "Commercial envelope",
  technical: "Technical envelope",
  legal: "Legal and compliance",
  company: "Company documents",
};

export const STATE_LABEL: Record<ItemState, string> = {
  pending: "Outstanding",
  ready: "Ready",
  submitted: "Submitted",
  na: "Not applicable",
};

export const emptyPack = (): SubmissionPack => ({
  items: DEFAULT_ITEMS.map((i) => ({ ...i })),
  method: "",
  submittedAt: null,
  submittedBy: null,
});

/**
 * Merge a stored pack with the current defaults.
 *
 * New standard items appear on old projects, and anything the team added or
 * edited is kept. Without this, extending the default list would silently skip
 * every project created before the change — which is the failure mode of every
 * checklist that ships as a fixed array.
 */
export function hydrate(stored: unknown): SubmissionPack {
  const base = emptyPack();
  if (!stored || typeof stored !== "object") return base;
  const p = stored as Partial<SubmissionPack>;
  const saved = new Map((p.items ?? []).map((i) => [i.id, i]));
  const items = base.items.map((d) => {
    const s = saved.get(d.id);
    return s ? { ...d, ...s, group: s.group ?? d.group } : d;
  });
  // Anything the team added themselves is not in the defaults; keep it.
  for (const [id, s] of saved) if (!items.some((i) => i.id === id)) items.push(s);
  return { items, method: p.method ?? "", submittedAt: p.submittedAt ?? null, submittedBy: p.submittedBy ?? null };
}

/** Outstanding items that are not marked not-applicable — the number that matters. */
export const outstanding = (p: SubmissionPack) =>
  p.items.filter((i) => i.state === "pending").length;

export const readiness = (p: SubmissionPack) => {
  const live = p.items.filter((i) => i.state !== "na");
  if (!live.length) return 100;
  const done = live.filter((i) => i.state === "submitted" || i.state === "ready").length;
  return Math.round((done / live.length) * 100);
};
