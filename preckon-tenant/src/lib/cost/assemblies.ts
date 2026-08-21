// Assemblies: building a rate from its resources instead of quoting a number.
//
// rates.ts answers "what did this item cost last time". That is the right
// question when a comparable rate exists. When one does not — a bespoke item,
// a new specification, an unfamiliar region — an estimator builds the rate up
// from labour, plant and materials, and that build-up is the assembly.
//
// ── WHY BUILD-UP BEATS A QUOTED RATE FOR SOME ITEMS ──────────────────────────
//
// A quoted rate is a single number with no internal structure, so nothing can
// be checked and nothing can be adjusted. If steel moves 12%, a build-up
// updates because it knows how much steel is in the item; a quoted rate has to
// be re-quoted or fudged. If a client challenges the price, a build-up answers
// with hours and quantities; a quoted rate answers "that is our rate".
//
// The build-up is also where the money hides. Two contractors quoting the same
// number can have completely different labour assumptions, and the one whose
// gang rate assumes 12 m²/hour when the site gets 8 loses money on every metre
// while believing it is winning.
//
// ── THE OUTPUT/WASTE TRAP ────────────────────────────────────────────────────
//
// Two conventions exist and they are not interchangeable:
//
//   Output (labour): units produced per hour. Hours = quantity ÷ output.
//   Waste (material): extra material bought per unit placed. Quantity × (1 + w).
//
// Getting either inverted produces a rate that looks plausible and is wrong by
// the reciprocal, which is why both are named explicitly here rather than
// folded into one "factor" field.

export type ResourceKind = "labour" | "plant" | "material" | "subcontract";

export interface ResourceLine {
  id: string;
  kind: ResourceKind;
  description: string;
  /** Unit the resource is bought in: hour, m3, tonne, week. */
  unit: string;
  /** Cost per unit of the resource, in minor units. */
  rateMinor: number;

  /* Exactly one of these applies, by kind. */

  /** LABOUR/PLANT: units of work the WHOLE GANG produces per hour — the usual
   *  estimating convention ("bricklayer gang output 4 m²/hour"), not the output
   *  of one person. Gang-hours = quantity / output; labour-hours = that × gang
   *  size. Reading it as per-person overstates the labour by the gang size. */
  outputPerHour?: number;
  /** LABOUR/PLANT: how many of this resource work together to achieve the
   *  output above. Each one is paid, so this multiplies the cost. */
  gangSize?: number;
  /** MATERIAL: quantity of resource per unit of work. */
  usagePerUnit?: number;
  /** MATERIAL: proportion bought and not placed. 0.05 is 5% waste. */
  wastePct?: number;
  /** SUBCONTRACT: a lump per unit of work, needing no build-up. */
  perUnitMinor?: number;
}

export interface Assembly {
  key: string;
  description: string;
  /** The unit the assembled rate is expressed in: m2, m3, nr. */
  unit: string;
  resources: ResourceLine[];
  /** Overhead and profit, applied to the net cost. 0.15 is 15%. */
  oncostPct?: number;
  /** Preliminaries share, applied before oncost. */
  prelimsPct?: number;
}

export interface ResourceCost {
  id: string;
  kind: ResourceKind;
  description: string;
  /** Resource units consumed per unit of work (hours, m3, tonnes). */
  quantityPerUnit: number;
  rateMinor: number;
  /** Cost per unit of work from this resource. */
  costMinor: number;
  /** Share of the net cost. */
  sharePct: number;
  why: string;
}

export interface AssembledRate {
  key: string;
  description: string;
  unit: string;
  lines: ResourceCost[];
  /** Cost before prelims and oncost. */
  netMinor: number;
  prelimsMinor: number;
  oncostMinor: number;
  /** What goes in the bill. */
  rateMinor: number;
  /** Net cost by resource kind — the shape of the rate. */
  byKind: { kind: ResourceKind; costMinor: number; sharePct: number }[];
  warnings: string[];
}

