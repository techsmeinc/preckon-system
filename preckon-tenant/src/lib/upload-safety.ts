/**
 * Upload validation.
 *
 * Every file on a construction project arrives from outside: consultants,
 * subcontractors, clients, and whoever they forwarded it from. The platform then
 * parses it, renders it, extracts text from it and shows it to other people. An
 * upload path that trusts what it is told is the largest attack surface here.
 *
 * ── THE EXTENSION IS A CLAIM, NOT A FACT ─────────────────────────────────────
 *
 * `.pdf` is a filename somebody chose. So is the MIME type — it is sent by the
 * client and can say anything. The only evidence about what a file actually is
 * comes from its own bytes, so the declared type is checked AGAINST the magic
 * number rather than believed.
 *
 * A mismatch is refused rather than corrected. A file whose contents disagree
 * with its name is either broken or deliberate, and neither is something to
 * quietly accept and process.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 *
 * This is not an antivirus. It cannot detect a malicious PDF that is a valid
 * PDF. It closes the cheap holes — wrong type, dangerous extension, decompression
 * bomb, absurd size — and a real scanner belongs behind it. Saying so plainly
 * matters: believing this is AV is worse than knowing there is none.
 */

export type Verdict = "accept" | "reject";

export interface UploadCheck {
  verdict: Verdict;
  reasons: string[];
  /** What the bytes say it is, when recognisable. */
  detectedType: string | null;
  why: string;
}

export interface UploadInput {
  filename: string;
  /** Declared by the client. Never trusted on its own. */
  declaredMime?: string | null;
  sizeBytes: number;
  /** First bytes of the file, for magic-number detection. 16 is enough. */
  head?: Uint8Array | null;
}

/** Extensions never accepted, whatever the bytes say. */
export const BLOCKED_EXTENSIONS = [
  "exe", "dll", "scr", "com", "pif", "cpl", "msi", "msp",
  "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "jar", "app", "dmg", "pkg", "deb", "rpm",
  "sh", "bash", "zsh", "run", "bin",
  "lnk", "url", "reg", "inf", "chm", "hta",
  // Office macro formats. The macro-free equivalents are accepted.
  "docm", "xlsm", "pptm", "dotm", "xltm",
];

/** What a construction project legitimately uploads. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "dwg", "dxf", "ifc", "rvt", "nwd", "nwc",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "rtf", "md",
  "png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "heic",
  "zip", "7z", "rar",
  "xer", "xml", "mpp", "json",
  "eml", "msg",
];

/** 250 MB. Large enough for a federated model, small enough to bound the damage. */
export const MAX_SIZE_BYTES = 250 * 1024 * 1024;

interface Magic { type: string; bytes: number[]; offset?: number }

/**
 * Magic numbers for the formats worth verifying.
 *
 * Not exhaustive, and deliberately so: an unrecognised signature is not treated
 * as a failure, because most legitimate construction formats have no stable one.
 * The check only fires when the bytes are recognisable AND disagree with the
 * name — that is the case worth refusing.
 */
