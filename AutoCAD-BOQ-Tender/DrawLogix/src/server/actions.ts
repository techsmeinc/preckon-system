"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { ACTIVE_ORG_COOKIE, requireOrgId } from "@/db/tenant";
import { composeCad, freeformEntitiesFor } from "@/domain/cad-export";
import { designFromBrief, sendCopilotMessage } from "@/domain/copilot";
import { addDocument, archiveDocument } from "@/domain/documents";
import { extractDocumentText } from "@/lib/extract";
import { isAiConfigured } from "@/ai/agent";
import { editDxf, type ModelSummary } from "@/ai/dxf-copilot";
import { buildDrawingIfc } from "@/domain/ifc";
import { type PageSelection, pdfToModel } from "@/domain/pdf-to-dxf";
import { generateConcept, generateConceptAI } from "@/domain/generate";
import { type LifecycleState, transitionDrawing } from "@/domain/lifecycle";
import { archiveProject, createProject } from "@/domain/projects";

export async function switchOrgAction(orgId: string) {
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function createProjectAction(input: { name: string; client?: string; description?: string }) {
  return createProject(await requireOrgId(), input);
}

export async function archiveProjectAction(projectId: string) {
  return archiveProject(await requireOrgId(), projectId);
}

export async function addDocumentAction(input: { projectId: string; name: string; docType: string; content: string }) {
  return addDocument(await requireOrgId(), input);
}

/**
 * Upload a document file (PDF/DOCX/TXT), extract its text, and record it on the
 * project. Pasted text (the `content` field) is merged in too, so either path works.
 */
export async function uploadDocumentAction(formData: FormData) {
  const orgId = await requireOrgId();
  const projectId = String(formData.get("projectId") ?? "");
  const docType = String(formData.get("docType") ?? "sow");
  let name = String(formData.get("name") ?? "").trim();
  let content = String(formData.get("content") ?? "").trim();

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (!name) name = file.name;
    const result = await fileToContent(file);
    // An image is its own document (a data-URL can't be concatenated with text); text
    // extractions merge with any pasted content.
    if (result?.content.startsWith("data:")) {
      return addDocument(orgId, { projectId, name, docType, content: result.content });
    }
    if (result) content = content ? `${content}\n\n${result.content}` : result.content;
    else if (!content) {
      throw new Error("Couldn't read that file — try a .txt/.md/.docx/.xlsx/.pdf or an image, or paste the text instead.");
    }
  }

  return addDocument(orgId, { projectId, name, docType, content });
}

// Images the VLM can read natively. Stored as `data:<mime>;base64,…` in the document
// content; the design-extraction step turns them into Anthropic image blocks.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // keep well under the DB packet limit

function imageMimeFor(filename: string, fileType: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
  if (fileType.startsWith("image/")) return fileType;
  return null;
}

/**
 * Turn an uploaded file into document content: a `data:` URL for images (read by the
 * VLM at generation time), or extracted text for everything else. Returns null when
 * nothing usable could be produced.
 */
async function fileToContent(file: File): Promise<{ content: string; note?: string } | null> {
  const mime = imageMimeFor(file.name, file.type);
  if (mime) {
    if (file.size > MAX_IMAGE_BYTES) return null;
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    return { content: `data:${mime};base64,${b64}` };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const text = (await extractDocumentText(file.name, buf)).trim();
  return text ? { content: text } : null;
}

/**
 * Bulk upload: accept MANY files at once (text, PDF, DOCX, Excel, images), extract or
 * encode each, and add them as documents. Generation reads every document on the
 * project, so all uploads feed the AI.
 */
export async function uploadDocumentsAction(formData: FormData) {
  const orgId = await requireOrgId();
  const projectId = String(formData.get("projectId") ?? "");
  const docType = String(formData.get("docType") ?? "sow");
  const pasted = String(formData.get("content") ?? "").trim();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let added = 0;
  const skipped: string[] = [];

  for (const file of files) {
    try {
      const result = await fileToContent(file);
      if (!result) {
        const lower = file.name.toLowerCase();
        const reason = lower.endsWith(".pdf")
          ? "no text layer — looks like a scanned PDF. Export it as an image, or copy the text and paste it below."
          : imageMimeFor(file.name, file.type)
            ? "image too large — keep it under 4 MB."
            : /\.(dwg|dxf)$/.test(lower)
              ? "CAD files aren't a brief input — use the DXF editor for those."
              : "no extractable text — paste the text instead.";
        skipped.push(`${file.name} — ${reason}`);
        continue;
      }
      await addDocument(orgId, { projectId, name: file.name, docType, content: result.content });
      added += 1;
    } catch (e) {
      skipped.push(`${file.name} — ${(e as Error).message}`);
    }
  }
  if (pasted) {
    await addDocument(orgId, { projectId, name: "Pasted brief", docType, content: pasted });
    added += 1;
  }
  if (added === 0) {
    throw new Error(skipped.length ? `No documents added — ${skipped.slice(0, 3).join("; ")}` : "Choose files or paste text.");
  }
  return { added, skipped };
}

export async function archiveDocumentAction(documentId: string) {
  return archiveDocument(await requireOrgId(), documentId);
}

/**
 * Transcribe an uploaded audio file (voice note) to text via OpenAI Whisper. Returns the
 * transcript for the user to review/edit before adding it to the brief. Requires
 * OPENAI_API_KEY — without it, the browser 🎙 Dictate button is the no-key path.
 */
/** BIM assistant: read the current 3D model + instruction (text/voice/images) → new model. */
export async function bimAgentAction(
  doc: import("@/bim/model").BimDocument,
  instruction: string,
  attachments: string[] = [],
  specialist: import("@/bim/agents").SpecialistId = "all",
): Promise<{ reply: string; doc: import("@/bim/model").BimDocument; commandCount: number }> {
  await requireOrgId();
  if (!isAiConfigured()) throw new Error("The BIM assistant needs an ANTHROPIC_API_KEY in .env.local.");
  const { runBimAgent } = await import("@/bim/agent");
  return runBimAgent(doc, instruction, attachments, specialist);
}

export async function transcribeAudioAction(formData: FormData): Promise<{ text: string }> {
  await requireOrgId();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an audio file to transcribe.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Audio file is too large (max 25 MB). Trim it or use the mic.");
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Audio-file transcription needs an OpenAI API key (set OPENAI_API_KEY in .env.local). For now, use the 🎙 Dictate button — it transcribes your voice live in the browser with no key.");
  }
  const body = new FormData();
  body.append("file", file, file.name || "audio.webm");
  body.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}). ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("Couldn't hear any speech in that audio file.");
  return { text };
}

