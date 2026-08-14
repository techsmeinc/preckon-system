import { uuidv7 } from "uuidv7";
import { query } from "./db";
import { typeMatchSql } from "./artifact-types";

// Learning from being corrected.
//
// The workspace already carries a correction WITHIN a project — an agent reads
// only confirmed artifacts, so a quantity you fix is the one that gets priced.
// This carries it BETWEEN projects: the estimator who corrects the same rate on
// four tenders should correct it once.
//
// It is retrieval, not training. A lesson is a row a human can read, argue with
// and retire, and an agent that uses one can say so. A fine-tuned model could
// do neither — and this product's entire claim is that every number can be
// traced back to something.
//
// TOKENS. This makes generation CHEAPER, not dearer. Lessons are matched
// against the records actually in front of the agent, so a run carries a
// handful of lines rather than a rate book; and a proposal that lands right the
// first time is a review cycle and a re-run that never happen — which is where
// the real spend is.

/** What a correction has to be about before it is worth remembering. */
const LEARNABLE: Record<string, { subject: string[]; fields: string[] }> = {
  // A rate corrected against a BOQ code is the single most repeated correction
  // in estimating, and the one that costs money when it is missed.
  cost_line: { subject: ["boq_code", "code"], fields: ["rate_minor", "currency", "rate_source"] },
  // Descriptions and units drift from house style; quantities are project
  // facts and are deliberately NOT learned — last job's quantity has nothing
  // to say about this job's building.
  boq_line: { subject: ["code", "description"], fields: ["unit", "description"] },
  // How something was measured travels; what it measured does not.
  drawing_measurement: { subject: ["item"], fields: ["unit", "method"] },
  schedule_activity: { subject: ["activity"], fields: ["trade", "phase"] },
};

const shortType = (t: string) => t.split(".").pop() ?? t;
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().slice(0, 255);
const asText = (v: unknown) =>
  v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Record what a human changed, if it is the sort of thing that repeats.
 *
 * Called from editArtifact, which is the one place that holds both the agent's
 * proposal and the correction. Deliberately silent on failure: learning is a
 * side effect of an edit, and an edit must never fail because the workspace
 * could not take a note about it.
 */
export async function captureCorrections(
  tenantId: string,
  projectId: string | null,
  typeKey: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  userId: string
): Promise<number> {
  try {
    const rule = LEARNABLE[shortType(typeKey)];
    if (!rule || !before || !after) return 0;

    // The subject is the first key the record actually carries — a cost line is
    // identified by its BOQ code, a bill line by its code or, failing that, its
    // description.
    const subject = rule.subject.map((k) => norm((after as any)[k] ?? (before as any)[k])).find(Boolean);
    if (!subject) return 0;

    let learned = 0;
    for (const field of rule.fields) {
      const was = asText(before[field]);
      const now = asText(after[field]);
      // Nothing changed, or the human cleared it — an emptied field is a
      // deletion, not a preference, and teaching "make this blank" is wrong.
      if (now === null || now === "" || was === now) continue;

      await query(
        `INSERT INTO learned_lesson
           (id, tenant_id, project_id, type_key, subject, field, was_value, now_value, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           -- The same correction made again is the same lesson, held harder.
           times_seen = times_seen + 1,
           was_value  = VALUES(was_value),
           now_value  = VALUES(now_value),
           status     = 'active',
           updated_at = NOW(3)`,
        [uuidv7(), tenantId, projectId, typeKey, subject, field, was, now, userId]
      );
      learned++;
    }
    return learned;
  } catch {
    // See above: an edit that succeeded must not be reported as failed because
    // the lesson table was unavailable.
    return 0;
  }
}

export interface Lesson {
  subject: string;
  field: string;
  was_value: string | null;
  now_value: string;
  times_seen: number;
}

/**
 * The lessons that apply to the records an agent is about to work on.
 *
 * Matched, never dumped. Handing an agent everything this workspace has ever
 * learned would be the rate-book problem again — thousands of tokens of mostly
 * irrelevant preference, most of it about work this project does not contain.
 *
 * Ordered by how often a human has repeated the correction, because that is the
 * only evidence available that a lesson is a house rule rather than a one-off.
 */
export async function lessonsFor(
  tenantId: string,
  typeKey: string,
  subjects: string[],
  limit = 40
): Promise<Lesson[]> {
  const keys = [...new Set(subjects.map(norm).filter(Boolean))].slice(0, 200);
  if (!keys.length) return [];
  const ph = keys.map(() => "?").join(",");
  return query<Lesson>(
    `SELECT subject, field, was_value, now_value, times_seen
       FROM learned_lesson
      WHERE tenant_id = ? AND ${typeMatchSql("type_key", typeKey).sql} AND status = 'active' AND subject IN (${ph})
      ORDER BY times_seen DESC, updated_at DESC
      LIMIT ${Math.min(100, Math.max(1, limit))}`,
    [tenantId, ...typeMatchSql("type_key", typeKey).params, ...keys]
  );
}

/** The subjects to look lessons up by, given the records going into a run. */
export function subjectsOf(typeKey: string, records: Array<{ payload?: any }>): string[] {
  const rule = LEARNABLE[shortType(typeKey)];
  if (!rule) return [];
  const out: string[] = [];
  for (const r of records) {
    for (const k of rule.subject) {
      const v = r?.payload?.[k];
      if (v) { out.push(String(v)); break; }
    }
  }
  return out;
}
