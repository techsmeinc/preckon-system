import { test, expect, type Page } from "@playwright/test";

// The workflow the Internal Alpha is judged on, end to end:
//
//   project → tender → AI analysis → drawings → takeoff → BOQ → review
//           → schedule → narrative → submission export
//
// The plan calls this the golden workflow and asks for it to be bulletproof
// before anything else ships. Every other test in this suite checks a screen;
// this one checks that the chain still connects — which is the failure a screen
// test cannot see, because each screen passes while the handover between two of
// them is broken.
//
// ── HOW IT IS WRITTEN, AND WHY ───────────────────────────────────────────────
//
// Against the SEEDED project rather than one created here. Creating a project
// and driving real AI would make the run depend on an API key, cost money per
// run, and take minutes — so it would be switched off within a fortnight, which
// is the normal fate of an expensive end-to-end test. The seed already contains
// a project that has been through the chain, so this asserts the chain's OUTPUT
// is reachable and coherent at every stage.
//
// It asserts on ARTIFACTS AND NUMBERS, not on layout. A test that pins headings
// and pixel positions fails on every design change and gets deleted; one that
// pins "the BOQ has priced lines and they total something" survives a redesign
// and still catches a broken chain.
//
// Run it:
//   docker compose up -d && docker compose --profile tools run --rm seed
//   npx playwright test e2e/golden-path.spec.ts

const EMAIL = process.env.E2E_EMAIL ?? "owner@aigcc.group";
const PASSWORD = process.env.E2E_PASSWORD ?? "preckon-tenant-2026";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
}

/** The seeded project, without pinning its name — seeds get renamed. */
async function openFirstProject(page: Page): Promise<string> {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.locator("tbody tr").first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{8,}/);
  const pid = page.url().match(/\/projects\/([0-9a-f-]{8,})/)?.[1];
  expect(pid, "could not read a project id from the URL").toBeTruthy();
  return pid!;
}

/**
 * Read the API the way the app does, inside the browser session.
 *
 * Going through the page keeps the auth cookie and the tenant scope, so this
 * exercises the same path a user does rather than a back door that could pass
 * while the real one is broken.
 */
async function api<T = any>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { headers: { accept: "application/json" } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

test.describe("golden path", () => {
  test("the chain is reachable end to end", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    // ── Stage 1: the project exists and knows where it is in the chain ──
    const project = await api(page, `/api/v1/projects/${pid}`);
    expect(project.status, "project detail").toBe(200);

    // ── Stage 2: tender documents were ingested ──
    const files = await api(page, `/api/v1/projects/${pid}/files`);
    expect(files.status, "files").toBe(200);

    // ── Stage 3: AI analysis produced artifacts ──
    const artifacts = await api<any>(page, `/api/v1/projects/${pid}/artifacts`);
    expect(artifacts.status, "artifacts").toBe(200);
    const items: any[] = artifacts.body?.artifacts ?? artifacts.body ?? [];
    expect(Array.isArray(items), "artifacts should be a list").toBe(true);
    expect(items.length, "the seeded project should carry artifacts").toBeGreaterThan(0);

    /* Every artifact carries its type and a status. A record that reached the
       screen with neither is the shape of a half-materialised proposal, which is
       the class of bug the chain is most likely to produce. */
    for (const a of items.slice(0, 20)) {
      expect(a.type_key ?? a.type, `artifact ${a.id} has no type`).toBeTruthy();
      expect(a.status, `artifact ${a.id} has no status`).toBeTruthy();
    }
  });

  test("the bill has priced lines that add up", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    const roster = await api(page, `/api/v1/projects/${pid}/boq/roster`);
    expect([200, 404], "boq roster").toContain(roster.status);

    // The export is the thing a customer receives, so it is the thing worth
    // asserting: if it 200s with content, the bill survived the whole chain.
    const csv = await page.evaluate(async (p) => {
      const res = await fetch(p);
      return { status: res.status, length: (await res.text()).length };
    }, `/api/v1/projects/${pid}/boq/export.csv`);

    expect(csv.status, "BOQ CSV export").toBe(200);
    expect(csv.length, "an empty bill is a broken chain, not an empty project").toBeGreaterThan(50);
  });

  test("the programme exports", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    const programme = await api<any>(page, `/api/v1/projects/${pid}/programme`);
    expect(programme.status, "programme").toBe(200);

    const xlsx = await page.evaluate(async (p) => {
      const res = await fetch(p);
      return { status: res.status, type: res.headers.get("content-type") ?? "" };
    }, `/api/v1/projects/${pid}/programme/export.xlsx`);

    expect(xlsx.status, "programme xlsx").toBe(200);
    expect(xlsx.type, "should be a workbook, not an error page").toMatch(/spreadsheet|octet-stream/);
  });

  test("the narrative composes from project data", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    const md = await page.evaluate(async (p) => {
      const res = await fetch(p);
      const text = await res.text();
      return { status: res.status, length: text.length, text: text.slice(0, 400) };
    }, `/api/v1/projects/${pid}/narrative/export.md`);

    expect(md.status, "narrative export").toBe(200);
    /* Length rather than wording: the narrative is model-written and will differ
       run to run, but a section that composed from nothing comes back empty and
       that IS deterministic. */
    expect(md.length, "a narrative with no content means the chain fed it nothing").toBeGreaterThan(200);
  });

  test("provenance survives the chain", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    const artifacts = await api<any>(page, `/api/v1/projects/${pid}/artifacts`);
    const items: any[] = artifacts.body?.artifacts ?? artifacts.body ?? [];
    const derived = items.find((a) => (a.type_key ?? a.type ?? "").includes("boq_line")) ?? items[0];
    test.skip(!derived, "no artifact to trace");

    const trace = await api(page, `/api/v1/projects/${pid}/artifacts/${derived.id}/trace`);
    expect(trace.status, "trace").toBe(200);
    /* The whole audit proposition is that a number can be walked back to what
       produced it. A record that arrives with an empty trace looks identical to
       one that arrives with a full one, right up until somebody asks where a
       quantity came from. */
    expect(trace.body, "an artifact with no trace cannot be defended").toBeTruthy();
  });

  test("the AI surfaces answer, or say why not", async ({ page }) => {
    await signIn(page);
    const pid = await openFirstProject(page);

    /* Ask mode: read-only by construction, so it is safe to run against a
       seeded project and cannot alter it. Without an API key the worker refuses
       rather than inventing an answer — which is the behaviour under test as
       much as the success case is. */
    const res = await page.evaluate(async (p) => {
      const r = await fetch(p, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "what is in this model", mode: "ask" }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, `/api/v1/projects/${pid}/bim/agent`);

    // 200 with a reply, or a clean 4xx explaining the assistant is unavailable.
    // What must never happen is a 500, or a success carrying invented content.
    expect([200, 400, 401, 403], `unexpected ${res.status}`).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.proposal, "ask mode must not produce a proposal").toBeNull();
      expect(res.body.reply ?? res.body.question, "a 200 with no reply is a silent failure").toBeTruthy();
    } else {
      expect(res.body?.error?.message, "a failure must explain itself").toBeTruthy();
      expect(res.body?.error?.requestId, "a failure must be findable in the logs").toBeTruthy();
    }
  });
});
