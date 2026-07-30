import { query } from "@/lib/db";
import { errUnprocessable } from "@/lib/errors";

// Shared role helpers. Lives outside route.ts because Next.js route modules may
// only export HTTP handlers (extra exports fail the production type check).

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Resolve a set of permission keys to their rows, 422 on any unknown key. */
export async function resolvePermissionIds(
  keys: string[]
): Promise<{ id: string; key: string }[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const found = await query<{ id: string; key: string }>(
    `SELECT id, \`key\` FROM host_permission WHERE \`key\` IN (${placeholders})`,
    unique
  );
  if (found.length !== unique.length) {
    const foundKeys = new Set(found.map((f) => f.key));
    const missing = unique.filter((k) => !foundKeys.has(k));
    throw errUnprocessable("Unknown permission keys", { missing });
  }
  return found;
}
