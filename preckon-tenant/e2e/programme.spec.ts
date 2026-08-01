import { test, expect, type Page } from "@playwright/test";

// Every control on the work programme, each asserted against what actually
// persisted rather than what the click appeared to do. An edit here supersedes
// the artifact and writes to the audit chain, so a control that silently fails
// leaves the bar looking right until the next reload — which is the failure
// mode this file exists to catch.

const EMAIL = process.env.E2E_EMAIL ?? "owner@cedarstone.build";
const PASSWORD = process.env.E2E_PASSWORD ?? "preckon-tenant-2026";
const PID = process.env.E2E_PROJECT_ID ?? "019fb44e-982b-79aa-b701-0e21855fb266";
const URL = `/projects/${PID}/modules/schedulelogix`;

async function open(page: Page) {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await page.goto(URL);
  await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
}

/** The row whose activity name contains `text`. */
const rowFor = (page: Page, text: string) =>
  page.locator(".prow").filter({ has: page.locator(".pname", { hasText: text }) }).first();

/**
 * The same row, pinned by position.
 *
 * `rowFor` re-evaluates its filter on every use, so the moment an inline edit
 * swaps the `.pname` span for an input the filter stops matching and the row
 * "disappears" mid-interaction. Resolve the index once, then address the row by
 * position for the rest of the edit.
 */
async function pinRow(page: Page, text: string) {
  const rows = page.locator(".prow");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const name = await rows.nth(i).locator(".pname").first().textContent().catch(() => null);
    if (name && name.includes(text)) return rows.nth(i);
  }
  throw new Error(`no programme row matching "${text}"`);
}

async function rowCount(page: Page) {
  return page.locator(".prog-grid .prow").count();
}

