// Primavera P6 import: XER and P6 XML.
//
// Almost every large employer issues its programme as a P6 file, and almost
// every contractor has to respond to it. A planning tool that cannot read one
// is a tool the planner exports out of, works around, and eventually stops
// opening. This is the least glamorous feature in the programme module and
// probably the one that decides whether it gets used.
//
// ── THE XER FORMAT ───────────────────────────────────────────────────────────
//
// XER is tab-delimited, table-oriented and undocumented by Oracle. Its shape:
//
//   ERMHDR<TAB>version<TAB>date<TAB>...
//   %T<TAB>TABLE_NAME
//   %F<TAB>field1<TAB>field2<TAB>...
//   %R<TAB>value1<TAB>value2<TAB>...
//   %E
//
// Field ORDER varies between P6 versions, which is the trap: reading by column
// index works against the file you tested and silently mis-assigns against the
// next one. Everything here reads by field NAME.
//
// ── WHAT AN IMPORT MUST NEVER DO ─────────────────────────────────────────────
//
// Silently drop rows. A programme that imports 900 of 1,100 activities looks
// complete, schedules fine, and is missing the section that mattered. Every
// skipped row is counted and explained, and the caller gets those counts
// alongside the data — an import that cannot say what it discarded is not an
// import, it is a guess.
//
// Dates are parsed but treated as advisory: the durations and the logic are
// what this system reschedules from, and a P6 file's stored dates reflect P6's
// own calendars and constraints, which are not fully reproduced here. Importing
// dates as gospel would produce a programme that disagrees with its own CPM.

export interface ImportedActivity {
  /** P6 activity id (`task_code`) — what a planner recognises. */
  key: string;
  name: string;
  /** Original duration in days. */
  duration: number;
  /** Remaining duration, where the file carries progress. */
  remaining?: number;
  percentComplete?: number;
  wbs?: string;
  milestone: boolean;
  /** Predecessor links, with relationship type and lag. */
  predecessors: { key: string; type: "FS" | "SS" | "FF" | "SF"; lagDays: number }[];
  /** P6's own dates, kept for reference and NOT used for scheduling. */
  p6Start?: string | null;
  p6Finish?: string | null;
  calendarId?: string | null;
  /** P6 internal id, needed to resolve relationships. Not shown to users. */
  p6Id: string;
}

export interface ImportResult {
  projectName: string | null;
  activities: ImportedActivity[];
  /** WBS paths, so an imported programme keeps its structure. */
  wbs: { id: string; name: string; parentId: string | null }[];
  calendars: { id: string; name: string; hoursPerDay: number }[];
  /** Rows read, rows kept, and every reason a row was dropped. */
  stats: { rowsRead: number; activitiesKept: number; linksKept: number; skipped: number };
  warnings: string[];
  errors: string[];
}

/** P6 relationship codes → the types cpm.ts understands. */
const REL: Record<string, "FS" | "SS" | "FF" | "SF"> = {
  PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF",
  FS: "FS", SS: "SS", FF: "FF", SF: "SF",
};

/** Task types P6 uses for milestones. */
const MILESTONE_TYPES = new Set(["TT_Mile", "TT_FinMile", "TT_StartMile"]);

interface XerTable { name: string; fields: string[]; rows: string[][] }

/**
 * Split an XER file into its tables.
 *
 * Tolerant on purpose: a `%R` before any `%F`, an unknown directive, a trailing
 * blank line and a stray `\r` are all things real exports contain, and none of
 * them is a reason to reject a planner's file.
 */
export function parseXerTables(text: string): XerTable[] {
  const tables: XerTable[] = [];
  let current: XerTable | null = null;

  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split("\t");
    switch (cells[0]) {
      case "%T":
        current = { name: (cells[1] ?? "").trim(), fields: [], rows: [] };
        tables.push(current);
        break;
      case "%F":
        if (current) current.fields = cells.slice(1).map((f) => f.trim());
        break;
      case "%R":
        // A row before its field list cannot be interpreted by name, and
        // guessing by position is exactly the failure mode this format invites.
        if (current?.fields.length) current.rows.push(cells.slice(1));
        break;
      default:
        break;   // ERMHDR, %E, and anything Oracle adds later
    }
  }
  return tables;
}

