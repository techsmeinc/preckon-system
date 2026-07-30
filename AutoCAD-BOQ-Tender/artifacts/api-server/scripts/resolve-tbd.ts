/**
 * TBD Resolver — second-pass validator that turns TBD quantities into real
 * numbers WHERE THE EVIDENCE EXISTS, with zero model tokens. It does NOT guess:
 * it derives quantities from the project's measured CAD footprint (the largest
 * closed outline on a structural layer) using standard QS formulas:
 *
 *   • horizontal-surface AREA (slab, floor finish, ceiling, roof, vapour
 *     barrier, screed, sub-base) → quantity = building footprint (m²)
 *   • VOLUME (concrete slab / blinding / sub-base) → footprint × stated thickness
 *
 * These are PRELIMINARY (medium-confidence) numbers per the design doc, so the
 * line keeps verification_status=needs_review with a clear basis. Vertical
 * areas (walls/partitions) and MEP lengths stay TBD — they need a perimeter /
 * MEP-drawing takeoff the footprint can't supply.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="mysql://root@localhost:3306/boq_tender"
 *   npx esbuild scripts/resolve-tbd.ts --bundle --platform=node --format=cjs --external:mysql2 --outfile=scripts/resolve-tbd.cjs
 *   node scripts/resolve-tbd.cjs <projectId> [--footprint=840] [--apply]
 *
 * Without --apply it's a DRY RUN (prints what it would change). --footprint
 * overrides the CAD-derived footprint (e.g. from a stated building L×W).
 */
import mysql from "mysql2/promise";
import {
  assessItemQuality, scopeTypeRemark, qualityNote, validateQuantity, reviewSuffix,
  quantityConfidence, confidenceSuffix, isTbdQuantity, detectMeasurementMethod, inferScopeType,
} from "../src/lib/estimator-style";
import { normalizeUnit } from "../src/lib/boq-units";

const UNIT_TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, inches: 0.0254, feet: 0.3048 };
const areaFactor = (u?: string | null) => { const f = u && UNIT_TO_M[u] != null ? UNIT_TO_M[u] : null; return f == null ? null : f * f; };
// Annotation/tag/dim layers carry huge bounding boxes — never the footprint.
const NON_STRUCTURAL = /note|tag|anno|level|\blvl\b|title|\btb[-_ ]|dim|text|txt|hatch|furn|legend|grid|north|scale|symbol/i;
// Horizontal surfaces that track the building footprint.
const RE_FOOTPRINT_AREA = /\b(slab|floor|flooring|ceiling|roof|vapou?r barrier|damp[- ]?proof|screed|sub[- ]?base|blinding|deck)\b/i;
const RE_VOLUME_FOOTPRINT = /\b(slab|blinding|sub[- ]?base|screed|topping)\b/i;

/** Largest closed outline on a structural layer across the project's drawings, in m². */
function cadFootprintM2(summaries: any[]): { m2: number; source: string } | null {
  let best = 0; let src = "";
  for (const s of summaries) {
    if (!s || !Array.isArray(s.layers)) continue;
    const af = areaFactor(s.units);
    if (af == null) continue;
    for (const l of s.layers) {
      if (NON_STRUCTURAL.test(l.layer ?? "")) continue;
      const tops: number[] | undefined = l.closed_polyline_top_areas;
      const maxA = Array.isArray(tops) && tops.length ? Math.max(...tops) : Number(l.polyline_area_total ?? 0);
      const m2 = maxA * af;
      // Sanity band: a real building footprint, not a tiny detail or a runaway dup.
      if (m2 > 30 && m2 < 100000 && m2 > best) { best = m2; src = `${s.file ?? "drawing"} / layer ${l.layer}`; }
    }
  }
  return best > 0 ? { m2: Math.round(best * 100) / 100, source: src } : null;
}

