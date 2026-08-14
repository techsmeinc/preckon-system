/**
 * Matching artifact type keys.
 *
 * A type key is namespaced: `construction.cost_line`. Everywhere a short name
 * had to be resolved against a full one, the code did `LIKE '%cost_line'` or
 * `endsWith("cost_line")`, and both are wrong for the same reason — a suffix
 * does not respect segment boundaries:
 *
 *   construction.cost_line        matches, and should
 *   construction.extra_cost_line  ALSO matches, and should not
 *
 * That is a live bug today, not only a future one. It becomes much worse with
 * more than one pack installed, which is the direction the product is going:
 *
 *   construction.cost_line
 *   enterprise.cost_line
 *   insurance.cost_line
 *
 * where a bare `cost_line` matches all three and the caller silently gets
 * whichever the database returned first.
 *
 * The rule here is simple and boundary-aware:
 *
 *   a reference WITH a dot   → exact match, and nothing else
 *   a reference without one  → the last segment must equal it, exactly
 *
 * Prefer full keys. The short form stays supported because seeds, pack configs
 * and hand-written workflow nodes use it, and breaking those to fix a matching
 * bug would be a poor trade — but it is now unambiguous within a namespace
 * rather than a substring gamble.
 */

/** The last segment: "construction.cost_line" → "cost_line". */
export const shortType = (typeKey: string): string => typeKey.split(".").pop() ?? typeKey;

/** Is this reference a fully-qualified key rather than a short name? */
export const isCanonical = (ref: string): boolean => ref.includes(".");

/**
 * Does `typeKey` satisfy `ref`?
 *
 * Case-insensitive, because pack authors are inconsistent about it and a type
 * that fails to match on capitalisation is a bug nobody can see.
 */
export function isTypeMatch(typeKey: string, ref: string): boolean {
  if (!typeKey || !ref) return false;
  const a = typeKey.toLowerCase();
  const b = ref.toLowerCase();
  return isCanonical(b) ? a === b : shortType(a) === b;
}

/** Any of them. */
export const matchesAnyType = (typeKey: string, refs: string[]): boolean =>
  refs.some((r) => isTypeMatch(typeKey, r));

/**
 * SQL for the same rule, as a fragment and its parameters.
 *
 * A canonical reference is an equality test. A short one has to allow both the
 * bare key and any namespace, so it is `type_key = ? OR type_key LIKE ?` with a
 * DOT in the pattern — `%.cost_line` rather than `%cost_line`, which is the
 * whole difference between matching `extra_cost_line` and not.
 *
 *   const m = typeMatchSql("type_key", ref);
 *   query(`SELECT … WHERE tenant_id = ? AND ${m.sql}`, [tenantId, ...m.params]);
 */
export function typeMatchSql(column: string, ref: string): { sql: string; params: string[] } {
  if (isCanonical(ref)) return { sql: `${column} = ?`, params: [ref] };
  return { sql: `(${column} = ? OR ${column} LIKE ?)`, params: [ref, `%.${ref}`] };
}

/** The same for a list — matches if any reference matches. */
export function typeMatchAnySql(column: string, refs: string[]): { sql: string; params: string[] } {
  if (!refs.length) return { sql: "1 = 0", params: [] };
  const parts = refs.map((r) => typeMatchSql(column, r));
  return {
    sql: `(${parts.map((p) => p.sql).join(" OR ")})`,
    params: parts.flatMap((p) => p.params),
  };
}

/**
 * Which references a key is ambiguous against — more than one candidate sharing
 * a short name. For diagnostics: a caller that hits this is relying on luck.
 */
export function ambiguousMatches(typeKeys: string[], ref: string): string[] {
  if (isCanonical(ref)) return [];
  const hits = typeKeys.filter((k) => isTypeMatch(k, ref));
  return hits.length > 1 ? hits : [];
}