/** Read a table's rows as name-keyed records. */
function records(t: XerTable | undefined): Record<string, string>[] {
  if (!t) return [];
  return t.rows.map((r) => {
    const o: Record<string, string> = {};
    t.fields.forEach((f, i) => { o[f] = (r[i] ?? "").trim(); });
    return o;
  });
}

const num = (v: string | undefined): number => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * P6 stores durations in HOURS. Days are what everything downstream works in.
 *
 * The divisor is the activity's calendar hours-per-day where the file gives one,
 * because an 8-hour and a 10-hour calendar turn the same stored number into
 * different durations. Defaulting to 8 when it is missing is a guess, and it is
 * declared as one in the warnings rather than absorbed.
 */
const hoursToDays = (hours: number, hoursPerDay: number) =>
  Math.round((hours / Math.max(1, hoursPerDay)) * 100) / 100;

/** P6 dates are `YYYY-MM-DD HH:MM`. Returned as ISO, or null when unparseable. */
function p6Date(v: string | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00.000Z`;
}

/**
 * Import a P6 XER file.
 *
 * Fields are read by name throughout. P6 changes column order between versions,
 * and index-based reads work perfectly against the file they were written for
 * and silently mis-assign every field against the next one — a programme that
 * imports without error and means something else entirely.
 */
export function importXer(text: string): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const tables = parseXerTables(text);
  if (!tables.length) {
    return {
      projectName: null, activities: [], wbs: [], calendars: [],
      stats: { rowsRead: 0, activitiesKept: 0, linksKept: 0, skipped: 0 },
      warnings: [],
      errors: ["This does not look like an XER file — no %T table markers were found."],
    };
  }

  const table = (n: string) => tables.find((t) => t.name.toUpperCase() === n);
  const projects = records(table("PROJECT"));
  const calRows = records(table("CALENDAR"));
  const wbsRows = records(table("PROJWBS"));
  const taskRows = records(table("TASK"));
  const predRows = records(table("TASKPRED"));

  const rowsRead = taskRows.length + predRows.length;

  if (!taskRows.length) {
    errors.push("No TASK table in this file — there are no activities to import.");
  }

  const calendars = calRows.map((c) => ({
    id: c.clndr_id,
    name: c.clndr_name || c.clndr_id,
    hoursPerDay: num(c.day_hr_cnt) || 8,
  }));
  const calById = new Map(calendars.map((c) => [c.id, c] as const));
  if (calRows.length && calendars.some((c) => !num(String(c.hoursPerDay)))) {
    warnings.push("Some calendars carry no hours-per-day; 8 was assumed for those activities.");
  }

  const wbs = wbsRows.map((w) => ({
    id: w.wbs_id,
    name: w.wbs_name || w.wbs_short_name || w.wbs_id,
    // P6 marks the root by pointing at itself or at nothing.
    parentId: w.parent_wbs_id && w.parent_wbs_id !== w.wbs_id ? w.parent_wbs_id : null,
  }));
  const wbsById = new Map(wbs.map((w) => [w.id, w] as const));

  let skipped = 0;
  const byP6Id = new Map<string, ImportedActivity>();
  const activities: ImportedActivity[] = [];
  let assumedCalendar = 0;

  for (const t of taskRows) {
    const key = (t.task_code || "").trim();
    if (!key) {
      // Without an activity id there is nothing a planner could match this to,
      // and inventing one would put a phantom activity in their programme.
      skipped++;
      continue;
    }
    const cal = calById.get(t.clndr_id);
    if (!cal && t.clndr_id) assumedCalendar++;
    const hpd = cal?.hoursPerDay ?? 8;

    const act: ImportedActivity = {
      key,
      name: (t.task_name || key).trim(),
      duration: hoursToDays(num(t.target_drtn_hr_cnt), hpd),
      remaining: t.remain_drtn_hr_cnt ? hoursToDays(num(t.remain_drtn_hr_cnt), hpd) : undefined,
      percentComplete: t.phys_complete_pct ? num(t.phys_complete_pct) : undefined,
      wbs: wbsById.get(t.wbs_id)?.name,
      milestone: MILESTONE_TYPES.has(t.task_type),
      predecessors: [],
      p6Start: p6Date(t.act_start_date || t.early_start_date || t.target_start_date),
      p6Finish: p6Date(t.act_end_date || t.early_end_date || t.target_end_date),
      calendarId: t.clndr_id || null,
      p6Id: t.task_id,
    };
    activities.push(act);
    if (act.p6Id) byP6Id.set(act.p6Id, act);
  }

  if (assumedCalendar) {
    warnings.push(
      `${assumedCalendar} activit${assumedCalendar === 1 ? "y references a calendar" : "ies reference calendars"} not present in this file; 8 hours per day was assumed, so those durations may be wrong.`,
    );
  }

  let linksKept = 0;
  let danglingLinks = 0;
  for (const p of predRows) {
    const succ = byP6Id.get(p.task_id);
    const pred = byP6Id.get(p.pred_task_id);
    if (!succ || !pred) {
      // A relationship to an activity outside this file — common in a
      // multi-project export. Counted, because a dropped link changes the
      // critical path and nobody should discover that by surprise.
      danglingLinks++;
      continue;
    }
    const type = REL[p.pred_type] ?? "FS";
    if (!REL[p.pred_type] && p.pred_type) {
      warnings.push(`Unknown relationship type '${p.pred_type}' treated as Finish-to-Start.`);
    }
    const hpd = calById.get(succ.calendarId ?? "")?.hoursPerDay ?? 8;
    succ.predecessors.push({ key: pred.key, type, lagDays: hoursToDays(num(p.lag_hr_cnt), hpd) });
    linksKept++;
  }

  if (danglingLinks) {
    warnings.push(
      `${danglingLinks} relationship(s) referenced activities not in this file and were dropped. External links change the critical path — check whether this export was meant to include them.`,
    );
  }
  if (skipped) {
    warnings.push(`${skipped} row(s) had no activity id and were skipped.`);
  }

  return {
    projectName: projects[0]?.proj_short_name || projects[0]?.proj_name || null,
    activities,
    wbs,
    calendars,
    stats: { rowsRead, activitiesKept: activities.length, linksKept, skipped },
    warnings,
    errors,
  };
}

/**
 * Import a P6 XML file.
 *
 * P6 XML is the documented, schema-backed alternative to XER and is what newer
 * integrations emit. Parsed with a small tag reader rather than a DOM
 * dependency: the subset needed here is shallow and regular, and a P6 export can
 * be hundreds of megabytes — which is also why the tag reader is non-recursive.
 */
export function importP6Xml(text: string): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const xml = String(text ?? "");

  if (!/<(?:APIBusinessObjects|Project)\b/i.test(xml)) {
    return {
      projectName: null, activities: [], wbs: [], calendars: [],
      stats: { rowsRead: 0, activitiesKept: 0, linksKept: 0, skipped: 0 },
      warnings: [],
      errors: ["This does not look like a P6 XML file."],
    };
  }

  const blocks = (tag: string): string[] =>
    [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
  const field = (block: string, tag: string): string | undefined => {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
    return m ? decodeEntities(m[1].trim()) : undefined;
  };

  const calendars = blocks("Calendar").map((c) => ({
    id: field(c, "ObjectId") ?? "",
    name: field(c, "Name") ?? "",
    hoursPerDay: Number(field(c, "HoursPerDay") ?? 8) || 8,
  }));
  const calById = new Map(calendars.map((c) => [c.id, c] as const));

  const wbs = blocks("WBS").map((w) => ({
    id: field(w, "ObjectId") ?? "",
    name: field(w, "Name") ?? "",
    parentId: field(w, "ParentObjectId") || null,
  }));
  const wbsById = new Map(wbs.map((w) => [w.id, w] as const));

  const taskBlocks = blocks("Activity");
  const relBlocks = blocks("Relationship");
  let skipped = 0;

  const byObjectId = new Map<string, ImportedActivity>();
  const activities: ImportedActivity[] = [];

  for (const b of taskBlocks) {
    const key = field(b, "Id") ?? "";
    if (!key) { skipped++; continue; }
    const calId = field(b, "CalendarObjectId") ?? "";
    const hpd = calById.get(calId)?.hoursPerDay ?? 8;
    const type = field(b, "Type") ?? "";

    const act: ImportedActivity = {
      key,
      name: field(b, "Name") ?? key,
      duration: hoursToDays(Number(field(b, "PlannedDuration") ?? 0) || 0, hpd),
      remaining: field(b, "RemainingDuration") != null
        ? hoursToDays(Number(field(b, "RemainingDuration")) || 0, hpd) : undefined,
      percentComplete: field(b, "PercentComplete") != null
        ? Number(field(b, "PercentComplete")) || 0 : undefined,
      wbs: wbsById.get(field(b, "WBSObjectId") ?? "")?.name,
      milestone: /Milestone/i.test(type),
      predecessors: [],
      p6Start: p6Date(field(b, "StartDate") ?? field(b, "PlannedStartDate")),
      p6Finish: p6Date(field(b, "FinishDate") ?? field(b, "PlannedFinishDate")),
      calendarId: calId || null,
      p6Id: field(b, "ObjectId") ?? "",
    };
    activities.push(act);
    if (act.p6Id) byObjectId.set(act.p6Id, act);
  }

  let linksKept = 0;
  let dangling = 0;
  for (const r of relBlocks) {
    const succ = byObjectId.get(field(r, "SuccessorActivityObjectId") ?? "");
    const pred = byObjectId.get(field(r, "PredecessorActivityObjectId") ?? "");
    if (!succ || !pred) { dangling++; continue; }
    const t = (field(r, "Type") ?? "").replace(/\s/g, "");
    const type: "FS" | "SS" | "FF" | "SF" =
      /^FinishtoStart$/i.test(t) ? "FS" :
      /^StarttoStart$/i.test(t) ? "SS" :
      /^FinishtoFinish$/i.test(t) ? "FF" :
      /^StarttoFinish$/i.test(t) ? "SF" : "FS";
    const hpd = calById.get(succ.calendarId ?? "")?.hoursPerDay ?? 8;
    succ.predecessors.push({ key: pred.key, type, lagDays: hoursToDays(Number(field(r, "Lag") ?? 0) || 0, hpd) });
    linksKept++;
  }

  if (dangling) {
    warnings.push(`${dangling} relationship(s) referenced activities not in this file and were dropped.`);
  }
  if (skipped) warnings.push(`${skipped} activit(y/ies) had no Id and were skipped.`);
  if (!activities.length) errors.push("No activities found in this P6 XML file.");

  return {
    projectName: blocks("Project").length ? (field(blocks("Project")[0], "Name") ?? null) : null,
    activities, wbs, calendars,
    stats: { rowsRead: taskBlocks.length + relBlocks.length, activitiesKept: activities.length, linksKept, skipped },
    warnings, errors,
  };
}

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Pick the right importer from the file's own content, not its extension. */
export function importProgramme(text: string): ImportResult {
  const head = String(text ?? "").slice(0, 2000);
  // Extensions lie — planners rename files. The content does not.
  return /^\s*(?:ERMHDR|%T)\b/m.test(head) ? importXer(text) : importP6Xml(text);
}

/**
 * Convert an import into the rows cpm.ts schedules from.
 *
 * Deliberately drops P6's stored dates. They reflect P6's calendars,
 * constraints and scheduling options, none of which are reproduced here, so
 * carrying them through would produce a programme whose displayed dates
 * disagree with its own critical path. Durations and logic re-schedule cleanly;
 * dates do not.
 */
export function toCpmRows(r: ImportResult): any[] {
  return r.activities.map((a) => ({
    payload: {
      activity: a.key,
      name: a.name,
      duration_days: a.duration,
      milestone: a.milestone,
      wbs: a.wbs,
      // The shape linksOf() reads: typed objects, not encoded strings. A string
      // form would be parsed by the `predecessors` fallback as a bare activity
      // name, quietly flattening every SS/FF relationship and every lag into
      // Finish-to-Start — a network that schedules cleanly and is not the one
      // the planner sent.
      depends_on: a.predecessors.map((p) => ({
        activity: p.key,
        type: p.type,
        lag_days: p.lagDays,
      })),
    },
  }));
}
