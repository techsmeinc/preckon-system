// Matching artifact type keys across namespaces.
//
// The bug this replaces is live today, not merely future-facing: `LIKE
// '%cost_line'` and `endsWith("cost_line")` do not respect segment boundaries,
// so `construction.extra_cost_line` matched a request for `cost_line`. With
// more than one domain pack installed it gets worse — construction, enterprise
// and insurance each define cost_line, a bare reference matches all three, and
// the caller gets whichever the database returned first.

import { describe, it, expect } from "vitest";
import {
  ambiguousMatches, isCanonical, isTypeMatch, matchesAnyType, shortType,
  typeMatchAnySql, typeMatchSql,
} from "@/lib/artifact-types";

describe("reading a type key", () => {
  it("takes the last segment as the short name", () => {
    expect(shortType("construction.cost_line")).toBe("cost_line");
    expect(shortType("cost_line")).toBe("cost_line");
  });

  it("knows a fully-qualified reference from a bare one", () => {
    expect(isCanonical("construction.cost_line")).toBe(true);
    expect(isCanonical("cost_line")).toBe(false);
  });
});

describe("matching", () => {
  it("matches a short name against its namespaced key", () => {
    expect(isTypeMatch("construction.cost_line", "cost_line")).toBe(true);
  });

  it("does NOT match a longer name that merely ends the same way", () => {
    // The whole point. `endsWith` said yes here, and it was wrong.
    expect(isTypeMatch("construction.extra_cost_line", "cost_line")).toBe(false);
    expect(isTypeMatch("construction.subcost_line", "cost_line")).toBe(false);
  });

  it("matches a canonical reference exactly, and nothing else", () => {
    expect(isTypeMatch("construction.cost_line", "construction.cost_line")).toBe(true);
    expect(isTypeMatch("enterprise.cost_line", "construction.cost_line")).toBe(false);
  });

  it("lets a short reference reach any namespace, which is why it is ambiguous", () => {
    expect(isTypeMatch("enterprise.cost_line", "cost_line")).toBe(true);
    expect(isTypeMatch("insurance.cost_line", "cost_line")).toBe(true);
  });

  it("ignores case, because pack authors are inconsistent about it", () => {
    expect(isTypeMatch("Construction.Cost_Line", "cost_line")).toBe(true);
  });

  it("refuses empty input rather than matching everything", () => {
    expect(isTypeMatch("", "cost_line")).toBe(false);
    expect(isTypeMatch("construction.cost_line", "")).toBe(false);
  });

  it("matches against a list", () => {
    expect(matchesAnyType("construction.cost_line", ["boq_line", "cost_line"])).toBe(true);
    expect(matchesAnyType("construction.cost_line", ["boq_line", "risk"])).toBe(false);
  });
});

describe("the SQL form follows the same rule", () => {
  it("compares a canonical reference for equality", () => {
    const m = typeMatchSql("type_key", "construction.cost_line");
    expect(m.sql).toBe("type_key = ?");
    expect(m.params).toEqual(["construction.cost_line"]);
  });

  it("puts a DOT in the pattern for a short reference", () => {
    // "%.cost_line" not "%cost_line" — that dot is the entire difference
    // between matching extra_cost_line and not.
    const m = typeMatchSql("type_key", "cost_line");
    expect(m.params).toEqual(["cost_line", "%.cost_line"]);
    expect(m.params[1].startsWith("%.")).toBe(true);
  });

  it("still allows the bare key, for a pack with no namespace", () => {
    expect(typeMatchSql("type_key", "cost_line").params).toContain("cost_line");
  });

  it("ORs a list together", () => {
    const m = typeMatchAnySql("type_key", ["cost_line", "enterprise.risk"]);
    expect(m.sql).toContain(" OR ");
    expect(m.params).toEqual(["cost_line", "%.cost_line", "enterprise.risk"]);
  });

  it("matches nothing for an empty list, rather than everything", () => {
    // A missing scope must not silently widen to the whole table.
    expect(typeMatchAnySql("type_key", []).sql).toBe("1 = 0");
  });
});

describe("ambiguity is detectable", () => {
  const installed = ["construction.cost_line", "enterprise.cost_line", "insurance.cost_line", "construction.risk"];

  it("names every candidate when a short reference is ambiguous", () => {
    expect(ambiguousMatches(installed, "cost_line")).toHaveLength(3);
  });

  it("reports none when only one pack defines it", () => {
    expect(ambiguousMatches(installed, "risk")).toEqual([]);
  });

  it("reports none for a canonical reference, which cannot be ambiguous", () => {
    expect(ambiguousMatches(installed, "construction.cost_line")).toEqual([]);
  });
});
