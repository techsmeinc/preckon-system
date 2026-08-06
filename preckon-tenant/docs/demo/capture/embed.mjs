// Bake captured screenshots into the runbook.
//
//   node embed.mjs <path to demo.html> [shot dir]
//
// Reads <shot dir>/<SLOT>.png, scales each to 1400px wide and writes it into
// the page's BAKED map as a JPEG data URI. Slots with no image keep their
// capture instructions, so a half-finished run still produces a usable
// document.
//
// Re-runnable: it replaces the whole BAKED assignment each time rather than
// appending, so running it twice does not double the file size.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const docPath = process.argv[2];
const shotDir = process.argv[3] ?? path.join(process.cwd(), "out");
if (!docPath) {
  console.error("usage: node embed.mjs <demo.html> [shot dir]");
  process.exit(1);
}

const doc = fs.readFileSync(docPath, "utf8");
const slots = [...doc.matchAll(/data-shot="([^"]+)"/g)].map((m) => m[1]);

// The scaling runs in a real canvas — the same code path as the in-page attach
// button, so a baked image and an attached one come out looking identical.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");

const baked = {};
let bytes = 0;
for (const id of slots) {
  const file = path.join(shotDir, `${id}.png`);
  if (!fs.existsSync(file)) continue;
  const b64 = fs.readFileSync(file).toString("base64");
  const url = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
    const scale = Math.min(1, 1400 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  }, `data:image/png;base64,${b64}`);
  baked[id] = url;
  bytes += url.length;
  console.log(`  baked ${id}  ${(url.length / 1024).toFixed(0)} KB`);
}
await browser.close();

const json = JSON.stringify(baked).replace(/</g, "\\u003c");
// The editor saves this document with CRLF, so the line ending is part of the
// match rather than an assumption about how it was last written.
const eol = doc.includes("\r\n") ? "\r\n" : "\n";
const next = doc.replace(/var BAKED = \{[\s\S]*?\};\r?\n/, `var BAKED = ${json};${eol}`);
if (next === doc) {
  console.error("could not find the BAKED assignment in the document");
  process.exit(1);
}
fs.writeFileSync(docPath, next);

console.log(`\n${Object.keys(baked).length} of ${slots.length} slots filled · ${(bytes / 1048576).toFixed(1)} MB embedded`);
const missing = slots.filter((s) => !baked[s]);
if (missing.length) console.log("still to capture: " + missing.join(", "));
