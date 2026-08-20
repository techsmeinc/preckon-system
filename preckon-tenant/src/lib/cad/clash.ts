// Clash and clearance detection.
//
// Two kinds of problem look identical in a model and are completely different
// on site:
//
//   a HARD clash — a duct passing through a beam. Somebody has to move.
//   a CLEARANCE breach — a valve 40 mm from a wall, which fits, and which
//   nobody can ever reach to service.
//
// The second is the one that survives coordination, because it is not a clash:
// the geometry is legal, and only a rule about access says it is wrong. Tools
// that only test intersection report it as clean and the problem is discovered
// by the maintenance contractor two years later.
//
// So both are tested here, against rules that are DATA — clearance requirements
// differ by discipline, by client and by country, and hard-coding 300 mm above
// a ceiling is how a model passes coordination and fails an inspection.
//
// Axis-aligned bounding boxes only. That is a deliberate limit: AABB testing is
// exact for the boxes it is given and approximate for the shapes inside them,
// so it over-reports on diagonal runs and never under-reports. A coordination
// tool that misses clashes is worse than one that flags a few that turn out to
// be clear.

export interface Box {
  /** Minimum corner. */
  x: number; y: number; z: number;
  /** Extents. */
  dx: number; dy: number; dz: number;
}

export interface Item {
  id: string;
  name: string;
  /** Discipline: structural, mechanical, electrical, architectural. */
  discipline: string;
  category?: string | null;
  box: Box;
  /** Elements that are meant to pass through others — a duct through a wall
   *  opening formed for it. Suppresses the clash between exactly those two. */
  permittedThrough?: string[];
}

export interface ClearanceRule {
  key: string;
  /** Applies to items of this discipline or category. */
  appliesTo: { discipline?: string; category?: string };
  /** Minimum gap in metres to anything else. */
  minimumGap: number;
  /** Human reason — maintenance access, fire separation, thermal. */
  reason: string;
  /** Only against these disciplines. Absent = all. */
  against?: string[];
}

export type ClashKind = "hard" | "clearance" | "touching";
export type Severity = "critical" | "major" | "minor";

export interface Clash {
  id: string;
  kind: ClashKind;
  severity: Severity;
  a: { id: string; name: string; discipline: string };
  b: { id: string; name: string; discipline: string };
  /** Overlap volume for a hard clash, in m³. */
  overlapVolume?: number;
  /** Actual gap for a clearance breach. */
  gap?: number;
  required?: number;
  rule?: string;
  message: string;
}

const hi = (b: Box) => ({ x: b.x + b.dx, y: b.y + b.dy, z: b.z + b.dz });

/** Overlap along one axis; negative means a gap of that size. */
const overlap1 = (aMin: number, aMax: number, bMin: number, bMax: number) =>
  Math.min(aMax, bMax) - Math.max(aMin, bMin);

export function overlapVolume(a: Box, b: Box): number {
  const ah = hi(a), bh = hi(b);
  const x = overlap1(a.x, ah.x, b.x, bh.x);
  const y = overlap1(a.y, ah.y, b.y, bh.y);
  const z = overlap1(a.z, ah.z, b.z, bh.z);
  return x > 0 && y > 0 && z > 0 ? x * y * z : 0;
}

/**
 * Shortest gap between two boxes. Zero when they touch, negative when they
 * intersect (the deepest penetration).
 */
export function gap(a: Box, b: Box): number {
  const ah = hi(a), bh = hi(b);
  const dx = -overlap1(a.x, ah.x, b.x, bh.x);
  const dy = -overlap1(a.y, ah.y, b.y, bh.y);
  const dz = -overlap1(a.z, ah.z, b.z, bh.z);
  const outside = [dx, dy, dz].filter((d) => d > 0);
  if (!outside.length) return -Math.min(-dx, -dy, -dz);   // intersecting
  return Math.sqrt(outside.reduce((s, d) => s + d * d, 0));
}

/* A structural element being hit is worse than two services hitting each other:
   moving a beam is a design change, moving a duct is a Tuesday. */
const severityOf = (a: Item, b: Item, kind: ClashKind): Severity => {
  const structural = a.discipline === "structural" || b.discipline === "structural";
  if (kind === "hard") return structural ? "critical" : "major";
  if (kind === "clearance") return structural ? "major" : "minor";
  return "minor";
};

export interface ClashOptions {
  /** Gaps below this count as touching rather than clear. Millimetre noise. */
  tolerance?: number;
  /** Skip pairs within the same discipline — usually already coordinated. */
  crossDisciplineOnly?: boolean;
}

