// Seed a rich CONSTRUCTION demo tenant — "AIGCC Group" — into the running tenant
// plane: owner + team, a real rate book / standards / precedent library, a
// portfolio of live tenders, and autopilot-run pursuits so the workspace looks
// alive. Idempotent-ish: re-running skips users/library/projects that exist.
//
//   node scripts/seed-aigcc.mjs            (against http://localhost:3100)
//
const BASE = process.env.TENANT_URL ?? "http://localhost:3100";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "change-me-service-token";
const TENANT = "00000000-0000-7000-8000-0000000000a1";
const OWNER = { email: "owner@aigcc.group", name: "Ade Bello", password: "preckon-tenant-2026" };

let cookie = "";
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", origin: BASE, cookie, ...(opts.headers || {}) } });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) cookie = setc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (r) => r.status >= 200 && r.status < 300;

// ── Demo content (construction / AIGCC Group) ──────────────────────────────
const USERS = [
  { email: "priya.nair@aigcc.group",  name: "Priya Nair",   roleKeys: ["precon_lead"] },
  { email: "marco.reyes@aigcc.group", name: "Marco Reyes",  roleKeys: ["estimator"] },
  { email: "sarah.chen@aigcc.group",  name: "Sarah Chen",   roleKeys: ["qs_reviewer"] },
  { email: "james.okafor@aigcc.group",name: "James Okafor", roleKeys: ["admin"] },
  { email: "lena.novak@aigcc.group",  name: "Lena Novak",   roleKeys: ["viewer"] },
  // Demo admins with a known password (change in production).
  { email: "shruthi@aigcc.group",     name: "Shruthi",      roleKeys: ["admin"], password: "preckon-2026" },
  { email: "pranavi@aigcc.group",     name: "Pranavi",      roleKeys: ["admin"], password: "preckon-2026" },
];

const RATE_BOOK = [
  { code: "C25", payload: { description: "Concrete grade C25/30 to foundations", unit: "m3", rate_minor: 15200, currency: "USD", trade: "Concrete" } },
  { code: "C32", payload: { description: "Concrete grade C32/40 to superstructure", unit: "m3", rate_minor: 16850, currency: "USD", trade: "Concrete" } },
  { code: "R16", payload: { description: "Reinforcement bar 16mm high-yield", unit: "kg", rate_minor: 125, currency: "USD", trade: "Rebar" } },
  { code: "R25", payload: { description: "Reinforcement bar 25mm high-yield", unit: "kg", rate_minor: 132, currency: "USD", trade: "Rebar" } },
  { code: "FW1", payload: { description: "Formwork to soffits & beams", unit: "m2", rate_minor: 4200, currency: "USD", trade: "Formwork" } },
  { code: "BW1", payload: { description: "Blockwork 140mm external walls", unit: "m2", rate_minor: 6800, currency: "USD", trade: "Masonry" } },
  { code: "SS1", payload: { description: "Structural steel UB/UC sections, erected", unit: "tonne", rate_minor: 245000, currency: "USD", trade: "Steel" } },
  { code: "CW1", payload: { description: "Unitised curtain walling, glazed", unit: "m2", rate_minor: 62000, currency: "USD", trade: "Facade" } },
  { code: "PIL", payload: { description: "Bored cast-in-place piles 600mm", unit: "m", rate_minor: 21000, currency: "USD", trade: "Piling" } },
  { code: "EXC", payload: { description: "Bulk excavation incl. cart away", unit: "m3", rate_minor: 1850, currency: "USD", trade: "Groundworks" } },
  { code: "WP1", payload: { description: "Tanking / waterproofing membrane", unit: "m2", rate_minor: 5500, currency: "USD", trade: "Waterproofing" } },
  { code: "MEP", payload: { description: "MEP first + second fix per m2 GFA", unit: "m2", rate_minor: 34000, currency: "USD", trade: "MEP" } },
];
const STANDARDS = [
  { key: "EN1992", payload: { title: "Eurocode 2 — Design of concrete structures", discipline: "structural", mandatory: true } },
  { key: "EN1090", payload: { title: "Execution of steel structures (EN 1090-2)", discipline: "structural", mandatory: true } },
  { key: "ISO19650", payload: { title: "BIM information management (ISO 19650)", discipline: "digital", mandatory: false } },
  { key: "OHS45001", payload: { title: "Occupational health & safety (ISO 45001)", discipline: "hse", mandatory: true } },
];
const PRECEDENT = [
  { key: "harbour-point", payload: { project: "Harbour Point Tower", value_minor: 4820000000, currency: "USD", outcome: "won", margin_pct: 11.5, year: 2024 } },
  { key: "terminal-3", payload: { project: "Airport Terminal 3 Fit-out", value_minor: 1265000000, currency: "USD", outcome: "lost", margin_pct: 8.0, year: 2025 } },
];
const PROJECTS = [
  { name: "Marina Bay Mixed-Use Tower", code: "MBT-2026", client_name: "Harbourfront Development Authority", run: true },
  { name: "Coastal Highway Bridge — Segment 4", code: "CHB-004", client_name: "National Roads Agency", run: true },
  { name: "Green Data Centre — Phase 1", code: "GDC-001", client_name: "Nimbus Cloud Infrastructure", run: false },
  { name: "Metro Line 4 — Central Station", code: "ML4-CS", client_name: "Metropolitan Transit Board", run: false },
  { name: "Riverside Hospital — East Wing", code: "RHW-2026", client_name: "Regional Health Trust", run: false },
];

