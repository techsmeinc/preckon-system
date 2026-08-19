// Formal document revisions.
//
// These pin the four rules that separate a CDE from a folder of files: exactly
// one current revision, superseded revisions immutable, issued revisions frozen,
// and "latest" meaning latest by contract rather than by upload time.

import { describe, it, expect } from "vitest";
import {
  ALPHA_LETTERS, SUITABILITY,
  parseRevision, formatRevision, isValidRevision, compareRevisions,
  nextRevision, promoteRevision, latestRevision,
  planSupersession, canEdit, editBlockedReason, isPublishedSuitability,
  type RevisionRow,
} from "@/lib/doc/revision";

describe("alpha revisions", () => {
  it("skips I and O", () => {
    /* At drawing scale on a printed title block, revision I is indistinguishable
       from 1 and O from 0. The ambiguity gets resolved on site by guessing. */
    expect(ALPHA_LETTERS).not.toContain("I");
    expect(ALPHA_LETTERS).not.toContain("O");
    expect(isValidRevision("alpha", "I")).toBe(false);
    expect(isValidRevision("alpha", "O")).toBe(false);
  });

  it("advances past the skipped letters", () => {
    expect(nextRevision("alpha", "H")).toBe("J");
    expect(nextRevision("alpha", "N")).toBe("P");
  });

  it("starts at A", () => {
    expect(nextRevision("alpha", null)).toBe("A");
  });

  it("continues past Z", () => {
    expect(nextRevision("alpha", "Z")).toBe("AA");
    expect(nextRevision("alpha", "AA")).toBe("AB");
  });

  it("round-trips every code it generates", () => {
    let code = nextRevision("alpha", null);
    for (let i = 0; i < 60; i++) {
      const p = parseRevision("alpha", code)!;
      expect(formatRevision("alpha", p)).toBe(code);
      code = nextRevision("alpha", code);
    }
  });

  it("orders correctly across the skips", () => {
    expect(compareRevisions("alpha", "J", "H")).toBeGreaterThan(0);
    expect(compareRevisions("alpha", "AA", "Z")).toBeGreaterThan(0);
    expect(compareRevisions("alpha", "B", "B")).toBe(0);
  });
});

describe("numeric revisions", () => {
  it("starts at 01 and pads", () => {
    expect(nextRevision("numeric", null)).toBe("01");
    expect(nextRevision("numeric", "01")).toBe("02");
    expect(nextRevision("numeric", "09")).toBe("10");
  });

  it("rejects zero", () => {
    expect(isValidRevision("numeric", "00")).toBe(false);
  });
});

describe("ISO 19650 revisions", () => {
  it("starts preliminary at P01", () => {
    expect(nextRevision("iso19650", null)).toBe("P01");
    expect(nextRevision("iso19650", "P01")).toBe("P02");
  });

  it("promotes to C01 on acceptance, restarting the count", () => {
    /* C01 is the first construction issue whatever the drafting history was.
       Carrying P07 across to C07 would imply six construction issues that never
       happened. */
    expect(promoteRevision("iso19650", "P07")).toBe("C01");
  });

  it("continues the contractual series once promoted", () => {
    expect(promoteRevision("iso19650", "C01")).toBe("C02");
    expect(nextRevision("iso19650", "C01")).toBe("C02");
  });

  it("ranks any C above any P", () => {
    /* The important one. Comparing on the number alone puts P99 above C01 and
       makes "latest" wrong at exactly the moment it matters most — the document
       has just been accepted for construction. */
    expect(compareRevisions("iso19650", "C01", "P99")).toBeGreaterThan(0);
  });

  it("orders within a family by number", () => {
    expect(compareRevisions("iso19650", "P10", "P09")).toBeGreaterThan(0);
    expect(compareRevisions("iso19650", "C02", "C10")).toBeLessThan(0);
  });

  it("rejects a malformed code", () => {
    expect(isValidRevision("iso19650", "X01")).toBe(false);
    expect(isValidRevision("iso19650", "P1")).toBe(false);   // needs two digits
    expect(isValidRevision("iso19650", "P00")).toBe(false);
  });

  it("refuses to promote under another scheme", () => {
    expect(() => promoteRevision("alpha", "A")).toThrow(/ISO 19650/i);
  });
});

