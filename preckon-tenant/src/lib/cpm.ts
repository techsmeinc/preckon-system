// Critical path analysis for the work programme.
//
// Deterministic, and deliberately not the agent's job. A planner states the
// logic — what follows what, with what overlap — and arithmetic decides which
// chain is critical. Asking a model to nominate the critical path produces a
// label nobody can check; computing it from the stated links produces one a
// planner can argue with.
//
// Supports the four standard relationships, because FS alone cannot express a
// real programme:
//
//   FS  finish-to-start   the normal case; +lag is a wait (a concrete cure)
//   SS  start-to-start    two trades starting together, +lag one floor behind
//   FF  finish-to-finish  services that must be done when the wall is
//   SF  start-to-finish   rare; a handover where the old system runs until the
//                         new one starts
//
// Negative lag is a lead — a deliberate overlap.

export type RelType = "FS" | "SS" | "FF" | "SF";

export interface Link {
  activity: string;
  type: RelType;
  lag_days: number;
}

export interface CpmNode {
  /** The source artifact, untouched. */
  a: any;
  key: string;
  name: string;
  phase: string;
  dur: number;
  milestone: boolean;
  links: Link[];
  /** Early start / finish, late start / finish, in days from commencement. */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Days this activity can slip without delaying the project. */
  float: number;
  critical: boolean;
  /** True when a declared predecessor names an activity that doesn't exist —
   *  the link is dropped, and the programme is only as sound as the rest. */
  danglingRefs: string[];
  flagged: boolean;
}

export interface CpmResult {
  nodes: CpmNode[];
  total: number;
  /** Activities in dependency order along the longest path. */
  criticalPath: CpmNode[];
  /** Problems worth showing a planner rather than silently absorbing. */
  warnings: string[];
}

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Read links from the typed form, falling back to bare FS predecessor names. */
function linksOf(payload: any): Link[] {
  const typed = Array.isArray(payload?.depends_on) ? payload.depends_on : [];
  if (typed.length) {
    return typed
      .filter((d: any) => d && typeof d.activity === "string")
      .map((d: any) => ({
        activity: String(d.activity),
        type: (["FS", "SS", "FF", "SF"].includes(String(d.type)) ? d.type : "FS") as RelType,
        lag_days: num(d.lag_days, 0),
      }));
  }
  return (Array.isArray(payload?.predecessors) ? payload.predecessors : [])
    .filter((p: any) => typeof p === "string" && p.trim())
    .map((p: string) => ({ activity: p, type: "FS" as RelType, lag_days: 0 }));
}

