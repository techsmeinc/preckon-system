// Revision intelligence.
//
// The failure this exists to stop: a changed fire rating between Rev B and Rev C
// reaching site because nobody could diff a 200-page specification by eye.
//
// These pin that the comparison is arithmetic rather than judgement, that
// extraction noise does not drown the real changes, and that the things which
// move money — dimensions, obligations, commercial figures — surface first.

import { describe, it, expect } from "vitest";
import {
  compareRevisionText, comparePage, classifyLine, isSignificant,
  normalise, reviewOrder, type ComparePage,
} from "@/lib/doc/compare";

const page = (n: number, ...lines: string[]): ComparePage => ({ page: n, lines });

describe("what a line looks like", () => {
  it("spots a dimension", () => {
    expect(classifyLine("Partition to be 150 mm thick")).toBe("dimension");
    expect(classifyLine("Blockwork 200x400 units")).toBe("dimension");
    expect(classifyLine("Fall to be 1:100 minimum")).toBe("dimension");
  });

  it("spots an obligation", () => {
    expect(classifyLine("The contractor shall provide access")).toBe("requirement");
    expect(classifyLine("Doors must be self-closing")).toBe("requirement");
  });

  it("spots a commercial figure", () => {
    expect(classifyLine("Provisional sum of AED 250,000")).toBe("commercial");
    expect(classifyLine("Liquidated damages apply")).toBe("commercial");
  });

  it("spots a cross-reference", () => {
    expect(classifyLine("Refer to Drawing A-201 for details")).toBe("reference");
    expect(classifyLine("See specification section 09 22 16")).toBe("reference");
  });

  it("spots a note", () => {
    /* "all dimensions to be verified" names dimensions but states none, so
       there is no measurement to check and it is correctly a note. The word is
       not the thing. */
    expect(classifyLine("NOTE: all dimensions to be verified on site")).toBe("note");
    // Points at a person, not a controlled document — nothing to follow.
    expect(classifyLine("Note: refer to architect")).toBe("note");
    expect(classifyLine("Notes apply throughout")).toBe("note");
  });

  it("falls back to plain text", () => {
    expect(classifyLine("General arrangement of the east wing")).toBe("text");
  });

  it("ranks a dimension above a note when both could apply", () => {
    /* Deliberately generous. A false "check this" costs a minute; a missed
       dimension change costs a variation nobody priced. */
    expect(classifyLine("NOTE: slab thickness 250 mm")).toBe("dimension");
  });

  it("treats dimensions, obligations and money as significant", () => {
    expect(isSignificant("dimension")).toBe(true);
    expect(isSignificant("requirement")).toBe(true);
    expect(isSignificant("commercial")).toBe(true);
    expect(isSignificant("note")).toBe(false);
    expect(isSignificant("text")).toBe(false);
  });
});

describe("noise that is not a change", () => {
  it("collapses whitespace differences", () => {
    /* Two extractions of the same untouched page routinely differ in spacing.
       Reporting those buries the real changes, which is how people stop reading
       diffs at all. */
    expect(normalise("The  contractor   shall")).toBe(normalise("The contractor shall"));
  });

  it("normalises smart quotes and dashes", () => {
    expect(normalise("“fire-rated”")).toBe(normalise('"fire-rated"'));
    expect(normalise("50–60mm")).toBe(normalise("50-60mm"));
  });

  it("reports nothing for a page that only changed its spacing", () => {
    const before = [page(1, "The contractor shall provide access")];
    const after = [page(1, "The  contractor  shall  provide access")];
    expect(compareRevisionText(before, after).changes).toHaveLength(0);
  });
});

