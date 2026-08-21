// Bid-to-delivery handover: the point where a won job forgets how it was priced.
//
// The bid team knows things the delivery team needs and does not have. Which
// rates were keen and which were comfortable. Which qualifications the client
// never actually accepted. What the programme assumed about access, about a
// crane, about a fourteen-week steel lead. Which risks were priced and which
// were consciously not.
//
// Almost none of that survives the handover, because the handover is usually a
// meeting and a folder. Six months later a site team is arguing about whether
// something was in the price, and the only person who knows has moved on to the
// next tender.
//
// ── WHAT THIS PRODUCES AND WHY THAT SHAPE ────────────────────────────────────
//
// Not a document. A CHECKLIST with gaps, because the value is in what is
// missing rather than in what is present. A handover pack that quietly omits
// the three assumptions nobody wrote down reads as complete and is worse than
// no pack at all — it makes the site team believe they have the full picture.
//
// So completeness is scored, every gap is named, and the gaps that will cost
// money are separated from the ones that are merely untidy.
//
// ── THE THREE THINGS THAT ALWAYS GET LOST ────────────────────────────────────
//
// Qualifications the client never accepted. Priced on the assumption they
// would be, and a site team that does not know they were rejected performs work
// nobody has paid for.
//
// Rates with no slack. The bid knows which lines were sharpened to win. The
// site team treats every rate as equally comfortable and spends the keen ones
// first.
//
// Risks deliberately not priced. A risk consciously excluded is a commercial
// position. A risk nobody mentioned is a surprise, and the difference is
// entirely in whether it was written down.

export type HandoverArea =
  | "commercial"
  | "programme"
  | "technical"
  | "risk"
  | "procurement"
  | "client";

export interface HandoverItem {
  id: string;
  area: HandoverArea;
  title: string;
  /** What the bid team knew. Empty means the gap is the point. */
  detail?: string | null;
  /** True where a site team acting without this loses money. */
  material: boolean;
  /** Where it came from — a bid artifact, a qualification, a rate. */
  source?: string | null;
  /** Who has to act on it, where somebody must. */
  owner?: string | null;
}

/** A commercial position taken at bid stage. */
export interface CarriedQualification {
  id: string;
  text: string;
  /** Whether the client actually accepted it. Unknown is the dangerous state. */
  clientAccepted: boolean | null;
  /** Value at risk if it turns out not to hold. */
  exposureMinor?: number | null;
}

/** A rate the bid team knows is tight. */
export interface KeenRate {
  code: string;
  description: string;
  rateMinor: number;
  /** How far below the comfortable rate it was set, as a proportion. */
  sharpenedByPct: number;
  why?: string | null;
}

export interface HandoverInput {
  projectId: string;
  contractValueMinor: number;
  items: HandoverItem[];
  qualifications: CarriedQualification[];
  keenRates: KeenRate[];
  /** Risks priced into the bid, and risks deliberately left out. */
  risksPriced?: { id: string; title: string; allowanceMinor: number }[];
  risksExcluded?: { id: string; title: string; why: string }[];
}

export interface AreaCoverage {
  area: HandoverArea;
  present: number;
  missingDetail: number;
  materialGaps: number;
  complete: boolean;
}

export interface HandoverPack {
  projectId: string;
  coverage: AreaCoverage[];
  /** 0–100. Weighted so material gaps hurt more than untidy ones. */
  completenessPct: number;
  /** Areas with nothing recorded at all. */
  emptyAreas: HandoverArea[];
  /** Gaps that will cost money, worst first. */
  materialGaps: HandoverItem[];
  /** Qualifications the client has not accepted, or has not answered. */
  unacceptedQualifications: (CarriedQualification & { verdict: string })[];
  /** Total exposure carried by qualifications that are not agreed. */
  qualificationExposureMinor: number;
  /** Rates the site team must not treat as comfortable. */
  keenRates: (KeenRate & { warning: string })[];
  /** Risks excluded on purpose — a position, not a surprise, if recorded. */
  excludedRisks: { id: string; title: string; why: string }[];
  warnings: string[];
  ready: boolean;
  summary: string;
}

const AREAS: HandoverArea[] = ["commercial", "programme", "technical", "risk", "procurement", "client"];

const AREA_LABEL: Record<HandoverArea, string> = {
  commercial: "Commercial",
  programme: "Programme",
  technical: "Technical",
  risk: "Risk",
  procurement: "Procurement",
  client: "Client and contract",
};

/**
 * Build the handover pack, and say what is missing from it.
 *
 * Deliberately not a document generator. The output is a state — how complete
 * this is, what is absent, and whether it is fit to hand over — because a pack
 * that renders cleanly with three assumptions missing is worse than no pack:
 * it persuades the site team they have the full picture.
 */
