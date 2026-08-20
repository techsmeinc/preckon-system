// Retrieval.
//
// The `chunk` table has existed since the beginning with nothing writing to it,
// so every AI answer has come from whatever the caller put in the envelope.
//
// These pin the three properties that make retrieved evidence trustworthy:
// chunks break on meaning rather than length, an exact identifier beats a
// merely-similar passage, and the context budget is never silently exceeded.

import { describe, it, expect } from "vitest";
import {
  estimateTokens, chunkText, chunkDocument,
  extractIdentifiers, scoreCandidate, rank, packToBudget, cosine,
  type Candidate,
} from "@/lib/doc/retrieval";

describe("token estimate", () => {
  it("grows with length", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(estimateTokens("hi"));
  });

  it("is zero for nothing and never negative", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null as any)).toBe(0);
  });
});

describe("chunking breaks on meaning", () => {
  it("keeps a short paragraph whole", () => {
    const c = chunkText("The partition shall achieve a fire rating of 120 minutes.", 1, 0);
    expect(c).toHaveLength(1);
    expect(c[0].text).toMatch(/120 minutes/);
  });

  it("does not split a decimal across chunks", () => {
    /* The failure this prevents: "fire rating of" in one chunk and "120
       minutes" in another, so the retrieved evidence says the opposite of the
       document. */
    const text = "Slab thickness shall be 150.5 mm throughout. " .repeat(40);
    for (const c of chunkText(text, 1, 0, { target: 40, max: 80 })) {
      expect(c.text).not.toMatch(/150\.$/);
      expect(c.text).not.toMatch(/^5 mm/);
    }
  });

  it("does not treat an abbreviation as a sentence end", () => {
    const text = "Refer to Fig. 2 for the detail. " .repeat(30);
    const chunks = chunkText(text, 1, 0, { target: 30, max: 60 });
    expect(chunks.some((c) => /Fig\. 2/.test(c.text))).toBe(true);
  });

  it("prefers paragraph boundaries", () => {
    const text = "First clause about access.\n\nSecond clause about fire rating.";
    const c = chunkText(text, 1, 0, { target: 8, max: 20, overlap: 0 });
    expect(c.length).toBeGreaterThanOrEqual(2);
  });

  it("respects the hard ceiling", () => {
    const text = "word ".repeat(2000);
    for (const c of chunkText(text, 1, 0, { target: 100, max: 200 })) {
      expect(c.tokens).toBeLessThanOrEqual(200);   // max is a ceiling, not a target
    }
  });

  it("cuts inside a sentence only when the sentence alone exceeds the ceiling", () => {
    /* A single run-on clause with no terminator — the one place a hard cut is
       justified. Deliberately varied text: 4000 identical characters would cut
       into identical pieces, which the duplicate filter then collapses back to
       one, so it would prove nothing about cutting. */
    const monster = Array.from({ length: 400 }, (_, i) => `item${i}`).join(" ");
    const c = chunkText(monster, 1, 0, { target: 50, max: 100 });
    expect(c.length).toBeGreaterThan(1);
  });

  it("collapses pieces that come out byte-identical", () => {
    // Emitting the same text twice as separate evidence is worse than once.
    const repeated = "x".repeat(4000);
    const c = chunkText(repeated, 1, 0, { target: 50, max: 100 });
    expect(c).toHaveLength(1);
  });

  it("carries overlap so a fact spanning a seam survives whole", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Clause ${i} states a requirement.`).join(" ");
    const c = chunkText(text, 1, 0, { target: 40, max: 80, overlap: 20 });
    expect(c.length).toBeGreaterThan(1);
    // Consecutive chunks share some text.
    const first = c[0].text.split(/\s+/).slice(-3).join(" ");
    expect(c[1].text).toContain(first.split(/\s+/)[0]);
  });

  it("returns nothing for empty input", () => {
    expect(chunkText("", 1, 0)).toHaveLength(0);
    expect(chunkText("   ", 1, 0)).toHaveLength(0);
  });
});

describe("chunking a document", () => {
  it("keeps ordinals continuous across pages", () => {
    const chunks = chunkDocument([
      { page: 1, text: "Page one content about access." },
      { page: 2, text: "Page two content about fire rating." },
    ]);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps the page on each chunk, so evidence can be cited", () => {
    const chunks = chunkDocument([
      { page: 7, text: "Something on page seven." },
    ]);
    expect(chunks[0].page).toBe(7);
  });
});

describe("identifiers in the question", () => {
  it("finds a drawing number", () => {
    expect(extractIdentifiers("what does A-201 say about the lobby")).toContain("A-201");
  });

  it("finds a full ISO 19650 number", () => {
    expect(extractIdentifiers("check DXB01-ABC-ZZ-04-DR-M-0103")).toContain("DXB01-ABC-ZZ-04-DR-M-0103");
  });

  it("finds a MasterFormat section", () => {
    expect(extractIdentifiers("is section 09 22 16 priced")).toContain("09 22 16");
  });

  it("finds a bare sheet token", () => {
    expect(extractIdentifiers("open M103")).toContain("M103");
  });

  it("finds a level reference", () => {
    expect(extractIdentifiers("partitions on L04")).toContain("L04");
  });

  it("finds nothing in an ordinary question", () => {
    expect(extractIdentifiers("what is the fire rating of the corridor walls")).toHaveLength(0);
  });
});

describe("an exact identifier beats a similar passage", () => {
  const about: Candidate = { id: "a", text: "The lobby finishes are described in detail here.", similarity: 0.95 };
  const exact: Candidate = { id: "b", text: "Drawing A-201 shows the lobby layout.", similarity: 0.20 };

  it("ranks the literal match first", () => {
    /* The whole reason this is not a pure vector store: A-201 and A-210 are
       neighbours in embedding space and completely different drawings.
       Answering confidently about the wrong one is worse than not answering. */
    const ranked = rank("what does A-201 say about the lobby", [about, exact]);
    expect(ranked[0].id).toBe("b");
  });

  it("says why it won", () => {
    const ranked = rank("what does A-201 say about the lobby", [about, exact]);
    expect(ranked[0].why).toMatch(/names A-201/i);
    expect(ranked[0].matchedIdentifiers).toContain("A-201");
  });

  it("falls back to similarity when no identifier is present", () => {
    const ranked = rank("tell me about the lobby", [exact, about]);
    expect(ranked[0].id).toBe("a");
  });

  it("matches an identifier in the document number, not only the body", () => {
    const c: Candidate = { id: "c", text: "General notes.", documentNumber: "A-201" };
    expect(scoreCandidate("what is on A-201", c).matchedIdentifiers).toContain("A-201");
  });

  it("does not let a huge lexical score swamp an identifier match", () => {
    const loud: Candidate = { id: "loud", text: "lobby lobby lobby", lexical: 5000 };
    const named: Candidate = { id: "named", text: "See A-201.", lexical: 0.1 };
    expect(rank("A-201 lobby", [loud, named])[0].id).toBe("named");
  });

  it("is stable — the same question returns the same order", () => {
    const a: Candidate = { id: "x", text: "same", page: 1 };
    const b: Candidate = { id: "y", text: "same", page: 1 };
    expect(rank("q", [a, b]).map((c) => c.id)).toEqual(rank("q", [b, a]).map((c) => c.id));
  });
});

describe("packing to the context budget", () => {
  const mk = (id: string, text: string, score = 1) =>
    ({ id, text, score, matchedIdentifiers: [], why: "" } as any);

  it("never exceeds the budget", () => {
    /* AI Fabric section 10 is explicit: going over is not an option. Silently
       truncating inside the model is worse than returning less and saying so. */
    const items = Array.from({ length: 20 }, (_, i) => mk(String(i), "word ".repeat(100)));
    const packed = packToBudget(items, 300);
    expect(packed.tokensUsed).toBeLessThanOrEqual(300);
  });

  it("takes the best first", () => {
    const packed = packToBudget([mk("best", "short", 10), mk("worse", "short", 1)], 1000);
    expect(packed.chosen[0].id).toBe("best");
  });

  it("skips near-duplicates", () => {
    /* Tender documents repeat boilerplate across sections. Three copies of the
       same clause crowd out the paragraph that would have answered the
       question. */
    const dup = "The contractor shall provide access to all areas at all times.";
    const packed = packToBudget([mk("a", dup), mk("b", dup), mk("c", "Something else entirely.")], 1000);
    expect(packed.chosen).toHaveLength(2);
    expect(packed.dropped).toBe(1);
  });

  it("reports what it left out", () => {
    const items = Array.from({ length: 10 }, (_, i) => mk(String(i), "word ".repeat(100)));
    const packed = packToBudget(items, 200);
    expect(packed.dropped).toBeGreaterThan(0);
    expect(packed.why).toMatch(/left out/i);
  });

  it("says so plainly when there is no evidence", () => {
    expect(packToBudget([], 500).why).toMatch(/no evidence/i);
  });

  it("drops an item too large for the budget rather than trimming it", () => {
    // A half-clause is evidence for a claim the document does not make.
    const packed = packToBudget([mk("big", "word ".repeat(1000))], 50);
    expect(packed.chosen).toHaveLength(0);
    expect(packed.dropped).toBe(1);
  });
});

describe("cosine similarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("is 0 rather than NaN for degenerate input", () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});
