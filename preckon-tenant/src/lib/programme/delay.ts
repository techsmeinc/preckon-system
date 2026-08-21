// Delay analysis: what caused the overrun, and who carries it.
//
// This is the most commercially consequential thing in the programme module.
// The output of a delay analysis decides whether a contractor gets an extension
// of time, whether the employer gets liquidated damages, and occasionally
// whether either survives the job. It is also the calculation most often done
// badly, because the arithmetic is easy and the ATTRIBUTION is not.
//
// ── WHAT THIS DOES AND DOES NOT CLAIM ────────────────────────────────────────
//
// It measures impact and states entitlement under stated rules. It does not
// determine liability. The difference matters: "this event delayed completion
// by 12 days and, being a Relevant Event, carries time but not money under the
// stated contract" is a defensible technical statement. "The employer owes
// £340,000" is a legal opinion, and no tool should produce one silently.
//
// So every result carries the rule it was decided under, and anything the rules
// do not cleanly settle is returned as `contested` rather than resolved. A
// delay analysis that never says "this is arguable" is not being careful; it is
// hiding the part a quantum expert would be paid to argue.
//
// ── CONCURRENCY IS THE HARD PART ─────────────────────────────────────────────
//
// When an employer-risk event and a contractor-risk event delay the same
// completion at the same time, who pays? There is no universal answer — it
// depends on the contract and the jurisdiction, and the two main approaches
// (Malmaison and apportionment) give different results on purpose.
//
// Both are implemented, selectable, and neither is the silent default. Picking
// one for the user and not saying so would bury a decision worth six figures in
// a config value.

/** Who carries the risk of an event under the contract. */
export type RiskOwner =
  /** Employer risk: typically time AND money (a Relevant Event with loss/expense). */
  | "employer"
  /** Contractor risk: neither time nor money. */
  | "contractor"
  /** Neutral: weather, strikes — typically time but NOT money. */
  | "neutral";

export interface DelayEvent {
  id: string;
  title: string;
  owner: RiskOwner;
  /** Day the event began to affect the works, from commencement. */
  startDay: number;
  /** Days of delay this event caused to the affected activity. */
  days: number;
  /** The activity it hit. */
  activityKey: string;
  /** Float available on that activity when the event struck. Delay is absorbed
   *  by float before it reaches completion. */
  activityFloat: number;
  /** Evidence references — the whole claim rests on these. */
  evidence?: string[];
}

/** How concurrent employer and contractor delay is treated. */
export type ConcurrencyRule =
  /** Malmaison: contractor gets time for the employer delay despite its own
   *  concurrent delay, but no money. The prevailing English approach. */
  | "malmaison"
  /** Apportionment: the delay is split between the parties. Scots law
   *  (City Inn), and some contracts adopt it expressly. */
  | "apportion"
  /** Dominant cause: whichever delay is larger takes the whole period. */
  | "dominant";

export interface EventImpact {
  id: string;
  title: string;
  owner: RiskOwner;
  /** Days that disappeared into float and never reached completion. */
  absorbedByFloat: number;
  /** Days that actually pushed the completion date. */
  criticalDays: number;
  /** Days of extension of time this event supports. */
  eotDays: number;
  /** Whether the event also supports a money claim. */
  compensable: boolean;
  /** True where concurrency means this is arguable rather than settled. */
  contested: boolean;
  why: string;
}

export interface ConcurrentPeriod {
  fromDay: number;
  toDay: number;
  days: number;
  employerEvents: string[];
  contractorEvents: string[];
  /** Days awarded to the contractor as EOT for this period. */
  eotDays: number;
  /** Days left at the contractor's cost. */
  contractorDays: number;
  compensable: boolean;
  why: string;
}

