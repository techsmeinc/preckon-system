// RFQ issue and vendor management.
//
// A package becomes an enquiry, an enquiry goes to a list of vendors, and the
// answers come back on a clock. Almost everything that goes wrong in buying is
// a rule about that clock or that list being broken quietly:
//
//   - a quote accepted after the deadline, when the others closed on time
//   - a vendor who declined still appearing in the comparison as "no response"
//   - a reissue that silently replaces the scope vendors already priced
//
// So the states and the transitions are here, in one place, with the reasons
// attached to the refusal rather than left to whoever writes the next screen.
// Pure functions: no database, no clock of its own — `now` is always passed in,
// because a deadline rule that reads the system clock cannot be tested against
// the awkward minute either side of it.

export type RfqStatus = "draft" | "issued" | "closed" | "awarded" | "cancelled";

/** Where one invited vendor has got to. Ordered by how far they progressed. */
export type VendorState = "invited" | "viewed" | "declined" | "quoted" | "no_response";

export interface RfqVendor {
  vendorId: string;
  name: string;
  state: VendorState;
  /** Set when they declined, so the reason survives into the next enquiry. */
  declineReason?: string | null;
  invitedAt?: string | null;
  respondedAt?: string | null;
}

export interface Rfq {
  id: string;
  packageId: string;
  /** Bumped on reissue. Vendors always price a numbered revision, never "the RFQ". */
  revision: number;
  status: RfqStatus;
  title: string;
  /** Scope must exist before this can be issued — an empty enquiry is not an enquiry. */
  scopeItemIds: string[];
  issuedAt?: string | null;
  /** ISO. The clock everything below is measured against. */
  dueAt?: string | null;
  vendors: RfqVendor[];
  awardedVendorId?: string | null;
}

export interface Refusal {
  ok: false;
  reason: string;
}
export type Result<T> = { ok: true; value: T } | Refusal;

const refuse = (reason: string): Refusal => ({ ok: false, reason });

/* ── issuing ─────────────────────────────────────────────────────────────── */

/**
 * Issue an enquiry.
 *
 * Three preconditions, each of which has produced a real procurement mess when
 * skipped: no scope means vendors price different things; no vendors means the
 * enquiry sits looking sent; no deadline means every quote is arguably on time.
 */
export function issue(rfq: Rfq, at: string, dueAt: string): Result<Rfq> {
  if (rfq.status !== "draft") return refuse(`An RFQ can only be issued from draft; this one is ${rfq.status}.`);
  if (!rfq.scopeItemIds.length) return refuse("There is no scope on this RFQ, so vendors would be pricing nothing.");
  if (!rfq.vendors.length) return refuse("No vendors have been invited.");
  if (Date.parse(dueAt) <= Date.parse(at)) return refuse("The deadline is not in the future.");
  return {
    ok: true,
    value: {
      ...rfq,
      status: "issued",
      issuedAt: at,
      dueAt,
      vendors: rfq.vendors.map((v) => ({ ...v, state: v.state === "draft" as never ? "invited" : v.state, invitedAt: v.invitedAt ?? at })),
    },
  };
}

/**
 * Reissue after a scope change.
 *
 * A new revision rather than an edit in place. Vendors priced revision 2; if
 * revision 3 quietly overwrote it, the quotes on file would answer a question
 * nobody can reconstruct. Responses are cleared because they are answers to the
 * old question — but the vendor list and their declines carry over.
 */
export function reissue(rfq: Rfq, at: string, dueAt: string, scopeItemIds: string[]): Result<Rfq> {
  if (rfq.status === "awarded") return refuse("This RFQ is awarded. Reissuing would reopen a decision already taken.");
  if (rfq.status === "cancelled") return refuse("This RFQ was cancelled.");
  if (!scopeItemIds.length) return refuse("A reissue still needs scope.");
  return {
    ok: true,
    value: {
      ...rfq,
      revision: rfq.revision + 1,
      status: "issued",
      scopeItemIds,
      issuedAt: at,
      dueAt,
      awardedVendorId: null,
      vendors: rfq.vendors.map((v) =>
        v.state === "declined"
          ? v                                     // a decline stands until they say otherwise
          : { ...v, state: "invited", respondedAt: null },
      ),
    },
  };
}

/* ── the clock ───────────────────────────────────────────────────────────── */

