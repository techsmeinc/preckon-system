// Is the technical narrative actually about this project?
//
// The narrative_section schema has carried a `grounded_in` field since it was
// written, on the stated grounds that "a narrative that cites the bill and the
// baseline is checkable; one that doesn't is prose". Nothing ever checked it.
//
// ── THE TWO WAYS A SUBMISSION LOSES ON THE WRITING ───────────────────────────
//
// Boilerplate. Sixty pages that could describe any project, submitted for this
// one. Evaluators read a lot of these and score them accordingly: it is not
// that the words are wrong, it is that nothing in them could only be true of
// this job. The tell is measurable — almost no specifics, and the few that
// exist are about the contractor rather than the works.
//
// Contradiction, which is much worse. The narrative says "our 14-week piling
// programme" and the baseline says 18 weeks. The evaluator has both documents.
// A bid that disagrees with itself does not merely lose the point, it makes
// every other number in the submission suspect — and this happens constantly,
// because the narrative is written early, the programme moves late, and nobody
// re-reads the prose against the final artifacts.
//
// ── WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
//
// It checks the things that can be checked mechanically: does a figure in the
// prose match the artifact it claims to come from, does the section cite
// anything at all, is there any project-specific content in it.
//
// It does NOT judge whether the writing is any good. That is a human's job and
// a tool pretending otherwise would produce confident scores nobody should act
// on. Every finding here points at something specific and checkable, or it is
// not raised.

export interface NarrativeSection {
  section: string;
  title: string;
  bodyMd: string;
  /** Artifact ids or references this section claims to be written from. */
  groundedIn?: string[];
}

/** A fact from the artifacts that the prose can be checked against. */
export interface GroundingFact {
  /** Artifact this came from. */
  artifactId: string;
  /** What it is: "programme duration", "bill total", "package count". */
  label: string;
  /** The number, where it is numeric. */
  value?: number | null;
  /** Unit, so 18 weeks is not compared with 18 days. */
  unit?: string | null;
  /** Names, codes and other exact strings that should appear verbatim. */
  text?: string | null;
}

export type FindingKind =
  /** A figure in the prose contradicts the artifact it cites. */
  | "contradiction"
  /** A specific claim with nothing behind it. */
  | "unsupported"
  /** Nothing in this section is specific to the project. */
  | "boilerplate"
  /** The section cites no evidence at all. */
  | "ungrounded";

export interface Finding {
  kind: FindingKind;
  section: string;
  /** The sentence or phrase at issue, so a writer can find it. */
  excerpt: string;
  detail: string;
  /** Contradictions are always material; boilerplate costs marks. */
  severity: "high" | "medium" | "low";
}

export interface SectionReview {
  section: string;
  title: string;
  wordCount: number;
  /** Project-specific references per 100 words. */
  specificityPer100: number;
  /** Figures matched against a cited fact. */
  matchedFacts: number;
  findings: Finding[];
  /** 0–100. Grounding and specificity, not writing quality. */
  groundedScore: number;
  verdict: string;
}

export interface NarrativeReview {
  sections: SectionReview[];
  findings: Finding[];
  /** Contradictions first: these make the whole submission suspect. */
  contradictions: Finding[];
  boilerplateSections: string[];
  ungroundedSections: string[];
  overallScore: number;
  warnings: string[];
  summary: string;
}

/** Number words that appear in construction prose and need matching too. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, fifteen: 15,
  sixteen: 16, eighteen: 18, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/** Units we can compare, normalised. Weeks and days are NOT interchangeable. */
const UNIT_ALIAS: Record<string, string> = {
  week: "week", weeks: "week", wk: "week", wks: "week",
  day: "day", days: "day",
  month: "month", months: "month",
  m2: "m2", "m²": "m2", sqm: "m2",
  m3: "m3", "m³": "m3", cum: "m3",
  nr: "nr", no: "nr", number: "nr",
  t: "t", tonne: "t", tonnes: "t",
};

interface Quantified { value: number; unit: string | null; excerpt: string }

/**
 * Pull quantified claims out of prose.
 *
 * Only quantified ones. "We will deliver excellence" cannot be checked against
 * anything and flagging it would be a style opinion wearing a compliance badge;
 * "our 14-week piling programme" either matches the baseline or does not.
 */
