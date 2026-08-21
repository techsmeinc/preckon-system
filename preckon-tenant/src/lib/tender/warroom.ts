// The tender war room: every live bid, and which one is about to go wrong.
//
// A bid team runs six to twelve tenders at once. Each has its own deadline, its
// own unanswered clarifications, its own missing approvals, and its own quiet
// slide towards a submission written in the last two days.
//
// The failure is never that a deadline was unknown. It is that with eight
// tenders live, the one in trouble looks exactly like the seven that are fine
// until about seventy-two hours before submission.
//
// ── WHAT MAKES A BID LOOK FINE WHEN IT IS NOT ────────────────────────────────
//
// Progress is not the signal. A bid can be 80% complete and undeliverable
// because the 20% remaining is a subcontractor quote that has not arrived and
// cannot be chased any faster. The signals that actually predict a bad
// submission are:
//
//   Unanswered clarifications close to the deadline. Every one is a decision
//   still to be made, and the client's own deadline for asking has usually
//   passed before anyone notices.
//   Missing prices for significant packages. The gap gets filled with an
//   allowance, and an allowance is a guess with a number on it.
//   No internal approval booked. A bid that cannot be signed off cannot be
//   submitted, and the approver's diary is not the bid team's to control.
//   Effort concentrated at the end. Work compressed into the final days is
//   priced with more contingency and written with less care.
//
// So the ranking here is by JEOPARDY, not by date. The tender due Friday that
// is finished matters less than the one due in three weeks whose steel package
// has no price and whose approver is on leave.

export type BidStage = "reviewing" | "estimating" | "pricing" | "approval" | "submitted" | "withdrawn";

export interface LiveBid {
  id: string;
  projectName: string;
  client: string;
  valueMinor: number;
  stage: BidStage;
  /** Days until submission. Negative means overdue. */
  daysToSubmit: number;
  /** Clarifications raised with the client and not yet answered. */
  openClarifications?: number;
  /** Deadline for raising further clarifications, where the client set one. */
  daysToClarificationDeadline?: number | null;
  /** Packages needing a subcontract price, and how many have one. */
  packagesTotal?: number;
  packagesPriced?: number;
  /** Whether the internal approval slot is actually booked. */
  approvalBooked?: boolean;
  /** Who owns it. A bid with no owner is everybody's and nobody's. */
  owner?: string | null;
  /** Bids this competes with for the same people. */
  sharedResourceWith?: string[];
}

export type Jeopardy = "critical" | "at_risk" | "watch" | "on_track" | "closed";

export interface BidJeopardy {
  id: string;
  projectName: string;
  client: string;
  valueMinor: number;
  stage: BidStage;
  daysToSubmit: number;
  jeopardy: Jeopardy;
  /** Weighted concern, for ranking. Higher is worse. */
  score: number;
  /** Every reason, so the ranking can be argued with. */
  reasons: string[];
  /** The single most useful thing to do about it. */
  nextAction: string | null;
}

export interface WarRoom {
  bids: BidJeopardy[];
  /** Needs intervention today, worst first. */
  critical: BidJeopardy[];
  atRisk: BidJeopardy[];
  /** Value of everything live and not yet submitted. */
  liveValueMinor: number;
  /** Value sitting in bids that are in trouble. */
  atRiskValueMinor: number;
  /** Deadlines colliding within a few days of each other. */
  collisions: { days: number; bids: string[]; note: string }[];
  /** People carrying more than one live bid at once. */
  overloadedOwners: { owner: string; bids: string[]; note: string }[];
  warnings: string[];
  summary: string;
}

const CLOSED = new Set<BidStage>(["submitted", "withdrawn"]);

/**
 * Score one bid's jeopardy.
 *
 * Deliberately not a progress percentage. Progress measures what has been done
 * and jeopardy measures what can still go wrong, and only the second one
 * predicts a bad submission.
 */
