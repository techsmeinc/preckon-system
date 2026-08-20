// Clarification lifecycle.
//
// A clarification is a question to the client that changes what you are
// pricing. Two things make them dangerous, and both are about timing rather
// than content:
//
//   - The question deadline usually falls well before the bid deadline. After
//     it passes, an ambiguity you have not raised becomes an ambiguity you have
//     priced — at your own risk, whichever way it is later read.
//   - An answer that arrives after you have priced the affected scope only
//     helps if somebody goes back and changes the price. Answers land in an
//     inbox; bids get submitted from a spreadsheet.
//
// So the states here track not just "asked and answered" but whether the answer
// was actually CARRIED INTO the bid, and a clarification that was answered and
// never incorporated is treated as an open risk rather than a closed question.

export type ClarificationStatus =
  | "draft"
  | "submitted"
  | "answered"
  | "incorporated"    // the answer has been reflected in the price or scope
  | "withdrawn"
  | "unanswered";     // the client never replied and the window shut

export type Impact = "none" | "price" | "scope" | "programme" | "risk";

export interface Clarification {
  id: string;
  ref: string;
  question: string;
  raisedBy?: string;
  raisedAt: string;
  status: ClarificationStatus;
  /** What this touches, so its answer can be routed to the right person. */
  impacts: Impact[];
  /** BOQ lines, packages or requirements this affects. */
  affects: string[];
  submittedAt?: string | null;
  answeredAt?: string | null;
  answer?: string | null;
  incorporatedAt?: string | null;
  incorporatedBy?: string | null;
  /** What was assumed while waiting. This is the thing that bites. */
  assumption?: string | null;
}

export interface Deadlines {
  /** Last date the client accepts questions. */
  questionsCloseAt: string;
  /** Bid submission. */
  submissionAt: string;
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;
const refuse = (reason: string): Refusal => ({ ok: false, reason });

/**
 * Submit a question to the client.
 *
 * Refused after the questions deadline. Not because the system cannot record it
 * — because sending it creates a false expectation of an answer, and the honest
 * move at that point is to price the ambiguity and state the assumption.
 */
export function submit(c: Clarification, at: string, deadlines: Deadlines): Result<Clarification> {
  if (c.status !== "draft") return refuse(`Only a draft can be submitted; this one is ${c.status}.`);
  if (!c.question.trim()) return refuse("There is no question to ask.");
  if (Date.parse(at) > Date.parse(deadlines.questionsCloseAt)) {
    return refuse(
      `Questions closed ${deadlines.questionsCloseAt}. Price the ambiguity and record the assumption instead — ` +
      `a question sent now will most likely go unanswered and the risk stays with you either way.`,
    );
  }
  return { ok: true, value: { ...c, status: "submitted", submittedAt: at } };
}

export function answer(c: Clarification, at: string, text: string): Result<Clarification> {
  if (c.status !== "submitted") return refuse(`Only a submitted clarification can be answered; this one is ${c.status}.`);
  if (!text.trim()) return refuse("An empty answer is not an answer.");
  return { ok: true, value: { ...c, status: "answered", answeredAt: at, answer: text } };
}

/**
 * Mark the answer as carried into the bid.
 *
 * Separate from `answer` on purpose. The gap between receiving an answer and
 * acting on it is where bids get lost, and collapsing the two states would
 * hide exactly the thing worth reporting.
 */
export function incorporate(c: Clarification, at: string, by: string): Result<Clarification> {
  if (c.status !== "answered") return refuse(`Nothing to incorporate: this clarification is ${c.status}.`);
  return { ok: true, value: { ...c, status: "incorporated", incorporatedAt: at, incorporatedBy: by } };
}

/** Close out anything the client never answered, once the window has shut. */
export function closeUnanswered(items: Clarification[], now: string, deadlines: Deadlines): Clarification[] {
  const shut = Date.parse(now) > Date.parse(deadlines.questionsCloseAt);
  return items.map((c) =>
    shut && c.status === "submitted" ? { ...c, status: "unanswered" as const } : c,
  );
}

export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface ClarificationRisk {
  id: string;
  ref: string;
  level: RiskLevel;
  why: string;
}

export interface ClarificationReport {
  total: number;
  open: number;
  answeredNotIncorporated: number;
  unanswered: number;
  risks: ClarificationRisk[];
  /** True when nothing outstanding should stop the bid going in. */
  clearToSubmit: boolean;
  summary: string;
}

/**
 * What is still outstanding, and how much it matters.
 *
 * An answered-but-not-incorporated item outranks an unanswered one. That
 * ordering is deliberate: an unanswered question is a known unknown that has
 * been priced with a stated assumption, while an answer sitting unread is a
 * known KNOWN that the bid still contradicts.
 */
export function assess(items: Clarification[], now: string, deadlines: Deadlines): ClarificationReport {
  const risks: ClarificationRisk[] = [];
  const isOpen = (c: Clarification) => c.status === "draft" || c.status === "submitted";

  for (const c of items) {
    const priceOrScope = c.impacts.includes("price") || c.impacts.includes("scope");

    if (c.status === "answered") {
      risks.push({
        id: c.id, ref: c.ref,
        level: priceOrScope ? "critical" : "high",
        why: `Answered ${c.answeredAt} and not yet carried into the bid${priceOrScope ? " — it changes the price or the scope" : ""}.`,
      });
    } else if (c.status === "unanswered" || (c.status === "submitted" && Date.parse(now) > Date.parse(deadlines.questionsCloseAt))) {
      risks.push({
        id: c.id, ref: c.ref,
        level: c.assumption ? "medium" : priceOrScope ? "critical" : "high",
        why: c.assumption
          ? `No answer; priced on the stated assumption: "${c.assumption}".`
          : "No answer and no assumption recorded — the bid contains an unquantified ambiguity.",
      });
    } else if (c.status === "draft" && Date.parse(now) > Date.parse(deadlines.questionsCloseAt)) {
      risks.push({
        id: c.id, ref: c.ref, level: "high",
        why: "Drafted but never sent, and questions have closed.",
      });
    }
  }

  const order: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  risks.sort((a, b) => order[a.level] - order[b.level]);

  const answeredNotIncorporated = items.filter((c) => c.status === "answered").length;
  const unanswered = items.filter((c) => c.status === "unanswered").length;
  const open = items.filter(isOpen).length;
  const blocking = risks.filter((r) => r.level === "critical").length;

  return {
    total: items.length,
    open,
    answeredNotIncorporated,
    unanswered,
    risks,
    clearToSubmit: blocking === 0,
    summary: blocking
      ? `${blocking} clarification(s) must be resolved before submission; ${answeredNotIncorporated} answered and not yet in the bid.`
      : `No blocking clarifications. ${open} still open, ${unanswered} never answered.`,
  };
}
