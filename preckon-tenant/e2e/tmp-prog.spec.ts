import { test, expect } from "@playwright/test";
const S = "C:/Users/IKIO/AppData/Local/Temp/claude/c--Users-IKIO-Downloads-New-Preckon-system/cb0bf521-1820-453b-baa7-507dcfd42218/scratchpad";
const P = "/projects/019fb44e-982b-79aa-b701-0e21855fb266/modules/schedulelogix";

test("the editable programme works", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@cedarstone.build");
  await page.getByLabel("Password").fill("preckon-tenant-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await page.goto(P);
  await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 20000 });

  // Set a commencement date — bars should switch from "day N" to real dates.
  await page.locator(".prog-field input[type=date]").fill("2026-09-01");
  await expect(page.locator(".prow .pc-d").first()).toContainText(/\d{2}/, { timeout: 15000 });

  // Open the editor on a real activity.
  const row = page.locator(".prow:not(.sec)").first();
  await row.hover();
  await row.locator(".prow-tools button").first().click();
  await expect(page.locator(".pedit")).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator(".prog").screenshot({ path: `${S}/programme.png` });
});
