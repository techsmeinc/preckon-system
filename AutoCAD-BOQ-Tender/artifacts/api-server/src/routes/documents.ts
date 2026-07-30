import { Router, json as expressJson } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import { cadAnnotationsSchema, cadAnnotationsTable, cadChunksTable, cadExtractionsTable, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CAD_EXTRACTOR_URL, ingestDocument, ingestModeFor, isCadFile, shouldIngestAsDrawing } from "../lib/cad-ingest";

const router = Router();

const ALLOWED_DOCUMENT_TYPES = [
  "drawing",
  "tender",
  "rfp",
  "sow",
  "addendum",
  "specification",
  "other",
] as const;
type DocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(value);
}

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".dwg", ".dxf", ".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed`));
    }
  },
});

// GET /projects/:id/documents
router.get("/projects/:id/documents", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    res.json(documents);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/upload
router.post("/projects/:id/upload", upload.single("file"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const rawDocumentType = req.body.documentType;
  const documentType = (Array.isArray(rawDocumentType) ? rawDocumentType[0] : rawDocumentType) as string;
  if (!isDocumentType(documentType)) {
    res.status(400).json({ error: `Invalid documentType. Must be one of: ${ALLOWED_DOCUMENT_TYPES.join(", ")}` });
    return;
  }

  try {
    // DXF/DWG always; PDFs ingest in drawing-mode when marked as drawing, or
    // in document-mode when marked as tender / rfp / sow / spec / addendum / other.
    const willExtract = ingestModeFor(file.originalname, documentType) !== null;
    const [{ id: newId }] = await db
      .insert(documentsTable)
      .values({
        projectId: id,
        filename: file.filename,
        originalName: file.originalname,
        documentType,
        fileSize: file.size,
        mimeType: file.mimetype,
        filePath: file.path,
        status: "uploaded",
        cadExtractionStatus: willExtract ? "pending" : "skipped",
      })
      .$returningId();
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, newId));

    if (willExtract) {
      // Fire and forget — the document row already exists with status "pending"
      // so the client can poll /projects/:id/documents for cadExtractionStatus.
      // ingestDocument never throws to its caller; errors land in cad_extractions.
      void ingestDocument(newId).catch(err => {
        req.log.warn({ err, documentId: newId }, "ingestDocument crashed unexpectedly");
      });
    }

    res.status(201).json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /documents/:id/cad-extraction — used by the UI to poll ingest progress
router.get("/documents/:id/cad-extraction", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(cadExtractionsTable).where(eq(cadExtractionsTable.documentId, id));
    if (rows.length === 0) { res.status(404).json({ error: "No CAD extraction for this document" }); return; }
    res.json(rows[0]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /documents/:id/raw — serve the original uploaded file so the UI can
// preview it (PDFs/images render inline in the browser; DWG/DXF/Office files
// fall back to a download). Disposition is "inline" with the original filename
// so a Save-As keeps the user's name rather than the on-disk hashed one.
router.get("/documents/:id/raw", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "File no longer available on disk" });
      return;
    }
    if (doc.mimeType) res.type(doc.mimeType);
    // Encode the filename for the RFC 5987 form so non-ASCII names survive.
    const encoded = encodeURIComponent(doc.originalName);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${doc.originalName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encoded}`,
    );
    res.sendFile(path.resolve(doc.filePath), err => {
      if (err && !res.headersSent) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to read file" });
      }
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /documents/:id/svg — render a .dwg/.dxf drawing to an SVG for the
// in-portal CAD viewer. DWG is converted to DXF first by the Python sidecar
// (ODA File Converter → ezdxf native SVG backend). Since an uploaded file is
// immutable, the rendered SVG is cached on disk next to it so re-opens are
// instant and don't re-hit the sidecar.
router.get("/documents/:id/svg", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!isCadFile(doc.originalName)) {
      res.status(415).json({ error: "Only .dwg/.dxf drawings can be rendered to SVG" });
      return;
    }
    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "File no longer available on disk" });
      return;
    }
    // A handful of pathological drawings render to enormous SVGs (hundreds of
    // MB) that would OOM the browser/editor. Above this cap we refuse to serve
    // it inline so the client can fall back to "download original".
    const MAX_SVG_BYTES = 60_000_000; // 60 MB
    const tooLarge = (bytes: number) =>
      res.status(413).json({
        error: "This drawing is too detailed to preview in the browser. Download the original to open it in a CAD application.",
        tooLarge: true,
        bytes,
      });

    const cachePath = `${doc.filePath}.preview.svg`;
    if (fs.existsSync(cachePath)) {
      const sz = (await fs.promises.stat(cachePath)).size;
      if (sz > MAX_SVG_BYTES) { tooLarge(sz); return; }
      res.type("image/svg+xml").send(await fs.promises.readFile(cachePath, "utf8"));
      return;
    }
    const r = await fetch(`${CAD_EXTRACTOR_URL}/render-cad`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.filePath }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: `CAD render failed (${r.status})`, detail: detail.slice(0, 600) });
      return;
    }
    const data = (await r.json()) as { svg?: string };
    if (!data.svg) { res.status(502).json({ error: "Renderer returned no SVG" }); return; }
    await fs.promises.writeFile(cachePath, data.svg, "utf8").catch(() => {});
    if (Buffer.byteLength(data.svg) > MAX_SVG_BYTES) { tooLarge(Buffer.byteLength(data.svg)); return; }
    res.type("image/svg+xml").send(data.svg);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to render drawing" });
  }
});

// GET /documents/:id/dxf — serve a DXF for the in-browser CAD viewer (which
// renders DXF client-side with WebGL). A .dxf is served as-is; a .dwg is
// converted to DXF by the Python sidecar (ODA File Converter) and cached on
// disk next to the upload (uploads are immutable) so re-opens are instant.
router.get("/documents/:id/dxf", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!isCadFile(doc.originalName)) {
      res.status(415).json({ error: "Only .dwg/.dxf drawings can be viewed" });
      return;
    }
    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "File no longer available on disk" });
      return;
    }
    // Already a DXF — stream it straight through.
    if (path.extname(doc.originalName).toLowerCase() === ".dxf") {
      res.type("application/dxf");
      res.sendFile(path.resolve(doc.filePath), err => {
        if (err && !res.headersSent) { req.log.error(err); res.status(500).json({ error: "Failed to read file" }); }
      });
      return;
    }
    // DWG — convert via the sidecar, cached as <file>.converted.dxf.
    const cachePath = `${doc.filePath}.converted.dxf`;
    if (fs.existsSync(cachePath)) {
      res.type("application/dxf");
      res.sendFile(path.resolve(cachePath));
      return;
    }
    const r = await fetch(`${CAD_EXTRACTOR_URL}/to-dxf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.filePath }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: `DWG→DXF conversion failed (${r.status})`, detail: detail.slice(0, 600) });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.promises.writeFile(cachePath, buf).catch(() => {});
    res.type("application/dxf").send(buf);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to prepare drawing" });
  }
});

