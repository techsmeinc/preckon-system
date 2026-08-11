/**
 * project-tools — what the Copilot can look up while answering.
 *
 * THE PROBLEM
 *
 * The Copilot was handed the last 100 artifacts, truncated to 45,000
 * characters, and asked to answer from that. On a project with a 200-line bill
 * it was reading a fragment and answering as though it had the whole thing.
 * "What's the total?" got a number derived from whichever records survived the
 * cut — plausible, checkable, and wrong.
 *
 * THE CHANGE
 *
 * It asks. Each tool is one question with a bounded answer, so the assistant
 * pulls the three records a question needs instead of being handed a hundred it
 * mostly ignores. It sees more and costs less: a typical answer now reads a few
 * hundred tokens of records rather than forty thousand characters of them.
 *
 * TRUST BOUNDARY (§5.1)
 *
 * The worker still has no database handle and no credential of its own. These
 * call Core over the same service token used to post job results back, and Core
 * answers only for the tenant and project on the job. The tenant is never
 * something the model can name — it comes off the envelope — so no phrasing of
 * a question can reach another workspace's bill.
 */

const CORE_URL = process.env.CORE_URL ?? "http://localhost:3000";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

/**
 * The tool definitions, written for the model rather than for a schema.
 *
 * Each description says WHEN to reach for it, because a tool list without that
 * produces an assistant that calls everything once and then answers from the
 * pile — which is the blind dump again, with extra latency.
 */
export const PROJECT_TOOL_DEFS = [
  {
    name: "project_overview",
    description:
      "Start here for almost any question. Returns what kinds of record this project holds and how many of each, its uploaded files, and its recent runs — without reading any of them. Use it to decide what to look at next.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_records",
    description:
      "Find records: BOQ lines, cost lines, measurements, risks, RFIs, schedule activities, spec clauses. Filter by type, or by free text matched against the record's contents (e.g. 'blockwork', 'DN150'). Returns the records themselves.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "boq_line | cost_line | drawing_measurement | schedule_activity | risk | rfi | spec_clause | procurement_package. Omit for any." },
        q: { type: "string", description: "Free text to match inside the record." },
        limit: { type: "number", description: "Up to 60. Default 20." },
      },
      required: [],
    },
  },
  {
    name: "get_record",
    description:
      "One record in full, with what produced it and what it was derived from. Use when asked where a number came from or why something is priced as it is.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The record id." } },
      required: ["id"],
    },
  },
  {
    name: "read_document",
    description:
      "Read the actual text of an uploaded document — the tender, a specification, a schedule. Five pages at a time. Use it when a question turns on what a document SAYS rather than on what another agent extracted from it.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "All or part of the filename." },
        from_page: { type: "number", description: "First page to read. Default 1." },
      },
      required: ["filename"],
    },
  },
  {
    name: "recent_activity",
    description:
      "Who did what on this project and when — confirmations, corrections, uploads, runs. Use for questions about what changed, who changed it, or what has happened lately.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Up to 60. Default 25." } },
      required: [],
    },
  },
  {
    name: "boq_totals",
    description:
      "Totals computed by the database: number of bill lines, how many are confirmed or pending, the priced total, and the count per section. Use this for any 'how much' or 'how many' question — never add records up yourself.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

/**
 * Bind the tools to one job's tenant and project.
 *
 * Returns null when the envelope carries no project, which is the honest state
 * for a workspace-level question: the loop then runs with no tools and the
 * assistant answers from the records it was given, exactly as before.
 */
export function projectToolbox(env) {
  const tenantId = env?.tenant_id;
  const projectId = env?.project_id;
  if (!tenantId || !projectId) return null;

  const call = async (tool, args) => {
    const res = await fetch(`${CORE_URL}/api/internal/projects/${projectId}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tenant_id: tenantId, tool, args }),
      // A tool call that hangs holds the whole answer. Better to fail one
      // lookup and let the model say what it could not find out.
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      // Returned rather than thrown: the loop shows this to the model, which
      // can then say "I could not read that document" instead of the whole
      // answer failing.
      return { error: json?.error?.message ?? `Lookup failed (${res.status})` };
    }
    return json;
  };

  const handlers = {};
  for (const def of PROJECT_TOOL_DEFS) {
    handlers[def.name] = (args) => call(def.name, args ?? {});
  }

  return { toolDefinitions: PROJECT_TOOL_DEFS, handlers };
}