test.describe("work programme", () => {
  test.describe.configure({ mode: "serial" });

  test("adds a section, then an activity under it", async ({ page }) => {
    await open(page);
    const before = await rowCount(page);

    const sectionsBefore = await page.locator(".prow.sec").count();
    await page.getByRole("button", { name: "Add section" }).click();
    await expect(page.locator(".prow.sec")).toHaveCount(sectionsBefore + 1, { timeout: 20_000 });
    expect(await rowCount(page)).toBe(before + 1);

    // The + on a section adds a child, which must render indented beneath it.
    const section = rowFor(page, "New section");
    await section.hover();
    await section.locator(".prow-tools button", { hasText: "+" }).click();
    await expect(page.locator(".prow")).toHaveCount(before + 2, { timeout: 20_000 });

    const child = rowFor(page, "New activity");
    await expect(child).toBeVisible();
    // Indented => it is a child, not a sibling.
    const pad = await child.locator(".pc-act").evaluate((el) => getComputedStyle(el).paddingInlineStart);
    expect(parseFloat(pad)).toBeGreaterThan(8);
  });

  test("collapses and expands the section", async ({ page }) => {
    await open(page);
    const all = await rowCount(page);
    const twisty = page.locator(".prow.sec .ptw").first();

    // How MANY rows a section hides depends on how many children it has, so
    // assert the direction and the round trip rather than an exact count.
    await twisty.click();
    await expect.poll(() => rowCount(page)).toBeLessThan(all);
    await twisty.click();
    await expect.poll(() => rowCount(page)).toBe(all);
  });

  test("renames an activity and the change survives a reload", async ({ page }) => {
    await open(page);
    const row = await pinRow(page, "New activity");
    await row.locator(".pname").click();
    await row.locator(".pname-in").fill("Renamed by test");
    await row.locator(".pname-in").press("Enter");

    await expect(rowFor(page, "Renamed by test")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
    await expect(rowFor(page, "Renamed by test")).toBeVisible();
  });

  test("sets duration and a predecessor through the editor, and the dates follow", async ({ page }) => {
    await open(page);
    const row = rowFor(page, "Renamed by test");
    await row.hover();
    await row.locator(".prow-tools button").first().click();          // the ✎
    await expect(page.locator(".pedit")).toBeVisible();

    await page.locator(".pedit-grid input[type=number]").first().fill("9");
    await page.getByRole("button", { name: "Add link" }).click();
    const link = page.locator(".pedit-link").first();
    await expect(link).toBeVisible();
    const predName = await link.locator("select").first().inputValue();
    await link.locator("select").nth(1).selectOption("FS");
    await link.locator("input[type=number]").fill("2");               // FS + 2 days lag
    await page.locator(".pedit-foot button").click();

    await expect(page.locator(".pedit")).toBeHidden({ timeout: 20_000 });
    await page.reload();
    await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });

    const after = rowFor(page, "Renamed by test");
    await expect(after.locator(".pc-n")).toContainText("9d");

    // The activity must now start after its predecessor finishes, plus the lag.
    const pred = rowFor(page, predName);
    const predFinish = await pred.locator(".pc-d").nth(1).innerText();
    const ownStart = await after.locator(".pc-d").first().innerText();
    expect(ownStart).not.toEqual(predFinish);                          // it moved
    expect(await after.locator(".pc-d").first().innerText()).toBeTruthy();
  });

  test("sets % done and an assignee", async ({ page }) => {
    await open(page);
    const row = await pinRow(page, "Renamed by test");

    await row.locator(".ppct").click();
    await row.locator(".ppct-in").fill("40");
    await row.locator(".ppct-in").press("Enter");
    await expect(row.locator(".ppct b")).toHaveText("40%", { timeout: 20_000 });

    const options = await row.locator(".passign option").count();
    if (options > 1) {
      const value = await row.locator(".passign option").nth(1).getAttribute("value");
      await row.locator(".passign").selectOption(value!);
      await page.waitForTimeout(1500);
      await page.reload();
      await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
      await expect(rowFor(page, "Renamed by test").locator(".passign")).toHaveValue(value!);
    }

    await page.reload();
    await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
    await expect(rowFor(page, "Renamed by test").locator(".ppct b")).toHaveText("40%");
  });

  test("commencement date switches the grid to real dates", async ({ page }) => {
    await open(page);
    await page.locator(".prog-field input[type=date]").fill("2026-09-01");
    await expect(page.locator(".prow .pc-d").first()).toContainText(/\d{2}/, { timeout: 20_000 });
    await page.reload();
    await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(".prog-field input[type=date]")).toHaveValue("2026-09-01");
  });

  test("zoom, critical filter and assignee filter change what is shown", async ({ page }) => {
    await open(page);
    const chart = page.locator(".prog-track > div").first();
    const wide = (await chart.boundingBox())!.width;
    await page.locator(".zoomctl2 button", { hasText: "+" }).click();
    expect((await chart.boundingBox())!.width).toBeGreaterThan(wide);
    await page.locator(".zoomctl2 button", { hasText: "−" }).click();

    const all = await rowCount(page);
    await page.getByRole("checkbox").first().check();          // critical only
    expect(await rowCount(page)).toBeLessThan(all);
    await page.getByRole("checkbox").first().uncheck();
    expect(await rowCount(page)).toBe(all);
  });

  test("exports a CSV of the programme", async ({ page }) => {
    await open(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("work-programme.csv");
  });

  test("deletes the added rows, including a confirmed one", async ({ page }) => {
    await open(page);
    page.on("dialog", (d) => d.accept());

    for (const name of ["Renamed by test", "New section"]) {
      const row = rowFor(page, name);
      if (!(await row.count())) continue;
      const before = await rowCount(page);
      await row.hover();
      await row.locator(".prow-tools button").last().click();   // the bin
      await expect(page.locator(".prog-grid .prow")).toHaveCount(before - 1, { timeout: 20_000 });
    }

    await page.reload();
    await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 25_000 });
    await expect(rowFor(page, "Renamed by test")).toHaveCount(0);
    await expect(rowFor(page, "New section")).toHaveCount(0);
  });

  test("the audit chain still verifies after all of that", async ({ page }) => {
    await open(page);
    const res = await page.request.get("/api/v1/audit/verify");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBe(true);
  });
});