export async function generateConceptAction(projectId: string) {
  const orgId = await requireOrgId();
  // When AI is configured, Claude reads the documents; otherwise rule-based extraction.
  return isAiConfigured() ? generateConceptAI(orgId, projectId) : generateConcept(orgId, projectId);
}

export async function transitionDrawingAction(drawingId: string, to: LifecycleState) {
  return transitionDrawing(await requireOrgId(), drawingId, to);
}

/**
 * Export the project's latest drawing as a professional CAD file:
 * - "dwg": native AutoCAD (ezdxf → ODA File Converter)
 * - "dxf": professional DXF with REAL dimension entities (ezdxf)
 * - "ifc": a BIM model that opens in Autodesk Revit (Open IFC)
 * Returns the file base64-encoded for the browser to download.
 */
export async function exportCadAction(
  projectId: string,
  format: "dwg" | "dxf" | "ifc",
): Promise<{ name: string; mime: string; b64: string; note?: string }> {
  const orgId = await requireOrgId();
  const drawing = (
    await db
      .select({ title: schema.drawings.title, kind: schema.drawings.kind, schedule: schema.drawings.schedule, traceability: schema.drawings.traceability, dxf: schema.drawings.dxf })
      .from(schema.drawings)
      .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
      .orderBy(desc(schema.drawings.createdAt))
      .limit(1)
  )[0];
  if (!drawing) throw new Error("Generate a drawing first, then export it.");

  const base = (drawing.title || "drawing").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "drawing";

  if (format === "ifc") {
    // For freeform, resolve raw primitives (stored or reconstructed from the DXF) so the
    // BIM model has geometry even on drawings generated before entities were persisted.
    const forIfc = drawing.kind === "freeform_sketch" ? { ...drawing, schedule: freeformEntitiesFor(drawing) } : drawing;
    const ifc = buildDrawingIfc(forIfc);
    return { name: `${base}.ifc`, mime: "application/x-step", b64: Buffer.from(ifc, "utf8").toString("base64") };
  }

  const out = await composeCad(drawing);
  if (format === "dwg") {
    if (!out.dwg) throw new Error(`DWG needs the ODA File Converter on the server (set DRAWLOGIX_ODA). ${out.dwgError ?? ""}`.trim());
    return { name: `${base}.dwg`, mime: "image/vnd.dwg", b64: out.dwg.toString("base64") };
  }
  return {
    name: `${base}.dxf`,
    mime: "image/vnd.dxf",
    b64: out.dxf.toString("base64"),
    note: out.dwg ? undefined : out.dwgError ?? undefined,
  };
}

export async function sendCopilotAction(projectId: string, content: string, attachments: string[] = []) {
  return sendCopilotMessage(await requireOrgId(), projectId, content, attachments);
}

export async function designFromBriefAction(projectId: string, brief: string) {
  return designFromBrief(await requireOrgId(), projectId, brief);
}

/** DXF edit copilot — stateless: turn an instruction into edit operations (no DB). */
export async function dxfCopilotAction(summary: ModelSummary, instruction: string) {
  return editDxf(summary, instruction);
}

/**
 * PDF → DXF conversion. Accepts a vector PDF and returns an editable DxfModel the
 * editor loads exactly like an uploaded DXF (then copilot + export work unchanged).
 * Stateless — no DB; the model lives client-side until the user exports it.
 */
export async function pdfToDxfAction(formData: FormData) {
  await requireOrgId(); // gate on an active tenant, matching the rest of the app
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF file to convert.");
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("That isn't a PDF — upload a .pdf exported from your CAD tool.");
  const scaleRaw = Number(formData.get("scale"));
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const pages = parsePageSelection(String(formData.get("pages") ?? ""));

  const buf = Buffer.from(await file.arrayBuffer());
  const { pages: converted, stats, pageReport, warning } = await pdfToModel(buf, { scale, pages });
  if (converted.length === 0) {
    throw new Error(warning ?? "No convertible vector geometry was found in that PDF.");
  }
  return { pages: converted, stats, pageReport, warning };
}

/** Parse the UI "pages" field: "" / "auto" → auto-detect; "all" → every page; "3-5,8" → list. */
function parsePageSelection(raw: string): PageSelection {
  const s = raw.trim().toLowerCase();
  if (!s || s === "auto") return "auto";
  if (s === "all") return "all";
  const nums = new Set<number>();
  for (const part of s.split(",")) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) nums.add(n);
    } else if (/^\d+$/.test(part.trim())) {
      nums.add(Number(part.trim()));
    }
  }
  return nums.size ? [...nums] : "auto";
}
