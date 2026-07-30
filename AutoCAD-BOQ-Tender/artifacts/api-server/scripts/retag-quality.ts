/**
 * Maintenance script — re-run the (zero-token) estimator QA classifier over BOQ
 * rows already in the DB and rewrite their scope-type (remarks) + QA tag (notes)
 * IN PLACE. No model calls. Safe to re-run (idempotent).
 *
 * Usage:  DATABASE_URL=mysql://root@localhost:3306/boq_tender \
 *         npx esbuild scripts/retag-quality.ts --bundle --platform=node \
 *           --format=cjs --packages=external --outfile=scripts/retag-quality.cjs \
 *         && node scripts/retag-quality.cjs [projectId]
 *
 * projectId defaults to all projects when omitted.
 */
import mysql from "mysql2/promise";
import { assessItemQuality, scopeTypeRemark, qualityNote, validateQuantity, reviewSuffix, quantityConfidence, confidenceSuffix } from "../src/lib/estimator-style";
import { normalizeUnit } from "../src/lib/boq-units";

// The scope-type strings the classifier can produce — used to tell apart a
// remarks value WE set previously (overwrite-able) from free text the model or a
// QS wrote (must be preserved).
const SCOPE_VALUES = new Set<string>([
  "Supply & Install", "Supply Only", "Install Only", "Testing & Commissioning",
  "Demolition / Disposal", "Connection to Existing", "Design / Submittal",
  "Allowance / Provisional", "Temporary Works", "General",
]);

/** Strip any previously-appended QA tag (both the old `[QA NN%: …]` and the new
 *  `[QA] Scope — QA NN%: …` forms) from the end of a notes string. */
function stripQaTag(notes: string | null): string {
  if (!notes) return "";
  const idx = notes.indexOf("[QA");
  return (idx >= 0 ? notes.slice(0, idx) : notes).trimEnd();
}

async function main() {
  const url = process.env.DATABASE_URL || "mysql://root@localhost:3306/boq_tender";
  const projectArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const conn = await mysql.createConnection(url);

  const [rows] = await conn.execute<any[]>(
    projectArg
      ? "SELECT id, project_id, category, description, unit, quantity, notes, remarks, verification_status FROM boq_items WHERE project_id = ?"
      : "SELECT id, project_id, category, description, unit, quantity, notes, remarks, verification_status FROM boq_items",
    projectArg ? [projectArg] : [],
  );

  let updated = 0;
  let unitFixed = 0;
  let reviewCount = 0;
  let reviewHigh = 0;
  const scopeCounts: Record<string, number> = {};
  const confCounts: Record<string, number> = { High: 0, Medium: 0, Low: 0, TBD: 0 };
  let qSum = 0;

  for (const r of rows) {
    // unit: normalise the stored spelling so EVERY export path (not just the
    // AIGCC one, which normalises on display) reads a clean token.
    const curUnit: string = r.unit ?? "";
    const newUnit = normalizeUnit(curUnit);

    const qa = assessItemQuality({
      description: r.description, category: r.category, unit: newUnit, notes: r.notes,
    });
    qSum += qa.score;
    scopeCounts[qa.scopeType] = (scopeCounts[qa.scopeType] ?? 0) + 1;

    // Quantity Validator — flag lines a human must check.
    const evItem = { description: r.description, category: r.category, unit: newUnit, notes: r.notes, quantity: r.quantity };
    const qv = validateQuantity(evItem);
    if (qv.needsReview) { reviewCount++; if (qv.severity === "high") reviewHigh++; }
    const conf = quantityConfidence(evItem);
    confCounts[conf] = (confCounts[conf] ?? 0) + 1;

    // remarks: set scope-type only when empty or when it currently holds a
    // scope-type value we wrote before. Never clobber model/QS free text.
    const curRemarks: string | null = r.remarks ?? null;
    const scopeTag = scopeTypeRemark(qa.scopeType); // "" for General
    const newRemarks =
      !curRemarks || SCOPE_VALUES.has(curRemarks) ? (scopeTag || null) : curRemarks;

    // notes: strip the old QA tag, append a fresh one (review + confidence).
    const base = stripQaTag(r.notes ?? null);
    const newNotes = `${base ? `${base} ` : ""}${qualityNote(qa)}${reviewSuffix(qv)}${confidenceSuffix(conf)}`;

    // verification_status: mark needs_review when flagged. When NOT flagged but a
    // prior run had set needs_review, clear it back to unverified so fixed lines
    // don't keep a stale flag. Never touch other statuses (primary_only, etc.).
    const curStatus: string | null = r.verification_status ?? null;
    const newStatus = qv.needsReview
      ? "needs_review"
      : (curStatus === "needs_review" ? "unverified" : curStatus);

    if (newUnit !== curUnit) unitFixed++;
    if (newUnit !== curUnit || newRemarks !== curRemarks || newNotes !== (r.notes ?? "") || newStatus !== curStatus) {
      await conn.execute("UPDATE boq_items SET unit = ?, remarks = ?, notes = ?, verification_status = ? WHERE id = ?", [
        newUnit, newRemarks, newNotes, newStatus, r.id,
      ]);
      updated++;
    }
  }

  const avg = rows.length ? Math.round((qSum / rows.length) * 100) : 0;
  console.log(`Fixed ${updated}/${rows.length} row(s)${projectArg ? ` for project ${projectArg}` : " (all projects)"} — ${unitFixed} had a unit-spelling corrected.`);
  console.log(`Avg description quality: ${avg}%`);
  console.log(`Quantity Validator: ${reviewCount} line(s) flagged needs_review (${reviewHigh} high-priority).`);
  const tbd = confCounts.TBD ?? 0;
  const coverage = rows.length ? Math.round(((rows.length - tbd) / rows.length) * 100) : 100;
  console.log(`Evidence coverage: ${coverage}% — confidence High ${confCounts.High} · Medium ${confCounts.Medium} · Low ${confCounts.Low} · TBD ${tbd} (TBD shows as "TBD" in the export).`);
  console.log("Scope mix: " + Object.entries(scopeCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(" · "));
  console.log("Find flagged lines:  SELECT sow_ref, sr_no, unit, quantity, notes FROM boq_items WHERE verification_status='needs_review' ORDER BY project_id, sow_ref;");
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
