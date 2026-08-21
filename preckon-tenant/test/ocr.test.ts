// Scanned-document detection.
//
// The bug this exists to stop: a scanned drawing set extracts to nothing, gets
// recorded as `ingested`, and every agent downstream reads an empty document.
// Nothing errors. The specification section it contained is simply absent from
// the bill, the risk register and the compliance check, and the register says
// the file was read.

import { describe, it, expect } from "vitest";
import {
  assessPage, assessDocument, merge, isOcrText, stripMarker, OCR_MARKER,
  type ExtractedPage, type OcrResult,
} from "@/lib/doc/ocr";

const page = (n: number, text: string): ExtractedPage => ({ page: n, text });

/** Prose long enough to be a real text layer. */
const REAL = "The contractor shall provide all labour, plant and materials necessary for the completion of the substructure works including excavation, disposal and blinding to the levels shown on the drawings.";

describe("one page", () => {
  it("recognises a usable text layer", () => {
    const a = assessPage(page(1, REAL));
    expect(a.kind).toBe("text_layer");
    expect(a.needsOcr).toBe(false);
  });

  it("treats an empty page as needing OCR, not as blank and fine", () => {
    /* A blank page and a scanned page are indistinguishable from the text
       layer. Assuming blank is the assumption that loses a drawing. */
    const a = assessPage(page(1, ""));
    expect(a.needsOcr).toBe(true);
    expect(a.why).toMatch(/indistinguishable from the text layer/);
  });

  it("catches a scan whose only text is a stamped title block", () => {
    const a = assessPage(page(1, "A-201 Rev C"));
    expect(a.needsOcr).toBe(true);
    expect(a.why).toMatch(/content of the page is not in the file/);
  });

  it("counts distinct words, so a repeated glyph is not mistaken for content", () => {
    // A real pdf-parse failure mode on drawings with subset fonts: plenty of
    // characters, no content.
    const a = assessPage(page(1, "fi ".repeat(200)));
    expect(a.characters).toBeGreaterThan(100);
    expect(a.needsOcr).toBe(true);
  });

  it("takes thresholds from the caller", () => {
    expect(assessPage(page(1, "A-201 Rev C"), { minCharacters: 5, minWords: 2 }).needsOcr).toBe(false);
  });
});

describe("a whole document", () => {
  it("refuses to call an unreadable file ingested", () => {
    /* The whole point. `ingested` on a file holding no readable text is the lie
       that makes everything downstream wrong quietly. */
    const d = assessDocument([page(1, ""), page(2, "")]);
    expect(d.ingestStatus).toBe("needs_ocr");
    expect(d.entirelyScanned).toBe(true);
    expect(d.warnings[0]).toMatch(/stored but not read/);
    expect(d.warnings[0]).toMatch(/missing from the bill/);
  });

  it("calls a readable document ingested", () => {
    const d = assessDocument([page(1, REAL), page(2, REAL)]);
    expect(d.ingestStatus).toBe("ingested");
    expect(d.pagesNeedingOcr).toEqual([]);
    expect(d.summary).toMatch(/all with a usable text layer/);
  });

  it("flags a mixed set as the hardest case to notice", () => {
    // Scanned sheets bound in with vector ones: the scans are invisible
    // downstream while everything else reads normally.
    const d = assessDocument([page(1, REAL), page(2, ""), page(3, REAL)]);
    expect(d.mixed).toBe(true);
    expect(d.pagesNeedingOcr).toEqual([2]);
    expect(d.warnings[0]).toMatch(/hardest version of this to notice/);
  });

  it("still ingests a mixed set, because most of it is readable", () => {
    const d = assessDocument([page(1, REAL), page(2, "")]);
    expect(d.ingestStatus).toBe("ingested");
  });

  it("warns that a sparse page's text is a label, not the drawing", () => {
    /* Sparse is the awkward middle: enough characters to look like a text
       layer, too few distinct words to be the page's content. A scanned sheet
       whose revision table repeats the drawing number down the border does
       exactly this. */
    const d = assessDocument([page(1, REAL), page(2, "A-201 Rev C ".repeat(5))]);
    expect(d.pages[1].kind).toBe("sparse");
    expect(d.warnings.some((w) => /a label, not as the drawing/.test(w))).toBe(true);
  });

  it("reports an empty extraction as unreadable rather than as a clean document", () => {
    const d = assessDocument([]);
    expect(d.ingestStatus).toBe("unreadable");
    expect(d.summary).toMatch(/Nothing was extracted/);
  });
});

describe("merging OCR results back in", () => {
  const extracted = [page(1, REAL), page(2, "")];
  const result = (over: Partial<OcrResult> = {}): OcrResult =>
    ({ page: 2, text: "RC slab 300 thick", confidence: 0.92, engine: "test", ...over });

  it("leaves text-layer pages alone", () => {
    const m = merge(extracted, [result()]);
    expect(m.pages[0]).toMatchObject({ source: "text_layer", text: REAL });
  });

  it("marks OCR text in the text itself, not only in the record", () => {
    /* Page text gets inlined into agent prompts and copied into provenance,
       where the structured field does not follow it. */
    const m = merge(extracted, [result()]);
    expect(m.pages[1].source).toBe("ocr");
    expect(m.pages[1].text.startsWith(OCR_MARKER)).toBe(true);
    expect(isOcrText(m.pages[1].text)).toBe(true);
  });

  it("flags low-confidence pages as unusable evidence", () => {
    const m = merge(extracted, [result({ confidence: 0.4 })]);
    expect(m.lowConfidencePages).toEqual([2]);
    expect(m.pages[1].lowConfidence).toBe(true);
    expect(m.warnings[0]).toMatch(/confuses 3 with 8 routinely/);
  });

  it("accepts a caller's confidence threshold", () => {
    expect(merge(extracted, [result({ confidence: 0.8 })], { minConfidence: 0.9 }).lowConfidencePages).toEqual([2]);
    expect(merge(extracted, [result({ confidence: 0.8 })], { minConfidence: 0.7 }).lowConfidencePages).toEqual([]);
  });

  it("does not invent a confidence an engine did not report", () => {
    const m = merge(extracted, [result({ confidence: null })]);
    expect(m.pages[1].confidence).toBeNull();
    expect(m.pages[1].lowConfidence).toBe(false);
  });
});

describe("the marker survives round-tripping", () => {
  it("recognises OCR text read back out of storage", () => {
    expect(isOcrText(`${OCR_MARKER} RC slab 300 thick`)).toBe(true);
    expect(isOcrText(REAL)).toBe(false);
  });

  it("strips the marker for display without touching ordinary text", () => {
    expect(stripMarker(`${OCR_MARKER} RC slab`)).toBe("RC slab");
    expect(stripMarker(REAL)).toBe(REAL);
  });

  it("copes with leading whitespace, which storage round-trips add", () => {
    expect(isOcrText(`  ${OCR_MARKER} RC slab`)).toBe(true);
  });
});
