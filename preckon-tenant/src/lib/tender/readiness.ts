// Submission readiness and the manifest.
//
// lib/submission.ts already models the pack and computes a readiness figure as
// done-over-live. That number is honest arithmetic and a misleading answer,
// because it weights every item the same: a missing bid bond and a missing
// organisation chart both cost one twentieth. One of those is disqualification
// and the other is a comment.
//
// So readiness here is weighted by consequence, and it reports a BLOCKING set
// rather than a percentage alone — 95% ready means nothing if the 5% is the
// bond. The percentage is kept because people ask for it, but it is never the
// only thing returned.
//
// The manifest is the second half: the list that goes in the envelope, in the
// order the client asked for it, with what is missing stated rather than
// omitted. A manifest that silently lists only what exists is how a pack goes
// out incomplete.

import type { SubmissionItem, SubmissionPack } from "../submission";

export type Consequence = "disqualifying" | "scored" | "supporting";

export interface ItemRule {
  /** Matches SubmissionItem.id. */
  id: string;
  consequence: Consequence;
  /** Client's required order in the pack, when they stipulate one. */
  order?: number;
  /** Named format requirement — "sealed separately", "PDF/A", "hard copy x3". */
  format?: string | null;
}

/* A bid is rejected unopened for a missing bond or an unsigned form of tender;
   a weak method statement loses marks. Weighting them equally produces a number
   that cannot be acted on. */
const WEIGHT: Record<Consequence, number> = {
  disqualifying: 10,
  scored: 3,
  supporting: 1,
};

export interface Blocker {
  id: string;
  label: string;
  consequence: Consequence;
  reason: string;
}

export interface Readiness {
  /** Weighted 0..100. */
  score: number;
  /** The naive figure lib/submission.ts reports, for continuity. */
  simplePercent: number;
  blockers: Blocker[];
  outstanding: number;
  /** Hours until the deadline, when one is given. */
  hoursRemaining?: number | null;
  submittable: boolean;
  summary: string;
}

const isDone = (i: SubmissionItem) => i.state === "ready" || i.state === "submitted";

export function readiness(
  pack: SubmissionPack,
  rules: ItemRule[] = [],
  opts: { now?: string; deadline?: string | null } = {},
): Readiness {
  const ruleOf = new Map(rules.map((r) => [r.id, r] as const));
  const live = pack.items.filter((i) => i.state !== "na");

  let earned = 0;
  let possible = 0;
  const blockers: Blocker[] = [];

  for (const item of live) {
    const consequence = ruleOf.get(item.id)?.consequence ?? "supporting";
    const weight = WEIGHT[consequence];
    possible += weight;
    if (isDone(item)) {
      earned += weight;
      continue;
    }
    if (consequence === "disqualifying") {
      blockers.push({
        id: item.id, label: item.label, consequence,
        reason: "Missing this is grounds for the bid being rejected unopened.",
      });
    } else if (consequence === "scored") {
      blockers.push({
        id: item.id, label: item.label, consequence,
        reason: "Scored by the evaluator — absent, it scores zero.",
      });
    }
  }

  const hoursRemaining = opts.deadline && opts.now
    ? Math.round((Date.parse(opts.deadline) - Date.parse(opts.now)) / 3_600_000)
    : null;

  const disqualifying = blockers.filter((b) => b.consequence === "disqualifying");
  const score = possible ? Math.round((earned / possible) * 100) : 100;
  const simple = live.length ? Math.round((live.filter(isDone).length / live.length) * 100) : 100;

  const parts: string[] = [`${score}% ready by consequence`];
  if (simple !== score) parts.push(`${simple}% by item count`);
  if (disqualifying.length) {
    parts.push(`${disqualifying.length} disqualifying gap(s): ${disqualifying.map((b) => b.label).join(", ")}`);
  }
  if (hoursRemaining != null) {
    parts.push(hoursRemaining < 0 ? "the deadline has passed" : `${hoursRemaining}h to deadline`);
  }

  return {
    score,
    simplePercent: simple,
    blockers,
    outstanding: live.filter((i) => !isDone(i)).length,
    hoursRemaining,
    submittable: disqualifying.length === 0 && (hoursRemaining == null || hoursRemaining > 0),
    summary: parts.join("; ") + ".",
  };
}

export interface ManifestEntry {
  order: number;
  id: string;
  label: string;
  group: SubmissionItem["group"];
  state: string;
  format: string | null;
  /** Where the file is, once produced. */
  reference?: string | null;
  present: boolean;
}

export interface Manifest {
  entries: ManifestEntry[];
  missing: ManifestEntry[];
  method: string;
  complete: boolean;
  /** Plain text, for the covering letter or the envelope label. */
  render: string;
}

/**
 * The manifest that goes in the envelope.
 *
 * Missing items are LISTED, marked missing, rather than omitted. A manifest
 * showing only what exists reads as complete, and the point of a manifest is
 * to be checkable against the pack by somebody who was not there when it was
 * assembled.
 */
export function manifest(pack: SubmissionPack, rules: ItemRule[] = []): Manifest {
  const ruleOf = new Map(rules.map((r) => [r.id, r] as const));
  const entries: ManifestEntry[] = pack.items
    .filter((i) => i.state !== "na")
    .map((i, idx) => ({
      order: ruleOf.get(i.id)?.order ?? 1000 + idx,
      id: i.id,
      label: i.label,
      group: i.group,
      state: i.state,
      format: ruleOf.get(i.id)?.format ?? null,
      reference: i.from ?? null,
      present: isDone(i),
    }))
    .sort((a, b) => a.order - b.order);

  const missing = entries.filter((e) => !e.present);

  return {
    entries,
    missing,
    method: pack.method || "not stated",
    complete: missing.length === 0,
    render: [
      `Submission manifest — ${entries.length} item(s), method: ${pack.method || "not stated"}`,
      ...entries.map((e, i) =>
        `${String(i + 1).padStart(2, "0")}. ${e.label}` +
        (e.format ? ` [${e.format}]` : "") +
        (e.present ? "" : "   ** NOT INCLUDED **"),
      ),
      missing.length
        ? `\n${missing.length} item(s) not included. This pack is incomplete.`
        : "\nAll listed items included.",
    ].join("\n"),
  };
}