describe("latest revision", () => {
  it("is by scheme order, not by upload time", () => {
    // The list is deliberately out of order: a re-upload of an old revision must
    // not make it current.
    expect(latestRevision("iso19650", ["P02", "C01", "P99"])).toBe("C01");
    expect(latestRevision("alpha", ["C", "A", "B"])).toBe("C");
  });

  it("ignores codes that are not valid for the scheme", () => {
    expect(latestRevision("alpha", ["A", "I", "B"])).toBe("B");
  });

  it("is null when there is nothing valid", () => {
    expect(latestRevision("alpha", [])).toBeNull();
    expect(latestRevision("numeric", ["rev-x"])).toBeNull();
  });
});

describe("supersession", () => {
  const rows = (...specs: [string, RevisionRow["state"]][]): RevisionRow[] =>
    specs.map(([code, state]) => ({ code, state }));

  it("makes the incoming revision current and supersedes the previous one", () => {
    const plan = planSupersession("alpha", rows(["A", "superseded"], ["B", "current"]), "C");
    expect(plan.current).toBe("C");
    expect(plan.superseded).toEqual(["B"]);
  });

  it("leaves already-superseded revisions alone", () => {
    const plan = planSupersession("alpha", rows(["A", "superseded"], ["B", "current"]), "C");
    expect(plan.unchanged).toContain("A");
  });

  it("does not touch drafts", () => {
    /* A draft is somebody's unfinished work. Superseding it because a colleague
       issued a later revision deletes work that was never in the contractual
       series to begin with. */
    const plan = planSupersession("alpha", rows(["B", "current"], ["D", "draft"]), "C");
    expect(plan.unchanged).toContain("D");
    expect(plan.superseded).toEqual(["B"]);
  });

  it("warns when the incoming code ranks below what it supersedes", () => {
    // Usually a typo. Allowed, because back-issuing happens, but never silent.
    const plan = planSupersession("alpha", rows(["D", "current"]), "B");
    expect(plan.why).toMatch(/ranks above it/i);
  });

  it("says so plainly for a first issue", () => {
    expect(planSupersession("alpha", [], "A").why).toMatch(/first current revision/i);
  });

  it("refuses an invalid incoming code", () => {
    expect(() => planSupersession("alpha", [], "I")).toThrow(/not a valid/i);
  });
});

describe("immutability", () => {
  it("blocks editing a superseded revision", () => {
    const r: RevisionRow = { code: "B", state: "superseded" };
    expect(canEdit(r)).toBe(false);
    expect(editBlockedReason(r)).toMatch(/record of what was issued/i);
  });

  it("blocks editing a transmitted revision even while it is current", () => {
    /* The recipient holds a copy. A register that says something different from
       the drawing on the consultant's desk is worse than no register. */
    const r: RevisionRow = { code: "C", state: "current", frozen: true };
    expect(canEdit(r)).toBe(false);
    expect(editBlockedReason(r)).toMatch(/recipient holds this one/i);
  });

  it("allows editing a current revision that has not been issued", () => {
    expect(canEdit({ code: "C", state: "current" })).toBe(true);
  });

  it("allows editing a draft", () => {
    expect(canEdit({ code: "D", state: "draft" })).toBe(true);
  });
});

describe("purpose of issue", () => {
  it("separates work in progress from published", () => {
    expect(isPublishedSuitability("S3")).toBe(false);
    expect(isPublishedSuitability("A1")).toBe(true);
    expect(isPublishedSuitability("D2")).toBe(true);
  });

  it("treats as-constructed as published", () => {
    expect(isPublishedSuitability("CR")).toBe(true);
  });

  it("is case insensitive and safe on nonsense", () => {
    expect(isPublishedSuitability("d1")).toBe(true);
    expect(isPublishedSuitability("nope")).toBe(false);
  });

  it("carries a label for every code", () => {
    for (const [code, v] of Object.entries(SUITABILITY)) {
      expect(v.label.length, code).toBeGreaterThan(0);
    }
  });
});
