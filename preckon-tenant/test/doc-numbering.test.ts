// Document numbering.
//
// The number is the document's identity on a construction project — it is how
// the thing is filed, routed, transmitted and found. These pin the rules that
// make a number trustworthy: it round-trips, it cannot collide, and a scheme
// that would produce an unparseable number is refused before any document
// carries one.

import { describe, it, expect } from "vitest";
import {
  ISO19650_SCHEME, DEFAULT_ABSENT,
  formatNumber, parseNumber, validateScheme, validateValues,
  nextSequence, isReserved, exampleNumber, sequenceSegment,
  type NumberingScheme,
} from "@/lib/doc/numbering";

const simple: NumberingScheme = {
  key: "simple",
  name: "Simple",
  separator: "-",
  segments: [
    { key: "project", label: "Project", kind: "fixed", value: "DXB01" },
    { key: "disc", label: "Discipline", kind: "enum", values: ["A", "M", "E"] },
    { key: "num", label: "Number", kind: "sequence", width: 4 },
  ],
};

// A volume of "01" rather than "ZZ": ZZ is the absent placeholder, and in
// ISO 19650 it already means "no volume applicable", so a supplied ZZ and an
// omitted volume are the same statement. Pinned explicitly further down.
const full = () => ({
  project: "DXB01", originator: "ABC", volume: "01", level: "04",
  type: "DR", role: "M", number: "103",
});

describe("building a number", () => {
  it("joins the segments in scheme order", () => {
    expect(formatNumber(simple, { disc: "M", num: "103" })).toBe("DXB01-M-0103");
  });

  it("zero-pads the sequence to the declared width", () => {
    // Otherwise sheets sort as 1, 10, 100, 2 in every register and file listing.
    expect(formatNumber(simple, { disc: "A", num: "7" })).toBe("DXB01-A-0007");
  });

  it("builds a full ISO 19650 number", () => {
    expect(formatNumber(ISO19650_SCHEME, full())).toBe("DXB01-ABC-01-04-DR-M-0103");
  });

  it("refuses rather than emitting a broken number", () => {
    /* A malformed number reaching the register costs far more than a rejected
       form: every downstream reference is wrong and renumbering a live project
       is not a small job. */
    expect(() => formatNumber(simple, { disc: "X", num: "1" })).toThrow(/not one of the allowed values/i);
  });

  it("requires the sequence", () => {
    expect(() => formatNumber(simple, { disc: "A" })).toThrow(/required/i);
  });
});

describe("absent optional segments", () => {
  it("emit a placeholder rather than collapsing the position", () => {
    /* The whole reason: a variable number of parts cannot be parsed back, and
       two different documents could format to the same string. */
    const v = { ...full(), level: "" };
    expect(formatNumber(ISO19650_SCHEME, v)).toBe(`DXB01-ABC-01-${DEFAULT_ABSENT}-DR-M-0103`);
  });

  it("keep the separator count fixed however many are absent", () => {
    const v = { ...full(), volume: "", level: "" };
    const out = formatNumber(ISO19650_SCHEME, v);
    expect(out.split("-")).toHaveLength(ISO19650_SCHEME.segments.length);
  });

  it("treats a supplied placeholder as absent, because it says the same thing", () => {
    /* ZZ is not a workaround here — ISO 19650 already uses it to mean "no
       volume applicable". So a person who selects ZZ and a person who leaves
       the field empty have made the same statement, and the parsed value must
       not depend on which route they took. */
    const back = parseNumber(ISO19650_SCHEME, "DXB01-ABC-ZZ-04-DR-M-0103");
    expect(back.ok).toBe(true);
    expect(back.values.volume).toBeUndefined();
  });

  it("come back absent, not as the placeholder", () => {
    // So parse(format(x)) returns what the caller actually supplied.
    const v = { ...full(), level: "" };
    const back = parseNumber(ISO19650_SCHEME, formatNumber(ISO19650_SCHEME, v));
    expect(back.ok).toBe(true);
    expect(back.values.level).toBeUndefined();
  });
});

describe("reading a number back", () => {
  it("round-trips every segment", () => {
    const v = full();
    const back = parseNumber(ISO19650_SCHEME, formatNumber(ISO19650_SCHEME, v));
    expect(back.ok).toBe(true);
    expect(back.values).toMatchObject({
      project: "DXB01", originator: "ABC", volume: "01", level: "04",
      type: "DR", role: "M", number: "103",
    });
  });

  it("strips the padding, so the value is the number not its rendering", () => {
    const back = parseNumber(simple, "DXB01-A-0007");
    expect(back.values.num).toBe("7");
  });

  it("rejects the wrong number of parts", () => {
    const back = parseNumber(simple, "DXB01-A");
    expect(back.ok).toBe(false);
    expect(back.issues[0].message).toMatch(/expected 3 parts/i);
  });

  it("rejects a value outside a closed list", () => {
    expect(parseNumber(simple, "DXB01-Q-0001").ok).toBe(false);
  });

  it("rejects a non-numeric sequence", () => {
    expect(parseNumber(simple, "DXB01-A-ABCD").ok).toBe(false);
  });

  it("checks the fixed segment actually matches", () => {
    // A number from another project must not validate against this scheme.
    const back = parseNumber(simple, "AUH02-A-0001");
    expect(back.ok).toBe(false);
    expect(back.issues[0].message).toMatch(/expected "DXB01"/i);
  });
});

