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

export interface BuildOptions {
  /**
   * Read tools only.
   *
   * "Ask" is a different promise from "Edit": the answer must not change the
   * model. Enforcing that by withholding the write tools is worth more than
   * asking the model nicely in a prompt — it cannot emit a command it was never
   * given, so the guarantee holds even when the instruction sounds like an
   * order.
   */
  readOnly?: boolean;
}

export function buildRegistry(authored: AuthoredToolDef[] = [], opts: BuildOptions = {}): BuildResult {
  const available = opts.readOnly ? BUILTIN_TOOLS.filter((t) => t.kind === "read") : BUILTIN_TOOLS;
  const registry = new ToolRegistry().register(...available);
  const skipped: { name: string; reason: string }[] = [];

  // An authored tool that writes is not offered in ask mode either, for the same
  // reason: it compiles down to the very commands being withheld.
  if (opts.readOnly) {
    for (const def of authored) {
      const writes = def.steps.some((st) => BUILTIN_TOOLS.find((b) => b.name === st.tool)?.kind === "write");
      if (writes) skipped.push({ name: def.name, reason: "changes the model — not available while asking" });
    }
    authored = authored.filter((def) => !def.steps.some((st) => BUILTIN_TOOLS.find((b) => b.name === st.tool)?.kind === "write"));
  }

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