export const isOpen = (rfq: Rfq, now: string): boolean =>
  rfq.status === "issued" && (!rfq.dueAt || Date.parse(now) <= Date.parse(rfq.dueAt));

export const isLate = (rfq: Rfq, now: string): boolean =>
  rfq.status === "issued" && !!rfq.dueAt && Date.parse(now) > Date.parse(rfq.dueAt);

/**
 * Extend the deadline.
 *
 * Only forwards, and only while the enquiry is live. Shortening a deadline
 * vendors are already working to is how a "competitive" enquiry ends up with
 * one response — and a deadline moved backwards after quotes are in is
 * indistinguishable from choosing who is late.
 */
export function extend(rfq: Rfq, newDueAt: string): Result<Rfq> {
  if (rfq.status !== "issued") return refuse(`Only a live RFQ can be extended; this one is ${rfq.status}.`);
  if (!rfq.dueAt) return refuse("This RFQ has no deadline to extend.");
  if (Date.parse(newDueAt) <= Date.parse(rfq.dueAt)) return refuse("A deadline may only move later.");
  return { ok: true, value: { ...rfq, dueAt: newDueAt } };
}

/**
 * Record a vendor response.
 *
 * A quote arriving after the deadline is accepted into the record but marked
 * late by the caller's own clock — see `isLate`. Hiding it would be worse: the
 * fact that it arrived, and when, is exactly what an audit asks about.
 */
export function respond(
  rfq: Rfq, vendorId: string, state: Exclude<VendorState, "invited" | "no_response">, at: string,
  declineReason?: string,
): Result<Rfq> {
  const vendor = rfq.vendors.find((v) => v.vendorId === vendorId);
  if (!vendor) return refuse(`${vendorId} was not invited to this RFQ.`);
  if (rfq.status !== "issued") return refuse(`This RFQ is ${rfq.status}, so responses are not being taken.`);
  if (vendor.state === "declined" && state === "quoted") {
    return refuse(`${vendor.name} declined this enquiry; a quote cannot arrive from a declined vendor without re-inviting them.`);
  }
  return {
    ok: true,
    value: {
      ...rfq,
      vendors: rfq.vendors.map((v) =>
        v.vendorId === vendorId
          ? { ...v, state, respondedAt: at, declineReason: state === "declined" ? declineReason ?? null : v.declineReason }
          : v,
      ),
    },
  };
}

/** Close the enquiry. Anyone still silent is recorded as such, not left invited. */
export function close(rfq: Rfq): Result<Rfq> {
  if (rfq.status !== "issued") return refuse(`Only a live RFQ can be closed; this one is ${rfq.status}.`);
  return {
    ok: true,
    value: {
      ...rfq,
      status: "closed",
      vendors: rfq.vendors.map((v) =>
        v.state === "invited" || v.state === "viewed" ? { ...v, state: "no_response" } : v,
      ),
    },
  };
}

/**
 * Award to one vendor.
 *
 * Only to a vendor who actually quoted. Awarding to somebody who never priced
 * the scope is either a data error or a decision that should not be recorded
 * as the outcome of this enquiry.
 */
export function award(rfq: Rfq, vendorId: string): Result<Rfq> {
  if (rfq.status !== "closed") return refuse("Close the RFQ before awarding, so the field is final.");
  const vendor = rfq.vendors.find((v) => v.vendorId === vendorId);
  if (!vendor) return refuse(`${vendorId} was not invited to this RFQ.`);
  if (vendor.state !== "quoted") return refuse(`${vendor.name} did not quote, so this enquiry cannot be awarded to them.`);
  return { ok: true, value: { ...rfq, status: "awarded", awardedVendorId: vendorId } };
}

/* ── reading the field ───────────────────────────────────────────────────── */

export interface Field {
  invited: number;
  quoted: number;
  declined: number;
  silent: number;
  /** One response is a price, not a market. */
  competitive: boolean;
}

export function field(rfq: Rfq): Field {
  const by = (s: VendorState) => rfq.vendors.filter((v) => v.state === s).length;
  const quoted = by("quoted");
  return {
    invited: rfq.vendors.length,
    quoted,
    declined: by("declined"),
    silent: by("invited") + by("viewed") + by("no_response"),
    competitive: quoted >= 3,
  };
}