// GET /documents/:id/dxf-bounds — robust model-space bounding box for the
// viewer to fit to (ignores stray far-flung entities that would otherwise
// shrink the drawing to an invisible speck). Cached on disk like the DXF.
router.get("/documents/:id/dxf-bounds", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!isCadFile(doc.originalName) || !doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "Drawing not available" });
      return;
    }
    const cachePath = `${doc.filePath}.bounds.json`;
    if (fs.existsSync(cachePath)) {
      res.type("application/json").send(await fs.promises.readFile(cachePath, "utf8"));
      return;
    }
    const r = await fetch(`${CAD_EXTRACTOR_URL}/cad-bounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.filePath }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: `Bounds computation failed (${r.status})`, detail: detail.slice(0, 400) });
      return;
    }
    const text = await r.text();
    await fs.promises.writeFile(cachePath, text, "utf8").catch(() => {});
    res.type("application/json").send(text);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to compute drawing bounds" });
  }
});

// GET /documents/:id/annotations — markup + measurement overlay for a drawing.
// Returns the saved annotation array (empty when none yet).
router.get("/documents/:id/annotations", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(cadAnnotationsTable).where(eq(cadAnnotationsTable.documentId, id));
    if (!row) { res.json({ annotations: [] }); return; }
    let annotations: unknown = [];
    try { annotations = JSON.parse(row.data); } catch { annotations = []; }
    res.json({ annotations, updatedAt: row.updatedAt });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /documents/:id/annotations — save the overlay for a drawing (upsert).
// A dedicated, larger JSON limit covers freehand pen strokes with many points.
router.put("/documents/:id/annotations", expressJson({ limit: "8mb" }), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = cadAnnotationsSchema.safeParse(req.body?.annotations);
  if (!parsed.success) { res.status(400).json({ error: "Invalid annotations payload" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    const data = JSON.stringify(parsed.data);
    await db
      .insert(cadAnnotationsTable)
      .values({ documentId: id, projectId: doc.projectId, data })
      .onDuplicateKeyUpdate({ set: { data } });
    res.json({ ok: true, count: parsed.data.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /documents/:id/entities — selectable/editable model-space entities
// (handles + geometry in drawing units) for the in-portal geometry editor.
// Not cached: edits create new document versions, so each open reads fresh.
router.get("/documents/:id/entities", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!isCadFile(doc.originalName)) {
      res.status(415).json({ error: "Only .dwg/.dxf drawings can be edited" });
      return;
    }
    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "File no longer available on disk" });
      return;
    }
    const r = await fetch(`${CAD_EXTRACTOR_URL}/cad-entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.filePath }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: `Entity listing failed (${r.status})`, detail: detail.slice(0, 600) });
      return;
    }
    res.type("application/json").send(await r.text());
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list drawing entities" });
  }
});

