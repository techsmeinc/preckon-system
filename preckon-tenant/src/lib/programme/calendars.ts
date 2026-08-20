// Global, project and resource calendars.
//
// cpm.ts computes in abstract days from commencement, which is the right way to
// compute a network and the wrong thing to show anybody. "Day 47" becomes a
// date only once somebody decides which days are worked — and in this region
// that decision is not the western default: the weekend is Friday–Saturday in
// much of the Gulf, Sunday is a working day, and Eid moves every year.
//
// So calendars are data, not a hardcoded Mon–Fri, and they nest:
//
//   global (the company's working week and public holidays)
//     └ project (site-specific shutdowns, client-imposed closures)
//         └ resource (a subcontractor's own shutdown, a crane off-hire)
//
// The narrower calendar can only ever REMOVE working time, never add it back.
// A resource calendar that could reinstate a public holiday would quietly
// promise work on a day the site is locked.

/** 0 = Sunday, per JavaScript's own getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Calendar {
  id: string;
  name: string;
  /** Days of the week that are worked. */
  workdays: Weekday[];
  /** ISO dates (YYYY-MM-DD) that are not worked, whatever the weekday. */
  holidays: string[];
  /** Inherits from this calendar; may only narrow it. */
  parentId?: string | null;
  hoursPerDay?: number;
}

/** The Gulf default: Sunday to Thursday. */
export const GULF_WEEK: Weekday[] = [0, 1, 2, 3, 4];
/** The western default, kept for projects that use it. */
export const WESTERN_WEEK: Weekday[] = [1, 2, 3, 4, 5];

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/**
 * Flatten a calendar and its ancestors into the effective working rule.
 *
 * Workdays intersect (each level may only remove days) and holidays union
 * (each level may only add closures). That asymmetry is the "narrow only"
 * rule stated once, in the one place it can be enforced.
 */
export function effective(calendar: Calendar, all: Calendar[]): Calendar {
  const chain: Calendar[] = [];
  let current: Calendar | undefined = calendar;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? all.find((c) => c.id === current!.parentId) : undefined;
  }

  let workdays = new Set<Weekday>(chain[0]?.workdays ?? GULF_WEEK);
  const holidays = new Set<string>();
  for (const level of chain) {
    workdays = new Set([...workdays].filter((d) => level.workdays.includes(d)));
    for (const h of level.holidays) holidays.add(h);
  }

  return {
    ...calendar,
    workdays: [...workdays].sort() as Weekday[],
    holidays: [...holidays].sort(),
    // The narrowest level that states hours wins. Walked backwards rather than
    // with findLast, which needs a newer lib target than this project sets.
    hoursPerDay:
      [...chain].reverse().find((c) => c.hoursPerDay != null)?.hoursPerDay ?? 8,
  };
}

export const isWorkingDay = (cal: Calendar, date: string): boolean =>
  cal.workdays.includes(parse(date).getUTCDay() as Weekday) && !cal.holidays.includes(date);

/** The next working day on or after `date`. */
export function nextWorkingDay(cal: Calendar, date: string): string {
  let d = parse(date);
  // 400 is a year and a bit: enough to clear any plausible shutdown, and a
  // bound so a calendar with no working days at all cannot hang the request.
  for (let i = 0; i < 400; i++) {
    if (isWorkingDay(cal, iso(d))) return iso(d);
    d = addDays(d, 1);
  }
  throw new RangeError(`${cal.name} has no working day within 400 days of ${date}.`);
}

/**
 * The date `n` working days after `start`.
 *
 * Duration is inclusive of the start day, the way construction durations are
 * always quoted: a 1-day activity starting Sunday finishes Sunday, not Monday.
 */
export function addWorkingDays(cal: Calendar, start: string, days: number): string {
  if (days <= 0) return nextWorkingDay(cal, start);
  let d = parse(nextWorkingDay(cal, start));
  let remaining = days - 1;
  let guard = 0;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(cal, iso(d))) remaining -= 1;
    if (++guard > 10_000) throw new RangeError("Calendar has too few working days to span this duration.");
  }
  return iso(d);
}

/** Working days between two dates, inclusive of both ends. */
export function workingDaysBetween(cal: Calendar, from: string, to: string): number {
  if (Date.parse(to) < Date.parse(from)) return 0;
  let d = parse(from);
  let n = 0;
  while (iso(d) <= to) {
    if (isWorkingDay(cal, iso(d))) n += 1;
    d = addDays(d, 1);
  }
  return n;
}

export interface DatedActivity {
  key: string;
  name: string;
  /** Offsets from commencement, as cpm.ts produces them. */
  es: number;
  ef: number;
  dur: number;
  float?: number;
  critical?: boolean;
  startDate: string;
  finishDate: string;
}

/**
 * Turn a CPM result into real dates.
 *
 * The offsets are working-day counts, so they are laid onto the calendar rather
 * than added as clock days — which is the whole reason a 60-day programme does
 * not finish 60 days after it starts.
 */
export function schedule(
  cal: Calendar, commencement: string,
  nodes: { key: string; name: string; es: number; ef: number; dur: number; float?: number; critical?: boolean }[],
): DatedActivity[] {
  const start = nextWorkingDay(cal, commencement);
  return nodes.map((n) => {
    const startDate = addWorkingDays(cal, start, n.es + 1);
    return {
      key: n.key, name: n.name, es: n.es, ef: n.ef, dur: n.dur,
      float: n.float, critical: n.critical,
      startDate,
      finishDate: n.dur > 0 ? addWorkingDays(cal, startDate, n.dur) : startDate,
    };
  });
}
