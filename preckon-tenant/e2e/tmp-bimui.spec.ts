import { test, expect } from "@playwright/test";

test("the BIM assistant prompt bar renders and reports the missing key", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@cedarstone.build");
  await page.getByLabel("Password").fill("preckon-tenant-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);

  await page.goto("/projects/019fb44e-982b-79aa-b701-0e21855fb266/modules/drawlogix");

  const ask = page.locator(".bim-ask");
  await expect(ask).toBeVisible();
  await expect(ask.locator("select")).toBeVisible();
  await expect(ask.locator("input")).toBeVisible();

  await ask.locator("input").fill("Draw a 12 by 8 metre clinic with a corridor");
  await ask.getByRole("button", { name: /Draw/i }).click();
  await expect(page.locator(".toast.on")).toContainText(/ANTHROPIC_API_KEY/i, { timeout: 20000 });
  await page.screenshot({ path: "C:/Users/IKIO/AppData/Local/Temp/claude/c--Users-IKIO-Downloads-New-Preckon-system/cb0bf521-1820-453b-baa7-507dcfd42218/scratchpad/bim-ask.png", fullPage: true });
});