describe("comparing a page", () => {
  it("finds an added line", () => {
    const c = comparePage(["one"], ["one", "two"], 1);
    expect(c).toHaveLength(1);
    expect(c[0].op).toBe("added");
    expect(c[0].after).toBe("two");
  });

  it("finds a removed line", () => {
    const c = comparePage(["one", "two"], ["one"], 1);
    expect(c).toHaveLength(1);
    expect(c[0].op).toBe("removed");
    expect(c[0].before).toBe("two");
  });

  it("pairs a rewording into one modification, not two changes", () => {
    /* Without pairing, a reworded sentence reports as an unrelated removal and
       addition and the reviewer cannot see it is one edit. */
    const c = comparePage(
      ["Partition to be 100 mm thick"],
      ["Partition to be 150 mm thick"],
      1,
    );
    expect(c).toHaveLength(1);
    expect(c[0].op).toBe("modified");
  });

  it("says what the numbers did", () => {
    // The thing a reviewer is actually looking for.
    const c = comparePage(["Slab 200 mm"], ["Slab 250 mm"], 1);
    expect(c[0].why).toMatch(/200.*became.*250/);
    expect(c[0].why).toMatch(/worth checking/i);
  });

  it("leaves unchanged lines alone", () => {
    const c = comparePage(["a", "b", "c"], ["a", "b", "c"], 1);
    expect(c).toHaveLength(0);
  });

  it("handles an empty page on either side", () => {
    expect(comparePage([], ["new"], 1)[0].op).toBe("added");
    expect(comparePage(["gone"], [], 1)[0].op).toBe("removed");
    expect(comparePage([], [], 1)).toHaveLength(0);
  });

  it("reports line numbers so the change can be found", () => {
    const c = comparePage(["a", "b", "c"], ["a", "c"], 1);
    expect(c[0].line).toBe(2);
  });
});

describe("comparing revisions", () => {
  const revB = [
    page(1, "General arrangement", "Partition to be 100 mm thick", "Notes apply throughout"),
    page(2, "The contractor shall provide access", "Refer to Drawing A-201"),
  ];
  const revC = [
    page(1, "General arrangement", "Partition to be 150 mm thick", "Notes apply throughout"),
    page(2, "The contractor shall provide access", "Refer to Drawing A-202", "Provisional sum of AED 250,000"),
  ];

  it("finds changes across pages", () => {
    const r = compareRevisionText(revB, revC);
    expect(r.changes.length).toBeGreaterThanOrEqual(3);
    expect(r.pagesAffected).toEqual([1, 2]);
  });

  it("counts by operation", () => {
    const r = compareRevisionText(revB, revC);
    expect(r.modified).toBeGreaterThanOrEqual(2);
    expect(r.added).toBeGreaterThanOrEqual(1);
  });

  it("counts what could move money", () => {
    const r = compareRevisionText(revB, revC);
    // The thickness change and the provisional sum.
    expect(r.significant).toBeGreaterThanOrEqual(2);
  });

  it("skips pages that did not change", () => {
    const same = compareRevisionText(revB, revB);
    expect(same.changes).toHaveLength(0);
    expect(same.summary).toMatch(/no text changes/i);
  });

  it("reports an inserted page wholesale", () => {
    const r = compareRevisionText(revB, [...revC, page(3, "New appendix")]);
    expect(r.pagesAffected).toContain(3);
  });

  it("reports a deleted page wholesale", () => {
    const r = compareRevisionText(revB, [revB[0]]);
    expect(r.pagesAffected).toContain(2);
    expect(r.changes.some((c) => c.op === "removed")).toBe(true);
  });

  it("summarises for the top of the screen", () => {
    const r = compareRevisionText(revB, revC);
    expect(r.summary).toMatch(/change/i);
    expect(r.summary).toMatch(/quantity, cost or obligation/i);
  });

  it("tallies by kind", () => {
    const r = compareRevisionText(revB, revC);
    expect(r.byKind.dimension).toBeGreaterThanOrEqual(1);
    expect(r.byKind.commercial).toBeGreaterThanOrEqual(1);
  });
});

describe("review order", () => {
  it("puts the significant changes first", () => {
    const before = [page(1, "Notes apply", "General text"), page(2, "Slab 200 mm")];
    const after = [page(1, "Notes revised", "General text amended"), page(2, "Slab 300 mm")];
    const ordered = reviewOrder(compareRevisionText(before, after));
    expect(ordered[0].significant).toBe(true);
  });

  it("then reads in page order", () => {
    const before = [page(1, "Slab 100 mm"), page(2, "Beam 200 mm")];
    const after = [page(1, "Slab 150 mm"), page(2, "Beam 250 mm")];
    const ordered = reviewOrder(compareRevisionText(before, after));
    expect(ordered[0].page).toBe(1);
    expect(ordered[1].page).toBe(2);
  });
});
