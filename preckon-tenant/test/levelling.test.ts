// Resource levelling.
//
// Two properties matter more than any individual case, and both are the kind
// that a plausible-looking implementation gets wrong:
//
//   Levelling must never violate the logic. A plan that fixes the histogram by
//   starting an activity before its predecessor finishes looks feasible and
//   cannot be built.
//
//   Levelling must be honest about what it cost. Moving within float is free;
//   moving beyond it delays completion. A result that blends the two is
//   worthless to the person who has to tell the client.

import { describe, it, expect } from "vitest";
import { level, asProposal, type LevellingActivity } from "@/lib/programme/levelling";
import type { Availability } from "@/lib/programme/resources";

const act = (
  key: string, earlyStart: number, duration: number, totalFloat: number,
  demands?: { role: string; units: number }[], predecessors?: string[],
): LevellingActivity => ({ key, name: key, earlyStart, duration, totalFloat, demands, predecessors });

const have = (role: string, units: number): Availability => ({ role, units });

describe("when nothing is over-committed", () => {
  it("moves nothing and says so", () => {
    const r = level(
      [act("a", 0, 2, 0, [{ role: "brickie", units: 2 }])],
      [have("brickie", 4)],
    );
    expect(r.moves).toEqual([]);
    expect(r.delayDays).toBe(0);
    expect(r.feasible).toBe(true);
    expect(r.summary).toMatch(/No levelling needed/);
  });
});

describe("levelling within float is free", () => {
  it("delays the slack activity, not the tight one, and keeps the end date", () => {
    // Two activities both want 3 brickies on day 0; only 3 exist. `tight` has no
    // float and must not move; `slack` has 10 days of float and can wait.
    const r = level(
      [
        act("tight", 0, 2, 0, [{ role: "brickie", units: 3 }]),
        act("slack", 0, 2, 10, [{ role: "brickie", units: 3 }]),
      ],
      [have("brickie", 3)],
    );
    expect(r.moves.map((m) => m.key)).toEqual(["slack"]);
    expect(r.moves[0].toDay).toBe(2);
    expect(r.moves[0].beyondFloat).toBe(false);
    expect(r.delayDays).toBe(0);
    expect(r.costlyMoves).toEqual([]);
    expect(r.summary).toMatch(/completion date is unchanged/);
  });

  it("halves the peak it was asked to level", () => {
    const r = level(
      [
        act("a", 0, 2, 0, [{ role: "brickie", units: 3 }]),
        act("b", 0, 2, 10, [{ role: "brickie", units: 3 }]),
      ],
      [have("brickie", 3)],
    );
    const peak = r.peaks.find((p) => p.role === "brickie")!;
    expect(peak.before).toBe(6);
    expect(peak.after).toBe(3);
  });
});

describe("levelling beyond float costs time, and says how much", () => {
  it("reports the delay separately from the free moves", () => {
    // Both activities are critical. One has to give, and it moves the end date.
    const r = level(
      [
        act("a", 0, 3, 0, [{ role: "crane", units: 1 }]),
        act("b", 0, 3, 0, [{ role: "crane", units: 1 }]),
      ],
      [have("crane", 1)],
    );
    expect(r.costlyMoves).toHaveLength(1);
    expect(r.costlyMoves[0].beyondFloat).toBe(true);
    expect(r.durationBefore).toBe(3);
    expect(r.durationAfter).toBe(6);
    expect(r.delayDays).toBe(3);
    expect(r.summary).toMatch(/Completion moves out by 3 day/);
  });

  it("explains the overrun in float terms, not just days", () => {
    const r = level(
      [
        act("a", 0, 4, 0, [{ role: "crane", units: 1 }]),
        act("b", 0, 4, 1, [{ role: "crane", units: 1 }]),
      ],
      [have("crane", 1)],
    );
    // Delayed 4 days against 1 day of float: 3 beyond.
    expect(r.moves[0].why).toMatch(/3 beyond its 1 day\(s\) of float/);
  });
});

