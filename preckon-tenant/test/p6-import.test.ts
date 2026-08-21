// P6 import.
//
// The failures worth testing are the silent ones. An import that throws gets
// fixed; an import that returns 900 of 1,100 activities, or reads the right
// number from the wrong column, produces a programme that schedules fine and
// means something else.

import { describe, it, expect } from "vitest";
import {
  importXer, importP6Xml, importProgramme, parseXerTables, toCpmRows,
} from "@/lib/programme/p6-import";
import { computeCpm } from "@/lib/cpm";

/** Build an XER table block with an explicit field order. */
const tbl = (name: string, fields: string[], rows: string[][]) =>
  [`%T\t${name}`, `%F\t${fields.join("\t")}`, ...rows.map((r) => `%R\t${r.join("\t")}`)].join("\n");

const XER = [
  "ERMHDR\t19.12\t2026-08-20\tProject\tadmin\tPreckon",
  tbl("PROJECT", ["proj_id", "proj_short_name", "proj_name"], [["1", "CS-01", "Cedarstone"]]),
  tbl("CALENDAR", ["clndr_id", "clndr_name", "day_hr_cnt"], [["C1", "5 day", "8"]]),
  tbl("PROJWBS", ["wbs_id", "wbs_name", "parent_wbs_id"], [
    ["W1", "Substructure", "W1"],
    ["W2", "Superstructure", "W1"],
  ]),
  tbl("TASK",
    ["task_id", "task_code", "task_name", "task_type", "target_drtn_hr_cnt", "clndr_id", "wbs_id", "early_start_date"],
    [
      ["101", "A1000", "Excavate", "TT_Task", "80", "C1", "W1", "2026-09-01 08:00"],
      ["102", "A1010", "Blind and pour", "TT_Task", "40", "C1", "W1", "2026-09-11 08:00"],
      ["103", "A1020", "Substructure complete", "TT_Mile", "0", "C1", "W1", "2026-09-16 08:00"],
    ]),
  tbl("TASKPRED",
    ["task_pred_id", "task_id", "pred_task_id", "pred_type", "lag_hr_cnt"],
    [
      ["1", "102", "101", "PR_FS", "0"],
      ["2", "103", "102", "PR_FS", "0"],
    ]),
  "%E",
].join("\n");

describe("reading the format", () => {
  it("splits tables, fields and rows", () => {
    const t = parseXerTables(XER);
    expect(t.map((x) => x.name)).toEqual(["PROJECT", "CALENDAR", "PROJWBS", "TASK", "TASKPRED"]);
    expect(t.find((x) => x.name === "TASK")!.rows).toHaveLength(3);
  });

  it("survives CRLF line endings", () => {
    expect(parseXerTables(XER.replace(/\n/g, "\r\n")).length).toBe(5);
  });

  it("ignores a row that arrives before its field list", () => {
    // Reading it would mean assigning by position, which is the exact failure
    // this format invites.
    const t = parseXerTables(["%T\tTASK", "%R\t1\t2\t3", "%F\ta\tb\tc"].join("\n"));
    expect(t[0].rows).toEqual([]);
  });

  it("says so when the file is not an XER at all", () => {
    const r = importXer("just some text");
    expect(r.errors[0]).toMatch(/does not look like an XER file/);
    expect(r.activities).toEqual([]);
  });
});

describe("reading by field name, not column position", () => {
  it("gets the same result when P6 reorders its columns", () => {
    /* The trap this format sets. P6 changes field order between versions, so an
       index-based reader works perfectly against the file it was written for and
       silently mis-assigns every field against the next one. */
    const reordered = [
      "ERMHDR\t19.12",
      tbl("CALENDAR", ["day_hr_cnt", "clndr_name", "clndr_id"], [["8", "5 day", "C1"]]),
      tbl("TASK",
        ["task_name", "clndr_id", "task_code", "target_drtn_hr_cnt", "task_type", "task_id"],
        [["Excavate", "C1", "A1000", "80", "TT_Task", "101"]]),
      "%E",
    ].join("\n");
    const r = importXer(reordered);
    expect(r.activities[0]).toMatchObject({ key: "A1000", name: "Excavate", duration: 10 });
  });
});