const round = (n: number) => Math.round(n);
const pct = (part: number, whole: number) => whole ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * Build a rate from its resources.
 *
 * Everything is computed per ONE unit of work. Multiplying by a bill quantity
 * is the caller's job, and keeping it out of here is what lets the same
 * assembly serve a 40 m² and a 4,000 m² item without a second calculation that
 * could disagree with the first.
 */
export function assemble(a: Assembly): AssembledRate {
  const warnings: string[] = [];
  const lines: ResourceCost[] = [];

  for (const r of a.resources) {
    let quantityPerUnit = 0;
    let why = "";

    switch (r.kind) {
      case "labour":
      case "plant": {
        const output = r.outputPerHour ?? 0;
        if (output <= 0) {
          // A zero output means infinite hours. Refusing to price the line and
          // saying so beats emitting a rate that silently ignores the labour.
          warnings.push(`${r.description}: no output rate given, so its time could not be priced. The assembled rate excludes it and is therefore too low.`);
          continue;
        }
        const gang = Math.max(1, r.gangSize ?? 1);
        // Hours for the GANG, then multiplied by how many are in it: four
        // labourers achieving 8 m²/hour between them cost four labour-hours per
        // 8 m², not one.
        quantityPerUnit = (1 / output) * gang;
        why = `${gang > 1 ? `Gang of ${gang} at ` : ""}${output} ${a.unit}/hour → ${round1(quantityPerUnit)} hour(s) per ${a.unit}.`;
        break;
      }
      case "material": {
        const usage = r.usagePerUnit ?? 0;
        if (usage <= 0) {
          warnings.push(`${r.description}: no usage per ${a.unit} given, so this material is not in the rate.`);
          continue;
        }
        const waste = Math.max(0, r.wastePct ?? 0);
        // Waste is material BOUGHT and not placed, so it multiplies up. Applying
        // it as a discount, or as 1/(1-w), are both wrong and both plausible.
        quantityPerUnit = usage * (1 + waste);
        why = waste > 0
          ? `${usage} ${r.unit} per ${a.unit} plus ${Math.round(waste * 1000) / 10}% waste → ${round3(quantityPerUnit)} ${r.unit}.`
          : `${usage} ${r.unit} per ${a.unit}, no waste allowance.`;
        if (waste === 0) {
          warnings.push(`${r.description}: no waste allowance. Cut-and-fit materials almost always have one, and zero is usually an omission rather than a decision.`);
        }
        break;
      }
      case "subcontract": {
        const per = r.perUnitMinor ?? 0;
        if (per <= 0) {
          warnings.push(`${r.description}: no subcontract price per ${a.unit}.`);
          continue;
        }
        lines.push({
          id: r.id, kind: r.kind, description: r.description,
          quantityPerUnit: 1, rateMinor: per, costMinor: round(per), sharePct: 0,
          why: `Subcontract lump of ${per} per ${a.unit} — no build-up, priced as quoted.`,
        });
        continue;
      }
    }

    lines.push({
      id: r.id, kind: r.kind, description: r.description,
      quantityPerUnit, rateMinor: r.rateMinor,
      costMinor: round(quantityPerUnit * r.rateMinor),
      sharePct: 0, why,
    });
  }

  const netMinor = lines.reduce((s, l) => s + l.costMinor, 0);
  for (const l of lines) l.sharePct = pct(l.costMinor, netMinor);

  /* Prelims then oncost, in that order and compounding.

     Prelims are a cost of doing the work, so profit is earned on them; applying
     oncost to the net alone would price the job below the intended margin. The
     order is a commercial decision, so it is stated here rather than left to be
     discovered from the arithmetic. */
  const prelimsMinor = round(netMinor * Math.max(0, a.prelimsPct ?? 0));
  const oncostMinor = round((netMinor + prelimsMinor) * Math.max(0, a.oncostPct ?? 0));

  const kinds: ResourceKind[] = ["labour", "plant", "material", "subcontract"];
  const byKind = kinds
    .map((kind) => {
      const costMinor = lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.costMinor, 0);
      return { kind, costMinor, sharePct: pct(costMinor, netMinor) };
    })
    .filter((k) => k.costMinor > 0);

  if (!lines.length) warnings.push("This assembly priced to nothing — every resource was unusable.");

  return {
    key: a.key,
    description: a.description,
    unit: a.unit,
    lines,
    netMinor,
    prelimsMinor,
    oncostMinor,
    rateMinor: netMinor + prelimsMinor + oncostMinor,
    byKind,
    warnings,
  };
}