/**
 * Test every pair.
 *
 * O(n²), and deliberately so at this size: a spatial index is the right answer
 * for a hundred thousand elements and a source of subtle bugs for the few
 * thousand a package model holds. When it needs to scale, the index goes in
 * behind this same signature.
 */
export function detect(
  items: Item[], rules: ClearanceRule[] = [], opts: ClashOptions = {},
): Clash[] {
  const tolerance = opts.tolerance ?? 0.001;
  const out: Clash[] = [];

  const ruleFor = (item: Item): ClearanceRule | undefined =>
    rules.find((r) =>
      (r.appliesTo.discipline == null || r.appliesTo.discipline === item.discipline) &&
      (r.appliesTo.category == null || r.appliesTo.category === item.category));

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (opts.crossDisciplineOnly && a.discipline === b.discipline) continue;
      // An opening formed for exactly this element is not a clash with it.
      if (a.permittedThrough?.includes(b.id) || b.permittedThrough?.includes(a.id)) continue;

      const d = gap(a.box, b.box);

      if (d < -tolerance) {
        const volume = overlapVolume(a.box, b.box);
        out.push({
          id: `${a.id}~${b.id}`, kind: "hard", severity: severityOf(a, b, "hard"),
          a: { id: a.id, name: a.name, discipline: a.discipline },
          b: { id: b.id, name: b.name, discipline: b.discipline },
          overlapVolume: Number(volume.toFixed(4)),
          message: `${a.name} (${a.discipline}) passes through ${b.name} (${b.discipline}) — ${volume.toFixed(3)} m³ of overlap.`,
        });
        continue;
      }

      if (Math.abs(d) <= tolerance) {
        out.push({
          id: `${a.id}~${b.id}`, kind: "touching", severity: severityOf(a, b, "touching"),
          a: { id: a.id, name: a.name, discipline: a.discipline },
          b: { id: b.id, name: b.name, discipline: b.discipline },
          gap: 0,
          message: `${a.name} and ${b.name} touch. Intentional or not, nothing can be installed between them.`,
        });
        continue;
      }

      // Clearance: check both items' rules, worst requirement wins.
      for (const [subject, other] of [[a, b], [b, a]] as const) {
        const rule = ruleFor(subject);
        if (!rule) continue;
        if (rule.against?.length && !rule.against.includes(other.discipline)) continue;
        if (d >= rule.minimumGap) continue;
        out.push({
          id: `${subject.id}~${other.id}~${rule.key}`, kind: "clearance",
          severity: severityOf(subject, other, "clearance"),
          a: { id: subject.id, name: subject.name, discipline: subject.discipline },
          b: { id: other.id, name: other.name, discipline: other.discipline },
          gap: Number(d.toFixed(4)), required: rule.minimumGap, rule: rule.key,
          message:
            `${subject.name} is ${(d * 1000).toFixed(0)} mm from ${other.name}; ` +
            `${(rule.minimumGap * 1000).toFixed(0)} mm required for ${rule.reason}. It fits, and it cannot be worked on.`,
        });
      }
    }
  }

  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
  return out.sort((x, y) => order[x.severity] - order[y.severity] || (y.overlapVolume ?? 0) - (x.overlapVolume ?? 0));
}

export interface ClashReport {
  clashes: Clash[];
  hard: number;
  clearance: number;
  touching: number;
  critical: number;
  byDisciplinePair: { pair: string; count: number }[];
  clean: boolean;
  summary: string;
}

export function report(items: Item[], rules: ClearanceRule[] = [], opts: ClashOptions = {}): ClashReport {
  const clashes = detect(items, rules, opts);
  const pairs = new Map<string, number>();
  for (const c of clashes) {
    const pair = [c.a.discipline, c.b.discipline].sort().join(" / ");
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  const hard = clashes.filter((c) => c.kind === "hard").length;
  const clearance = clashes.filter((c) => c.kind === "clearance").length;

  return {
    clashes,
    hard,
    clearance,
    touching: clashes.filter((c) => c.kind === "touching").length,
    critical: clashes.filter((c) => c.severity === "critical").length,
    byDisciplinePair: [...pairs.entries()].map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count),
    clean: clashes.length === 0,
    summary: clashes.length
      ? `${hard} hard clash(es), ${clearance} clearance breach(es)` +
        (pairs.size ? `; worst pairing ${[...pairs.entries()].sort((a, b) => b[1] - a[1])[0][0]}` : "") + "."
      : "No clashes or clearance breaches found.",
  };
}
