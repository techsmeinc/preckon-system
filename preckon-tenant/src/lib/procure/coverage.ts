// RFQ coverage and gap flags.
//
// The question this answers is the one asked in every pre-tender review, three
// days before submission: what have we NOT got a price for. It is easy to see
// the packages that came back and hard to see the ones that never went out —
// and a package nobody enquired about carries the estimator's guess into the
// bid at full risk, silently.
//
// So coverage is computed from the scope downwards, not from the RFQs upwards.
// A package with no enquiry is the most important row here, and it only appears
// if you start from the list of packages rather than the list of enquiries.

import { field, isLate, type Rfq } from "./rfq";

export type FlagCode =
  | "no_rfq"
  | "not_issued"
  | "no_responses"
  | "single_source"
  | "thin_field"
  | "closing_soon"
  | "overdue"
  | "all_declined"
  | "unawarded";

export type Severity = "critical" | "warning" | "info";

export interface Flag {
  code: FlagCode;
  severity: Severity;
  packageId: string;
  message: string;
}

export interface PackageRef {
  id: string;
  name: string;
  /** Value at estimate, minor units — used to sort exposure, not to price it. */
  valueMinor?: number;
}

export interface CoverageRow {
  packageId: string;
  name: string;
  valueMinor: number;
  rfqId: string | null;
  status: string;
  invited: number;
  quoted: number;
  flags: Flag[];
}

export interface CoverageReport {
  rows: CoverageRow[];
  flags: Flag[];
  /** Fraction of packages with at least one quote in hand, 0..1. */
  covered: number;
  /** Value with no quote against it. The number worth saying out loud. */
  uncoveredValueMinor: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export interface CoverageOptions {
  now: string;
  /** How near a deadline has to be before it is worth chasing. */
  closingSoonHours?: number;
  /** Below this many quotes, the field is thin. Three is the usual convention. */
  competitiveAt?: number;
}

/**
 * Coverage across every package, whether or not it has an enquiry.
 *
 * Flags are ordered by severity and then by value, because the review that uses
 * this has limited time and the biggest unpriced package is the right first
 * question.
 */
export function coverage(
  packages: PackageRef[], rfqs: Rfq[], opts: CoverageOptions,
): CoverageReport {
  const closingSoonHours = opts.closingSoonHours ?? 48;
  const competitiveAt = opts.competitiveAt ?? 3;
  const nowMs = Date.parse(opts.now);

  const byPackage = new Map<string, Rfq>();
  for (const r of rfqs) {
    const existing = byPackage.get(r.packageId);
    // Keep the latest revision when a package has been reissued.
    if (!existing || r.revision > existing.revision) byPackage.set(r.packageId, r);
  }

  const rows: CoverageRow[] = packages.map((pkg) => {
    const rfq = byPackage.get(pkg.id) ?? null;
    const valueMinor = pkg.valueMinor ?? 0;
    const flags: Flag[] = [];
    const flag = (code: FlagCode, severity: Severity, message: string) =>
      flags.push({ code, severity, packageId: pkg.id, message });

    if (!rfq) {
      flag("no_rfq", "critical", `No enquiry has been raised for ${pkg.name}. Its price is the estimate's own guess.`);
      return { packageId: pkg.id, name: pkg.name, valueMinor, rfqId: null, status: "none", invited: 0, quoted: 0, flags };
    }

    const f = field(rfq);
    if (rfq.status === "draft") {
      flag("not_issued", "critical", `${pkg.name} has a drafted enquiry that was never issued.`);
    }
    if (rfq.status === "issued") {
      if (isLate(rfq, opts.now)) {
        flag("overdue", "warning", `${pkg.name} passed its deadline (${rfq.dueAt}) and is still open.`);
      } else if (rfq.dueAt && Date.parse(rfq.dueAt) - nowMs <= closingSoonHours * 3600_000) {
        flag("closing_soon", "info", `${pkg.name} closes ${rfq.dueAt}.`);
      }
    }
    if (f.quoted === 0) {
      const all = f.invited > 0 && f.declined === f.invited;
      if (all) flag("all_declined", "critical", `Every vendor invited for ${pkg.name} declined.`);
      else flag("no_responses", "critical", `No quotes received for ${pkg.name}.`);
    } else if (f.quoted === 1) {
      flag("single_source", "warning", `Only one quote for ${pkg.name} — a price, not a market.`);
    } else if (f.quoted < competitiveAt) {
      flag("thin_field", "info", `${f.quoted} quotes for ${pkg.name}; ${competitiveAt} is the usual minimum.`);
    }
    if (rfq.status === "closed" && !rfq.awardedVendorId && f.quoted > 0) {
      flag("unawarded", "info", `${pkg.name} closed with ${f.quoted} quote(s) and no award recorded.`);
    }

    return {
      packageId: pkg.id, name: pkg.name, valueMinor,
      rfqId: rfq.id, status: rfq.status, invited: f.invited, quoted: f.quoted, flags,
    };
  });

  const withQuotes = rows.filter((r) => r.quoted > 0);
  const uncoveredValueMinor = rows
    .filter((r) => r.quoted === 0)
    .reduce((a, r) => a + r.valueMinor, 0);

  const flags = rows
    .flatMap((r) => r.flags.map((f) => ({ f, value: r.valueMinor })))
    .sort((a, b) =>
      SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || b.value - a.value,
    )
    .map(({ f }) => f);

  return {
    rows,
    flags,
    covered: packages.length ? withQuotes.length / packages.length : 1,
    uncoveredValueMinor,
  };
}