export function claimsIn(body: string): Quantified[] {
  const out: Quantified[] = [];
  const text = String(body ?? "");

  // Digits, with an optional unit immediately after. The hyphen form
  // ("14-week") is the one that appears most in real submissions.
  const re = /(\d[\d,]*(?:\.\d+)?)\s*[-–]?\s*([A-Za-z²³]+)?/g;
  for (const m of text.matchAll(re)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const rawUnit = (m[2] ?? "").toLowerCase();
    out.push({
      value,
      unit: UNIT_ALIAS[rawUnit] ?? null,
      excerpt: sentenceAround(text, m.index ?? 0),
    });
  }

  // Spelled-out numbers, which a digit regex misses entirely.
  const wordRe = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})[\\s-]+([A-Za-z²³]+)`, "gi");
  for (const m of text.matchAll(wordRe)) {
    const value = WORD_NUMBERS[m[1].toLowerCase()];
    if (value == null) continue;
    const rawUnit = (m[2] ?? "").toLowerCase();
    const unit = UNIT_ALIAS[rawUnit] ?? null;
    if (!unit) continue;   // "three teams" is not a checkable claim
    out.push({ value, unit, excerpt: sentenceAround(text, m.index ?? 0) });
  }

  return out;
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const endDot = text.indexOf(".", index);
  const end = endDot === -1 ? text.length : endDot + 1;
  return text.slice(start, end).trim().replace(/\s+/g, " ").slice(0, 200);
}

const wordsIn = (s: string) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * Review one section against the facts it should be grounded in.
 *
 * Facts are matched by UNIT as well as value: 18 weeks and 18 days are not the
 * same claim, and a checker that ignored units would report a contradiction as
 * agreement roughly as often as the reverse.
 */
export function reviewSection(
  s: NarrativeSection, facts: GroundingFact[],
  opts: { minSpecificity?: number } = {},
): SectionReview {
  const minSpecificity = opts.minSpecificity ?? 1.5;
  const findings: Finding[] = [];
  const body = String(s.bodyMd ?? "");
  const wordCount = wordsIn(body);
  const claims = claimsIn(body);

  const cited = new Set(s.groundedIn ?? []);
  // Facts from the artifacts this section actually claims to be written from.
  // Checking against everything would let a section be "supported" by a
  // document it never read.
  const relevant = cited.size ? facts.filter((f) => cited.has(f.artifactId)) : [];

  let matchedFacts = 0;

  if (!cited.size) {
    findings.push({
      kind: "ungrounded", section: s.section, excerpt: s.title,
      detail: "This section cites no evidence at all. Nothing in it can be checked, and an evaluator reading it alongside the bill has no way to tell whether it describes this job.",
      severity: wordCount > 150 ? "high" : "medium",
    });
  }

  /* ── Contradictions ──────────────────────────────────────────────────────
     Only where the prose states a figure in the same unit as a cited fact and
     the two differ. A number with no comparable fact is unverifiable, not
     wrong, and reporting it as wrong would train people to ignore this. */
  for (const claim of claims) {
    if (claim.unit == null) continue;
    const comparable = relevant.filter((f) => f.value != null && normUnit(f.unit) === claim.unit);
    if (!comparable.length) continue;

    const exact = comparable.find((f) => Math.abs((f.value as number) - claim.value) < 0.005);
    if (exact) { matchedFacts++; continue; }

    // Same unit, cited artifact, different number. That is a contradiction the
    // evaluator can find in thirty seconds because they hold both documents.
    const nearest = comparable.reduce((best, f) =>
      Math.abs((f.value as number) - claim.value) < Math.abs((best.value as number) - claim.value) ? f : best);
    findings.push({
      kind: "contradiction", section: s.section, excerpt: claim.excerpt,
      detail: `The narrative says ${claim.value} ${claim.unit} but ${nearest.label} is ${nearest.value} ${nearest.unit ?? claim.unit}. The evaluator has both documents; a submission that disagrees with itself makes every other figure in it suspect.`,
      severity: "high",
    });
  }

  /* ── Specificity ─────────────────────────────────────────────────────────
     Counted as project-specific references per 100 words: figures, and exact
     names or codes that come from the artifacts. A section can be perfectly
     well written and score zero here, which is the point — it means nothing in
     it could only be true of this project. */
  const textFacts = relevant.filter((f) => f.text && String(f.text).trim());
  const namesPresent = textFacts.filter((f) =>
    body.toLowerCase().includes(String(f.text).toLowerCase())).length;
  const specifics = claims.length + namesPresent;
  const specificityPer100 = wordCount ? Math.round((specifics / wordCount) * 10000) / 100 : 0;

  if (wordCount >= 80 && specificityPer100 < minSpecificity) {
    findings.push({
      kind: "boilerplate", section: s.section, excerpt: firstSentence(body),
      detail: `${specificityPer100} project-specific reference(s) per 100 words. Nothing here could only be true of this job — evaluators read a great many sections like this and score them as the filler they are. Name the actual quantities, the actual sequence, the actual constraints.`,
      severity: "medium",
    });
  }

  /* ── Unsupported specifics ───────────────────────────────────────────────
     A section that cites evidence but states figures none of it supports is
     asserting things from nowhere, which is different from citing nothing. */
  if (cited.size && claims.length > 0 && matchedFacts === 0 && relevant.some((f) => f.value != null)) {
    findings.push({
      kind: "unsupported", section: s.section, excerpt: firstSentence(body),
      detail: `This section cites evidence but none of its ${claims.length} figure(s) match anything in it. Either the citations are decorative or the numbers came from somewhere nobody recorded.`,
      severity: "medium",
    });
  }

  const groundedScore = scoreSection(findings, specificityPer100, matchedFacts, minSpecificity);

  return {
    section: s.section, title: s.title, wordCount, specificityPer100, matchedFacts, findings,
    groundedScore,
    verdict: verdictFor(findings, groundedScore, matchedFacts),
  };
}

const normUnit = (u?: string | null) => (u ? UNIT_ALIAS[String(u).toLowerCase()] ?? String(u).toLowerCase() : null);

function firstSentence(body: string): string {
  const t = String(body ?? "").trim().replace(/\s+/g, " ");
  const dot = t.indexOf(".");
  return (dot === -1 ? t : t.slice(0, dot + 1)).slice(0, 200);
}

function scoreSection(
  findings: Finding[], specificity: number, matched: number, minSpecificity: number,
): number {
  let score = 100;
  for (const f of findings) {
    // A contradiction is not three times worse than boilerplate; it is
    // categorically worse, because it damages the credibility of the rest.
    score -= f.kind === "contradiction" ? 45 : f.kind === "ungrounded" ? 30 : 20;
  }
  if (specificity >= minSpecificity * 2) score += 5;
  if (matched > 0) score += Math.min(10, matched * 3);
  return Math.max(0, Math.min(100, score));
}

function verdictFor(findings: Finding[], score: number, matched: number): string {
  const contradictions = findings.filter((f) => f.kind === "contradiction").length;
  if (contradictions) {
    return `${contradictions} figure(s) here contradict the evidence cited. Fix these before anything else — they are the findings an evaluator will make themselves.`;
  }
  if (findings.some((f) => f.kind === "ungrounded")) {
    return "Written against nothing. Cite the artifacts it should be describing, then check the figures against them.";
  }
  if (findings.some((f) => f.kind === "boilerplate")) {
    return "Reads as filler. Nothing in it is specific to this project.";
  }
  return matched > 0
    ? `Grounded: ${matched} figure(s) check out against the cited evidence.`
    : "No contradictions found.";
}

/**
 * Review a whole narrative.
 *
 * Contradictions are separated out and lead the report, because they are the
 * only category where doing nothing has a cost beyond the section itself.
 */
export function review(
  sections: NarrativeSection[], facts: GroundingFact[],
  opts: { minSpecificity?: number } = {},
): NarrativeReview {
  const reviews = sections.map((s) => reviewSection(s, facts, opts));
  const findings = reviews.flatMap((r) => r.findings);
  const contradictions = findings.filter((f) => f.kind === "contradiction");
  const warnings: string[] = [];

  const boilerplateSections = findings.filter((f) => f.kind === "boilerplate").map((f) => f.section);
  const ungroundedSections = findings.filter((f) => f.kind === "ungrounded").map((f) => f.section);

  if (contradictions.length) {
    warnings.push(
      `${contradictions.length} figure(s) in the narrative contradict the artifacts cited. The evaluator holds both documents, and a bid that disagrees with itself puts every other number in the submission in doubt.`,
    );
  }
  if (ungroundedSections.length === sections.length && sections.length > 0) {
    warnings.push("No section cites any evidence. The whole narrative is unverifiable against the rest of the submission.");
  }
  if (boilerplateSections.length >= Math.ceil(sections.length / 2) && sections.length > 1) {
    warnings.push(
      `${boilerplateSections.length} of ${sections.length} sections read as filler. On a quality-weighted award this is where the marks are lost, and it is the cheapest thing in a bid to fix.`,
    );
  }

  const overallScore = reviews.length
    ? Math.round(reviews.reduce((s, r) => s + r.groundedScore, 0) / reviews.length)
    : 0;

  return {
    sections: reviews, findings, contradictions, boilerplateSections, ungroundedSections,
    overallScore, warnings,
    summary: summarise(sections.length, contradictions.length, boilerplateSections.length,
      ungroundedSections.length, overallScore),
  };
}

function summarise(
  total: number, contradictions: number, boilerplate: number, ungrounded: number, score: number,
): string {
  if (!total) return "No narrative sections to review.";
  if (!contradictions && !boilerplate && !ungrounded) {
    return `${total} section(s) reviewed, all grounded in the evidence they cite. Score ${score}.`;
  }
  const parts: string[] = [];
  if (contradictions) parts.push(`${contradictions} contradiction(s) against the cited artifacts`);
  if (ungrounded) parts.push(`${ungrounded} section(s) citing no evidence`);
  if (boilerplate) parts.push(`${boilerplate} section(s) reading as filler`);
  return `${parts.join(", ")}. Score ${score}.`;
}