export function jeopardyOf(b: LiveBid): BidJeopardy {
  const reasons: string[] = [];
  let score = 0;

  /* Candidate actions with an explicit priority, rather than first-one-wins.
     Assigning nextAction in code order let a generic "escalate today" beat the
     specific, actionable "chase these three quotes and decide the allowance" —
     and the specific one is the whole value of the board. */
  const actions: { priority: number; action: string }[] = [];
  const suggest = (priority: number, action: string) => actions.push({ priority, action });

  const base = {
    id: b.id, projectName: b.projectName, client: b.client,
    valueMinor: b.valueMinor, stage: b.stage, daysToSubmit: b.daysToSubmit,
  };

  if (CLOSED.has(b.stage)) {
    return { ...base, jeopardy: "closed", score: 0, reasons: [`${b.stage}.`], nextAction: null };
  }

  /* ── Overdue ─────────────────────────────────────────────────────────────── */
  if (b.daysToSubmit < 0) {
    score += 100;
    reasons.push(`Submission date passed ${-b.daysToSubmit} day(s) ago and this is still ${b.stage}.`);
    suggest(100, "Confirm whether this was submitted, extended or lost. A bid past its date with no outcome recorded is the bid register lying to everyone who reads it.");
  }

  /* ── Time against stage ──────────────────────────────────────────────────
     A bid still being estimated a week out is in more trouble than one in
     approval a week out, and the raw date cannot tell them apart. */
  const stageFloor: Partial<Record<BidStage, number>> = {
    reviewing: 21, estimating: 14, pricing: 7, approval: 3,
  };
  const floor = stageFloor[b.stage];
  if (floor != null && b.daysToSubmit >= 0 && b.daysToSubmit < floor) {
    const short = floor - b.daysToSubmit;
    score += Math.min(40, short * 3);
    reasons.push(`Still ${b.stage} with ${b.daysToSubmit} day(s) left — normally ${floor} day(s) of runway remain at this stage, so it is ${short} day(s) behind where it should be.`);
    suggest(50, b.stage === "estimating" || b.stage === "reviewing"
      ? "Decide now whether to resource this properly or withdraw. A bid finished in the last two days is priced with more contingency and written with less care, and loses on both."
      : "Escalate today. There is not enough runway left for this stage to complete normally.");
  }

  /* ── Clarifications ──────────────────────────────────────────────────────
     Every unanswered one is a decision outstanding, and the client's window for
     asking closes well before the submission date. */
  const open = b.openClarifications ?? 0;
  if (open > 0) {
    const clarDeadline = b.daysToClarificationDeadline;
    if (clarDeadline != null && clarDeadline < 0) {
      score += 30;
      reasons.push(`${open} clarification(s) unanswered and the client's window for raising them closed ${-clarDeadline} day(s) ago. Whatever is unresolved now has to be priced as an assumption or qualified out.`);
      suggest(70, "Convert each open clarification into a priced assumption or a written qualification. Neither is free, and leaving them as open questions puts them in the price by accident.");
    } else if (clarDeadline != null && clarDeadline <= 3) {
      score += 20;
      reasons.push(`${open} clarification(s) outstanding with ${clarDeadline} day(s) left to raise anything further.`);
      suggest(55, "Chase these today — after the clarification deadline they become assumptions whether or not anyone decides to make them.");
    } else {
      score += Math.min(15, open * 3);
      reasons.push(`${open} clarification(s) awaiting a client answer.`);
    }
  }

  /* ── Package coverage ────────────────────────────────────────────────────── */
  if (b.packagesTotal != null && b.packagesTotal > 0) {
    const priced = b.packagesPriced ?? 0;
    const missing = b.packagesTotal - priced;
    if (missing > 0) {
      const share = missing / b.packagesTotal;
      score += Math.round(share * 35) + (b.daysToSubmit <= 7 ? 15 : 0);
      reasons.push(
        `${missing} of ${b.packagesTotal} package(s) have no subcontract price${
          b.daysToSubmit <= 7 ? ` with ${b.daysToSubmit} day(s) to go — these will be filled with allowances, which are guesses with numbers on them` : ""
        }.`,
      );
      suggest(b.daysToSubmit <= 7 ? 65 : 30, b.daysToSubmit <= 7
        ? "Chase the outstanding quotes today, and decide now what allowance goes in if they do not arrive — that decision made under time pressure on the last day is how contingency gets guessed."
        : "Chase the outstanding package quotes.");
    }
  }

  /* ── Approval ────────────────────────────────────────────────────────────
     The constraint the bid team does not control. An approver's diary fills up
     weeks ahead, and a bid that cannot be signed cannot be submitted however
     finished it is. */
  if (b.approvalBooked === false && b.daysToSubmit <= 10 && b.daysToSubmit >= 0) {
    score += 25;
    reasons.push(`No approval slot booked with ${b.daysToSubmit} day(s) to submission. A finished bid that cannot be signed off does not get submitted.`);
    suggest(60, "Book the approval slot now. This is the one constraint on the list that the bid team does not control.");
  }

  /* ── Ownership ───────────────────────────────────────────────────────────── */
  if (!b.owner) {
    score += 15;
    reasons.push("No named owner. A bid that belongs to everybody belongs to nobody, and this is usually the first thing true about a bid that goes wrong.");
    suggest(20, "Name an owner.");
  }

  const jeopardy: Jeopardy =
    score >= 60 ? "critical"
    : score >= 30 ? "at_risk"
    : score >= 12 ? "watch"
    : "on_track";

  if (!reasons.length) reasons.push(`${b.stage} with ${b.daysToSubmit} day(s) to go; nothing outstanding.`);

  // Highest priority wins. Ties keep the order they were raised in, which is
  // roughly severity order anyway.
  const nextAction = actions.sort((x, y) => y.priority - x.priority)[0]?.action ?? null;

  return { ...base, jeopardy, score, reasons, nextAction };
}