// Derive the next revision name for an edited drawing. "Plan.dwg" → "Plan (rev 1).dwg",
// "Plan (rev 1).dwg" → "Plan (rev 2).dwg". Keeps edited versions grouped by base name.
function nextRevisionName(originalName: string, siblings: string[]): string {
  const ext = path.extname(originalName);
  const stem = originalName.slice(0, originalName.length - ext.length);
  const base = stem.replace(/ \(rev \d+\)$/i, "");
  let maxRev = 0;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(rev (\\d+)\\)${ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  for (const s of siblings) {
    const m = s.match(re);
    if (m) maxRev = Math.max(maxRev, parseInt(m[1]));
  }
  return `${base} (rev ${maxRev + 1})${ext}`;
}

// POST /documents/:id/edit — apply geometry edit ops to a drawing and save the
// result as a NEW document version (the original on disk is never mutated). The
// Python sidecar does the ezdxf round-trip (and DXF→DWG via ODA when needed);
// we copy the produced file into uploads under a fresh name, insert a versioned
// document row, and kick off CAD ingest so the new geometry feeds the BOQ.
router.post("/documents/:id/edit", expressJson({ limit: "16mb" }), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ops = req.body?.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    res.status(400).json({ error: "ops must be a non-empty array" });
    return;
  }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!isCadFile(doc.originalName)) {
      res.status(415).json({ error: "Only .dwg/.dxf drawings can be edited" });
      return;
    }
    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      res.status(404).json({ error: "File no longer available on disk" });
      return;
    }

    const targetExt = path.extname(doc.originalName).toLowerCase(); // keep DWG as DWG
    const r = await fetch(`${CAD_EXTRACTOR_URL}/cad-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.filePath, ops, targetExt }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: `CAD edit failed (${r.status})`, detail: detail.slice(0, 600) });
      return;
    }
    const result = (await r.json()) as { path?: string; applied?: number; errors?: string[] };
    if (!result.path || !fs.existsSync(result.path)) {
      res.status(502).json({ error: "Editor returned no saved file", detail: JSON.stringify(result.errors ?? []) });
      return;
    }

    // Copy the sidecar's output into uploads under a fresh hashed name, then
    // insert a versioned document row pointing at it.
    const ext = path.extname(result.path) || targetExt;
    const newFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const newPath = path.join(uploadDir, newFilename);
    await fs.promises.copyFile(result.path, newPath);
    const fileSize = (await fs.promises.stat(newPath)).size;

    const siblings = await db.select().from(documentsTable).where(eq(documentsTable.projectId, doc.projectId));
    const revisionName = nextRevisionName(doc.originalName, siblings.map(s => s.originalName));

    const [{ id: newId }] = await db
      .insert(documentsTable)
      .values({
        projectId: doc.projectId,
        filename: newFilename,
        originalName: revisionName,
        documentType: doc.documentType,
        fileSize,
        mimeType: doc.mimeType,
        filePath: newPath,
        status: "uploaded",
        cadExtractionStatus: "pending",
      })
      .$returningId();
    const [newDoc] = await db.select().from(documentsTable).where(eq(documentsTable.id, newId));

    // Re-ingest the edited drawing so its updated geometry feeds the BOQ.
    void ingestDocument(newId).catch(err => {
      req.log.warn({ err, documentId: newId }, "ingestDocument crashed after edit");
    });

    res.status(201).json({
      document: newDoc,
      applied: result.applied ?? 0,
      errors: result.errors ?? [],
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save drawing edits" });
  }
});

// POST /documents/:id/reingest — manually retry CAD extraction (e.g. after the
// sidecar comes back online or after fixing a malformed DWG export).
router.post("/documents/:id/reingest", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!shouldIngestAsDrawing(doc.originalName, doc.documentType)) {
      res.status(400).json({ error: "Document is not a drawing (.dwg/.dxf, or PDF labelled as drawing)" });
      return;
    }
    void ingestDocument(id).catch(err => {
      req.log.warn({ err, documentId: id }, "ingestDocument crashed unexpectedly");
    });
    res.status(202).json({ status: "running" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects/:id/cad-status — diagnostic snapshot of CAD ingest state
// across all documents in a project. Surfaces (a) which PDFs aren't being
// parsed because their type isn't "drawing", (b) which extractions failed and
// why, and (c) how many chunks are searchable. Hit this whenever the BOQ
// pipeline isn't picking up drawings.
router.get("/projects/:id/cad-status", async (req, res) => {
  const projectId = parseInt(String(req.params.id));
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }
  try {
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId));
    const extractions = await db.select().from(cadExtractionsTable).where(eq(cadExtractionsTable.projectId, projectId));
    const extByDoc = new Map<number, typeof extractions[number]>();
    for (const e of extractions) extByDoc.set(e.documentId, e);

    const perDocument = docs.map(d => {
      const ext = extByDoc.get(d.id);
      const isPdf = d.mimeType === "application/pdf" || d.originalName.toLowerCase().endsWith(".pdf");
      const willBeIngested = shouldIngestAsDrawing(d.originalName, d.documentType);
      return {
        documentId: d.id,
        originalName: d.originalName,
        documentType: d.documentType,
        mimeType: d.mimeType,
        cadExtractionStatus: d.cadExtractionStatus,
        isPdf,
        isDrawingType: d.documentType === "drawing",
        willBeIngested,
        hintIfPdf: isPdf && d.documentType !== "drawing"
          ? `This PDF is type "${d.documentType}". Change to "drawing" to enable CAD ingest.`
          : null,
        extraction: ext ? {
          status: ext.status,
          errorMessage: ext.errorMessage,
          layerCount: ext.layerCount,
          blockInstanceTotal: ext.blockInstanceTotal,
          textAnnotationCount: ext.textAnnotationCount,
          scheduleCount: ext.scheduleCount,
          chunkCount: ext.chunkCount,
          updatedAt: ext.updatedAt,
        } : null,
      };
    });

    const summary = {
      totalDocuments: docs.length,
      drawingsParsed: perDocument.filter(d => d.extraction?.status === "succeeded").length,
      drawingsRunning: perDocument.filter(d => d.extraction?.status === "running").length,
      drawingsFailed: perDocument.filter(d => d.extraction?.status === "failed").length,
      drawingsPending: perDocument.filter(d => d.willBeIngested && !d.extraction).length,
      pdfsNotMarkedAsDrawing: perDocument.filter(d => d.isPdf && !d.isDrawingType).length,
      totalChunks: perDocument.reduce((s, d) => s + (d.extraction?.chunkCount ?? 0), 0),
    };

    res.json({ summary, documents: perDocument });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/reingest — re-run CAD extraction for EVERY drawing document
// in a project. Use after an extractor upgrade (e.g. the block/xref geometry
// take-off) so existing drawings get the new length/area measures without a
// re-upload. Re-ingests sequentially in the background; returns the queued count.
router.post("/projects/:id/reingest", async (req, res) => {
  const projectId = parseInt(String(req.params.id));
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }
  try {
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId));
    const targets = docs.filter(d => shouldIngestAsDrawing(d.originalName, d.documentType));
    void (async () => {
      for (const d of targets) {
        try { await ingestDocument(d.id); }
        catch (err) { req.log.warn({ err, documentId: d.id }, "ingestDocument crashed unexpectedly"); }
      }
    })();
    res.status(202).json({ queued: targets.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /documents/:id — currently only documentType is editable
router.patch("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { documentType } = req.body ?? {};
  if (!isDocumentType(documentType)) {
    res.status(400).json({ error: `Invalid documentType. Must be one of: ${ALLOWED_DOCUMENT_TYPES.join(", ")}` });
    return;
  }
  try {
    // Detect a transition that needs CAD ingest: previously the document was
    // not a drawing (or had no extraction yet) and now it's been labelled as
    // "drawing". This covers the common flow where a user uploads a PDF and
    // only later sets its type to drawing.
    const [before] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    await db.update(documentsTable).set({ documentType }).where(eq(documentsTable.id, id));
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    const wasDrawing = before ? shouldIngestAsDrawing(before.originalName, before.documentType) : false;
    const isNowDrawing = shouldIngestAsDrawing(doc.originalName, doc.documentType);
    if (!wasDrawing && isNowDrawing) {
      void ingestDocument(id).catch(err => {
        req.log.warn({ err, documentId: id }, "ingestDocument crashed unexpectedly");
      });
    }

    res.json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /documents/:id — remove a document uploaded by mistake. Cleans up the
// searchable CAD chunks and the extraction record first (in case DB-level
// cascade isn't enforced), removes the stored file from disk, then deletes the
// document row. BOQ items are NOT touched — once generated they stand on their
// own and a QS may have edited them.
router.delete("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Remove dependent rows explicitly (chunks → extractions) so the delete
    // succeeds whether or not the FK constraints carry ON DELETE CASCADE.
    await db.delete(cadChunksTable).where(eq(cadChunksTable.documentId, id));
    await db.delete(cadExtractionsTable).where(eq(cadExtractionsTable.documentId, id));
    await db.delete(documentsTable).where(eq(documentsTable.id, id));

    // Best-effort file cleanup — the DB row is already gone, so a missing/locked
    // file shouldn't fail the request.
    if (doc.filePath) {
      try {
        if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
      } catch (err) {
        req.log.warn({ err, documentId: id, filePath: doc.filePath }, "Failed to remove document file from disk");
      }
    }

    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