export interface DelayAnalysis {
  impacts: EventImpact[];
  concurrent: ConcurrentPeriod[];
  /** Total extension of time supported. */
  eotDays: number;
  /** Of the EOT, days that also carry loss and expense. */
  compensableDays: number;
  /** Days of delay left at the contractor's risk — the LD exposure. */
  contractorDays: number;
  /** Days that never reached the completion date at all. */
  absorbedDays: number;
  rule: ConcurrencyRule;
  /** Anything a reviewer must look at rather than accept. */
  warnings: string[];
  summary: string;
}

/** Inclusive day span of an event's critical effect. */
interface Span { id: string; owner: RiskOwner; from: number; to: number }

/**
 * Analyse a set of delay events.
 *
 * Float is consumed first, and deliberately on a first-come basis by event
 * start: float belongs to the project, and whoever needs it first uses it. That
 * is the ordinary English-law position and it has a real consequence — a
 * contractor delay early in the job can exhaust the float that would otherwise
 * have absorbed a later employer delay, turning an employer event into a
 * critical one. Ordering by event date rather than by owner is what keeps that
 * effect visible instead of quietly favouring whoever the analysis was run for.
 */
export function analyse(
  events: DelayEvent[],
  opts: { rule?: ConcurrencyRule } = {},
): DelayAnalysis {
  const rule = opts.rule ?? "malmaison";
  const warnings: string[] = [];

  // Float per activity, consumed in event-date order.
  const floatLeft = new Map<string, number>();
  for (const e of events) {
    if (!floatLeft.has(e.activityKey)) floatLeft.set(e.activityKey, Math.max(0, e.activityFloat));
  }

  const ordered = [...events].sort((a, b) => a.startDay - b.startDay || a.id.localeCompare(b.id));
  const impacts: EventImpact[] = [];
  const spans: Span[] = [];

  for (const e of ordered) {
    const days = Math.max(0, e.days);
    const available = floatLeft.get(e.activityKey) ?? 0;
    const absorbed = Math.min(days, available);
    const critical = days - absorbed;
    floatLeft.set(e.activityKey, available - absorbed);

    if (critical > 0) {
      // The critical portion begins once float is exhausted.
      spans.push({ id: e.id, owner: e.owner, from: e.startDay + absorbed, to: e.startDay + days - 1 });
    }
    if (!e.evidence?.length && critical > 0) {
      warnings.push(`${e.id} (${e.title}) drives ${critical} critical day(s) with no evidence referenced. An unevidenced claim is not a claim.`);
    }

    impacts.push({
      id: e.id,
      title: e.title,
      owner: e.owner,
      absorbedByFloat: absorbed,
      criticalDays: critical,
      // Filled in after concurrency is resolved — an event's entitlement is not
      // knowable from the event alone.
      eotDays: 0,
      compensable: false,
      contested: false,
      why: "",
    });
  }

  const concurrent = resolveConcurrency(spans, rule);

  /* Award per event.

     Non-concurrent critical days follow the owner: employer events carry time
     and money, neutral events carry time only, contractor events carry neither.
     Concurrent days follow the rule, and are apportioned back to the events
     that caused them. */
  const concurrentDaysById = new Map<string, number>();
  const eotFromConcurrentById = new Map<string, number>();
  for (const p of concurrent) {
    const share = p.employerEvents.length ? p.eotDays / p.employerEvents.length : 0;
    for (const id of p.employerEvents) {
      concurrentDaysById.set(id, (concurrentDaysById.get(id) ?? 0) + p.days);
      eotFromConcurrentById.set(id, (eotFromConcurrentById.get(id) ?? 0) + share);
    }
    for (const id of p.contractorEvents) {
      concurrentDaysById.set(id, (concurrentDaysById.get(id) ?? 0) + p.days);
    }
  }

  for (const im of impacts) {
    const inConcurrent = Math.min(im.criticalDays, concurrentDaysById.get(im.id) ?? 0);
    const alone = im.criticalDays - inConcurrent;
    const concurrentEot = eotFromConcurrentById.get(im.id) ?? 0;

    if (im.owner === "contractor") {
      im.eotDays = 0;
      im.compensable = false;
      im.contested = inConcurrent > 0;
      im.why = im.criticalDays === 0
        ? `Absorbed by ${im.absorbedByFloat} day(s) of float; no effect on completion.`
        : `${im.criticalDays} critical day(s) at the contractor's risk — no extension, and exposed to liquidated damages.`;
    } else {
      im.eotDays = round(alone + concurrentEot);
      // Concurrency removes the money, not the time. That is the point of
      // Malmaison, and it is where most claims actually turn.
      im.compensable = im.owner === "employer" && inConcurrent === 0 && alone > 0;
      im.contested = inConcurrent > 0;
      im.why = describeAward(im, alone, inConcurrent, rule);
    }
  }

  const eotDays = round(impacts.reduce((s, i) => s + i.eotDays, 0));
  const compensableDays = round(
    impacts.filter((i) => i.compensable).reduce((s, i) => s + i.eotDays, 0));
  const absorbedDays = impacts.reduce((s, i) => s + i.absorbedByFloat, 0);
  const criticalTotal = impacts.reduce((s, i) => s + i.criticalDays, 0);
  const contractorDays = round(Math.max(0, uniqueCriticalDays(spans) - eotDays));

  if (rule !== "malmaison" && concurrent.length) {
    warnings.push(
      `Concurrency resolved by the '${rule}' rule, which gives a different answer from the prevailing Malmaison approach. Confirm the contract supports it before relying on this.`,
    );
  }
  if (criticalTotal > 0 && !events.some((e) => e.evidence?.length)) {
    warnings.push("No event in this analysis references any evidence.");
  }

  return {
    impacts, concurrent, eotDays, compensableDays, contractorDays, absorbedDays, rule, warnings,
    summary: summarise(eotDays, compensableDays, contractorDays, absorbedDays, concurrent.length, rule),
  };
}