async function drivePursuit(pid, label) {
  await call(`/api/v1/projects/${pid}/pursuit/start`, { method: "POST", body: "{}" });
  for (let i = 0; i < 160; i++) {   // construction runs 12 workflows (incl. a map) — allow time
    const s = (await call(`/api/v1/projects/${pid}/pursuit`)).body;
    if (s && !s.autopilot && s.completed >= s.total) return `${s.completed}/${s.total} · ${s.lifecycleState}`;
    await sleep(2000);
  }
  return "timeout";
}

(async () => {
  console.log(`\nSeeding AIGCC Group (construction) into ${BASE}\n${"=".repeat(58)}`);

  // 1) Bootstrap the tenant (service auth, idempotent by tenant id).
  const boot = await call(`/api/internal/tenants/${TENANT}/bootstrap`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tenant_name: "AIGCC Group", owner: { email: OWNER.email, name: OWNER.name, password: OWNER.password }, edition_ref: "enterprise", domain_key: "construction", max_tier: "deep" }),
  });
  console.log(`tenant bootstrap → HTTP ${boot.status}`);

  // 2) Sign in as the owner.
  const login = await call("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
  if (login.status !== 200) throw new Error("owner login failed: " + JSON.stringify(login.body));

  // 3) Team.
  let addedUsers = 0;
  for (const u of USERS) {
    const r = await call("/api/v1/users", { method: "POST", body: JSON.stringify(u) });
    if (ok(r)) addedUsers++;
  }
  console.log(`team members ensured (${addedUsers} added, ${USERS.length - addedUsers} already present)`);

  // 4) Library: rate book, standards, precedent.
  const existingLib = new Set(((await call("/api/v1/library")).body ?? []).map((e) => `${e.collection}:${e.entry_key}`));
  let libAdded = 0;
  const addLib = async (collection, entryKey, payload) => {
    if (existingLib.has(`${collection}:${entryKey}`)) return;
    if (ok(await call("/api/v1/library", { method: "POST", body: JSON.stringify({ collection, entryKey, payload }) }))) libAdded++;
  };
  for (const r of RATE_BOOK) await addLib("rate_book", r.code, r.payload);
  for (const s of STANDARDS) await addLib("standard", s.key, s.payload);
  for (const p of PRECEDENT) await addLib("precedent", p.key, p.payload);
  console.log(`library entries added: ${libAdded} (rate book ${RATE_BOOK.length}, standards ${STANDARDS.length}, precedent ${PRECEDENT.length})`);

  // 5) Project portfolio.
  const existingProjects = new Map(((await call("/api/v1/projects")).body ?? []).map((p) => [p.code, p.id]));
  const created = [];
  for (const p of PROJECTS) {
    let id = existingProjects.get(p.code);
    if (!id) {
      const r = await call("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: p.name, code: p.code, client_name: p.client_name, lifecycle_key: "bid_pursuit" }) });
      id = r.body?.id;
    }
    created.push({ ...p, id });
  }
  console.log(`projects ensured: ${created.filter((p) => p.id).length}/${PROJECTS.length}`);

  // 6) Run autopilot on the flagged pursuits so artifacts/lifecycle populate.
  for (const p of created.filter((p) => p.run && p.id)) {
    process.stdout.write(`  ▶ autopilot: ${p.name.padEnd(34)} `);
    console.log(await drivePursuit(p.id, p.name));
  }

  const verify = (await call("/api/v1/audit/verify")).body;
  console.log(`${"=".repeat(58)}\nAudit chain: ${JSON.stringify(verify)}`);
  console.log(`\n✅ AIGCC Group ready — sign in: ${OWNER.email} / ${OWNER.password}\n`);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
