// Audit both planes against WCAG 2.2 AA.
//
//   HOST_EMAIL=… HOST_PW=… APP_EMAIL=… APP_PW=… node a11y.mjs
//
// axe-core catches roughly a third to a half of WCAG failures — the machine-
// checkable ones: contrast, names, roles, labels, landmarks, headings. The rest
// (focus order, keyboard traps, meaningful alt text) still need a person, so
// this reports what it can prove and says nothing about what it cannot.
//
// WCAG 2.2 is the current Recommendation; 2.1 and 2.0 criteria are included
// because 2.2 contains them.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const HOST = process.env.HOST_URL ?? "https://host.preckon.com";
const APP = process.env.APP_URL ?? "https://app.preckon.com";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function signIn(page, url, email, pw) {
  await page.goto(`${url}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  await page.locator('input[type="email"], input#email').first().fill(email);
  await page.locator('input[type="password"], input#pw').first().fill(pw);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 40000 }).catch(() => {}),
    page.getByRole("button", { name: /^sign\s*in$/i }).first().click(),
  ]);
  await page.waitForTimeout(3000);
  if (await page.locator('input[type="password"]').count()) throw new Error("sign-in rejected");
}

async function scan(page, label, url, wait = 1800) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(wait);
  await page.evaluate(AXE);
  const res = await page.evaluate(
    async (tags) => await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }),
    TAGS
  );
  return { label, url, violations: res.violations };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const all = [];

try {
  all.push(await scan(page, "host · sign in", `${HOST}/login`));
  if (process.env.HOST_EMAIL) {
    await signIn(page, HOST, process.env.HOST_EMAIL, process.env.HOST_PW);
    for (const [p, l] of [["/overview", "host · overview"], ["/tenants", "host · tenants"],
                          ["/editions", "host · editions"], ["/audit", "host · audit"]]) {
      all.push(await scan(page, l, HOST + p));
    }
  }

  all.push(await scan(page, "app · sign in", `${APP}/login`));
  if (process.env.APP_EMAIL) {
    await ctx.clearCookies();
    await signIn(page, APP, process.env.APP_EMAIL, process.env.APP_PW);
    all.push(await scan(page, "app · dashboard", `${APP}/overview`));
    all.push(await scan(page, "app · projects", `${APP}/projects`));
    all.push(await scan(page, "app · drawing editor", `${APP}/drawings`, 3200));
    // Whichever project is first carries the most work; scan its stages.
    await page.goto(`${APP}/projects`, { waitUntil: "networkidle" }).catch(() => {});
    const row = page.locator("table tbody tr").first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(2500);
      const proj = page.url().replace(/\/+$/, "");
      all.push(await scan(page, "app · project overview", proj, 2600));
      for (const m of ["drawings", "boq", "schedule"]) {
        all.push(await scan(page, `app · ${m}`, `${proj}/modules/${m}`, 2800));
      }
    }
  }
} catch (e) {
  console.error("stopped:", e.message);
} finally {
  await browser.close();
}

// ── report ───────────────────────────────────────────────────────────────
const byRule = new Map();
for (const p of all) {
  for (const v of p.violations) {
    const r = byRule.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter((t) => /^wcag\d/.test(t)), pages: new Set(), nodes: 0, sample: [] };
    r.pages.add(p.label);
    r.nodes += v.nodes.length;
    for (const n of v.nodes.slice(0, 2)) if (r.sample.length < 4) r.sample.push(n.target.join(" ").slice(0, 90));
    byRule.set(v.id, r);
  }
}
const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rules = [...byRule.values()].sort((a, b) => (RANK[a.impact] ?? 9) - (RANK[b.impact] ?? 9) || b.nodes - a.nodes);

console.log(`\nScanned ${all.length} pages against ${TAGS.join(", ")}\n`);
for (const p of all) {
  const n = p.violations.reduce((s, v) => s + v.nodes.length, 0);
  console.log(`  ${n === 0 ? "clean " : String(n).padStart(4) + "  "} ${p.label}`);
}
console.log(`\n${rules.length} distinct rules failing, ${rules.reduce((s, r) => s + r.nodes, 0)} elements\n`);
for (const r of rules) {
  console.log(`[${(r.impact ?? "?").toUpperCase()}] ${r.id}  (${r.nodes} elements, ${r.pages.size} pages)`);
  console.log(`   ${r.help}`);
  console.log(`   ${r.wcag.join(" ")}  ·  on: ${[...r.pages].slice(0, 4).join(", ")}`);
  for (const s of r.sample) console.log(`   e.g. ${s}`);
  console.log("");
}

fs.writeFileSync(path.join(process.cwd(), "a11y.json"), JSON.stringify(all, null, 1));