export interface SensitivityPoint {
  /** What was changed, e.g. "labour +10%". */
  change: string;
  rateMinor: number;
  deltaMinor: number;
  deltaPct: number;
}

/**
 * How much the rate moves when a resource kind moves.
 *
 * The question a bid review actually asks: what happens if steel goes up 15%,
 * or if we do not achieve the output we assumed. A build-up can answer it; a
 * quoted rate cannot, which is most of the reason to build one up.
 */
export function sensitivity(
  a: Assembly, changes: { kind: ResourceKind; pct: number }[],
): SensitivityPoint[] {
  const base = assemble(a).rateMinor;
  return changes.map((c) => {
    const shifted: Assembly = {
      ...a,
      resources: a.resources.map((r) =>
        r.kind !== c.kind ? r : {
          ...r,
          rateMinor: r.rateMinor * (1 + c.pct),
          perUnitMinor: r.perUnitMinor != null ? r.perUnitMinor * (1 + c.pct) : undefined,
        }),
    };
    const rateMinor = assemble(shifted).rateMinor;
    return {
      change: `${c.kind} ${c.pct >= 0 ? "+" : ""}${Math.round(c.pct * 1000) / 10}%`,
      rateMinor,
      deltaMinor: rateMinor - base,
      deltaPct: base ? Math.round(((rateMinor - base) / base) * 1000) / 10 : 0,
    };
  });
}

/**
 * How far output can slip before the rate is underwater.
 *
 * The number an estimator most wants and least often has. A rate assuming
 * 12 m²/hour that gets 8 on site loses money on every metre, and the loss is
 * invisible until the job is half built — because nothing in a quoted rate
 * records what output was assumed in the first place.
 */
export function outputBreakeven(
  a: Assembly, soldRateMinor: number,
): { assembledMinor: number; headroomMinor: number; maxOutputDropPct: number | null; why: string } {
  const built = assemble(a);
  const headroom = soldRateMinor - built.rateMinor;

  const labour = built.lines.filter((l) => l.kind === "labour" || l.kind === "plant");
  const labourCost = labour.reduce((s, l) => s + l.costMinor, 0);

  if (headroom < 0) {
    return {
      assembledMinor: built.rateMinor, headroomMinor: headroom, maxOutputDropPct: 0,
      why: `Already below cost by ${Math.abs(headroom)} per ${a.unit} at the assumed output. Any shortfall makes it worse.`,
    };
  }
  if (labourCost <= 0) {
    return {
      assembledMinor: built.rateMinor, headroomMinor: headroom, maxOutputDropPct: null,
      why: "No time-based resources in this assembly, so output cannot erode the rate.",
    };
  }

  /* Labour cost scales with 1/output, so at output × (1-d) the labour cost is
     labourCost/(1-d). Setting the increase equal to the headroom:
       labourCost/(1-d) - labourCost = headroom
       d = headroom / (headroom + labourCost)                                */
  const d = headroom / (headroom + labourCost);
  return {
    assembledMinor: built.rateMinor,
    headroomMinor: headroom,
    maxOutputDropPct: Math.round(d * 1000) / 10,
    why: `Output can fall ${Math.round(d * 1000) / 10}% below the assumption before this item is at cost.`,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