describe("durations", () => {
  it("converts P6 hours to days using the activity's own calendar", () => {
    // 80 hours on an 8-hour calendar is 10 days.
    expect(importXer(XER).activities[0].duration).toBe(10);
  });

  it("uses a ten-hour calendar where the file says so", () => {
    // The same 80 hours is 8 days on a 10-hour calendar. Assuming 8 everywhere
    // would overstate this programme by 25%.
    const x = XER.replace('["C1", "5 day", "8"]', "").replace(
      tbl("CALENDAR", ["clndr_id", "clndr_name", "day_hr_cnt"], [["C1", "5 day", "8"]]),
      tbl("CALENDAR", ["clndr_id", "clndr_name", "day_hr_cnt"], [["C1", "long day", "10"]]),
    );
    expect(importXer(x).activities[0].duration).toBe(8);
  });

  it("warns when it had to assume a calendar", () => {
    const x = XER.replace(
      tbl("CALENDAR", ["clndr_id", "clndr_name", "day_hr_cnt"], [["C1", "5 day", "8"]]),
      tbl("CALENDAR", ["clndr_id", "clndr_name", "day_hr_cnt"], [["C9", "other", "8"]]),
    );
    const r = importXer(x);
    expect(r.warnings.some((w) => /8 hours per day was assumed/.test(w))).toBe(true);
  });
});

describe("what came through", () => {
  it("reports counts rather than leaving the caller to guess", () => {
    const r = importXer(XER);
    expect(r.stats).toMatchObject({ activitiesKept: 3, linksKept: 2, skipped: 0 });
    expect(r.projectName).toBe("CS-01");
  });

  it("recognises milestones by P6's task type", () => {
    expect(importXer(XER).activities.find((a) => a.key === "A1020")!.milestone).toBe(true);
    expect(importXer(XER).activities.find((a) => a.key === "A1000")!.milestone).toBe(false);
  });

  it("attaches the WBS name", () => {
    expect(importXer(XER).activities[0].wbs).toBe("Substructure");
  });

  it("treats a self-parented WBS node as the root", () => {
    const wbs = importXer(XER).wbs;
    expect(wbs.find((w) => w.id === "W1")!.parentId).toBeNull();
    expect(wbs.find((w) => w.id === "W2")!.parentId).toBe("W1");
  });
});

describe("nothing is dropped silently", () => {
  it("counts and explains an activity with no id", () => {
    const x = XER.replace(
      '%R\t103\tA1020\tSubstructure complete\tTT_Mile\t0\tC1\tW1\t2026-09-16 08:00',
      '%R\t103\t\tSubstructure complete\tTT_Mile\t0\tC1\tW1\t2026-09-16 08:00',
    );
    const r = importXer(x);
    expect(r.stats.skipped).toBe(1);
    expect(r.stats.activitiesKept).toBe(2);
    expect(r.warnings.some((w) => /no activity id/.test(w))).toBe(true);
  });

  it("counts a relationship pointing outside the file and says why it matters", () => {
    const x = XER.replace('%R\t1\t102\t101\tPR_FS\t0', '%R\t1\t102\t999\tPR_FS\t0');
    const r = importXer(x);
    expect(r.stats.linksKept).toBe(1);
    expect(r.warnings.some((w) => /change the critical path/.test(w))).toBe(true);
  });

  it("errors rather than returning an empty programme as a success", () => {
    const r = importXer(["ERMHDR\t19.12", tbl("PROJECT", ["proj_id"], [["1"]]), "%E"].join("\n"));
    expect(r.errors.some((e) => /No TASK table/.test(e))).toBe(true);
  });
});

describe("relationships", () => {
  it("carries the relationship type and lag through", () => {
    const x = XER.replace('%R\t1\t102\t101\tPR_FS\t0', '%R\t1\t102\t101\tPR_SS\t16');
    const link = importXer(x).activities.find((a) => a.key === "A1010")!.predecessors[0];
    expect(link).toEqual({ key: "A1000", type: "SS", lagDays: 2 });
  });

  it("falls back to Finish-to-Start for an unknown type, and says it did", () => {
    const x = XER.replace('%R\t1\t102\t101\tPR_FS\t0', '%R\t1\t102\t101\tPR_XX\t0');
    const r = importXer(x);
    expect(r.activities.find((a) => a.key === "A1010")!.predecessors[0].type).toBe("FS");
    expect(r.warnings.some((w) => /Unknown relationship type/.test(w))).toBe(true);
  });
});

