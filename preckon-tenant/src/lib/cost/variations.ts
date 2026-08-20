// Variation and change pricing.
//
// A variation is worth money only if it survives the process: notified in time,
// priced on a defensible basis, instructed by someone with authority, and
// agreed. Work done before that chain completes is work done at risk, and the
// most expensive habit in contracting is doing it anyway because the client
// asked nicely on site.
//
// So the state here is not decoration. Each step records who and when, the
// pricing basis is explicit rather than implied, and a variation carrying
// unagreed value is reported separately from one that is contractually secure —
// because a forecast that adds them together tells the board the job is fine
// when half the margin depends on a conversation nobody has had.

export type VariationStatus =
  | "identified"     // we spotted it; the client may not know yet
  | "notified"       // notice given within the contractual window
  | "quoted"         // priced and submitted
  | "instructed"     // client told us to proceed
  | "agreed"         // value agreed
  | "rejected"
  | "withdrawn";

/** How the money was arrived at. Each is defensible; being vague is not. */
export type PricingBasis =
  | "boq_rates"      // measured at existing bill rates — strongest position
  | "pro_rata"       // analogous bill rate, adjusted
  | "star_rate"      // new rate built up from first principles
  | "dayworks"       // time and materials
  | "lump_sum"
  | "provisional";

export interface Variation {
  id: string;
  ref: string;
  title: string;
  status: VariationStatus;
  basis: PricingBasis;
  /** The instruction, RFI or drawing revision that caused it. */
  origin?: string | null;
  valueMinor: number;
  /** Days of extension of time claimed. */
  eotDays?: number;
  identifiedAt: string;
  notifiedAt?: string | null;
  quotedAt?: string | null;
  instructedAt?: string | null;
  agreedAt?: string | null;
  instructedBy?: string | null;
  /** Work has started on site regardless of status. */
  workStarted?: boolean;
}

