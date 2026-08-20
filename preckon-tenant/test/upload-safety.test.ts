// Upload validation.
//
// Every file here arrives from outside and is then parsed, rendered and shown to
// other people. These pin the one rule that matters: the extension is a claim,
// the bytes are the evidence, and a disagreement is refused rather than guessed
// at.

import { describe, it, expect } from "vitest";
import {
  checkUpload, detectType, typesAgree, extensionOf,
  archiveRatioSafe, mayServe, scanStateWhy,
  BLOCKED_EXTENSIONS, ALLOWED_EXTENSIONS, MAX_SIZE_BYTES, MAX_COMPRESSION_RATIO,
} from "@/lib/upload-safety";

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47);

const ok = (over = {}) => ({ filename: "drawing.pdf", sizeBytes: 1024, head: PDF, ...over });

describe("detecting what a file actually is", () => {
  it("recognises a PDF", () => expect(detectType(PDF)).toBe("pdf"));
  it("recognises a zip", () => expect(detectType(ZIP)).toBe("zip"));
  it("recognises an executable", () => expect(detectType(EXE)).toBe("exe"));
  it("recognises a PNG", () => expect(detectType(PNG)).toBe("png"));

  it("returns null for unrecognised bytes rather than guessing", () => {
    expect(detectType(bytes(1, 2, 3, 4))).toBeNull();
    expect(detectType(null)).toBeNull();
    expect(detectType(new Uint8Array())).toBeNull();
  });
});

describe("type agreement", () => {
  it("accepts an exact match", () => expect(typesAgree("pdf", "pdf")).toBe(true));

  it("accepts a zip-backed format detected as zip", () => {
    // docx, xlsx, ifc and rvt are all zip containers underneath.
    for (const e of ["docx", "xlsx", "pptx", "ifc", "rvt"]) {
      expect(typesAgree(e, "zip"), e).toBe(true);
    }
  });

  it("accepts legacy Office detected as OLE", () => {
    expect(typesAgree("doc", "ole")).toBe(true);
    expect(typesAgree("xls", "ole")).toBe(true);
  });

  it("accepts the spelling variants", () => {
    expect(typesAgree("jpeg", "jpg")).toBe(true);
    expect(typesAgree("tiff", "tif")).toBe(true);
  });

  it("treats unrecognised bytes as proving nothing", () => {
    /* Most construction formats have no stable signature. Refusing them for
       lack of one would reject the majority of legitimate uploads. */
    expect(typesAgree("dxf", null)).toBe(true);
  });

  it("rejects a genuine mismatch", () => {
    expect(typesAgree("pdf", "png")).toBe(false);
  });
});

describe("accepting a legitimate file", () => {
  it("accepts a PDF that is a PDF", () => {
    const c = checkUpload(ok());
    expect(c.verdict).toBe("accept");
    expect(c.why).toMatch(/contents confirm pdf/i);
  });

  it("accepts a DXF with no recognisable signature", () => {
    expect(checkUpload({ filename: "plan.dxf", sizeBytes: 5000, head: bytes(0x30, 0x0d) }).verdict).toBe("accept");
  });

  it("accepts an xlsx detected as zip", () => {
    expect(checkUpload({ filename: "boq.xlsx", sizeBytes: 5000, head: ZIP }).verdict).toBe("accept");
  });

  it("accepts a file with no head supplied at all", () => {
    // Streaming uploads may check the name before any bytes have arrived.
    expect(checkUpload({ filename: "spec.pdf", sizeBytes: 100 }).verdict).toBe("accept");
  });
});

