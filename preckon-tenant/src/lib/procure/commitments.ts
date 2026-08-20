// Purchase orders and commitments.
//
// The moment an order is placed, money stops being a budget and becomes an
// obligation. Most cost overruns are visible at that moment and invisible for
// months afterwards, because spend reports show what has been PAID and an order
// placed today gets paid in ninety days. A job can commit 110% of its budget
// and look fine on every cost report until the invoices arrive.
//
// So commitment is tracked at the point of order, against the budget it draws
// down, and over-commitment is an event that gets reported rather than a number
// somebody has to notice. The three quantities are kept distinct throughout:
//
//   budget      what we allowed
//   committed   what we have contractually promised (orders + their variations)
//   paid        what has actually left the account
//
// Anticipated final cost is committed + uncommitted budget, never paid + budget,
// which is the version that reads comfortable and is wrong.

export type PoStatus = "draft" | "issued" | "acknowledged" | "part_delivered" | "complete" | "cancelled";

export interface PoVariation {
  id: string;
  reason: string;
  valueMinor: number;
  approvedBy?: string | null;
  at: string;
}

export interface Payment {
  id: string;
  valueMinor: number;
  at: string;
  reference?: string | null;
}

export interface PurchaseOrder {
  id: string;
  ref: string;
  packageId: string;
  vendorId: string;
  vendorName: string;
  status: PoStatus;
  /** Order value at issue, before variations. */
  valueMinor: number;
  variations: PoVariation[];
  payments: Payment[];
  /** From the awarded quote, so the order can be traced to the enquiry. */
  quoteId?: string | null;
  issuedAt?: string | null;
  requiredOnSiteAt?: string | null;
  leadTimeDays?: number | null;
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;
const refuse = (reason: string): Refusal => ({ ok: false, reason });

/** Order value including approved variations. This is the commitment. */
export const committedValue = (po: PurchaseOrder): number =>
  po.status === "cancelled" ? 0 : po.valueMinor + po.variations.reduce((s, v) => s + v.valueMinor, 0);

export const paidValue = (po: PurchaseOrder): number =>
  po.payments.reduce((s, p) => s + p.valueMinor, 0);

/**
 * Raise an order from an awarded quote.
 *
 * The quote id is carried through deliberately: an order that cannot be traced
 * back to the enquiry it came from is an order nobody can prove was competitive.
 */
export function raise(
  po: Omit<PurchaseOrder, "status" | "variations" | "payments">,
): Result<PurchaseOrder> {
  if (po.valueMinor <= 0) return refuse("An order needs a value.");
  if (!po.vendorId) return refuse("An order needs a vendor.");
  return { ok: true, value: { ...po, status: "draft", variations: [], payments: [] } };
}

export function issue(po: PurchaseOrder, at: string): Result<PurchaseOrder> {
  if (po.status !== "draft") return refuse(`This order is already ${po.status}.`);
  return { ok: true, value: { ...po, status: "issued", issuedAt: at } };
}

/**
 * Vary an order.
 *
 * Requires an approver above zero value for the same reason a variation to the
 * main contract does: an unattributed increase in commitment is how a package
 * quietly ends up 20% over its budget with nobody having decided to spend it.
 */
export function vary(
  po: PurchaseOrder, variation: Omit<PoVariation, "id">, id: string,
): Result<PurchaseOrder> {
  if (po.status === "cancelled") return refuse("This order was cancelled.");
  if (po.status === "complete") return refuse("This order is complete; raise a new one.");
  if (!variation.reason?.trim()) return refuse("A variation to an order needs a reason.");
  if (variation.valueMinor > 0 && !variation.approvedBy?.trim()) {
    return refuse("An increase in commitment needs an approver — record who authorised it.");
  }
  return { ok: true, value: { ...po, variations: [...po.variations, { ...variation, id }] } };
}

/**
 * Record a payment.
 *
 * Refused beyond the commitment. Paying more than was ordered is either a data
 * error or an unrecorded variation, and both should stop here rather than
 * surface as a reconciliation problem at final account.
 */
export function pay(po: PurchaseOrder, payment: Omit<Payment, "id">, id: string): Result<PurchaseOrder> {
  const committed = committedValue(po);
  const already = paidValue(po);
  if (already + payment.valueMinor > committed) {
    return refuse(
      `Payment would take the total paid to ${money(already + payment.valueMinor)} against a commitment of ` +
      `${money(committed)}. Vary the order first, or correct the payment.`,
    );
  }
  return { ok: true, value: { ...po, payments: [...po.payments, { ...payment, id }] } };
}

/* ── the cost position ────────────────────────────────────────────────────── */

export interface PackageBudget {
  packageId: string;
  name: string;
  budgetMinor: number;
}

export type CommitmentFlag =
  | "over_committed"
  | "fully_committed"
  | "uncommitted"
  | "paid_ahead"
  | "long_lead_at_risk";

export interface PackagePosition {
  packageId: string;
  name: string;
  budgetMinor: number;
  committedMinor: number;
  paidMinor: number;
  /** budget − committed. Negative is the number that matters. */
  uncommittedMinor: number;
  /** committed + whatever budget is left uncommitted. */
  anticipatedFinalMinor: number;
  varianceMinor: number;
  flags: CommitmentFlag[];
  orders: number;
}

export interface CostPosition {
  packages: PackagePosition[];
  budgetMinor: number;
  committedMinor: number;
  paidMinor: number;
  anticipatedFinalMinor: number;
  varianceMinor: number;
  summary: string;
}

/**
 * Where the money stands, package by package.
 *
 * Anticipated final cost is committed plus REMAINING budget — not paid plus
 * budget. The difference is the whole point: a package 100% committed and 10%
 * paid is finished as far as exposure goes, and a report built on payments
 * would call it 90% available.
 */
export function position(budgets: PackageBudget[], orders: PurchaseOrder[]): CostPosition {
  const byPackage = new Map<string, PurchaseOrder[]>();
  for (const po of orders) {
    const list = byPackage.get(po.packageId) ?? [];
    list.push(po);
    byPackage.set(po.packageId, list);
  }

  const packages: PackagePosition[] = budgets.map((b) => {
    const pos = byPackage.get(b.packageId) ?? [];
    const committed = pos.reduce((s, po) => s + committedValue(po), 0);
    const paid = pos.reduce((s, po) => s + paidValue(po), 0);
    const uncommitted = b.budgetMinor - committed;
    const anticipated = committed + Math.max(0, uncommitted);
    const flags: CommitmentFlag[] = [];

    if (committed > b.budgetMinor) flags.push("over_committed");
    else if (uncommitted === 0 && committed > 0) flags.push("fully_committed");
    else if (committed === 0) flags.push("uncommitted");
    if (paid > committed) flags.push("paid_ahead");
    if (pos.some((po) => po.leadTimeDays != null && po.requiredOnSiteAt && lateOnSite(po))) {
      flags.push("long_lead_at_risk");
    }

    return {
      packageId: b.packageId, name: b.name, budgetMinor: b.budgetMinor,
      committedMinor: committed, paidMinor: paid,
      uncommittedMinor: uncommitted,
      anticipatedFinalMinor: anticipated,
      varianceMinor: b.budgetMinor - anticipated,
      flags, orders: pos.length,
    };
  });

  const sum = (f: (p: PackagePosition) => number) => packages.reduce((a, p) => a + f(p), 0);
  const budget = sum((p) => p.budgetMinor);
  const committed = sum((p) => p.committedMinor);
  const anticipated = sum((p) => p.anticipatedFinalMinor);
  const over = packages.filter((p) => p.flags.includes("over_committed"));

  return {
    packages: packages.sort((a, b) => a.varianceMinor - b.varianceMinor),
    budgetMinor: budget,
    committedMinor: committed,
    paidMinor: sum((p) => p.paidMinor),
    anticipatedFinalMinor: anticipated,
    varianceMinor: budget - anticipated,
    summary:
      `${money(committed)} committed of ${money(budget)} budget; anticipated final ${money(anticipated)}` +
      (over.length ? `. ${over.length} package(s) over-committed: ${over.map((p) => p.name).join(", ")}` : "") + ".",
  };
}

/** An order whose lead time no longer fits the date it is needed on site. */
function lateOnSite(po: PurchaseOrder, now = new Date().toISOString().slice(0, 10)): boolean {
  if (!po.requiredOnSiteAt || po.leadTimeDays == null) return false;
  const daysAvailable = Math.floor((Date.parse(po.requiredOnSiteAt) - Date.parse(now)) / 86_400_000);
  return daysAvailable < po.leadTimeDays;
}

export interface DeliveryAlert {
  ref: string;
  vendorName: string;
  requiredOnSiteAt: string;
  leadTimeDays: number;
  daysAvailable: number;
  shortfallDays: number;
  message: string;
}

/**
 * Long-lead items that will not arrive in time.
 *
 * Computed from the order rather than from a delivery date somebody typed:
 * lead time plus today is when it can arrive at the earliest, and if that is
 * after the date it is needed, the programme is already wrong regardless of
 * what anybody has promised.
 */
export function deliveryAlerts(orders: PurchaseOrder[], now: string): DeliveryAlert[] {
  const alerts: DeliveryAlert[] = [];
  for (const po of orders) {
    if (po.status === "cancelled" || po.status === "complete") continue;
    if (!po.requiredOnSiteAt || po.leadTimeDays == null) continue;
    const daysAvailable = Math.floor((Date.parse(po.requiredOnSiteAt) - Date.parse(now)) / 86_400_000);
    if (daysAvailable >= po.leadTimeDays) continue;
    alerts.push({
      ref: po.ref,
      vendorName: po.vendorName,
      requiredOnSiteAt: po.requiredOnSiteAt,
      leadTimeDays: po.leadTimeDays,
      daysAvailable,
      shortfallDays: po.leadTimeDays - daysAvailable,
      message:
        `${po.ref} (${po.vendorName}) needs ${po.leadTimeDays} days and has ${daysAvailable}: ` +
        `${po.leadTimeDays - daysAvailable} days short of the ${po.requiredOnSiteAt} date on site.`,
    });
  }
  return alerts.sort((a, b) => b.shortfallDays - a.shortfallDays);
}

const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