describe("scheme validation", () => {
  it("accepts the seeded ISO 19650 scheme", () => {
    expect(validateScheme(ISO19650_SCHEME)).toEqual([]);
  });

  it("refuses a value containing the separator", () => {
    /* Caught at scheme-authoring time, which is the only point the mistake is
       cheap — the number would otherwise split into the wrong parts forever. */
    const bad: NumberingScheme = {
      ...simple,
      segments: [{ key: "d", label: "D", kind: "enum", values: ["A-B"] }, ...simple.segments.slice(1)],
    };
    expect(validateScheme(bad).some((i) => /contains the separator/i.test(i.message))).toBe(true);
  });

  it("requires exactly one sequence segment", () => {
    const none: NumberingScheme = { ...simple, segments: simple.segments.slice(0, 2) };
    expect(validateScheme(none).some((i) => /exactly one sequence/i.test(i.message))).toBe(true);

    const two: NumberingScheme = {
      ...simple,
      segments: [...simple.segments, { key: "n2", label: "N2", kind: "sequence" }],
    };
    expect(validateScheme(two).some((i) => /exactly one sequence/i.test(i.message))).toBe(true);
  });

  it("refuses an optional sequence", () => {
    const bad: NumberingScheme = {
      ...simple,
      segments: [simple.segments[0], simple.segments[1],
                 { key: "num", label: "Number", kind: "sequence", optional: true }],
    };
    expect(validateScheme(bad).some((i) => /cannot be optional/i.test(i.message))).toBe(true);
  });

  it("catches duplicate segment keys", () => {
    const bad: NumberingScheme = { ...simple, segments: [...simple.segments, { ...simple.segments[1] }] };
    expect(validateScheme(bad).some((i) => /duplicate segment/i.test(i.message))).toBe(true);
  });

  it("catches a backwards reserved range", () => {
    const bad: NumberingScheme = { ...simple, reserved: [{ from: 500, to: 100 }] };
    expect(validateScheme(bad).some((i) => /backwards/i.test(i.message))).toBe(true);
  });

  it("finds the sequence segment", () => {
    expect(sequenceSegment(simple)?.key).toBe("num");
  });
});

describe("allocating the next number", () => {
  it("starts at 1 on an empty project", () => {
    expect(nextSequence(simple, [])).toBe(1);
  });

  it("fills a gap left by a deleted document", () => {
    // Registers are dense by convention; a hole is a question somebody asks.
    expect(nextSequence(simple, [1, 2, 4])).toBe(3);
  });

  it("skips a reserved block", () => {
    /* Employers reserve ranges, and legacy paper registers already used some.
       Allocating into either produces a real-world collision. */
    const s: NumberingScheme = { ...simple, reserved: [{ from: 1, to: 99 }] };
    expect(nextSequence(s, [])).toBe(100);
  });

  it("skips reserved blocks that sit in the middle", () => {
    const s: NumberingScheme = { ...simple, reserved: [{ from: 3, to: 5 }] };
    expect(nextSequence(s, [1, 2])).toBe(6);
  });

  it("honours an explicit starting point", () => {
    expect(nextSequence(simple, [], 500)).toBe(500);
  });

  it("reports membership of a reserved range", () => {
    const s: NumberingScheme = { ...simple, reserved: [{ from: 10, to: 20 }] };
    expect(isReserved(s, 10)).toBe(true);
    expect(isReserved(s, 20)).toBe(true);
    expect(isReserved(s, 21)).toBe(false);
  });

  it("refuses a reserved value supplied by hand", () => {
    const s: NumberingScheme = { ...simple, reserved: [{ from: 1, to: 99 }] };
    expect(validateValues(s, { disc: "A", num: "50" }).some((i) => /reserved/i.test(i.message))).toBe(true);
  });
});

describe("validation reports everything at once", () => {
  it("does not stop at the first problem", () => {
    // A registration form should not be whack-a-mole.
    const issues = validateValues(ISO19650_SCHEME, { project: "DXB01", type: "ZZ", role: "9" });
    expect(issues.length).toBeGreaterThan(2);
  });

  it("rejects a value containing the separator", () => {
    const issues = validateValues(simple, { disc: "A", num: "1-2" });
    expect(issues.some((i) => /cannot contain/i.test(i.message))).toBe(true);
  });
});

describe("worked example for the scheme editor", () => {
  it("renders a plausible number", () => {
    expect(exampleNumber(simple)).toBe("DXB01-A-0001");
  });

  it("is parseable by its own scheme", () => {
    expect(parseNumber(ISO19650_SCHEME, exampleNumber(ISO19650_SCHEME)).ok).toBe(true);
  });
});
