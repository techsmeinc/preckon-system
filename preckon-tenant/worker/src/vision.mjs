/**
 * vision — read the PDF drawing sheets the DXF toolbox cannot see.
 *
 * Ported from AutoCAD-BOQ-Tender/artifacts/api-server/src/lib/vision-pass.ts.
 *
 * WHY. The toolbox in cad-tools.mjs queries parsed CAD: layers, blocks, closed
 * areas. A sheet exported to PDF has none of that — no layers, no blocks, no
 * geometry — so on a PDF-only tender pack every tool call comes back empty and
 * the specialists price from prose. Looking at the sheet is then the only route
 * to a quantity, and a drawing is a document designed to be looked at: the
 * schedules, room names, dimension strings and general notes are all legible.
 *
 * Runs ONCE per bill, not per division. The observations are shared into every
 * section prompt, so a sheet is read at most once however many trades cite it.
 *
 * The worker calls the cad sidecar directly for the raster. Both sides are
 * database-free and credential-free, so this adds no reach: the sidecar still
 * only turns bytes it is handed into bytes it returns, and rendered pages never
 * enter the job envelope (they are hundreds of KB each, and that envelope is a
 * database column).
 */

const CAD_URL = process.env.CAD_URL ?? "http://cad:7400";
const API = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are a quantity surveyor reading drawing sheets before taking off a bill.

Report ONLY what is legibly printed on the sheets. For each sheet give:
  - the sheet title, number and stated scale, exactly as printed;
  - every SCHEDULE table you can read (door/window/finishes/fixture/luminaire),
    transcribed row by row with its quantities — a schedule row is the strongest
    evidence a bill can carry, stronger than anything inferred from geometry;
  - stated dimensions, levels, thicknesses and material notes (e.g. "SLAB 200
    THK", "FALL 1:80", "C30/37");
  - room or area names with any stated areas;
  - general notes that bind the scope.

Do NOT estimate, scale off, or infer a quantity that is not printed. If a
dimension is illegible say so — an acknowledged gap is useful, a confident
misreading of a drawing is how a bill ends up wrong in a way nobody catches.
Return plain text organised by sheet. No preamble.`;

async function renderPages(pdf, maxPages, dpi) {
  const res = await fetch(`${CAD_URL}/render-pages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: pdf.path, maxPages, dpi }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`cad ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  return Array.isArray(body?.pages) ? body.pages : [];
}

/**
 * Look at the project's PDF drawings and return what is printed on them.
 *
 * Best-effort by design: a sheet that will not rasterise, or a vision call that
 * fails, must not take the bill down with it — the specialists still have the
 * documents and whatever CAD was parsed. Returns "" when there is nothing to
 * read, so callers can treat it as an optional block.
 */
export async function runVisionPass({ model, pdfs = [], maxSheets = 4, pagesPerPdf = 3, dpi = 150, note }) {
  if (!pdfs.length || !process.env.ANTHROPIC_API_KEY) return { notes: "", sheets: 0 };

  const images = [];
  for (const pdf of pdfs.slice(0, maxSheets)) {
    try {
      const pages = await renderPages(pdf, pagesPerPdf, dpi);
      for (const p of pages) {
        images.push({ filename: pdf.filename, page: p.page, b64: p.b64 });
        // A hard ceiling on what one pass will look at. Sheets are expensive in
        // tokens and the marginal one is usually a detail already covered.
        if (images.length >= 8) break;
      }
    } catch (e) {
      note?.("vision", `${pdf.filename}: ${e.message}`);
    }
    if (images.length >= 8) break;
  }
  if (!images.length) return { notes: "", sheets: 0 };

  const content = [];
  for (const img of images) {
    content.push({ type: "text", text: `SHEET: ${img.filename} (page ${img.page + 1})` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: img.b64 } });
  }
  content.push({ type: "text", text: "Report what is printed on these sheets." });

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const text = (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    return { notes: text, sheets: images.length };
  } catch (e) {
    note?.("vision", `read failed (${e.message})`);
    return { notes: "", sheets: 0 };
  }
}

/** Frame the observations for a section prompt, or nothing when there are none. */
export function visionBlock(notes) {
  if (!notes) return "";
  return `READ FROM THE DRAWING SHEETS — transcribed from the PDFs by a surveyor pass, not inferred. Schedule rows here are STATED figures: prefer them over anything you derive. Cite the sheet you take a number from.
${notes}`;
}