export function computeCpm(rows: any[]): CpmResult {
  const warnings: string[] = [];
  const nodes: CpmNode[] = rows.map((a) => {
    const p = a.payload ?? {};
    return {
      a,
      key: String(p.activity ?? a.id),
      name: String(p.activity ?? "Activity"),
      phase: String(p.phase ?? p.trade ?? ""),
      dur: Math.max(0, num(p.duration_days, 0)),
      milestone: p.is_milestone === true || num(p.duration_days, -1) === 0,
      links: linksOf(p),
      es: 0, ef: 0, ls: 0, lf: 0, float: 0,
      critical: false,
      danglingRefs: [],
      flagged: a.status === "pending" || a.status === "stale",
    };
  });
  if (nodes.length === 0) return { nodes, total: 0, criticalPath: [], warnings };

  // Resolve by activity name, then by WBS — an agent may cite either.
  const byName = new Map(nodes.map((n) => [n.key, n]));
  const byWbs = new Map(
    nodes.filter((n) => n.a.payload?.wbs).map((n) => [String(n.a.payload.wbs), n])
  );
  const resolve = (ref: string) => byName.get(ref) ?? byWbs.get(ref) ?? null;

  for (const n of nodes) {
    for (const l of n.links) if (!resolve(l.activity)) n.danglingRefs.push(l.activity);
  }
  const dangling = nodes.reduce((t, n) => t + n.danglingRefs.length, 0);
  if (dangling) {
    warnings.push(
      `${dangling} predecessor reference${dangling === 1 ? "" : "s"} name an activity that isn't in the programme — those links were ignored.`
    );
  }

  /** Earliest this activity can start, given one predecessor and a relationship. */
  const earliestFrom = (pred: CpmNode, l: Link, dur: number): number => {
    switch (l.type) {
      case "SS": return pred.es + l.lag_days;
      case "FF": return pred.ef + l.lag_days - dur;
      case "SF": return pred.es + l.lag_days - dur;
      default:   return pred.ef + l.lag_days; // FS
    }
  };

  // Forward pass to a fixed point. The iteration bound is also what stops a
  // cyclic network — which an agent can emit — from spinning forever.
  const stated = new Map(nodes.map((n) => [n, num(n.a.payload?.start_offset_days, 0)]));
  let settled = false;
  for (let pass = 0; pass <= nodes.length && !settled; pass++) {
    settled = true;
    for (const n of nodes) {
      // An activity with predecessors is positioned BY them; its stated offset
      // is only a floor for activities with no incoming link. Trusting a stated
      // offset over the network is how a programme ends up showing a bar before
      // the work it depends on.
      const resolved = n.links.map((l) => ({ l, p: resolve(l.activity) })).filter((x) => x.p);
      let start = resolved.length ? -Infinity : stated.get(n) ?? 0;
      for (const { l, p } of resolved) start = Math.max(start, earliestFrom(p as CpmNode, l, n.dur));
      if (!Number.isFinite(start)) start = 0;
      start = Math.max(0, start);
      if (start !== n.es) { n.es = start; settled = false; }
      n.ef = n.es + n.dur;
    }
  }
  if (!settled) warnings.push("The dependency network contains a cycle; dates were capped rather than resolved.");

  const total = Math.max(0, ...nodes.map((n) => n.ef));

  // Backward pass: latest each activity can run without pushing the end date.
  for (const n of nodes) { n.lf = total; n.ls = total - n.dur; }
  settled = false;
  for (let pass = 0; pass <= nodes.length && !settled; pass++) {
    settled = true;
    for (const n of nodes) {
      let lf = total;
      for (const s of nodes) {
        for (const l of s.links) {
          if (resolve(l.activity) !== n) continue;
          // Invert each relationship: the constraint this successor puts on us.
          const cap =
            l.type === "SS" ? s.ls - l.lag_days + n.dur
            : l.type === "FF" ? s.lf - l.lag_days
            : l.type === "SF" ? s.lf - l.lag_days + n.dur
            : s.ls - l.lag_days; // FS
          lf = Math.min(lf, cap);
        }
      }
      if (lf !== n.lf) { n.lf = lf; n.ls = lf - n.dur; settled = false; }
    }
  }

  for (const n of nodes) {
    n.float = Math.round((n.ls - n.es) * 100) / 100;
    // Float within half a day is critical in practice; exact-zero comparison on
    // floats would drop activities off the path for rounding alone.
    n.critical = n.float <= 0.5;
  }

  nodes.sort((a, b) => a.es - b.es || b.dur - a.dur || a.name.localeCompare(b.name));
  const criticalPath = nodes.filter((n) => n.critical);

  return { nodes, total, criticalPath, warnings };
}

/** Which priced lines a programme never allows time for. Scope with a price and
 *  no bar gets built anyway — and gets built late. */
export function uncoveredBoq(activities: any[], boqLines: any[]): any[] {
  const covered = new Set<string>();
  for (const a of activities) {
    for (const r of a.payload?.boq_refs ?? []) covered.add(String(r).trim());
  }
  if (covered.size === 0) return [];
  return boqLines.filter((b) => {
    const code = String(b.payload?.code ?? "").trim();
    return code && !covered.has(code);
  });
}
