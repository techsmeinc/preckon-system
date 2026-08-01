import { test, expect } from "@playwright/test";
const S = "C:/Users/IKIO/AppData/Local/Temp/claude/c--Users-IKIO-Downloads-New-Preckon-system/cb0bf521-1820-453b-baa7-507dcfd42218/scratchpad";
test("pipeline panel", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@cedarstone.build");
  await page.getByLabel("Password").fill("preckon-tenant-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await page.goto("/projects/019fb44e-982b-79aa-b701-0e21855fb266/modules/quantlogix");
  await expect(page.locator(".boqpipe")).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".pipe-stage")).toHaveCount(4);
  await page.getByRole("button", { name: "Details" }).click();
  await page.waitForTimeout(700);
  await page.locator(".boqpipe").screenshot({ path: `${S}/pipeline.png` });
});