describe("refusing what should not be here", () => {
  it("refuses an executable however it is named", () => {
    /* The single most valuable check. A .pdf whose bytes are MZ is not a
       mistake. */
    const c = checkUpload({ filename: "invoice.pdf", sizeBytes: 1000, head: EXE });
    expect(c.verdict).toBe("reject");
    expect(c.why).toMatch(/are an executable/i);
  });

  it("refuses a blocked extension", () => {
    expect(checkUpload({ filename: "setup.exe", sizeBytes: 100, head: EXE }).verdict).toBe("reject");
    expect(checkUpload({ filename: "run.bat", sizeBytes: 100 }).verdict).toBe("reject");
  });

  it("refuses macro-enabled Office formats", () => {
    // The macro-free equivalents are accepted, so there is a route through.
    for (const e of ["docm", "xlsm", "pptm"]) {
      expect(BLOCKED_EXTENSIONS).toContain(e);
      expect(checkUpload({ filename: `book.${e}`, sizeBytes: 100 }).verdict).toBe("reject");
    }
    expect(ALLOWED_EXTENSIONS).toContain("xlsx");
  });

  it("refuses a contents mismatch rather than correcting it", () => {
    /* A file whose contents disagree with its name is either broken or
       deliberate, and neither should be quietly processed. */
    const c = checkUpload({ filename: "photo.pdf", sizeBytes: 100, head: PNG });
    expect(c.verdict).toBe("reject");
    expect(c.why).toMatch(/look like a png .* named \.pdf/i);
  });

  it("refuses a path in the filename", () => {
    expect(checkUpload({ filename: "../../etc/passwd.pdf", sizeBytes: 10, head: PDF }).verdict).toBe("reject");
    expect(checkUpload({ filename: "sub/dir/file.pdf", sizeBytes: 10, head: PDF }).verdict).toBe("reject");
  });

  it("refuses an unknown extension", () => {
    expect(checkUpload({ filename: "thing.xyz", sizeBytes: 10 }).verdict).toBe("reject");
  });

  it("refuses a file with no extension", () => {
    expect(checkUpload({ filename: "README", sizeBytes: 10 }).verdict).toBe("reject");
  });

  it("refuses an empty file", () => {
    expect(checkUpload({ filename: "a.pdf", sizeBytes: 0, head: PDF }).verdict).toBe("reject");
  });

  it("refuses something over the size limit", () => {
    const c = checkUpload({ filename: "huge.pdf", sizeBytes: MAX_SIZE_BYTES + 1, head: PDF });
    expect(c.verdict).toBe("reject");
    expect(c.why).toMatch(/larger than/i);
  });

  it("collects every reason, not just the first", () => {
    const c = checkUpload({ filename: "../x.exe", sizeBytes: 0, head: EXE });
    expect(c.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("archive expansion", () => {
  it("accepts an ordinary ratio", () => {
    expect(archiveRatioSafe(1_000_000, 3_000_000)).toBe(true);
  });

  it("refuses a decompression bomb", () => {
    /* Ratios above ~200:1 essentially do not occur in drawings or models, which
       are already compressed. */
    expect(archiveRatioSafe(1_000, 1_000 * (MAX_COMPRESSION_RATIO + 1))).toBe(false);
  });

  it("refuses a zero-length archive", () => {
    expect(archiveRatioSafe(0, 1_000_000)).toBe(false);
  });
});

describe("scan state", () => {
  it("serves only what a scanner cleared", () => {
    /* "Not yet scanned" and "scanned and clean" must never be the same value —
       defaulting the unknown to clean is how an unscanned file gets treated as
       safe. */
    expect(mayServe("clean")).toBe(true);
    expect(mayServe("unscanned")).toBe(false);
    expect(mayServe("infected")).toBe(false);
    expect(mayServe("unavailable")).toBe(false);
  });

  it("explains every state", () => {
    for (const s of ["clean", "unscanned", "infected", "unavailable"] as const) {
      expect(scanStateWhy(s).length).toBeGreaterThan(10);
    }
  });

  it("is honest that no scanner means not cleared", () => {
    expect(scanStateWhy("unavailable")).toMatch(/no scanner is configured/i);
  });
});

describe("extension parsing", () => {
  it("takes the last segment, lowercased", () => {
    expect(extensionOf("Drawing.Rev.C.PDF")).toBe("pdf");
  });

  it("returns empty for a dotfile or no extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("plain")).toBe("");
  });
});