/**
 * Find periods where employer and contractor delay overlap, and split them.
 *
 * Computed day by day rather than by comparing event windows, because three
 * overlapping events produce periods no pair of windows describes. A day is
 * concurrent when at least one employer-risk and at least one contractor-risk
 * delay are both critical on it.
 */
function resolveConcurrency(spans: Span[], rule: ConcurrencyRule): ConcurrentPeriod[] {
  if (!spans.length) return [];
  const from = Math.min(...spans.map((s) => s.from));
  const to = Math.max(...spans.map((s) => s.to));

  const days: { day: number; emp: string[]; con: string[] }[] = [];
  for (let d = from; d <= to; d++) {
    const live = spans.filter((s) => d >= s.from && d <= s.to);
    const emp = live.filter((s) => s.owner === "employer" || s.owner === "neutral").map((s) => s.id);
    const con = live.filter((s) => s.owner === "contractor").map((s) => s.id);
    if (emp.length && con.length) days.push({ day: d, emp, con });
  }
  if (!days.length) return [];

  // Merge consecutive days with the same participants into one period: a
  // reviewer reads "days 12–19, event E3 against C1" as one argument, and
  // eight identical rows as eight.
  const periods: ConcurrentPeriod[] = [];
  const key = (x: typeof days[number]) => `${[...x.emp].sort().join(",")}|${[...x.con].sort().join(",")}`;
  let run = [days[0]];
  for (let i = 1; i <= days.length; i++) {
    const same = i < days.length && key(days[i]) === key(run[0]) && days[i].day === run[run.length - 1].day + 1;
    if (same) { run.push(days[i]); continue; }
    periods.push(buildPeriod(run, rule));
    if (i < days.length) run = [days[i]];
  }
  return periods;
}

