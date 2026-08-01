import { test, expect } from "@playwright/test";
test("measure", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@cedarstone.build");
  await page.getByLabel("Password").fill("preckon-tenant-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await page.goto("/projects/019fb44e-982b-79aa-b701-0e21855fb266/modules/schedulelogix");
  await expect(page.locator(".prog-wrap")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1200);
  for (const sel of [".prog", ".prog .chead", ".prog-bar", ".prog-wrap", ".prog-grid", ".prog-track"]) {
    const b = await page.locator(sel).first().boundingBox();
    console.log(sel.padEnd(14), b ? `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.y)}` : "NO BOX");
  }
  const r = await page.locator(".prow").first().boundingBox();
  console.log(".prow[0]      ", r ? `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.y)}` : "none");
  const r2 = await page.locator(".prow").nth(5).boundingBox();
  console.log(".prow[5]      ", r2 ? `${Math.round(r2.width)}x${Math.round(r2.height)} @${Math.round(r2.y)}` : "none");
});