describe("handing the programme to CPM", () => {
  it("produces a network CPM actually schedules", () => {
    /* The check that catches an invented row shape. depends_on must be typed
       objects; a string form is read by the `predecessors` fallback as a bare
       name, flattening every SS/FF and every lag to Finish-to-Start — a network
       that computes cleanly and is not the one that was imported. */
    const cpm = computeCpm(toCpmRows(importXer(XER)));
    expect(cpm.warnings).toEqual([]);
    expect(cpm.total).toBe(15);   // 10 + 5, then a zero-duration milestone
    expect(cpm.nodes.find((n) => n.key === "A1010")!.es).toBe(10);
  });

  it("preserves a lagged start-to-start through to the schedule", () => {
    const x = XER.replace('%R\t1\t102\t101\tPR_FS\t0', '%R\t1\t102\t101\tPR_SS\t16');
    const cpm = computeCpm(toCpmRows(importXer(x)));
    // SS with 2 days lag: A1010 starts on day 2, not after A1000 finishes.
    expect(cpm.nodes.find((n) => n.key === "A1010")!.es).toBe(2);
  });

  it("leaves P6's own dates out of the schedule", () => {
    // They reflect P6's calendars and constraints, which are not reproduced
    // here; carrying them would produce dates that disagree with the CPM.
    const rows = toCpmRows(importXer(XER));
    expect(JSON.stringify(rows)).not.toMatch(/2026-09-01/);
    // But they survive on the import itself, for reference.
    expect(importXer(XER).activities[0].p6Start).toMatch(/^2026-09-01T08:00/);
  });
});

describe("P6 XML", () => {
  const XML = `<?xml version="1.0"?>
<APIBusinessObjects>
  <Project><Name>Cedarstone</Name></Project>
  <Calendar><ObjectId>9</ObjectId><Name>Standard</Name><HoursPerDay>8</HoursPerDay></Calendar>
  <WBS><ObjectId>W1</ObjectId><Name>Substructure</Name></WBS>
  <Activity>
    <ObjectId>101</ObjectId><Id>A1000</Id><Name>Excavate &amp; cart away</Name>
    <Type>Task Dependent</Type><PlannedDuration>80</PlannedDuration>
    <CalendarObjectId>9</CalendarObjectId><WBSObjectId>W1</WBSObjectId>
  </Activity>
  <Activity>
    <ObjectId>102</ObjectId><Id>A1010</Id><Name>Blind and pour</Name>
    <Type>Task Dependent</Type><PlannedDuration>40</PlannedDuration>
    <CalendarObjectId>9</CalendarObjectId>
  </Activity>
  <Relationship>
    <PredecessorActivityObjectId>101</PredecessorActivityObjectId>
    <SuccessorActivityObjectId>102</SuccessorActivityObjectId>
    <Type>Finish to Start</Type><Lag>0</Lag>
  </Relationship>
</APIBusinessObjects>`;

  it("reads activities, durations and links", () => {
    const r = importP6Xml(XML);
    expect(r.stats).toMatchObject({ activitiesKept: 2, linksKept: 1 });
    expect(r.activities[0].duration).toBe(10);
    expect(r.activities[1].predecessors[0]).toEqual({ key: "A1000", type: "FS", lagDays: 0 });
  });

  it("decodes XML entities in names", () => {
    expect(importP6Xml(XML).activities[0].name).toBe("Excavate & cart away");
  });

  it("says so when the file is not P6 XML", () => {
    expect(importP6Xml("<html></html>").errors[0]).toMatch(/does not look like a P6 XML/);
  });
});

describe("choosing the importer", () => {
  it("picks by content, because planners rename files", () => {
    expect(importProgramme(XER).stats.activitiesKept).toBe(3);
    expect(importProgramme('<APIBusinessObjects><Project><Name>X</Name></Project></APIBusinessObjects>').errors)
      .toContain("No activities found in this P6 XML file.");
  });
});
