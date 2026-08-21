// Grounding the technical narrative.
//
// The finding that matters most is the contradiction: prose saying 14 weeks
// against a baseline saying 18. The evaluator holds both documents and will
// find it in thirty seconds, and once they have, every other number in the
// submission is suspect.
//
// The unit comparison is the part a plausible implementation gets wrong. 18
// weeks and 18 days are not the same claim, and a checker ignoring units
// reports contradictions as agreement about as often as the reverse.

import { describe, it, expect } from "vitest";
import { review, reviewSection, claimsIn, type GroundingFact, type NarrativeSection } from "@/lib/tender/narrative";

const fact = (over: Partial<GroundingFact> = {}): GroundingFact => ({
  artifactId: "prog-1", label: "the piling duration on the baseline",
  value: 18, unit: "weeks", ...over,
});

const section = (over: Partial<NarrativeSection> = {}): NarrativeSection => ({
  section: "programme", title: "Programme and sequencing",
  bodyMd: "Piling is planned over 18 weeks, sequenced from the south-east corner.",
  groundedIn: ["prog-1"], ...over,
});

describe("pulling checkable claims out of prose", () => {
  it("finds a hyphenated figure, the form submissions actually use", () => {
    const c = claimsIn("Our 14-week piling programme starts in March.");
    expect(c[0]).toMatchObject({ value: 14, unit: "week" });
  });

  it("finds spelled-out numbers a digit regex would miss", () => {
    const c = claimsIn("Piling runs over fourteen weeks.");
    expect(c.some((x) => x.value === 14 && x.unit === "week")).toBe(true);
  });

  it("ignores a spelled-out number with no comparable unit", () => {
    // "three teams" is not something an artifact can contradict.
    expect(claimsIn("We will deploy three teams.").some((c) => c.value === 3)).toBe(false);
  });

  it("normalises unit spellings", () => {
    expect(claimsIn("847 m² of blockwork")[0].unit).toBe("m2");
    expect(claimsIn("847 sqm of blockwork")[0].unit).toBe("m2");
  });

  it("carries the sentence, so a writer can find the phrase", () => {
    const c = claimsIn("An intro sentence. Our 14-week programme is efficient. Another.");
    expect(c[0].excerpt).toBe("Our 14-week programme is efficient.");
  });
});

describe("contradictions", () => {
  it("catches prose that disagrees with the artifact it cites", () => {
    const r = reviewSection(
      section({ bodyMd: "Our 14-week piling programme is fully resourced." }),
      [fact()],
    );
    const c = r.findings.find((f) => f.kind === "contradiction")!;
    expect(c.severity).toBe("high");
    expect(c.detail).toMatch(/says 14 week but the piling duration on the baseline is 18/);
    expect(c.detail).toMatch(/makes every other figure in it suspect/);
  });

  it("does not compare weeks with days", () => {
    /* 18 weeks and 18 days are different claims. A checker that ignored units
       would call this a match. */
    const r = reviewSection(
      section({ bodyMd: "Piling takes 18 days." }),
      [fact({ value: 18, unit: "weeks" })],
    );
    expect(r.findings.some((f) => f.kind === "contradiction")).toBe(false);
    expect(r.matchedFacts).toBe(0);
  });

  it("accepts a figure that matches", () => {
    const r = reviewSection(section(), [fact()]);
    expect(r.findings.filter((f) => f.kind === "contradiction")).toEqual([]);
    expect(r.matchedFacts).toBe(1);
    expect(r.verdict).toMatch(/check out against the cited evidence/);
  });

  it("does not call an unverifiable number wrong", () => {
    // A figure with no comparable fact is unverifiable, not incorrect.
    // Reporting it as incorrect trains people to ignore the whole report.
    const r = reviewSection(
      section({ bodyMd: "Piling is planned over 18 weeks across 4200 m2 of slab." }),
      [fact()],
    );
    expect(r.findings.some((f) => f.kind === "contradiction")).toBe(false);
  });

  it("only checks against the artifacts the section actually cites", () => {
    // Checking against everything would let a section be "supported" by a
    // document it never read.
    const r = reviewSection(
      section({ bodyMd: "Piling takes 14 weeks.", groundedIn: ["other-doc"] }),
      [fact({ artifactId: "prog-1" })],
    );
    expect(r.findings.some((f) => f.kind === "contradiction")).toBe(false);
  });
});

