// Purchase orders, commitments and delivery.
//
// The test that matters most: anticipated final cost is committed plus
// remaining budget, not paid plus budget. A package fully ordered and barely
// paid is spent as far as exposure goes, and a report built on payments calls
// it available.

import { describe, it, expect } from "vitest";
import {
  raise, issue, vary, pay, committedValue, paidValue, position, deliveryAlerts,
  type PurchaseOrder, type PackageBudget,
} from "@/lib/procure/commitments";

const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1", ref: "PO-001", packageId: "pkg1", vendorId: "v1", vendorName: "Alpha",
  status: "issued", valueMinor: 500_000, variations: [], payments: [],
  issuedAt: "2026-05-01", ...over,
});

describe("raising and varying an order", () => {
  it("refuses an order with no value or no vendor", () => {
    expect(raise({ id: "x", ref: "PO-9", packageId: "p", vendorId: "v", vendorName: "V", valueMinor: 0 } as any).ok).toBe(false);
    expect(raise({ id: "x", ref: "PO-9", packageId: "p", vendorId: "", vendorName: "V", valueMinor: 10 } as any).ok).toBe(false);
  });

  it("will not increase a commitment without an approver", () => {
    const r = vary(po(), { reason: "extra ducting", valueMinor: 50_000, at: "2026-06-01" }, "vr1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/needs an approver/);
  });

  it("allows a reduction without one, since nobody needs protecting from spending less", () => {
    const r = vary(po(), { reason: "scope removed", valueMinor: -20_000, at: "2026-06-01" }, "vr1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(committedValue(r.value)).toBe(480_000);
  });

  it("counts variations in the commitment", () => {
    const varied = ok(vary(po(), { reason: "extra", valueMinor: 60_000, approvedBy: "QS", at: "2026-06-01" }, "vr1"));
    expect(committedValue(varied)).toBe(560_000);
  });

  it("treats a cancelled order as committing nothing", () => {
    expect(committedValue(po({ status: "cancelled" }))).toBe(0);
  });
});

describe("payments", () => {
  it("refuses to pay beyond the commitment", () => {
    const paid = ok(pay(po(), { valueMinor: 400_000, at: "2026-07-01" }, "p1"));
    const r = pay(paid, { valueMinor: 200_000, at: "2026-08-01" }, "p2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Vary the order first/);
  });

  it("allows it once the order has been varied to cover it", () => {
    const varied = ok(vary(po(), { reason: "extra", valueMinor: 200_000, approvedBy: "QS", at: "2026-06-01" }, "vr1"));
    const paid = ok(pay(varied, { valueMinor: 700_000, at: "2026-08-01" }, "p1"));
    expect(paidValue(paid)).toBe(700_000);
  });
});

describe("the cost position", () => {
  const budgets: PackageBudget[] = [
    { packageId: "pkg1", name: "Blockwork", budgetMinor: 600_000 },
    { packageId: "pkg2", name: "Roofing", budgetMinor: 1_000_000 },
    { packageId: "pkg3", name: "Joinery", budgetMinor: 300_000 },
  ];

  it("anticipates from commitment, not from payments", () => {
    // pkg1 fully ordered at 500k, only 50k paid. A payments-based view would
    // call 550k of a 600k budget still available. It is not: it is spent.
    const orders = [ok(pay(po(), { valueMinor: 50_000, at: "2026-06-01" }, "p1"))];
    const p = position(budgets, orders);
    const pkg1 = p.packages.find((x) => x.packageId === "pkg1")!;
    expect(pkg1.committedMinor).toBe(500_000);
    expect(pkg1.paidMinor).toBe(50_000);
    expect(pkg1.anticipatedFinalMinor).toBe(600_000);   // 500k committed + 100k left
    expect(pkg1.varianceMinor).toBe(0);
  });

  it("flags a package committed beyond its budget", () => {
    const orders = [po({ valueMinor: 700_000 })];
    const p = position(budgets, orders);
    const pkg1 = p.packages.find((x) => x.packageId === "pkg1")!;
    expect(pkg1.flags).toContain("over_committed");
    expect(pkg1.varianceMinor).toBe(-100_000);
    expect(p.summary).toMatch(/over-committed: Blockwork/);
  });

  it("sorts the worst variance first, so the review starts in the right place", () => {
    const orders = [po({ valueMinor: 700_000 }), po({ id: "po2", ref: "PO-2", packageId: "pkg2", valueMinor: 200_000 })];
    const p = position(budgets, orders);
    expect(p.packages[0].packageId).toBe("pkg1");
  });

  it("marks a package nobody has ordered against", () => {
    const p = position(budgets, []);
    expect(p.packages.every((x) => x.flags.includes("uncommitted"))).toBe(true);
    expect(p.committedMinor).toBe(0);
    expect(p.anticipatedFinalMinor).toBe(1_900_000);   // the whole budget still to spend
  });
});

describe("long-lead delivery", () => {
  it("computes the shortfall from lead time rather than a promised date", () => {
    // 90-day lead, needed in 30 days. Whatever the vendor promised, it cannot
    // arrive in time and the programme is already wrong.
    const orders = [po({ leadTimeDays: 90, requiredOnSiteAt: "2026-07-01" })];
    const alerts = deliveryAlerts(orders, "2026-06-01");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].shortfallDays).toBe(60);
    expect(alerts[0].message).toMatch(/60 days short/);
  });

  it("says nothing when there is time", () => {
    const orders = [po({ leadTimeDays: 10, requiredOnSiteAt: "2026-09-01" })];
    expect(deliveryAlerts(orders, "2026-06-01")).toEqual([]);
  });

  it("ignores completed and cancelled orders", () => {
    const orders = [
      po({ status: "complete", leadTimeDays: 90, requiredOnSiteAt: "2026-07-01" }),
      po({ id: "po2", status: "cancelled", leadTimeDays: 90, requiredOnSiteAt: "2026-07-01" }),
    ];
    expect(deliveryAlerts(orders, "2026-06-01")).toEqual([]);
  });

  it("puts the worst shortfall first", () => {
    const orders = [
      po({ ref: "PO-A", leadTimeDays: 40, requiredOnSiteAt: "2026-06-20" }),
      po({ id: "po2", ref: "PO-B", leadTimeDays: 120, requiredOnSiteAt: "2026-06-20" }),
    ];
    expect(deliveryAlerts(orders, "2026-06-01").map((a) => a.ref)).toEqual(["PO-B", "PO-A"]);
  });
});
