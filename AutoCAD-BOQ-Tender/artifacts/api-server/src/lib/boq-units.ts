// ─────────────────────────────────────────────────────────────────────────────
// Standard BOQ unit normalisation (TechSME house standard).
//
// Every unit is normalised onto this canonical set so the priced BOQ and the
// AIGCC Excel export are internally consistent, regardless of which
// provider/model produced the item or how the exemplars/CSI tables spelled it:
//
//   m   — linear metre  (pipes, conduits, cabling, fencing, kerbs, handrails)
//   m²  — square metre  (formwork, masonry, roofing, waterproofing, insulation,
//                        flooring, painting, ceilings, cladding, paving, landscaping)
//   m³  — cubic metre   (excavation, backfill, concrete, filling, hardcore)
//   kg  — kilogram      (sheet-metal AC ducting; light steelwork by weight)
//   ton — metric tonne  (reinforcement & structural steel by weight)
//   EA  — each          (doors, windows, fixtures, pumps, panels, fittings, valves)
//   Set — set           (assemblies/plant supplied as one set)
//   LS  — lump sum       (mobilization, design, survey, submittals, T&C, as-built)
//   PM  — person-month   (engineers/supervisors/labour/equipment priced by time)
//
// Tokens that are not a recognised measure (kW, kVA, L, %, hr, roll) pass
// through unchanged — they are legitimate on the occasional specialist line.
//
// This module is the SINGLE source of truth, imported by BOTH the generator
// (normalises at insert time) and the Excel export (normalises again at display
// time, so legacy BOQs produced before the standard render correctly too).
// ─────────────────────────────────────────────────────────────────────────────

export const STANDARD_UNITS = ["m", "m²", "m³", "kg", "ton", "EA", "Set", "LS", "PM"] as const;

export function normalizeUnit(raw: string | null | undefined): string {
  const original = (raw ?? "").trim();
  if (!original) return original;
  // Lower-case and strip spaces/dots/commas/dashes so "Sq,mtrs." → "sqmtrs".
  const key = original.toLowerCase().replace(/[\s.,_/-]/g, "");

  // Volume first, so "m3"/"cum" win over the bare-"m" linear rule below.
  // "Cu.Mtr" → "cumtr", "Cubic Mtr" → "cubicmtr".
  if (["m3", "m³", "cum", "cums", "cbm", "cumtr", "cumtrs", "cubicmtr", "cubicmtrs",
    "cubicmeter", "cubicmetre", "cubicmeters", "cubicmetres"].includes(key)) return "m³";
  // Area. "Sq.mtr" → "sqmtr", "Sq,mtrs" → "sqmtrs".
  if (["m2", "m²", "sqm", "sqms", "sqmt", "sqmtr", "sqmtrs", "sqmeter", "sqmeters",
    "squaremeter", "squaremeters", "squaremetre", "squaremetres"].includes(key)) return "m²";
  // Weight — tonne family, then kilogram.
  if (["ton", "tons", "tonne", "tonnes", "metricton", "metrictonne"].includes(key)) return "ton";
  if (["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"].includes(key)) return "kg";
  // Lump sum (a "lot" is treated as a lump sum in this house style).
  if (["ls", "lumpsum", "lumpsums", "lump", "lot", "lots"].includes(key)) return "LS";
  // Person-month / man-month — labour, supervision, plant priced by time.
  if (["pm", "personmonth", "personmonths", "manmonth", "manmonths", "mandaymonth"].includes(key)) return "PM";
  // Set.
  if (["set", "sets"].includes(key)) return "Set";
  // Count → EA (each).
  if (["ea", "each", "no", "nos", "number", "numbers", "pc", "pcs", "piece",
    "pieces", "item", "items", "unit", "units", "nr", "qty"].includes(key)) return "EA";
  // Linear metre family — after area/volume so "m2"/"m3" are already handled.
  // "LM"/"Lm" → "lm", "Mtr"/"Mtrs" → "mtr"/"mtrs".
  if (["m", "lm", "lms", "rm", "mtr", "mtrs", "meter", "meters", "metre", "metres",
    "rmt", "runningmeter", "runningmetre", "lin", "linm", "linearmeter", "linearmetre"].includes(key)) return "m";

  // Not a recognised measure (kW, kVA, L, %, hr, roll, …) — keep as-is.
  return original;
}
