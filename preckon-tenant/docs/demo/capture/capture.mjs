// Capture the demo runbook's screenshots from the live sites.
//
// Drives the Chrome already installed on this machine rather than downloading
// a browser, at 1600x1000 with a 2x pixel ratio so the images stay legible when
// the runbook is read on a laptop.
//
// Credentials come from the environment, never from a file:
//   HOST_URL HOST_EMAIL HOST_PW   APP_URL APP_EMAIL APP_PW
//
// Read-only by design. It signs in, navigates and photographs. It does not
// create a tenant, upload a file or run an agent — those cost real records on a
// live system, and a screenshot is not worth that without being asked.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "out");
fs.mkdirSync(OUT, { recursive: true });

const env = (k, d) => process.env[k] ?? d;
const HOST = env("HOST_URL", "https://host.preckon.com");
const APP = env("APP_URL", "https://app.preckon.com");
const only = process.argv[2] || "";          // "login" to capture just the two sign-in screens

const log = (...a) => console.log(...a);
const done = [];
const skipped = [];

async function shot(page, id, what, opts = {}) {
  try {
    if (opts.settle !== false) await page.waitForTimeout(opts.wait ?? 900);
    await page.screenshot({ path: path.join(OUT, `${id}.png`), fullPage: !!opts.full });
    done.push(id);
    log(`  ✓ ${id}  ${what}`);
  } catch (e) {
    skipped.push([id, e.message.split("\n")[0]]);
    log(`  ✗ ${id}  ${e.message.split("\n")[0]}`);
  }
}

/** Sign in through the form, or report plainly why it could not. */
async function signIn(page, url, email, pw) {
  await page.goto(`${url}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  const user = page.locator('input[type="email"], input#email, input[autocomplete="username"]').first();
  const pass = page.locator('input[type="password"], input#pw').first();
  await user.fill(email);
  await pass.fill(pw);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 40000 }).catch(() => {}),
    page.locator('button[type="submit"], form button').first().click(),
  ]);
  await page.waitForTimeout(2500);
  if (/\/login/.test(page.url())) {
    const err = await page.locator("body").innerText().catch(() => "");
    throw new Error(`sign-in rejected — still on /login. Page said: ${err.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  return page.url();
}

/** Click the first thing that matches any of these, and say so. */
async function tryClick(page, selectors, label) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      try {
        await el.click({ timeout: 6000 });
        await page.waitForTimeout(1400);
        return true;
      } catch { /* try the next one */ }
    }
  }
  log(`    – could not find ${label}`);
  return false;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await ctx.newPage();

try {
  // ── the two sign-in screens (no credentials needed) ─────────────────────
  log("\nSign-in screens");
  await page.goto(`${HOST}/login`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await shot(page, "H-00", "Host sign-in");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await shot(page, "T-00", "Workspace sign-in");

  if (only === "login") throw { soft: true };

  // ── host console ────────────────────────────────────────────────────────
  if (process.env.HOST_EMAIL && process.env.HOST_PW) {
    log("\nHost console");
    await signIn(page, HOST, process.env.HOST_EMAIL, process.env.HOST_PW);
    await page.goto(`${HOST}/overview`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, "H-01", "Overview with KPI tiles and activity");

    await page.goto(`${HOST}/tenants`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, "H-02a", "Tenants list");
    if (await tryClick(page, ["table tbody tr", ".tw tbody tr"], "a tenant row")) {
      await shot(page, "H-02", "Tenant drawer with usage against entitlements");
      await page.keyboard.press("Escape");
    }

    await page.goto(`${HOST}/editions`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, "H-04", "Editions and the feature matrix", { full: true });

    await page.goto(`${HOST}/audit`, { waitUntil: "networkidle" }).catch(() => {});
    if (await tryClick(page, ['button:has-text("Verify")', 'button:has-text("verify")'], "Verify audit chain")) {
      await page.waitForTimeout(2200);
    }
    await shot(page, "H-05", "Audit chain verification");

    log("    H-03 (create a tenant) skipped — it writes a real tenant. Ask for it explicitly.");
    skipped.push(["H-03", "would create a real tenant; not done without permission"]);
  } else {
    log("\nHost console — skipped, no HOST_EMAIL / HOST_PW");
  }

  // ── tenant workspace ────────────────────────────────────────────────────
  if (process.env.APP_EMAIL && process.env.APP_PW) {
    log("\nWorkspace");
    await ctx.clearCookies();
    await signIn(page, APP, process.env.APP_EMAIL, process.env.APP_PW);

    await page.goto(`${APP}/overview`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, "T-01", "Dashboard with the review queue");

    await page.goto(`${APP}/projects`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, "T-01b", "Projects list");

    // Whichever project is first is the one with the most recent work in it.
    if (await tryClick(page, ["table tbody tr td .t-name", "table tbody tr"], "a project row")) {
      const proj = page.url().replace(/\/+$/, "");
      await shot(page, "T-02", "Project overview with the chain-progress strip", { full: true });

      for (const [mod, id, what] of [
        ["drawings", "T-06", "Issued drawings with the measured facts panel"],
        ["boq", "T-13", "The bill, grouped by division"],
        ["schedule", "T-15b", "The work programme in the app"],
      ]) {
        await page.goto(`${proj}/modules/${mod}`, { waitUntil: "networkidle" }).catch(() => {});
        await shot(page, id, what, { wait: 2600 });
      }

      await page.goto(`${APP}/drawings`, { waitUntil: "networkidle" }).catch(() => {});
      await shot(page, "T-07", "The drawing editor", { wait: 3200 });
    }

    // Arabic, on a data-heavy screen.
    await page.goto(`${APP}/projects`, { waitUntil: "networkidle" }).catch(() => {});
    if (await tryClick(page, ['button:has-text("English")', ".lang button", ".lang"], "the language switcher")) {
      await tryClick(page, ['button:has-text("العربية")', '[lang="ar"]'], "Arabic");
      await page.waitForTimeout(1600);
      await shot(page, "T-17", "The workspace in Arabic, right to left");
    }

    log("    T-03/T-04/T-05 skipped — they upload a file and run an agent on live data.");
    log("    T-14/T-15 are Excel windows; a browser cannot photograph them.");
    skipped.push(["T-03..T-05", "would upload and run agents on live data"],
                 ["T-14, T-15", "Excel windows — capture these by hand"]);
  } else {
    log("\nWorkspace — skipped, no APP_EMAIL / APP_PW");
  }
} catch (e) {
  if (!e?.soft) console.error("\nStopped:", e.message ?? e);
} finally {
  await browser.close();
}

log(`\n${done.length} captured -> ${OUT}`);
if (skipped.length) {
  log("not captured:");
  for (const [id, why] of skipped) log(`  ${id}: ${why}`);
}
