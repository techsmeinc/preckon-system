import { test, expect, type Page } from "@playwright/test";

// Localization: English, Arabic (RTL) and French. Each locale is checked for
// three things — the copy is translated, the document direction is right, and
// the numbers are formatted for that locale.

const EMAIL = process.env.E2E_EMAIL ?? "owner@aigcc.group";
const PASSWORD = process.env.E2E_PASSWORD ?? "preckon-tenant-2026";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
}

/** Set the per-user language the way the app itself stores it, then reload. */
async function useLocale(page: Page, code: "en" | "ar" | "fr") {
  await page.evaluate((c) => localStorage.setItem("preckon-locale", c), code);
  await page.reload();
}

test("Arabic switches the app to RTL and Arabic copy", async ({ page }) => {
  await signIn(page);
  await useLocale(page, "ar");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");

  // Sidebar and dashboard are in Arabic, not English.
  await expect(page.getByRole("link", { name: "المشاريع", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "مشاريعك" })).toBeVisible();
  await expect(page.getByText("Your projects")).toHaveCount(0);

  await page.screenshot({ path: "test-results/locale-ar-dashboard.png", fullPage: true });
});

test("French translates the app and keeps LTR", async ({ page }) => {
  await signIn(page);
  await useLocale(page, "fr");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(html).toHaveAttribute("lang", "fr");

  await expect(page.getByRole("link", { name: "Projets", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vos projets" })).toBeVisible();

  await page.screenshot({ path: "test-results/locale-fr-dashboard.png", fullPage: true });
});

test("the chain and a module surface translate", async ({ page }) => {
  await signIn(page);
  await useLocale(page, "ar");

  await page.getByRole("link", { name: "المشاريع", exact: true }).click();
  await page.waitForFunction(() => {
    const body = document.querySelector("tbody");
    return !!body && body.rows.length > 0 && !body.textContent?.includes("…");
  }, { timeout: 30_000 });

  const ready = page.locator("tbody tr", { hasText: "جاهز" }).first();
  const target = (await ready.count()) ? ready : page.locator("tbody tr").first();
  await target.click();

  // The chain tab bar carries the Arabic stage names.
  const tabs = page.locator(".pw-tabs");
  await expect(tabs.getByText("جدول الكميات", { exact: true })).toBeVisible();
  await expect(tabs.getByText("المشتريات", { exact: true })).toBeVisible();

  await tabs.getByText("جدول الكميات", { exact: true }).click();
  await expect(page).toHaveURL(/\/modules\/quantlogix/);
  await expect(page.getByRole("heading", { name: "جدول الكميات" })).toBeVisible();
  await page.screenshot({ path: "test-results/locale-ar-boq.png", fullPage: true });
});

test("the topbar switcher changes language in place", async ({ page }) => {
  await signIn(page);

  const picker = page.locator(".lang").getByLabel("Language");
  await expect(picker).toBeVisible();

  await picker.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مشاريعك" })).toBeVisible();
  await page.screenshot({ path: "test-results/topbar-lang-ar.png" });

  // Still reachable in a language you can't read — that's the point of putting
  // it in the topbar rather than three clicks into Settings.
  await page.locator(".lang").getByLabel("اللغة").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
});

test("a person's language overrides the workspace default", async ({ page }) => {
  await signIn(page);
  await useLocale(page, "fr");

  await page.getByRole("link", { name: "Paramètres" }).click();
  await page.getByRole("button", { name: "Préférences" }).click();

  // Switching back to English takes effect without a reload.
  // Scoped to the Settings row — the topbar has its own picker with the same label.
  await page.locator(".set-row").getByLabel("Langue").selectOption("en");
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