function buildPeriod(run: { day: number; emp: string[]; con: string[] }[], rule: ConcurrencyRule): ConcurrentPeriod {
  const days = run.length;
  const employerEvents = [...new Set(run[0].emp)];
  const contractorEvents = [...new Set(run[0].con)];

  let eot = 0;
  let why = "";
  switch (rule) {
    case "malmaison":
      // Time but not money: the contractor is relieved of damages for a period
      // it would have overrun anyway, but recovers no loss and expense for it.
      eot = days;
      why = `Concurrent employer and contractor delay. Under Malmaison the contractor is granted the full ${days} day(s) as an extension of time, but recovers no loss and expense for the period.`;
      break;
    case "apportion":
      eot = days / 2;
      why = `Concurrent delay apportioned equally: ${days / 2} day(s) to each party. Apportionment is the Scots-law approach (City Inn) and needs express support in the contract elsewhere.`;
      break;
    case "dominant":
      // With equal-length concurrent spans there is no dominant cause; the
      // honest output is that this period is contested, not a coin flip.
      eot = employerEvents.length > contractorEvents.length ? days
        : employerEvents.length < contractorEvents.length ? 0
        : days / 2;
      why = employerEvents.length === contractorEvents.length
        ? `No dominant cause over these ${days} day(s) — the period is genuinely contested and is shown split pending a decision.`
        : `Dominant cause approach: ${employerEvents.length > contractorEvents.length ? "employer" : "contractor"} events dominate these ${days} day(s).`;
      break;
  }

  return {
    fromDay: run[0].day,
    toDay: run[run.length - 1].day,
    days,
    employerEvents,
    contractorEvents,
    eotDays: round(eot),
    contractorDays: round(days - eot),
    // Concurrency defeats the money claim under every rule here. This is the
    // single most valuable line in a delay analysis and the one most often got
    // wrong in the contractor's favour.
    compensable: false,
    why,
  };
}

/** Distinct critical days across all spans — overlapping delay is not additive. */
function uniqueCriticalDays(spans: Span[]): number {
  const days = new Set<number>();
  for (const s of spans) for (let d = s.from; d <= s.to; d++) days.add(d);
  return days.size;
}

function describeAward(im: EventImpact, alone: number, concurrent: number, rule: ConcurrencyRule): string {
  const parts: string[] = [];
  if (im.absorbedByFloat > 0) parts.push(`${im.absorbedByFloat} day(s) absorbed by float.`);
  if (alone > 0) {
    parts.push(
      im.owner === "employer"
        ? `${alone} day(s) of employer-risk delay: extension of time and loss and expense.`
        : `${alone} day(s) of neutral delay: extension of time, but no money — a neutral event relieves damages, it does not compensate.`,
    );
  }
  if (concurrent > 0) {
    parts.push(
      `${concurrent} day(s) concurrent with contractor delay: time granted under the ${rule} rule, no money. Contested.`,
    );
  }
  if (!parts.length) parts.push("No effect on completion.");
  return parts.join(" ");
}

const round = (n: number) => Math.round(n * 100) / 100;

function summarise(
  eot: number, compensable: number, contractor: number, absorbed: number,
  concurrentPeriods: number, rule: ConcurrencyRule,
): string {
  if (!eot && !contractor && !absorbed) return "No delay to completion.";
  /* Float consumed with nothing reaching completion is its own state, not a
     zero-day claim. It is also worth saying out loud: the float is gone, and
     the next event on that activity goes straight to the completion date. */
  if (!eot && !contractor) {
    return `No delay to completion — ${absorbed} day(s) absorbed by float. That float is now spent, so a further delay on the same activity would be critical.`;
  }
  const parts = [`${eot} day(s) of extension of time supported`];
  parts.push(compensable > 0
    ? `${compensable} of them compensable`
    : "none of it compensable");
  if (contractor > 0) parts.push(`${contractor} day(s) remain at the contractor's risk`);
  if (absorbed > 0) parts.push(`${absorbed} day(s) absorbed by float`);
  if (concurrentPeriods > 0) {
    parts.push(`${concurrentPeriods} concurrent period(s) resolved under the ${rule} rule and open to argument`);
  }
  return parts.join("; ") + ".";
}
