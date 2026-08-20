// Procurement: enquiries, quote comparison, and what is not covered.
//
// The comparison tests carry the weight here. Ranking quote packs on the
// submitted total is the single most expensive mistake in buying, because the
// vendor who excluded the most looks cheapest, and the exclusion is discovered
// on site. These pin the opposite behaviour.

import { describe, it, expect } from "vitest";
import {
  issue, reissue, extend, respond, close, award, field, isLate, isOpen, type Rfq,
} from "@/lib/procure/rfq";
import { compareQuotes, type Quote, type ScopeItem } from "@/lib/procure/quotes";
import { coverage, type PackageRef } from "@/lib/procure/coverage";

const T0 = "2026-03-01T09:00:00.000Z";
const T1 = "2026-03-08T17:00:00.000Z";

const rfq = (over: Partial<Rfq> = {}): Rfq => ({
  id: "rfq1", packageId: "pkg1", revision: 1, status: "draft", title: "Blockwork",
  scopeItemIds: ["s1", "s2"],
  vendors: [
    { vendorId: "v1", name: "Alpha", state: "invited" },
    { vendorId: "v2", name: "Beta", state: "invited" },
  ],
  ...over,
});

const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.reason}`);
  return r.value;
};

describe("issuing an enquiry", () => {
  it("refuses to issue with no scope", () => {
    const r = issue(rfq({ scopeItemIds: [] }), T0, T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no scope/i);
  });

  it("refuses a deadline in the past", () => {
    const r = issue(rfq(), T1, T0);
    expect(r.ok).toBe(false);
  });

  it("refuses to issue with nobody invited", () => {
    expect(issue(rfq({ vendors: [] }), T0, T1).ok).toBe(false);
  });

  it("issues and starts the clock", () => {
    const r = ok(issue(rfq(), T0, T1));
    expect(r.status).toBe("issued");
    expect(isOpen(r, "2026-03-05T00:00:00.000Z")).toBe(true);
    expect(isLate(r, "2026-03-09T00:00:00.000Z")).toBe(true);
  });
});

describe("the deadline only moves one way", () => {
  it("extends forwards", () => {
    const live = ok(issue(rfq(), T0, T1));
    expect(ok(extend(live, "2026-03-10T17:00:00.000Z")).dueAt).toBe("2026-03-10T17:00:00.000Z");
  });

  it("refuses to shorten a deadline vendors are working to", () => {
    const live = ok(issue(rfq(), T0, T1));
    expect(extend(live, "2026-03-02T17:00:00.000Z").ok).toBe(false);
  });
});

describe("responses", () => {
  it("will not take a quote from a vendor who declined", () => {
    const live = ok(issue(rfq(), T0, T1));
    const declined = ok(respond(live, "v1", "declined", T0, "no capacity"));
    const r = respond(declined, "v1", "quoted", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/declined/i);
  });

  it("records silence as no_response at close, rather than leaving it invited", () => {
    const live = ok(issue(rfq(), T0, T1));
    const one = ok(respond(live, "v1", "quoted", T1));
    const closed = ok(close(one));
    expect(closed.vendors.find((v) => v.vendorId === "v2")!.state).toBe("no_response");
  });

  it("refuses to award to a vendor who never quoted", () => {
    const closed = ok(close(ok(issue(rfq(), T0, T1))));
    expect(award(closed, "v2").ok).toBe(false);
  });

  it("awards to a vendor who quoted, but only once closed", () => {
    const live = ok(issue(rfq(), T0, T1));
    const quoted = ok(respond(live, "v1", "quoted", T1));
    expect(award(quoted, "v1").ok).toBe(false);       // still open
    const closed = ok(close(quoted));
    expect(ok(award(closed, "v1")).awardedVendorId).toBe("v1");
  });
});

describe("reissue", () => {
  it("bumps the revision and clears stale responses, but keeps declines", () => {
    const live = ok(issue(rfq(), T0, T1));
    const quoted = ok(respond(live, "v1", "quoted", T1));
    const declined = ok(respond(quoted, "v2", "declined", T1, "too busy"));
    const next = ok(reissue(declined, T1, "2026-03-20T17:00:00.000Z", ["s1", "s2", "s3"]));
    expect(next.revision).toBe(2);
    expect(next.vendors.find((v) => v.vendorId === "v1")!.state).toBe("invited");
    expect(next.vendors.find((v) => v.vendorId === "v2")!.state).toBe("declined");
  });

  it("will not reopen an award", () => {
    const closed = ok(close(ok(respond(ok(issue(rfq(), T0, T1)), "v1", "quoted", T1))));
    const awarded = ok(award(closed, "v1"));
    expect(reissue(awarded, T1, "2026-04-01T00:00:00.000Z", ["s1"]).ok).toBe(false);
  });
});

/* ── comparison ───────────────────────────────────────────────────────────── */

const scope: ScopeItem[] = [
  { id: "s1", description: "Blockwork 200mm", qty: 100, unit: "m2", estimateRateMinor: 5000 },
  { id: "s2", description: "Fair-faced finish", qty: 100, unit: "m2", estimateRateMinor: 2000 },
];

const quote = (over: Partial<Quote> & Pick<Quote, "vendorId" | "vendorName" | "lines">): Quote => ({
  id: `q-${over.vendorId}`, rfqId: "rfq1", currency: "AED",
  submittedAt: T1, ...over,
});

describe("like-for-like comparison", () => {
  it("does not let the vendor who excluded the most win", () => {
    // Alpha prices everything at 700,000. Bravo prices only the blockwork at
    // 480,000 and excludes the finish — cheaper on the face of it, and not
    // actually cheaper at all.
    const alpha = quote({
      vendorId: "v1", vendorName: "Alpha",
      lines: [{ scopeItemId: "s1", rateMinor: 5000 }, { scopeItemId: "s2", rateMinor: 2000 }],
    });
    const bravo = quote({
      vendorId: "v2", vendorName: "Bravo",
      lines: [{ scopeItemId: "s1", rateMinor: 4800 }],
      excludedScopeItemIds: ["s2"],
    });

    const c = compareQuotes(scope, [alpha, bravo], { at: T1 });
    const a = c.rows.find((r) => r.vendorId === "v1")!;
    const b = c.rows.find((r) => r.vendorId === "v2")!;

    expect(b.quotedMinor).toBeLessThan(a.quotedMinor);      // looks cheaper...
    expect(b.allowanceMinor).toBe(200_000);                  // ...the finish, at Alpha's rate
    expect(b.adjustedMinor).toBe(680_000);
    expect(a.adjustedMinor).toBe(700_000);
    expect(c.recommendation!.vendorId).toBe("v2");           // genuinely cheaper once levelled
    expect(c.recommendation!.why).toMatch(/like-for-like/);
  });

  it("fills a gap from the other quotes before falling back to the estimate", () => {
    const cheap = quote({
      vendorId: "v1", vendorName: "Alpha",
      lines: [{ scopeItemId: "s1", rateMinor: 5000 }, { scopeItemId: "s2", rateMinor: 900 }],
    });
    const gapped = quote({
      vendorId: "v2", vendorName: "Bravo",
      lines: [{ scopeItemId: "s1", rateMinor: 5000 }],
    });
    const c = compareQuotes(scope, [cheap, gapped], { at: T1 });
    const b = c.rows.find((r) => r.vendorId === "v2")!;
    // 900 is what the market actually charged here, not the 2000 the estimator
    // assumed before the enquiry went out.
    expect(b.gaps[0].basis).toBe("priced_by_others");
    expect(b.allowanceMinor).toBe(90_000);
  });

  it("marks a quote not comparable when a gap cannot be priced at all", () => {
    const orphan: ScopeItem[] = [{ id: "s9", description: "Specialist coating", qty: 10, unit: "m2" }];
    const q = quote({ vendorId: "v1", vendorName: "Alpha", lines: [] });
    const c = compareQuotes(orphan, [q], { at: T1 });
    expect(c.rows[0].comparable).toBe(false);
    expect(c.rows[0].gaps[0].basis).toBe("none");
    expect(c.rows[0].allowanceMinor).toBe(0);        // zero, and NOT treated as free
    expect(c.recommendation).toBeNull();
    expect(c.warnings.join(" ")).toMatch(/no quote is comparable/i);
  });

  it("excludes a lapsed price from the ranking", () => {
    const live = quote({
      vendorId: "v1", vendorName: "Alpha",
      lines: [{ scopeItemId: "s1", rateMinor: 6000 }, { scopeItemId: "s2", rateMinor: 2000 }],
    });
    const expired = quote({
      vendorId: "v2", vendorName: "Bravo",
      lines: [{ scopeItemId: "s1", rateMinor: 4000 }, { scopeItemId: "s2", rateMinor: 1000 }],
      validUntil: "2026-02-01",
    });
    const c = compareQuotes(scope, [live, expired], { at: T1 });
    expect(c.rows.find((r) => r.vendorId === "v2")!.comparable).toBe(false);
    expect(c.recommendation!.vendorId).toBe("v1");   // the cheaper price is not available
  });

  it("flags a lead time longer than the time available", () => {
    const q = quote({
      vendorId: "v1", vendorName: "Alpha",
      lines: [{ scopeItemId: "s1", rateMinor: 5000 }, { scopeItemId: "s2", rateMinor: 2000 }],
      leadTimeDays: 90,
    });
    const c = compareQuotes(scope, [q], { at: T1, needByDays: 30 });
    expect(c.rows[0].issues.join(" ")).toMatch(/lead time/i);
  });

  it("says so when there is no competition", () => {
    const q = quote({
      vendorId: "v1", vendorName: "Alpha",
      lines: [{ scopeItemId: "s1", rateMinor: 5000 }, { scopeItemId: "s2", rateMinor: 2000 }],
    });
    const c = compareQuotes(scope, [q], { at: T1 });
    expect(c.warnings.join(" ")).toMatch(/not a competition/i);
  });

  it("will not silently convert currencies", () => {
    const a = quote({ vendorId: "v1", vendorName: "Alpha", lines: [{ scopeItemId: "s1", rateMinor: 5000 }, { scopeItemId: "s2", rateMinor: 2000 }] });
    const b = quote({ vendorId: "v2", vendorName: "Bravo", currency: "USD", lines: [{ scopeItemId: "s1", rateMinor: 1400 }, { scopeItemId: "s2", rateMinor: 500 }] });
    const c = compareQuotes(scope, [a, b], { at: T1 });
    expect(c.warnings.join(" ")).toMatch(/convert before relying/i);
  });
});

/* ── coverage ─────────────────────────────────────────────────────────────── */

describe("coverage", () => {
  const packages: PackageRef[] = [
    { id: "pkg1", name: "Blockwork", valueMinor: 500_000 },
    { id: "pkg2", name: "Roofing", valueMinor: 2_000_000 },
    { id: "pkg3", name: "Joinery", valueMinor: 100_000 },
  ];

  it("surfaces the package nobody enquired about, which no list of RFQs would show", () => {
    const live = ok(issue(rfq(), T0, T1));
    const r = coverage(packages, [live], { now: T0 });
    const missing = r.flags.filter((f) => f.code === "no_rfq");
    expect(missing.map((f) => f.packageId).sort()).toEqual(["pkg2", "pkg3"]);
    // Biggest exposure first: Roofing before Joinery.
    expect(missing[0].packageId).toBe("pkg2");
    expect(r.uncoveredValueMinor).toBe(2_600_000);
  });

  it("counts a package as covered once a quote is in hand", () => {
    const quoted = ok(respond(ok(issue(rfq(), T0, T1)), "v1", "quoted", T1));
    const r = coverage([packages[0]], [quoted], { now: T1 });
    expect(r.covered).toBe(1);
    expect(r.rows[0].quoted).toBe(1);
    expect(r.flags.some((f) => f.code === "single_source")).toBe(true);
  });

  it("reads the latest revision when a package was reissued", () => {
    const live = ok(issue(rfq(), T0, T1));
    const next = ok(reissue(live, T1, "2026-03-20T17:00:00.000Z", ["s1"]));
    const r = coverage([packages[0]], [live, next], { now: T1 });
    expect(r.rows[0].rfqId).toBe(next.id);
    expect(r.rows[0].status).toBe("issued");
  });

  it("escalates when every vendor declined", () => {
    let live = ok(issue(rfq(), T0, T1));
    live = ok(respond(live, "v1", "declined", T1));
    live = ok(respond(live, "v2", "declined", T1));
    const r = coverage([packages[0]], [live], { now: T1 });
    const flag = r.flags.find((f) => f.code === "all_declined");
    expect(flag?.severity).toBe("critical");
  });
});