describe("sections written against nothing", () => {
  it("flags a section citing no evidence", () => {
    const r = reviewSection(section({ groundedIn: [] }), [fact()]);
    const f = r.findings.find((x) => x.kind === "ungrounded")!;
    expect(f.detail).toMatch(/no way to tell whether it describes this job/);
  });

  it("treats a long ungrounded section as worse than a short one", () => {
    const long = reviewSection(
      section({ groundedIn: [], bodyMd: "We are committed to excellence. ".repeat(50) }), []);   // 200 words
    const short = reviewSection(section({ groundedIn: [], bodyMd: "Short note." }), []);
    expect(long.findings.find((f) => f.kind === "ungrounded")!.severity).toBe("high");
    expect(short.findings.find((f) => f.kind === "ungrounded")!.severity).toBe("medium");
  });
});

describe("boilerplate", () => {
  const filler = "We are committed to delivering excellence through our proven methodology and our experienced team, working in partnership with the client to achieve a successful outcome that meets and exceeds every expectation across the whole of the works and the wider programme of activity. ".repeat(2);

  it("flags a long section with nothing specific in it", () => {
    const r = reviewSection(section({ bodyMd: filler }), [fact()]);
    const f = r.findings.find((x) => x.kind === "boilerplate")!;
    expect(f.detail).toMatch(/could only be true of this job/);
    expect(f.detail).toMatch(/Name the actual quantities/);
  });

  it("leaves a short section alone — brevity is not filler", () => {
    const r = reviewSection(section({ bodyMd: "Piling follows the enabling works." }), [fact()]);
    expect(r.findings.some((f) => f.kind === "boilerplate")).toBe(false);
  });

  it("counts a named artifact reference as specific content", () => {
    const named = `The works at Cedarstone Phase 2 proceed as follows. ${filler}`;
    const withName = reviewSection(section({ bodyMd: named }), [
      fact({ value: null, text: "Cedarstone Phase 2", label: "project name" }),
    ]);
    const without = reviewSection(section({ bodyMd: named }), [fact()]);
    expect(withName.specificityPer100).toBeGreaterThan(without.specificityPer100);
  });
});

describe("citing evidence that supports nothing", () => {
  it("distinguishes decorative citations from no citations", () => {
    const r = reviewSection(
      section({ bodyMd: "The slab covers 4200 m2 and the frame 900 t." }),
      [fact()],   // cited, but nothing here is in weeks
    );
    const f = r.findings.find((x) => x.kind === "unsupported")!;
    expect(f.detail).toMatch(/citations are decorative or the numbers came from somewhere nobody recorded/);
  });
});

describe("scoring", () => {
  it("penalises a contradiction more than filler", () => {
    const contradicting = reviewSection(section({ bodyMd: "Piling takes 14 weeks." }), [fact()]);
    const bland = reviewSection(
      section({ bodyMd: "We are committed to excellence in all that we undertake. ".repeat(10) }), [fact()]);
    expect(contradicting.groundedScore).toBeLessThan(bland.groundedScore);
  });

  it("rewards a section whose figures check out", () => {
    expect(reviewSection(section(), [fact()]).groundedScore).toBe(100);
  });

  it("never goes below zero", () => {
    const r = reviewSection(
      section({ groundedIn: [], bodyMd: "Piling takes 14 weeks. ".repeat(40) }), [fact()]);
    expect(r.groundedScore).toBeGreaterThanOrEqual(0);
  });
});

describe("the whole narrative", () => {
  it("leads with contradictions", () => {
    const r = review([
      section({ section: "programme", bodyMd: "Piling takes 14 weeks." }),
      section({ section: "quality", bodyMd: "Piling takes 18 weeks." }),
    ], [fact()]);
    expect(r.contradictions).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/puts every other number in the submission in doubt/);
  });

  it("says when the whole narrative is unverifiable", () => {
    const r = review([
      section({ section: "quality", groundedIn: [] }),
      section({ section: "hse", groundedIn: [] }),
    ], [fact()]);
    expect(r.warnings.some((w) => /whole narrative is unverifiable/.test(w))).toBe(true);
  });

  it("points out that filler is the cheapest thing in a bid to fix", () => {
    const filler = "We are committed to excellence in partnership with our client throughout the duration of the works and beyond. ".repeat(6);   // 108 words, past the 80-word floor
    const r = review([
      section({ section: "quality", bodyMd: filler }),
      section({ section: "hse", bodyMd: filler }),
    ], [fact()]);
    expect(r.warnings.some((w) => /cheapest thing in a bid to fix/.test(w))).toBe(true);
  });

  it("says plainly when everything is grounded", () => {
    const r = review([section()], [fact()]);
    expect(r.summary).toMatch(/all grounded in the evidence they cite/);
    expect(r.overallScore).toBe(100);
  });

  it("handles an empty narrative", () => {
    expect(review([], []).summary).toBe("No narrative sections to review.");
  });
});
