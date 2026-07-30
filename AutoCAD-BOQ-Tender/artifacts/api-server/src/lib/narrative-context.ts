/**
 * Grounding context for the Technical Narrative generator.
 *
 * The bid-writer sections (Executive Summary, Technical Approach, Programme,
 * Quality, HSE, Risk, …) must be written from the project's REAL data, not from
 * the project name alone. This module assembles that data from three sources the
 * rest of the platform already produces:
 *
 *   1. Project documents — the PROPERLY EXTRACTED text from `cad_chunks`
 *      (PyMuPDF section text + vision findings + title blocks + schedules), NOT
 *      `fs.readFileSync(filePath)` which returns binary garbage for PDFs. This is
 *      the same high-signal chunk path the multi-agent BOQ pipeline reads.
 *   2. The priced Bill of Quantities (`boq_items`) — the actual quantified scope.
 *   3. The work programme (`schedule_activities`) — phases, durations, milestones.
 *   4. The SOW outline (`sow_sections`) — the document's own scope breakdown.
 *
 * Everything is digested to a compact, prompt-friendly form with hard length
 * caps so a long tender + a big BOQ never blow the model's context window.
 */
import { db } from "@workspace/db";
import {
  documentsTable,
  boqItemsTable,
  scheduleActivitiesTable,
  sowSectionsTable,
  cadChunksTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

/** Higher = surfaced first / survives truncation. Mirrors multi-agent-boq.ts. */
const CHUNK_PRIORITY: Record<string, number> = {
  vision_finding: 5,
  document_section: 4,
  title_block: 3,
  schedule: 2,
  text: 1,
  sheet_summary: 0,
};

const CHUNK_TYPES = [
  "vision_finding",
  "document_section",
  "title_block",
  "schedule",
  "text",
  "sheet_summary",
] as const;

export interface NarrativeContext {
  /** Prioritised, length-capped excerpt of the real parsed document text. */
  docExcerpt: string;
  /** Per-category roll-up of the priced BOQ (the quantified scope). */
  boqDigest: string;
  /** The work programme: phases, activities, durations, milestones. */
  scheduleDigest: string;
  /** The SOW outline (document's own scope breakdown). */
  outlineDigest: string;
  stats: {
    documents: number;
    boqItems: number;
    scheduleActivities: number;
    totalDurationDays: number;
    docChars: number;
  };
}

/** Pull the parsed-from-cad_chunks document text, prioritised and capped. */
async function gatherDocExcerpt(
  projectId: number,
  totalBudget: number,
): Promise<{ text: string; docCount: number }> {
  const documents = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId));

  const succeededIds = documents
    .filter(d => d.cadExtractionStatus === "succeeded")
    .map(d => d.id);
  if (succeededIds.length === 0) return { text: "", docCount: documents.length };

  const chunks = await db
    .select({
      documentId: cadChunksTable.documentId,
      chunkType: cadChunksTable.chunkType,
      text: cadChunksTable.text,
    })
    .from(cadChunksTable)
    .where(
      and(
        inArray(cadChunksTable.documentId, succeededIds),
        inArray(cadChunksTable.chunkType, [...CHUNK_TYPES]),
      ),
    );

  const byDoc = new Map<number, typeof chunks>();
  for (const c of chunks) {
    const arr = byDoc.get(c.documentId) ?? [];
    arr.push(c);
    byDoc.set(c.documentId, arr);
  }

  // Cap per document so one huge tender can't crowd out the others, then cap the
  // whole excerpt. The high-signal chunks (vision/section/title) sort first, so
  // truncation drops the noisy page-text dumps before the scope-bearing text.
  const perDocBudget = Math.max(
    2000,
    Math.floor(totalBudget / Math.max(1, byDoc.size)),
  );
  let used = 0;
  const blocks: string[] = [];
  for (const doc of documents) {
    if (used >= totalBudget) break;
    const docChunks = byDoc.get(doc.id);
    if (!docChunks || docChunks.length === 0) continue;
    const ordered = [...docChunks].sort(
      (a, b) => (CHUNK_PRIORITY[b.chunkType] ?? 0) - (CHUNK_PRIORITY[a.chunkType] ?? 0),
    );
    let stitched = ordered.map(c => c.text).join("\n\n");
    const cap = Math.min(perDocBudget, totalBudget - used);
    if (stitched.length > cap) stitched = `${stitched.slice(0, cap)}\n[... truncated ...]`;
    blocks.push(
      `========= ${doc.originalName} (${doc.documentType ?? "other"}) =========\n${stitched}`,
    );
    used += stitched.length;
  }

  return { text: blocks.join("\n\n"), docCount: documents.length };
}