describe("logic survives levelling", () => {
  it("never starts an activity before its predecessor finishes", () => {
    const r = level(
      [
        act("first", 0, 3, 0, [{ role: "gang", units: 1 }]),
        act("second", 3, 2, 0, [{ role: "gang", units: 1 }], ["first"]),
      ],
      [have("gang", 1)],
    );
    expect(r.moves).toEqual([]);   // already sequenced; nothing to level
    expect(r.durationAfter).toBe(5);
  });

  it("places a slack predecessor before its tight successor", () => {
    /* The case a float-only ordering gets wrong. `pred` has plenty of float and
       `succ` has none, so pure priority order would place `succ` FIRST — against
       a predecessor finish date that had not been decided yet, and which the
       later placement of `pred` then moves. The result looks levelled and
       violates the logic. */
    const r = level(
      [
        act("succ", 5, 2, 0, [{ role: "gang", units: 2 }], ["pred"]),
        act("pred", 0, 5, 20, [{ role: "gang", units: 2 }]),
        act("hog", 0, 5, 20, [{ role: "gang", units: 2 }]),
      ],
      [have("gang", 2)],
    );
    const start = (k: string) =>
      r.moves.find((m) => m.key === k)?.toDay ??
      [{ k: "succ", d: 5 }, { k: "pred", d: 0 }, { k: "hog", d: 0 }].find((x) => x.k === k)!.d;
    // Whatever the resource contention did, succ cannot begin before pred ends.
    expect(start("succ")).toBeGreaterThanOrEqual(start("pred") + 5);
  });

  it("carries a cascade down a chain", () => {
    // `blocker` monopolises the gang, so `a` waits, and `b` waits on `a`.
    const r = level(
      [
        act("blocker", 0, 4, 0, [{ role: "gang", units: 2 }]),
        act("a", 0, 2, 10, [{ role: "gang", units: 2 }]),
        act("b", 2, 2, 10, [{ role: "gang", units: 2 }], ["a"]),
      ],
      [have("gang", 2)],
    );
    const a = r.moves.find((m) => m.key === "a")!;
    const b = r.moves.find((m) => m.key === "b")!;
    expect(a.toDay).toBe(4);
    expect(b.toDay).toBeGreaterThanOrEqual(a.toDay + 2);
  });
});

describe("what cannot be levelled at all", () => {
  it("names the role rather than inventing a date", () => {
    // 5 needed, 2 exist, for ever. No amount of delay fixes this — it needs more
    // resource, and saying so is the only useful answer.
    const r = level(
      [act("a", 0, 2, 0, [{ role: "brickie", units: 5 }])],
      [have("brickie", 2)],
    );
    expect(r.feasible).toBe(false);
    expect(r.unresolved).toEqual(["brickie"]);
    expect(r.summary).toMatch(/needs more resource rather than different dates/);
  });

  it("treats a role nobody supplied as unavailable rather than unlimited", () => {
    const r = level([act("a", 0, 2, 0, [{ role: "diver", units: 1 }])], []);
    expect(r.feasible).toBe(false);
    expect(r.unresolved).toEqual(["diver"]);
  });

  it("leaves the activity at its early start, not parked in the far future", () => {
    const r = level(
      [act("a", 3, 2, 0, [{ role: "brickie", units: 9 }])],
      [have("brickie", 1)],
    );
    expect(r.durationAfter).toBe(5);   // 3 + 2, unmoved
  });
});

describe("things with no resource demand", () => {
  it("does not try to level a milestone", () => {
    const r = level([act("ms", 4, 0, 0)], [have("gang", 1)]);
    expect(r.moves).toEqual([]);
    expect(r.feasible).toBe(true);
  });

  it("still honours a milestone's predecessors", () => {
    const r = level(
      [act("work", 0, 3, 0, [{ role: "gang", units: 1 }]), act("ms", 0, 0, 0, undefined, ["work"])],
      [have("gang", 1)],
    );
    expect(r.durationAfter).toBe(3);
  });
});

describe("availability windows", () => {
  it("waits for the window when the resource is not there yet", () => {
    const r = level(
      [act("a", 0, 2, 10, [{ role: "crane", units: 1 }])],
      [{ role: "crane", units: 0, windows: [{ fromDay: 5, toDay: 20, units: 1 }] }],
    );
    expect(r.moves[0].toDay).toBe(5);
  });
});

describe("determinism", () => {
  it("gives the same plan twice, so yesterday's decision can be checked", () => {
    const build = (): LevellingActivity[] => [
      act("x", 0, 2, 5, [{ role: "gang", units: 2 }]),
      act("y", 0, 2, 5, [{ role: "gang", units: 2 }]),
      act("z", 0, 2, 5, [{ role: "gang", units: 2 }]),
    ];
    const a = level(build(), [have("gang", 2)]);
    const b = level(build(), [have("gang", 2)]);
    expect(a.moves).toEqual(b.moves);
  });
});

describe("the proposal", () => {
  it("requires approval when the completion date moves", () => {
    const r = level(
      [
        act("a", 0, 3, 0, [{ role: "crane", units: 1 }]),
        act("b", 0, 3, 0, [{ role: "crane", units: 1 }]),
      ],
      [have("crane", 1)],
    );
    const p = asProposal(r);
    expect(p.requiresApproval).toBe(true);
    expect(p.changes).toHaveLength(1);
  });

  it("does not require approval for moves absorbed by float", () => {
    const r = level(
      [
        act("a", 0, 2, 0, [{ role: "brickie", units: 3 }]),
        act("b", 0, 2, 10, [{ role: "brickie", units: 3 }]),
      ],
      [have("brickie", 3)],
    );
    expect(asProposal(r).requiresApproval).toBe(false);
  });

  it("proposes changes without applying them", () => {
    const input = [
      act("a", 0, 2, 0, [{ role: "brickie", units: 3 }]),
      act("b", 0, 2, 10, [{ role: "brickie", units: 3 }]),
    ];
    const before = JSON.stringify(input);
    asProposal(level(input, [have("brickie", 3)]));
    // The input programme is untouched: this module proposes, it does not edit.
    expect(JSON.stringify(input)).toBe(before);
  });
});