const MAGIC: Magic[] = [
  { type: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] },                   // %PDF
  { type: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },                   // PK.. (also docx/xlsx/ifczip)
  { type: "zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
  { type: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "bmp", bytes: [0x42, 0x4d] },
  { type: "tif", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { type: "tif", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { type: "rar", bytes: [0x52, 0x61, 0x72, 0x21] },
  { type: "7z",  bytes: [0x37, 0x7a, 0xbc, 0xaf] },
  { type: "exe", bytes: [0x4d, 0x5a] },                               // MZ — PE executable
  { type: "elf", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { type: "dwg", bytes: [0x41, 0x43, 0x31, 0x30] },                   // AC10xx
  { type: "ole", bytes: [0xd0, 0xcf, 0x11, 0xe0] },                   // legacy doc/xls/msg
];

/** Formats whose containers are zip archives underneath. */
const ZIP_BACKED = new Set(["docx", "xlsx", "pptx", "ifc", "nwd", "nwc", "rvt", "zip"]);
/** Formats stored in the OLE compound format. */
const OLE_BACKED = new Set(["doc", "xls", "ppt", "msg"]);

export function extensionOf(filename: string): string {
  const name = String(filename ?? "").trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

/** What the bytes say this is, or null if unrecognised. */
export function detectType(head?: Uint8Array | null): string | null {
  if (!head?.length) return null;
  for (const m of MAGIC) {
    const at = m.offset ?? 0;
    if (head.length < at + m.bytes.length) continue;
    if (m.bytes.every((b, i) => head[at + i] === b)) return m.type;
  }
  return null;
}

/** Whether a detected type is consistent with a claimed extension. */
export function typesAgree(extension: string, detected: string | null): boolean {
  if (!detected) return true;                       // unrecognised proves nothing
  if (detected === extension) return true;
  if (detected === "zip" && ZIP_BACKED.has(extension)) return true;
  if (detected === "ole" && OLE_BACKED.has(extension)) return true;
  if (detected === "jpg" && extension === "jpeg") return true;
  if (detected === "tif" && extension === "tiff") return true;
  return false;
}

/**
 * Whether this upload may be accepted.
 *
 * Every reason is collected rather than returning on the first, so somebody
 * fixing a rejected upload sees the whole picture at once.
 */
export function checkUpload(input: UploadInput): UploadCheck {
  const reasons: string[] = [];
  const ext = extensionOf(input.filename);
  const detected = detectType(input.head);

  if (!input.filename?.trim()) {
    reasons.push("The file has no name.");
  }

  // A path separator in a filename is either a traversal attempt or a client
  // bug, and both end with a file written somewhere nobody expects.
  if (/[\/\\]|\.\./.test(String(input.filename ?? ""))) {
    reasons.push("The file name contains a path. Upload a plain file name.");
  }

  if (!ext) {
    reasons.push("The file has no extension, so its type cannot be established.");
  } else if (BLOCKED_EXTENSIONS.includes(ext)) {
    reasons.push(`.${ext} files are never accepted.`);
  } else if (!ALLOWED_EXTENSIONS.includes(ext)) {
    reasons.push(`.${ext} is not a recognised project file type.`);
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    reasons.push("The file is empty.");
  } else if (input.sizeBytes > MAX_SIZE_BYTES) {
    reasons.push(`The file is larger than the ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB limit.`);
  }

  // An executable signature is refused whatever it has been named. This is the
  // single most valuable check here.
  if (detected === "exe" || detected === "elf") {
    reasons.push("The file contents are an executable, whatever its name says.");
  } else if (ext && !typesAgree(ext, detected)) {
    reasons.push(`The contents look like a ${detected} file but it is named .${ext}. Refused rather than guessed at.`);
  }

  const verdict: Verdict = reasons.length ? "reject" : "accept";
  const why = verdict === "accept"
    ? `Accepted as .${ext}${detected ? ` (contents confirm ${detected})` : ""}.`
    : reasons.join(" ");

  return { verdict, reasons, detectedType: detected, why };
}

/**
 * Whether an archive's declared expansion is plausible.
 *
 * A zip bomb is a small archive that expands to fill a disk. Compression ratios
 * above about 200:1 essentially do not occur in drawings, models or documents,
 * which are already compressed formats.
 */
export const MAX_COMPRESSION_RATIO = 200;

export function archiveRatioSafe(compressedBytes: number, declaredUncompressedBytes: number): boolean {
  if (compressedBytes <= 0) return false;
  return declaredUncompressedBytes / compressedBytes <= MAX_COMPRESSION_RATIO;
}

/**
 * Whether a scanner has cleared this content hash.
 *
 * The platform does not scan; it records that something else did. Kept as an
 * explicit unknown state rather than a boolean, because "not yet scanned" and
 * "scanned and clean" must never be the same value — defaulting the unknown to
 * clean is how an unscanned file gets treated as safe.
 */
export type ScanState = "unscanned" | "clean" | "infected" | "unavailable";

export function mayServe(state: ScanState): boolean {
  return state === "clean";
}

export function scanStateWhy(state: ScanState): string {
  switch (state) {
    case "clean": return "Scanned and clean.";
    case "infected": return "A scanner flagged this file. It cannot be served or processed.";
    case "unscanned": return "Not yet scanned. It will be available once a scanner has cleared it.";
    case "unavailable": return "No scanner is configured, so this file cannot be cleared for serving.";
  }
}