/** Pull a thickness in metres from a description, e.g. "150 mm slab" → 0.15. */
function thicknessM(desc: string): number | null {
  const m = desc.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (m) return Number(m[1]) / 1000;
  const cm = desc.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
  if (cm) return Number(cm[1]) / 100;
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL || "mysql://root@localhost:3306/boq_tender";
  const projectId = process.argv[2] ? parseInt(process.argv[2], 10) : NaN;
  if (!Number.isFinite(projectId)) { console.error("Usage: node resolve-tbd.cjs <projectId> [--footprint=NNN] [--apply]"); process.exit(1); }
  const apply = process.argv.includes("--apply");
  const fpArg = process.argv.find(a => a.startsWith("--footprint="));
  const footprintOverride = fpArg ? Number(fpArg.split("=")[1]) : null;

  const conn = await mysql.createConnection(url);

  // Footprint: CLI override wins, else derive from the project's CAD drawings.
  let footprint: { m2: number; source: string } | null =
    footprintOverride && footprintOverride > 0 ? { m2: footprintOverride, source: "manual --footprint" } : null;
  if (!footprint) {
    const [ex] = await conn.execute<any[]>(
      "SELECT ce.summary FROM cad_extractions ce JOIN documents d ON d.id=ce.document_id WHERE d.project_id=? AND ce.status='succeeded'",
      [projectId],
    );
    const summaries = ex.map(r => { try { return typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary; } catch { return null; } }).filter(Boolean);
    footprint = cadFootprintM2(summaries);
  }
  console.log(footprint ? `Footprint: ${footprint.m2} m² (${footprint.source})` : "Footprint: NONE found — area/volume TBDs cannot be resolved (pass --footprint=NNN).");

  const [rows] = await conn.execute<any[]>(
    "SELECT id, category, description, unit, quantity, notes, remarks, verification_status, drawing_references FROM boq_items WHERE project_id=?",
    [projectId],
  );

  let tbdTotal = 0, resolved = 0, stillTbd = 0;
  const log: string[] = [];

  for (const r of rows) {
    const refCount = (() => { try { const v = typeof r.drawing_references === "string" ? JSON.parse(r.drawing_references) : r.drawing_references; return Array.isArray(v) ? v.length : 0; } catch { return 0; } })();
    const unit = normalizeUnit(r.unit);
    const evItem = { description: r.description, category: r.category, unit, notes: r.notes, quantity: r.quantity, drawingRefCount: refCount };
    if (!isTbdQuantity(evItem)) continue;
    tbdTotal++;

    const desc: string = r.description ?? "";
    const scopeType = inferScopeType(desc, r.category);
    const method = detectMeasurementMethod(desc, r.category, unit, scopeType);
    let newQty: number | null = null;
    let basis = "";

    if (footprint) {
      if (method === "area" && RE_FOOTPRINT_AREA.test(desc)) {
        newQty = footprint.m2;
        basis = `Preliminary qty = ${footprint.m2} m² building footprint (${footprint.source}); verify per-room takeoff.`;
      } else if (method === "volume" && RE_VOLUME_FOOTPRINT.test(desc)) {
        const t = thicknessM(desc);
        if (t) { newQty = Math.round(footprint.m2 * t * 1000) / 1000; basis = `Preliminary qty = footprint ${footprint.m2} m² × ${t} m thickness = ${newQty} m³; verify.`; }
      }
    }

    if (newQty == null) { stillTbd++; continue; }

    // Rebuild the line with the resolved number + a fresh evidence basis. It is
    // PRELIMINARY (medium) so it stays flagged for the QS to confirm.
    const resolvedItem = { description: desc, category: r.category, unit, notes: basis, quantity: newQty, drawingRefCount: refCount };
    const qa = assessItemQuality(resolvedItem);
    const qv = validateQuantity(resolvedItem);
    const conf = quantityConfidence(resolvedItem);
    const scopeTag = scopeTypeRemark(qa.scopeType);
    const newRemarks = !r.remarks || r.remarks === scopeTag ? (scopeTag || null) : r.remarks;
    const newNotes = `${basis} ${qualityNote(qa)}${reviewSuffix(qv)}${confidenceSuffix(conf)}`;
    const newStatus = qv.needsReview ? "needs_review" : "unverified";

    log.push(`  [${r.id}] ${unit} TBD → ${newQty}  (${method})  ${desc.slice(0, 50)}`);
    if (apply) {
      await conn.execute("UPDATE boq_items SET quantity=?, unit=?, notes=?, remarks=?, verification_status=? WHERE id=?",
        [String(newQty), unit, newNotes, newRemarks, newStatus, r.id]);
    }
    resolved++;
  }

  console.log(`\n${apply ? "APPLIED" : "DRY RUN (no DB writes — add --apply)"}`);
  console.log(`TBD lines: ${tbdTotal} | resolved: ${resolved} | still TBD: ${stillTbd}`);
  if (log.length) console.log("Resolved:\n" + log.slice(0, 60).join("\n"));
  console.log("\nStill-TBD lines are areas needing a perimeter takeoff or MEP/site lengths with no drawing — these correctly stay TBD.");
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