export function pack(input: HandoverInput): HandoverPack {
  const warnings: string[] = [];

  const coverage: AreaCoverage[] = AREAS.map((area) => {
    const mine = input.items.filter((i) => i.area === area);
    const missingDetail = mine.filter((i) => !i.detail || !String(i.detail).trim()).length;
    const materialGaps = mine.filter(
      (i) => i.material && (!i.detail || !String(i.detail).trim()),
    ).length;
    return {
      area,
      present: mine.length,
      missingDetail,
      materialGaps,
      complete: mine.length > 0 && missingDetail === 0,
    };
  });

  const emptyAreas = coverage.filter((c) => c.present === 0).map((c) => c.area);

  /* Completeness weights a material gap at three times an untidy one, and
     counts an empty area as a whole area's worth of absence. An area nobody
     filled in is not 100% complete because it has no failures in it. */
  const totalItems = input.items.length;
  const materialGapCount = input.items.filter((i) => i.material && !String(i.detail ?? "").trim()).length;
  const minorGapCount = input.items.filter((i) => !i.material && !String(i.detail ?? "").trim()).length;
  const penalty = materialGapCount * 3 + minorGapCount + emptyAreas.length * 3;
  const denominator = totalItems + emptyAreas.length * 3 || 1;
  const completenessPct = Math.max(0, Math.round((1 - penalty / denominator) * 100));

  const materialGaps = input.items
    .filter((i) => i.material && !String(i.detail ?? "").trim());

  /* ── Qualifications ──────────────────────────────────────────────────────── */
  const unacceptedQualifications = input.qualifications
    .filter((q) => q.clientAccepted !== true)
    .map((q) => ({
      ...q,
      verdict: q.clientAccepted === false
        ? "The client rejected this and the bid was priced as though it held. Whatever it excluded is now work somebody has to do and nobody has paid for."
        : "The client never answered this. Unanswered is not accepted — assuming it holds is how a qualification becomes an unpriced obligation at the first valuation.",
    }));

  const qualificationExposureMinor = unacceptedQualifications
    .reduce((s, q) => s + Math.max(0, q.exposureMinor ?? 0), 0);

  if (unacceptedQualifications.length) {
    warnings.push(
      `${unacceptedQualifications.length} qualification(s) were priced in but not accepted by the client${
        qualificationExposureMinor > 0 ? `, carrying ${qualificationExposureMinor} of exposure` : ""
      }. A site team that does not know these were rejected performs the work anyway.`,
    );
  }

  /* ── Keen rates ──────────────────────────────────────────────────────────── */
  const keenRates = [...input.keenRates]
    .sort((a, b) => b.sharpenedByPct - a.sharpenedByPct)
    .map((r) => ({
      ...r,
      warning: r.sharpenedByPct >= 0.15
        ? `Sharpened ${Math.round(r.sharpenedByPct * 100)}% to win. There is no recovery in this rate — any inefficiency here comes straight out of the job.`
        : `Sharpened ${Math.round(r.sharpenedByPct * 100)}%. Tighter than the standard rate; do not spend it first.`,
    }));

  if (keenRates.length) {
    warnings.push(
      `${keenRates.length} rate(s) were sharpened to win this. A delivery team treating every rate as equally comfortable spends the keen ones first, and finds out at the second valuation.`,
    );
  }

  /* ── Risk ────────────────────────────────────────────────────────────────── */
  const excludedRisks = input.risksExcluded ?? [];
  if (!excludedRisks.length && !(input.risksPriced ?? []).length) {
    warnings.push(
      "No risk position recorded at all. Every risk on this job is now a surprise rather than a decision, and nobody can tell which were considered and priced.",
    );
  }

  for (const area of emptyAreas) {
    warnings.push(`Nothing recorded under ${AREA_LABEL[area]}. An empty section reads as 'nothing to say', which is almost never what it means.`);
  }

  const ready = completenessPct >= 80 && materialGaps.length === 0 && emptyAreas.length === 0;

  return {
    projectId: input.projectId,
    coverage,
    completenessPct,
    emptyAreas,
    materialGaps,
    unacceptedQualifications,
    qualificationExposureMinor,
    keenRates,
    excludedRisks,
    warnings,
    ready,
    summary: summarise(completenessPct, materialGaps.length, emptyAreas.length,
      unacceptedQualifications.length, keenRates.length, ready),
  };
}

function summarise(
  pct: number, material: number, empty: number,
  unaccepted: number, keen: number, ready: boolean,
): string {
  if (ready) {
    const notes: string[] = [];
    if (unaccepted) notes.push(`${unaccepted} unaccepted qualification(s)`);
    if (keen) notes.push(`${keen} sharpened rate(s)`);
    return `Ready to hand over at ${pct}% complete${notes.length ? `, carrying ${notes.join(" and ")} the delivery team must be told about` : ""}.`;
  }
  const parts = [`Not ready to hand over — ${pct}% complete.`];
  if (material) parts.push(`${material} material gap(s): things a site team loses money for not knowing.`);
  if (empty) parts.push(`${empty} section(s) empty.`);
  return parts.join(" ");
}

/**
 * The questions to put to the bid team while they are still available.
 *
 * Generated from the gaps rather than as a standing agenda, because a generic
 * checklist gets worked through and a specific question gets answered. The
 * window for asking these is short: the estimator is on the next tender within
 * a fortnight, and after that the answers exist nowhere.
 */
export function questionsForBidTeam(p: HandoverPack): { question: string; why: string }[] {
  const qs: { question: string; why: string }[] = [];

  for (const gap of p.materialGaps.slice(0, 10)) {
    qs.push({
      question: `${gap.title} — what did the bid assume here?`,
      why: `Recorded as material with no detail. ${gap.owner ? `${gap.owner} needs it` : "Somebody will need it"} and only the bid team knows.`,
    });
  }

  for (const q of p.unacceptedQualifications) {
    qs.push({
      question: `Qualification "${q.text}" — what was priced on the assumption it held, and what does it cost if it does not?`,
      why: q.verdict,
    });
  }

  for (const area of p.emptyAreas) {
    qs.push({
      question: `Nothing was recorded under ${AREA_LABEL[area]}. Was there genuinely nothing, or did it not get written down?`,
      why: "An empty section and a section with nothing in it look identical afterwards, and only one of them is safe.",
    });
  }

  if (p.keenRates.length) {
    const worst = p.keenRates[0];
    qs.push({
      question: `Rate ${worst.code} was sharpened ${Math.round(worst.sharpenedByPct * 100)}% — what has to go right for it to hold?`,
      why: "A keen rate usually depends on something specific: a supplier price, an output, a sequence. The delivery team can protect it only if they know what it is.",
    });
  }

  return qs;
}
