/**
 * Maintenance script — shorten over-long BOQ descriptions IN PLACE using ONE
 * cheap model (default claude-haiku-4-5), batched. Rewrites ONLY the description
 * text into a concise one-line estimator item; never touches unit / quantity /
 * refs. Originals are copied to a `boq_desc_backup` table first, so it is fully
 * reversible.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="mysql://root@localhost:3306/boq_tender"
 *   $env:ANTHROPIC_API_KEY="sk-ant-..."          # your key from Settings
 *   npx esbuild scripts/condense-descriptions.ts --bundle --platform=node --format=cjs --external:mysql2 --outfile=scripts/condense-descriptions.cjs
 *   node scripts/condense-descriptions.cjs 14    # project id (omit = all projects)
 *
 * Provider/model overrides (env): BOQ_PROVIDER (anthropic|openai|openrouter|groq,
 * default anthropic), BOQ_MODEL (default claude-haiku-4-5), plus the matching
 * key var: ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY.
 * Only rewrites descriptions longer than MIN_LEN chars (default 180).
 */
import mysql from "mysql2/promise";
import { getAIClient, extractJSON, type Provider, type ProviderConfig } from "../src/lib/ai-provider";
import { jsonrepair } from "jsonrepair";

const MIN_LEN = Number(process.env.BOQ_MIN_LEN ?? 40); // skip already-crisp short item lines
const BATCH = 20;

const SYSTEM = `You rewrite Bill of Quantities descriptions the way an experienced site QS writes a PRICED BOQ — plain, crisp, specific, instantly readable. NOT consultant, spec, or AI language.

WRITE LIKE THIS:
- Everyday construction English. Name the item, what it's made of, and the ONE key size. 6–18 words.
- Start "Supply & install …" (or "Supply, install & connect …" for pipes/cables/services). Simple catalogue items can be just the item + spec (e.g. "Angle valve", "Chrome water-heater tap").
- Keep only the few accessories that matter, joined naturally with "with" or "including" (e.g. "with shutoff valves & fittings").

NEVER do these (they make it read AI/SOW):
- NO references in the text — no "as per SOW 12.2", "per spec 08 11 13", "(SOW 20.2)", clause/section/drawing numbers. They live in other columns.
- NO standards/codes (UFC, ASTM, NFPA, IPC, SSPC, RAL numbers) unless it IS the product's name.
- NO "c/w", NO em-dashes (—), NO "complete with all accessories required", NO coordination/method/installation prose, NO room-by-room lists.
- Don't invent specs; keep the real sizes & materials already present; NEVER change the quantity or unit.

TARGET STYLE (match this):
- "Supply, install & connect PEX cold water line to 24 toilets & laundry, with shutoff valves & fittings"
- "Supply & install 30-min fire-rated hollow metal door, 910 x 2205 mm, with frame, hinges, lockset & closer"
- "Supply & build 190 mm reinforced CMU external wall up to 3 m high, with grout & reinforcement"
- "Supply & install 100 mm Sch.80 PVC telecom duct to nearest manhole, with pull string & concrete encasement"
- "Water hammer arrestor"   /   "Testing & commissioning of domestic water system"

Return ONLY raw JSON: {"items":[{"id":<id>,"short":"<human description>"}]} — one entry per input id, no commentary.`;

async function condenseBatch(
  client: ReturnType<typeof getAIClient>,
  model: string,
  rows: Array<{ id: number; unit: string; description: string }>,
): Promise<Map<number, string>> {
  const user = `Rewrite these ${rows.length} BOQ descriptions. Input JSON:\n` +
    JSON.stringify(rows.map(r => ({ id: r.id, unit: r.unit, description: r.description })));
  const resp = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
  });
  const content = resp.choices[0]?.message?.content ?? "";
  let parsed: { items?: Array<{ id: number; short: string }> };
  try {
    parsed = JSON.parse(extractJSON(content));
  } catch {
    parsed = JSON.parse(jsonrepair(extractJSON(content)));
  }
  const out = new Map<number, string>();
  for (const it of parsed.items ?? []) {
    if (typeof it.id === "number" && typeof it.short === "string" && it.short.trim().length >= 15) {
      out.set(it.id, it.short.trim().replace(/\s+/g, " "));
    }
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL || "mysql://root@localhost:3306/boq_tender";
  const projectArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const provider = (process.env.BOQ_PROVIDER ?? "anthropic") as Provider;
  const model = process.env.BOQ_MODEL ?? "claude-haiku-4-5";
  const providerConfig: ProviderConfig = {
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openrouterKey: process.env.OPENROUTER_API_KEY,
    groqKey: process.env.GROQ_API_KEY,
  };
  const keyOk = provider === "openai" ? !!process.env.OPENAI_API_KEY
    : provider === "anthropic" ? !!providerConfig.anthropicKey
    : provider === "openrouter" ? !!providerConfig.openrouterKey
    : provider === "groq" ? !!providerConfig.groqKey : false;
  if (!keyOk) {
    console.error(`No API key for provider "${provider}". Set the matching *_API_KEY env var (your key from the Settings page).`);
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  const client = getAIClient(provider, providerConfig);

  // Reversible: snapshot originals before touching anything (first write wins).
  await conn.execute(
    "CREATE TABLE IF NOT EXISTS boq_desc_backup (id INT PRIMARY KEY, project_id INT, description TEXT, backed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  );

  const [rows] = await conn.execute<any[]>(
    projectArg
      ? "SELECT id, project_id, unit, description FROM boq_items WHERE project_id = ? AND CHAR_LENGTH(description) > ?"
      : "SELECT id, project_id, unit, description FROM boq_items WHERE CHAR_LENGTH(description) > ?",
    projectArg ? [projectArg, MIN_LEN] : [MIN_LEN],
  );
  console.log(`Found ${rows.length} description(s) over ${MIN_LEN} chars to condense (provider=${provider}, model=${model}).`);
  if (rows.length === 0) { await conn.end(); return; }

  let done = 0, failed = 0, totalBefore = 0, totalAfter = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let shorts: Map<number, string>;
    try {
      shorts = await condenseBatch(client, model, batch);
    } catch (err) {
      failed += batch.length;
      console.warn(`  batch ${i / BATCH + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const r of batch) {
      const short = shorts.get(r.id);
      const cur = (r.description ?? "").trim();
      // Accept a non-trivial style rewrite. Allow same-ish length (humanising a
      // short line needn't shorten it) but never let it grow much or re-bloat.
      if (!short) continue;
      if (short.toLowerCase() === cur.toLowerCase()) continue;
      if (short.length > cur.length + 30 || short.length > 220) continue;
      await conn.execute("INSERT IGNORE INTO boq_desc_backup (id, project_id, description) VALUES (?,?,?)", [r.id, r.project_id, r.description]);
      await conn.execute("UPDATE boq_items SET description = ? WHERE id = ?", [short, r.id]);
      totalBefore += r.description.length; totalAfter += short.length; done++;
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length} processed (${done} rewritten)...`);
  }

  console.log(`\nDone. Rewrote ${done} description(s), ${failed} failed.`);
  if (done) console.log(`Avg length ${Math.round(totalBefore / done)} → ${Math.round(totalAfter / done)} chars. Originals saved in boq_desc_backup.`);
  console.log("Restore anytime with:  UPDATE boq_items b JOIN boq_desc_backup k ON b.id=k.id SET b.description=k.description;");
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
