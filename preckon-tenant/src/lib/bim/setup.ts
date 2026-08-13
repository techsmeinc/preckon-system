/**
 * BIM — building the registry for a request.
 *
 * The built-in catalogue is fixed; a user's authored tools are not, so the
 * registry is assembled per request rather than kept as a module singleton. It
 * also keeps tenants honest: an authored tool belongs to one author in one
 * tenant, and a registry built for one request can never leak into another.
 *
 * A broken authored tool must not take the assistant down with it — a tool
 * saved last month against a built-in that has since changed should be skipped
 * with a reason, leaving everything else working.
 */

import { compileAuthoredTool, validateAuthoredTool, type AuthoredToolDef } from "./authoring";
import { ToolRegistry } from "./registry";
import { BUILTIN_TOOLS } from "./tools";

export interface BuildResult {
  registry: ToolRegistry;
  /** Authored tools that would not compile, with the reason. Surfaced, not swallowed. */
  skipped: { name: string; reason: string }[];
}

export function buildRegistry(authored: AuthoredToolDef[] = []): BuildResult {
  const registry = new ToolRegistry().register(...BUILTIN_TOOLS);
  const skipped: { name: string; reason: string }[] = [];

  for (const def of authored) {
    const errors = validateAuthoredTool(def, registry);
    if (errors.length) {
      skipped.push({ name: def.name, reason: errors[0] });
      continue;
    }
    registry.upsert(compileAuthoredTool(def, registry));
  }

  return { registry, skipped };
}
