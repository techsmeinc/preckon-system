/**
 * Work-calendar engine for the project Work Programme — the Primavera-P6 / PIMS
 * "calendar" layer that turns raw durations into realistic dates by skipping
 * non-working days (weekends + holidays) and a resource's leave/vacation.
 *
 * PURE, dependency-free module (no drizzle, no DB, no Node APIs) — the twin of
 * `schedule-cpm.ts`. Imported unchanged by the API server (Excel export) AND the
 * React front-end (live Gantt) via the package subpath `@workspace/db/calendar-engine`.
 *
 * The Work Programme measures everything in CALENDAR-DAY OFFSETS from project
 * commencement (day 0 = the commencement date). This module maps an offset to a
 * real ISO date, decides whether a given day is a working day for a calendar, and
 * — crucially for CPM "calendar mode" — places a block of WORKING-day effort onto
 * the calendar so a bar visually spans the weekends/holidays/leave it straddles
 * (see `placeWork`). It also holds the cost math so the UI and Excel agree.
 *
 * Dates are ISO "YYYY-MM-DD" strings throughout; arithmetic is done in UTC to
 * avoid any local-timezone drift.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A holiday entry: a single `date`, or an inclusive `from`..`to` range. */
export interface Holiday {
  date?: string;
  from?: string;
  to?: string;
  name?: string;
}

/**
 * A work calendar. `weekendDays` are JS weekday numbers (0=Sun … 6=Sat); the GCC
 * default is Friday+Saturday = [5, 6]. `hoursPerDay` drives the hours/cost math.
 */
export interface WorkCalendar {
  weekendDays: number[];
  hoursPerDay: number;
  holidays: Holiday[];
}

/** The cost-relevant fields of a resource (subset of the DB row). */
export interface CostResource {
  rate?: number | string | null;
  rateBasis?: string | null; // "hourly" | "daily"
}

/** One leave/vacation period for a resource. */
export interface LeavePeriod {
  fromDate?: string | null;
  toDate?: string | null;
}

// ── GCC / region presets ─────────────────────────────────────────────────────
// Shipped here so the UI and server share ONE source of truth. The holiday lists
// are sensible starters (national + fixed-date) the user edits per project; the
// movable Islamic dates (Eid, etc.) shift yearly and are left for the user to add
// because they cannot be derived without a Hijri calendar table.

export interface CalendarPreset {
  key: string;
  label: string;
  weekendDays: number[];
  hoursPerDay: number;
  holidays: Holiday[];
}

export const CALENDAR_PRESETS: CalendarPreset[] = [
  {
    key: "uae",
    label: "UAE (Fri/Sat weekend)",
    // Many UAE private-sector firms still run Fri/Sat; the public sector moved to
    // Sat/Sun in 2022. Default to Fri/Sat here; the user can flip to [6,0].
    weekendDays: [5, 6],
    hoursPerDay: 8,
    holidays: [
      { date: "", name: "New Year's Day (Jan 1)" },
      { date: "", name: "Commemoration Day (Dec 1)" },
      { date: "", name: "National Day (Dec 2)" },
      { date: "", name: "National Day Holiday (Dec 3)" },
    ],
  },
  {
    key: "ksa",
    label: "Saudi Arabia (Fri/Sat weekend)",
    weekendDays: [5, 6],
    hoursPerDay: 8,
    holidays: [
      { date: "", name: "Saudi National Day (Sep 23)" },
      { date: "", name: "Founding Day (Feb 22)" },
    ],
  },
  {
    key: "kuwait",
    label: "Kuwait (Fri/Sat weekend)",
    weekendDays: [5, 6],
    hoursPerDay: 8,
    holidays: [
      { date: "", name: "New Year's Day (Jan 1)" },
      { date: "", name: "National Day (Feb 25)" },
      { date: "", name: "Liberation Day (Feb 26)" },
    ],
  },
  {
    key: "qatar",
    label: "Qatar (Fri/Sat weekend)",
    weekendDays: [5, 6],
    hoursPerDay: 8,
    holidays: [
      { date: "", name: "National Day (Dec 18)" },
      { date: "", name: "National Sport Day (2nd Tue Feb)" },
    ],
  },
  {
    key: "western",
    label: "Standard (Sat/Sun weekend)",
    weekendDays: [6, 0],
    hoursPerDay: 8,
    holidays: [{ date: "", name: "New Year's Day (Jan 1)" }],
  },
];

/** The default calendar a new project gets (GCC Fri/Sat, 8h/day, no holidays). */
export function defaultCalendar(): WorkCalendar {
  return { weekendDays: [5, 6], hoursPerDay: 8, holidays: [] };
}

// ── ISO date arithmetic (UTC) ────────────────────────────────────────────────

const MS_DAY = 86_400_000;