/** Roll the priced BOQ up by category: count, units, sample descriptions. */
async function gatherBoqDigest(
  projectId: number,
  maxChars = 5000,
): Promise<{ digest: string; itemCount: number }> {
  const items = await db
    .select({
      category: boqItemsTable.category,
      description: boqItemsTable.description,
      unit: boqItemsTable.unit,
      quantity: boqItemsTable.quantity,
    })
    .from(boqItemsTable)
    .where(eq(boqItemsTable.projectId, projectId));
  if (items.length === 0) return { digest: "", itemCount: 0 };

  const byCat = new Map<
    string,
    { count: number; units: Set<string>; samples: string[] }
  >();
  for (const it of items) {
    const cat = (it.category || "Uncategorised").trim();
    const entry = byCat.get(cat) ?? { count: 0, units: new Set<string>(), samples: [] };
    entry.count++;
    if (it.unit) entry.units.add(String(it.unit).trim());
    if (entry.samples.length < 5 && it.description) {
      const qty = it.quantity != null ? `${it.quantity} ${it.unit ?? ""} ` : "";
      entry.samples.push(`${qty}${String(it.description).trim().slice(0, 90)}`.trim());
    }
    byCat.set(cat, entry);
  }

  const lines: string[] = [];
  let used = 0;
  for (const [cat, e] of byCat) {
    const units = [...e.units].slice(0, 8).join(", ");
    const line = `• ${cat} — ${e.count} line item(s)${units ? ` [units: ${units}]` : ""}\n    e.g. ${e.samples.join("; ")}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { digest: lines.join("\n"), itemCount: items.length };
}

/** Digest the work programme: phases, durations, milestones, total duration. */
async function gatherScheduleDigest(
  projectId: number,
  maxChars = 4000,
): Promise<{ digest: string; activityCount: number; totalDurationDays: number }> {
  const acts = await db
    .select()
    .from(scheduleActivitiesTable)
    .where(eq(scheduleActivitiesTable.projectId, projectId))
    .orderBy(scheduleActivitiesTable.seq);
  if (acts.length === 0) return { digest: "", activityCount: 0, totalDurationDays: 0 };

  const totalDurationDays = acts.reduce(
    (m, a) => Math.max(m, (a.startOffsetDays ?? 0) + (a.durationDays ?? 0)),
    0,
  );

  // Group by phase, preserving first-seen order.
  const byPhase = new Map<string, typeof acts>();
  for (const a of acts) {
    const phase = (a.phase || "General").trim();
    const arr = byPhase.get(phase) ?? [];
    arr.push(a);
    byPhase.set(phase, arr);
  }

  const lines: string[] = [
    `Total programme duration: ${totalDurationDays} calendar days (~${Math.round(totalDurationDays / 7)} weeks).`,
  ];
  let used = lines[0].length;
  for (const [phase, list] of byPhase) {
    const header = `▸ ${phase}`;
    if (used + header.length > maxChars) break;
    lines.push(header);
    used += header.length + 1;
    for (const a of list) {
      const when = a.isMilestone
        ? `milestone @ day ${a.startOffsetDays}`
        : `day ${a.startOffsetDays}–${(a.startOffsetDays ?? 0) + (a.durationDays ?? 0)} (${a.durationDays}d)`;
      const ref = a.sowRef ? ` [SOW ${a.sowRef}]` : "";
      const line = `    - ${a.activity} — ${when}${ref}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
  }
  return { digest: lines.join("\n"), activityCount: acts.length, totalDurationDays };
}

/** Flatten the persisted SOW outline into indented "ref — title [basis]" lines. */
async function gatherOutlineDigest(projectId: number, maxChars = 3500): Promise<string> {
  const sections = await db
    .select()
    .from(sowSectionsTable)
    .where(eq(sowSectionsTable.projectId, projectId))
    .orderBy(sowSectionsTable.seq);
  if (sections.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const s of sections) {
    const indent = s.parentSowRef ? "    " : "";
    const basis = s.measurementBasis ? ` [${s.measurementBasis}]` : "";
    const line = `${indent}${s.sowRef} ${s.title}${basis}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * Assemble the full grounding context for a project's technical narrative.
 * Each piece degrades gracefully to an empty string when that data isn't there
 * (e.g. no BOQ generated yet, no programme built yet).
 */
export async function gatherNarrativeContext(
  projectId: number,
  opts?: { docBudget?: number },
): Promise<NarrativeContext> {
  const docBudget = opts?.docBudget ?? 22000;
  const [doc, boq, schedule, outlineDigest] = await Promise.all([
    gatherDocExcerpt(projectId, docBudget),
    gatherBoqDigest(projectId),
    gatherScheduleDigest(projectId),
    gatherOutlineDigest(projectId),
  ]);

  return {
    docExcerpt: doc.text,
    boqDigest: boq.digest,
    scheduleDigest: schedule.digest,
    outlineDigest,
    stats: {
      documents: doc.docCount,
      boqItems: boq.itemCount,
      scheduleActivities: schedule.activityCount,
      totalDurationDays: schedule.totalDurationDays,
      docChars: doc.text.length,
    },
  };
}