export interface ContractTerms {
  /** Days from becoming aware in which notice must be given. */
  noticeWindowDays: number;
  /** Value above which the client's written instruction is required. */
  instructionThresholdMinor?: number;
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;
const refuse = (reason: string): Refusal => ({ ok: false, reason });

const days = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Give notice.
 *
 * Refused after the contractual window, and refused loudly: a late notice is
 * not merely weaker, under most standard forms it is time-barred, and pretending
 * otherwise puts a number in the forecast that will never be paid.
 */
export function notify(v: Variation, at: string, terms: ContractTerms): Result<Variation> {
  if (v.status !== "identified") return refuse(`Already ${v.status}.`);
  const elapsed = days(v.identifiedAt, at);
  if (elapsed > terms.noticeWindowDays) {
    return refuse(
      `${elapsed} days since it was identified, against a ${terms.noticeWindowDays}-day notice window. ` +
      `Notice is late and may be time-barred — record it, but do not carry the value as recoverable ` +
      `without advice.`,
    );
  }
  return { ok: true, value: { ...v, status: "notified", notifiedAt: at } };
}

export function quote(v: Variation, at: string, valueMinor: number, basis: PricingBasis): Result<Variation> {
  if (v.status !== "notified" && v.status !== "identified") return refuse(`Cannot quote a variation that is ${v.status}.`);
  if (valueMinor <= 0 && basis !== "provisional") return refuse("A quote needs a value, or a provisional basis stated.");
  return { ok: true, value: { ...v, status: "quoted", quotedAt: at, valueMinor, basis } };
}

/**
 * Record the client's instruction.
 *
 * Above the threshold the contract requires it in writing, and `instructedBy`
 * is mandatory: "the site manager said carry on" is the sentence that loses
 * these at final account.
 */
export function instruct(v: Variation, at: string, by: string, terms: ContractTerms): Result<Variation> {
  if (v.status === "agreed" || v.status === "rejected" || v.status === "withdrawn") {
    return refuse(`This variation is ${v.status}.`);
  }
  if (!by?.trim()) return refuse("Record who instructed it — an unattributed instruction is not one.");
  const threshold = terms.instructionThresholdMinor;
  if (threshold != null && v.valueMinor > threshold && v.status !== "quoted") {
    return refuse(
      `Above the ${threshold / 100} instruction threshold, so it must be quoted and instructed in writing ` +
      `before the work proceeds.`,
    );
  }
  return { ok: true, value: { ...v, status: "instructed", instructedAt: at, instructedBy: by } };
}

export function agree(v: Variation, at: string, valueMinor?: number): Result<Variation> {
  if (v.status !== "instructed" && v.status !== "quoted") return refuse(`Cannot agree a variation that is ${v.status}.`);
  return {
    ok: true,
    value: { ...v, status: "agreed", agreedAt: at, valueMinor: valueMinor ?? v.valueMinor },
  };
}

/* ── the register ─────────────────────────────────────────────────────────── */

export type Exposure = "secure" | "probable" | "at_risk" | "lost";

export interface VariationRisk {
  ref: string;
  exposure: Exposure;
  valueMinor: number;
  why: string;
}

export interface VariationRegister {
  total: number;
  /** Agreed — contractually secure. */
  agreedMinor: number;
  /** Instructed but not agreed — probable. */
  instructedMinor: number;
  /** Quoted or notified only — at risk. */
  atRiskMinor: number;
  /** Work started without an instruction. The dangerous number. */
  unauthorisedMinor: number;
  risks: VariationRisk[];
  summary: string;
}

/**
 * What the variation account is actually worth.
 *
 * Split by how secure each pound is, because a register reporting one total
 * invites it to be added to the forecast whole. Work started without an
 * instruction is called out separately: it is money already spent that nobody
 * has yet promised to pay.
 */
export function register(variations: Variation[]): VariationRegister {
  const risks: VariationRisk[] = [];
  let agreed = 0, instructed = 0, atRisk = 0, unauthorised = 0;

  for (const v of variations) {
    if (v.status === "rejected" || v.status === "withdrawn") {
      risks.push({ ref: v.ref, exposure: "lost", valueMinor: v.valueMinor, why: `${v.status}.` });
      continue;
    }
    if (v.workStarted && (v.status === "identified" || v.status === "notified" || v.status === "quoted")) {
      unauthorised += v.valueMinor;
      risks.push({
        ref: v.ref, exposure: "at_risk", valueMinor: v.valueMinor,
        why: "Work has started without an instruction — the cost is being incurred with nothing obliging the client to pay it.",
      });
      continue;
    }
    switch (v.status) {
      case "agreed":
        agreed += v.valueMinor;
        risks.push({ ref: v.ref, exposure: "secure", valueMinor: v.valueMinor, why: "Agreed." });
        break;
      case "instructed":
        instructed += v.valueMinor;
        risks.push({
          ref: v.ref, exposure: "probable", valueMinor: v.valueMinor,
          why: `Instructed by ${v.instructedBy ?? "—"}, value not yet agreed.`,
        });
        break;
      default:
        atRisk += v.valueMinor;
        risks.push({
          ref: v.ref, exposure: "at_risk", valueMinor: v.valueMinor,
          why: v.status === "identified" ? "Identified but never notified." : `Only ${v.status}.`,
        });
    }
  }

  const order: Record<Exposure, number> = { at_risk: 0, probable: 1, secure: 2, lost: 3 };
  risks.sort((a, b) => order[a.exposure] - order[b.exposure] || b.valueMinor - a.valueMinor);

  return {
    total: variations.length,
    agreedMinor: agreed,
    instructedMinor: instructed,
    atRiskMinor: atRisk,
    unauthorisedMinor: unauthorised,
    risks,
    summary:
      `${money(agreed)} agreed, ${money(instructed)} instructed but not agreed, ${money(atRisk)} at risk` +
      (unauthorised ? `, including ${money(unauthorised)} of work started without an instruction` : "") + ".",
  };
}

const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Price a change against the existing bill where the work is the same.
 *
 * The strongest position in any variation argument: the rate is not being
 * negotiated, it is already in the contract. Falls back to a star rate only
 * when nothing comparable exists, and says which it used.
 */
export function priceChange(
  qty: number,
  comparable: { code: string; description: string; rateMinor: number } | null,
  starRateMinor?: number,
): { valueMinor: number; basis: PricingBasis; note: string } {
  if (comparable) {
    return {
      valueMinor: Math.round(qty * comparable.rateMinor),
      basis: "boq_rates",
      note: `${qty} at the contract rate for ${comparable.code} (${comparable.description}) — the rate is already agreed, not negotiable.`,
    };
  }
  if (starRateMinor != null && starRateMinor > 0) {
    return {
      valueMinor: Math.round(qty * starRateMinor),
      basis: "star_rate",
      note: `${qty} at a star rate built up from first principles — no comparable bill rate exists, so expect it to be challenged.`,
    };
  }
  return {
    valueMinor: 0,
    basis: "provisional",
    note: "No comparable rate and no build-up — carry as provisional until it is priced.",
  };
}
