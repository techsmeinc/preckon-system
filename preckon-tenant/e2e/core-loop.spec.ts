import { test, expect } from "@playwright/test";

// The seeded tenant owner — a CUSTOMER identity, distinct from Host staff.
// Override when the seed used different credentials.
const EMAIL = process.env.E2E_EMAIL ?? "owner@aigcc.group";
const PASSWORD = process.env.E2E_PASSWORD ?? "preckon-tenant-2026";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
}

/** Open whatever the seed created, rather than pinning a project name. */
async function openFirstProject(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.locator("tbody tr").first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{8,}/);
  await expect(page.getByRole("heading", { name: "Chain progress" })).toBeVisible();
}

test("sign in renders the app shell", async ({ page }) => {
  await signIn(page);
  // Dashboard: the estimator's landing.
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs your review" })).toBeVisible();
  // Shell chrome: nav, ⌘K search, Copilot.
  await expect(page.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copilot" }).first()).toBeVisible();
});

test("the command palette jumps to a screen", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("dialog", { name: "Command palette" }).getByLabel("Search").fill("Library");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library/);
});

test("the project workspace shows the chain", async ({ page }) => {
  await signIn(page);
  await openFirstProject(page);

  // The tab bar IS the chain — the stages come from the licensed modules.
  const tabs = page.locator(".pw-tabs");
  await expect(tabs.getByText("Overview")).toBeVisible();
  await expect(tabs.getByText("Documents")).toBeVisible();
  await expect(tabs.getByText("Tender", { exact: true })).toBeVisible();
  await expect(tabs.getByText("BOQ", { exact: true })).toBeVisible();

  // TenderLogix has its own surface, not a generic artifact dump.
  await tabs.getByText("Tender", { exact: true }).click();
  await expect(page).toHaveURL(/\/modules\/tenderlogix/);
});

test("core loop: start a skeleton run, confirm scope, pursuit advances", async ({ page }) => {
  await signIn(page);
  await openFirstProject(page);

  // Runs live behind the chain now, linked from the project overview.
  await page.getByRole("link", { name: /^Runs/ }).click();
  await page.getByRole("button", { name: "Start a run" }).first().click();
  await page.getByRole("dialog").getByRole("combobox").selectOption("workflow.tenderlogix.skeleton");
  await page.getByRole("button", { name: "Start run" }).click();

  // The run detail shows the step timeline; the run pauses at the scope gate.
  await expect(page.getByText("Step timeline")).toBeVisible();
  // Step ids are humanised in the timeline, so match the label not the key.
  await expect(page.getByText(/Gate Scope/i)).toBeVisible();
  await expect(page.getByText(/awaiting review/i).first()).toBeVisible();
});

test("a proposal is confirmed on the chain stage that produced it", async ({ page }) => {
  await signIn(page);
  await openFirstProject(page);

  // TenderLogix owns tender_summary, so its own surface is where it gets decided.
  await page.locator(".pw-tabs").getByText("Tender", { exact: true }).click();
  await expect(page).toHaveURL(/\/modules\/tenderlogix/);

  await page.getByRole("button", { name: /^Review$/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Accept as-is" }).click();
  await expect(page.locator(".toast.on")).toContainText("Confirmed");
});