/**
 * The board.
 *
 * Ranked by jeopardy rather than by date, because the tender due Friday that is
 * finished matters less than the one due in three weeks whose steel package has
 * no price and whose approver is on leave.
 */
export function warRoom(bids: LiveBid[]): WarRoom {
  const scored = bids.map(jeopardyOf).sort((a, b) => b.score - a.score || a.daysToSubmit - b.daysToSubmit);
  const live = scored.filter((b) => b.jeopardy !== "closed");
  const warnings: string[] = [];

  const critical = live.filter((b) => b.jeopardy === "critical");
  const atRisk = live.filter((b) => b.jeopardy === "at_risk");

  const liveValueMinor = live.reduce((s, b) => s + b.valueMinor, 0);
  const atRiskValueMinor = [...critical, ...atRisk].reduce((s, b) => s + b.valueMinor, 0);

  /* ── Colliding deadlines ─────────────────────────────────────────────────
     Two submissions in the same week is not two problems; it is one problem
     with the same people in it twice. Grouped so it reads as the resourcing
     decision it actually is. */
  const collisions: WarRoom["collisions"] = [];
  const byWeek = new Map<number, string[]>();
  for (const b of bids) {
    if (CLOSED.has(b.stage) || b.daysToSubmit < 0) continue;
    const week = Math.floor(b.daysToSubmit / 7);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(b.projectName);
  }
  for (const [week, names] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (names.length < 2) continue;
    collisions.push({
      days: week * 7,
      bids: names,
      note: `${names.length} submissions inside the same week. That is one resourcing decision, not ${names.length} separate deadlines — decide now which gets the estimator.`,
    });
  }

  /* ── Overloaded owners ───────────────────────────────────────────────────── */
  const byOwner = new Map<string, string[]>();
  for (const b of bids) {
    if (CLOSED.has(b.stage) || !b.owner) continue;
    if (!byOwner.has(b.owner)) byOwner.set(b.owner, []);
    byOwner.get(b.owner)!.push(b.projectName);
  }
  const overloadedOwners = [...byOwner.entries()]
    .filter(([, names]) => names.length >= 3)
    .map(([owner, names]) => ({
      owner,
      bids: names,
      note: `${owner} is carrying ${names.length} live bids. Something here will get the last two days rather than the attention it needs.`,
    }));

  const unowned = bids.filter((b) => !CLOSED.has(b.stage) && !b.owner).length;
  if (unowned) warnings.push(`${unowned} live bid(s) have no named owner.`);
  if (critical.length) {
    warnings.push(`${critical.length} bid(s) need intervention today, carrying ${critical.reduce((s, b) => s + b.valueMinor, 0)} of value.`);
  }
  for (const c of collisions) warnings.push(c.note);
  for (const o of overloadedOwners) warnings.push(o.note);

  return {
    bids: scored,
    critical,
    atRisk,
    liveValueMinor,
    atRiskValueMinor,
    collisions,
    overloadedOwners,
    warnings,
    summary: summarise(live.length, critical.length, atRisk.length, atRiskValueMinor, liveValueMinor),
  };
}

function summarise(
  live: number, critical: number, atRisk: number, atRiskValue: number, liveValue: number,
): string {
  if (!live) return "No live bids.";
  if (!critical && !atRisk) return `${live} live bid(s), all on track.`;
  const share = liveValue ? Math.round((atRiskValue / liveValue) * 100) : 0;
  const parts = [`${live} live bid(s)`];
  if (critical) parts.push(`${critical} needing intervention today`);
  if (atRisk) parts.push(`${atRisk} at risk`);
  return `${parts.join(", ")} — ${share}% of live bid value is in trouble.`;
}