/** Parse "YYYY-MM-DD" to a UTC-midnight epoch (NaN if malformed). */
function isoToUtc(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a UTC epoch back to "YYYY-MM-DD". */
function utcToIso(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** ISO date `n` calendar days after `iso`. */
export function isoAddDays(iso: string, n: number): string {
  const base = isoToUtc(iso);
  return Number.isNaN(base) ? iso : utcToIso(base + n * MS_DAY);
}

/** JS weekday (0=Sun … 6=Sat) for an ISO date. */
export function isoWeekday(iso: string): number {
  const ms = isoToUtc(iso);
  return Number.isNaN(ms) ? 0 : new Date(ms).getUTCDay();
}

/** Whole calendar days from `commencement` to `iso` (can be negative). */
export function isoToOffset(commencement: string, iso: string): number {
  const a = isoToUtc(commencement);
  const b = isoToUtc(iso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_DAY);
}

/** ISO date at a calendar-day `offset` from `commencement`. */
export function offsetToIso(commencement: string, offset: number): string {
  return isoAddDays(commencement, offset);
}

// ── Working-day rules ────────────────────────────────────────────────────────

/** Expand a calendar's holiday entries into a Set of ISO dates. */
export function holidaySet(cal: WorkCalendar): Set<string> {
  const out = new Set<string>();
  for (const h of cal.holidays ?? []) {
    if (h.date) {
      out.add(h.date.slice(0, 10));
    } else if (h.from) {
      const to = (h.to || h.from).slice(0, 10);
      let cur = h.from.slice(0, 10);
      // Guard against an inverted/huge range so a bad row can't loop forever.
      for (let i = 0; i < 366 && cur <= to; i++) {
        out.add(cur);
        cur = isoAddDays(cur, 1);
      }
    }
  }
  return out;
}

/** Expand a resource's leave periods into a Set of ISO dates. */
export function leaveDateSet(periods: LeavePeriod[]): Set<string> {
  const out = new Set<string>();
  for (const p of periods ?? []) {
    if (!p.fromDate) continue;
    const from = p.fromDate.slice(0, 10);
    const to = (p.toDate || p.fromDate).slice(0, 10);
    let cur = from;
    for (let i = 0; i < 1000 && cur <= to; i++) {
      out.add(cur);
      cur = isoAddDays(cur, 1);
    }
  }
  return out;
}

/**
 * Is `iso` a working day for `cal`? A day is non-working if it falls on a weekend
 * day, is in the holiday set, or is in the optional `extraOff` set (e.g. an
 * assigned resource's leave). `holidays` may be pre-expanded for speed.
 */
export function isWorkingDay(
  cal: WorkCalendar,
  iso: string,
  extraOff?: Set<string>,
  holidays?: Set<string>,
): boolean {
  const wd = isoWeekday(iso);
  if ((cal.weekendDays ?? []).includes(wd)) return false;
  const hol = holidays ?? holidaySet(cal);
  if (hol.has(iso)) return false;
  if (extraOff && extraOff.has(iso)) return false;
  return true;
}

/**
 * Build a fast `(offset) => boolean` working-day predicate in CALENDAR-OFFSET
 * space (offset 0 = commencement). The closure pre-expands holidays so repeated
 * CPM calls are cheap. `extraOff` is a per-activity set of ISO dates (the driving
 * resource's leave) that should also count as non-working.
 */
export function workingByOffset(
  cal: WorkCalendar,
  commencement: string,
  extraOff?: Set<string>,
): (offset: number) => boolean {
  const hol = holidaySet(cal);
  return (offset: number) => isWorkingDay(cal, offsetToIso(commencement, offset), extraOff, hol);
}

// ── Placing working-day effort onto the calendar ─────────────────────────────

/**
 * Place `workingDays` of effort starting at calendar-offset `startOffset`, given
 * an `isWorking(offset)` predicate. Returns the (possibly nudged-forward) start —
 * the first working day on/after `startOffset` so a bar never begins mid-weekend —
 * and the finish, which is the offset just after the last working day consumed.
 * The bar therefore spans `finish - start` CALENDAR days while containing exactly
 * `workingDays` working days, so it visually straddles any weekend/holiday/leave.
 *
 * A hard iteration cap keeps a pathological all-non-working calendar from looping.
 */
export function placeWork(
  isWorking: (offset: number) => boolean,
  startOffset: number,
  workingDays: number,
): { start: number; finish: number } {
  const wd = Math.max(0, Math.round(workingDays));
  let start = Math.max(0, Math.round(startOffset));
  const CAP = start + Math.max(1, wd) * 7 + 3660; // generous: ~10yr of weekends

  if (wd === 0) return { start, finish: start }; // milestone — no nudge, zero span

  // Nudge the start forward to the first working day.
  let guard = 0;
  while (!isWorking(start) && guard++ < CAP) start++;

  // Consume `wd` working days; `off` ends just past the last one.
  let consumed = 0;
  let off = start;
  guard = 0;
  while (consumed < wd && guard++ < CAP) {
    if (isWorking(off)) consumed++;
    off++;
  }
  return { start, finish: off };
}

// ── Cost / hours math (shared by UI + Excel) ─────────────────────────────────

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Person-hours for an activity: workingDays × hoursPerDay × allocation%. */
export function activityHours(workingDays: number, hoursPerDay: number, allocationPct = 100): number {
  return Math.max(0, workingDays) * Math.max(0, hoursPerDay) * (Math.max(0, allocationPct) / 100);
}

/**
 * Cost of one resource assignment over `workingDays` working days.
 * - hourly basis: rate × (workingDays × hoursPerDay × alloc%)
 * - daily  basis: rate × workingDays × alloc%
 * `unitsPerDay` multiplies the whole thing (e.g. 2 identical excavators).
 */
export function assignmentCost(
  resource: CostResource,
  workingDays: number,
  hoursPerDay: number,
  allocationPct = 100,
  unitsPerDay = 1,
): number {
  const rate = num(resource.rate);
  if (rate <= 0) return 0;
  const alloc = Math.max(0, allocationPct) / 100;
  const days = Math.max(0, workingDays);
  const units = Math.max(0, num(unitsPerDay) || 1);
  const base = (resource.rateBasis === "daily")
    ? rate * days * alloc
    : rate * days * Math.max(0, hoursPerDay) * alloc;
  return base * units;
}
