import { Router } from "express";
import { db } from "@workspace/db";
import { tenderIntelligenceTable, documentsTable, projectsTable, narrativeSectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAIClient, extractJSON, type Provider, type ProviderConfig } from "../lib/ai-provider";
import { gatherNarrativeContext } from "../lib/narrative-context";
import { buildNarrativeDocx, type NarrativeSection } from "../lib/narrative-docx";
import fs from "fs";

const router = Router();

router.get("/projects/:id/intelligence", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [intel] = await db.select().from(tenderIntelligenceTable).where(eq(tenderIntelligenceTable.projectId, projectId));
  res.json(intel ?? null);
});

router.post("/projects/:id/analyze", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const provider: Provider = req.body?.provider ?? "openai";
  const model: string = req.body?.model ?? "gpt-4.1-mini";
  const providerConfig: ProviderConfig = {
    ollamaUrl: req.body?.providerConfig?.ollamaUrl,
    openrouterKey: req.body?.providerConfig?.openrouterKey,
    groqKey: req.body?.providerConfig?.groqKey,
    anthropicKey: req.body?.providerConfig?.anthropicKey,
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) { send({ type: "error", message: "Project not found" }); res.end(); return; }

    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId));
    let docContext = "";
    for (const doc of documents.slice(0, 4)) {
      try {
        if (fs.existsSync(doc.filePath)) {
          docContext += `\n--- ${doc.originalName} ---\n${fs.readFileSync(doc.filePath, "utf-8").slice(0, 3000)}`;
        }
      } catch {}
    }

    send({ type: "progress", message: "Analysing tender opportunity and scoring Go/No-Go decision..." });

    const client = getAIClient(provider, providerConfig);
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a Senior Bid Director at a leading construction firm with 25+ years in competitive tendering.
Assess the tender opportunity and provide a Go/No-Go recommendation with scoring across: technical alignment, commercial attractiveness, risk profile, resource availability, competitive position, strategic fit.
Return ONLY a raw JSON object (no markdown):
{
  "goNoGoScore": number (0-100, where 0=strong No-Go, 50=borderline, 100=strong Go),
  "recommendation": "Go" | "Conditional Go" | "No-Go",
  "scopeSummary": "2-3 sentence project scope description",
  "keyStrengths": ["strength 1", "strength 2", "strength 3"],
  "keyRisks": ["risk 1", "risk 2", "risk 3"],
  "requiredClarifications": ["clarification 1", "clarification 2", "clarification 3", "clarification 4"],
  "competitiveAdvantages": ["advantage 1", "advantage 2", "advantage 3"],
  "estimatedValue": "e.g. $2M - $5M or Unknown",
  "complexity": "Low" | "Medium" | "High" | "Very High"
}`,
        },
        {
          role: "user",
          content: `Assess this tender: "${project.name}"${project.description ? `\nDescription: ${project.description}` : ""}${docContext ? `\n\nTender documents:\n${docContext}` : "\n\nNo documents uploaded — provide general assessment."}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let intel: Record<string, unknown> = {};
    try { intel = JSON.parse(extractJSON(raw)) as Record<string, unknown>; } catch {}

    await db.delete(tenderIntelligenceTable).where(eq(tenderIntelligenceTable.projectId, projectId));
    const [{ id: newId }] = await db.insert(tenderIntelligenceTable).values({
      projectId,
      goNoGoScore: (intel.goNoGoScore as number) ?? 50,
      recommendation: (intel.recommendation as string) ?? "Conditional Go",
      scopeSummary: (intel.scopeSummary as string) ?? null,
      keyStrengths: JSON.stringify(intel.keyStrengths ?? []),
      keyRisks: JSON.stringify(intel.keyRisks ?? []),
      requiredClarifications: JSON.stringify(intel.requiredClarifications ?? []),
      competitiveAdvantages: JSON.stringify(intel.competitiveAdvantages ?? []),
      estimatedValue: (intel.estimatedValue as string) ?? null,
      complexity: (intel.complexity as string) ?? "Medium",
    }).$returningId();
    const [saved] = await db.select().from(tenderIntelligenceTable).where(eq(tenderIntelligenceTable.id, newId));

    send({ type: "done", intelligence: saved });
    res.end();
  } catch (err) {
    req.log.error(err);
    send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    res.end();
  }
});

router.post("/projects/:id/generate-narrative", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const section: string = req.body?.section ?? "technical-approach";
  const provider: Provider = req.body?.provider ?? "openai";
  const model: string = req.body?.model ?? "gpt-4.1-mini";
  const providerConfig: ProviderConfig = {
    ollamaUrl: req.body?.providerConfig?.ollamaUrl,
    openrouterKey: req.body?.providerConfig?.openrouterKey,
    groqKey: req.body?.providerConfig?.groqKey,
    anthropicKey: req.body?.providerConfig?.anthropicKey,
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) { send({ type: "error", message: "Project not found" }); res.end(); return; }

    // Assemble the REAL project data the narrative must be grounded in: the
    // properly-parsed document text (from cad_chunks, NOT raw PDF bytes), the
    // priced BOQ, the work programme, and the SOW outline. Each degrades to ""
    // when that data hasn't been generated yet.
    send({ type: "progress", message: "Gathering project documents, BOQ and programme..." });
    const ctx = await gatherNarrativeContext(projectId);
    send({
      type: "context",
      message: `Grounding on ${ctx.stats.documents} document(s) (${ctx.stats.docChars} parsed chars), ${ctx.stats.boqItems} BOQ line(s), ${ctx.stats.scheduleActivities} programme activit(ies)${ctx.stats.totalDurationDays ? ` over ${ctx.stats.totalDurationDays} days` : ""}.`,
    });

    const sectionPrompts: Record<string, string> = {
      "executive-summary": "Write a compelling 3-paragraph Executive Summary for the tender submission. Cover: our understanding of the project and client's objectives (grounded in the document scope and SOW outline), our technical approach and key differentiators, and why we are the ideal contractor. Reference the real scale of the works (key BOQ scope areas) and the overall programme duration where stated. Be persuasive and specific.",
      "company-profile": "Write a 3-paragraph Company Profile highlighting: company history and scale, relevant project experience with similar scope to THIS project's actual works, key technical capabilities and certifications that align with the disciplines present in this tender's BOQ and scope.",
      "technical-approach": "Write a detailed, BOQ-based Technical Approach and Methodology. Ground it in the ACTUAL scope and DO NOT omit any major discipline/trade that appears in the BOQ — give a `###` sub-section with a concrete method statement for EACH (e.g. earthworks/excavation, structural/concrete, MEP, finishes, external works — whichever are present). For each discipline cover: the construction method, the plant & equipment deployed, the materials and their procurement, manpower/resourcing, and the applicable technical standards/codes. Then cover overall construction sequencing aligned to the work programme phases, temporary works, interface/coordination management between trades, and value-engineering/innovation opportunities tied to the quantified scope. Be exhaustive — an evaluator should find no part of the scope unaddressed.",
      "programme": "Write a Project Programme section built around the ACTUAL work programme provided below. Cover: the proposed overall schedule and total duration, the real phases and key milestones (use the activities and durations given — do not invent a different timeline), critical-path activities and how they are protected, manpower/resource deployment and loading across the phases, plant deployment, early-procurement strategy for long-lead items in this scope, and programme risk mitigation. Where the programme below states durations/milestones, honour them.",
      "quality": "Write a comprehensive Quality Assurance Plan covering: our QA/QC management system framework, project-specific Inspection and Test Plans (ITPs) tied to the actual trades/materials in this BOQ (give examples per discipline), the material submittal and approval process, the specific codes/standards applicable to the works (cite the standard families relevant to each trade), sampling/testing regime, non-conformance reporting and closure, and quality hold/witness points aligned to the work programme milestones.",
      "hse": "Write a thorough Health, Safety & Environment (HSE) section covering: our HSE management system and certifications (ISO 45001), project-specific hazard identification and controls (HIRAC) for the actual activities in this scope, and method-specific controls. IMPORTANTLY, tie the applicable safety standards to PROCUREMENT — the PPE, plant, equipment and materials procured determine the controls and certifications required (e.g. lifting-gear certification, scaffolding standards, COSHH/material-safety for procured materials); make this procurement→safety linkage explicit. Also cover the emergency response plan framework, environmental management and waste minimisation, and HSE training/competency.",
      "risk-management": "Write a Risk Management section with a brief critical analysis of 6-8 key project-specific risks drawn from THIS project's real scope, BOQ and programme. Cover the main risk categories: schedule/critical-path risks (derive these directly from the work programme's critical activities and milestones), procurement/long-lead-item risks, manpower/resource-availability risks, design/interface risks, and site-constraint risks stated in the documents. Present as a structured narrative (a `###` per risk): name the risk, give a short critical analysis of its likelihood and impact (and which programme activities or BOQ items it threatens), and provide a specific, proactive mitigation and contingency. Make clear that the risk profile depends on the schedule and procurement plan.",
    };

    // Build the shared grounding block once; every section sees it so the
    // narrative is consistent with the documents, the priced scope and the plan.
    const groundingBlock = [
      project.location ? `Location: ${project.location}` : "",
      project.client ? `Client: ${project.client}` : "",
      ctx.outlineDigest ? `\n## SCOPE-OF-WORK OUTLINE (the document's own breakdown)\n${ctx.outlineDigest}` : "",
      ctx.boqDigest ? `\n## PRICED BILL OF QUANTITIES (the actual quantified scope)\n${ctx.boqDigest}` : "",
      ctx.scheduleDigest ? `\n## WORK PROGRAMME (the baseline schedule — phases, durations, milestones)\n${ctx.scheduleDigest}` : "",
      ctx.docExcerpt ? `\n## SOURCE TECHNICAL DOCUMENTS (parsed text + vision findings)\n${ctx.docExcerpt}` : "",
    ].filter(Boolean).join("\n");

    const hasGrounding = !!(ctx.docExcerpt || ctx.boqDigest || ctx.scheduleDigest || ctx.outlineDigest);

    const client = getAIClient(provider, providerConfig);
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      messages: [
        {
          role: "system",
          content: `You are a senior bid writer with 20 years writing winning tender submissions for major construction projects in the Middle East and internationally.
Write in a professional, confident, first-person-plural tone (we/our firm). Use correct construction industry terminology.
Produce a THOROUGH, evaluator-ready section (aim for roughly 700-1200 words) structured with markdown: a short opening paragraph, then clear \`##\`/\`###\` sub-headings and bullet lists where they aid readability. Be comprehensive — leave nothing important from the scope unaddressed — but never pad with generic filler.

GROUND EVERYTHING IN THE PROVIDED PROJECT DATA. You are given the real parsed tender documents, the priced Bill of Quantities (the quantified scope), the work programme (phases, durations, milestones) and the SOW outline. Be specific to THIS project: refer to the actual scope areas, quantities/units, disciplines, durations and milestones that appear in the data. Do NOT invent figures, durations or scope that contradict the data, and do NOT write generic boilerplate that could apply to any project. Where the data is silent, you may add standard professional content but keep it consistent with what is given.`,
        },
        {
          role: "user",
          content: `Project: "${project.name}"${project.description ? `\nDescription: ${project.description}` : ""}

${hasGrounding ? `=== PROJECT DATA TO GROUND THE NARRATIVE IN ===\n${groundingBlock}\n=== END PROJECT DATA ===` : "(No documents, BOQ or programme have been generated for this project yet — write a well-reasoned general submission based on the project name/description.)"}

TASK: ${sectionPrompts[section] ?? sectionPrompts["technical-approach"]}`,
        },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) send({ type: "delta", content: delta });
    }

    send({ type: "done" });
    res.end();
  } catch (err) {
    req.log.error(err);
    send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    res.end();
  }
});

/**
 * Compile the (already-generated) narrative section drafts into a formatted,
 * downloadable Word document. PURE FORMATTING — no model call, so it costs ZERO
 * tokens and works the same regardless of which (free) provider drafted the
 * sections. The client posts the current section drafts; the project meta is
 * stamped onto the title block from the DB.
 */
router.post("/projects/:id/narrative/export.docx", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const rawSections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const sections: NarrativeSection[] = rawSections
      .map((s: { title?: unknown; content?: unknown }) => ({
        title: typeof s?.title === "string" ? s.title : "",
        content: typeof s?.content === "string" ? s.content : "",
      }))
      .filter((s: NarrativeSection) => s.title && s.content.trim());

    if (sections.length === 0) {
      res.status(400).json({ error: "No drafted narrative sections to export. Generate at least one section first." });
      return;
    }

    const buffer = await buildNarrativeDocx(sections, {
      projectName: project.name,
      client: project.client,
      location: project.location,
      quotationRef: project.quotationRef,
      submissionDate: project.submissionDate,
    });

    const safeName = (project.name || "project").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    // A single-section export is named after that section; a multi-section export
    // is the full Technical Narrative.
    const filename =
      sections.length === 1
        ? `${sections[0].title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}-${safeName}.docx`
        : `Technical-Narrative-${safeName}.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.send(buffer);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build Word document" });
  }
});

/**
 * Load the saved Technical Narrative sections for a project so drafts (and their
 * verified status) survive page reloads.
 */
router.get("/projects/:id/narrative", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db
      .select()
      .from(narrativeSectionsTable)
      .where(eq(narrativeSectionsTable.projectId, projectId));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load narrative" });
  }
});

/**
 * Save (upsert) a single narrative section's edited content and verified flag.
 * Keyed on (projectId, sectionKey) so re-saving the same section overwrites it.
 */
router.put("/projects/:id/narrative/:sectionKey", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const sectionKey = String(req.params.sectionKey).slice(0, 64);
  if (isNaN(projectId) || !sectionKey) { res.status(400).json({ error: "Invalid id or section" }); return; }

  const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 255) : sectionKey;
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  const verified = req.body?.verified === true;

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    await db
      .insert(narrativeSectionsTable)
      .values({ projectId, sectionKey, title, content, verified })
      .onDuplicateKeyUpdate({ set: { title, content, verified } });

    const [saved] = await db
      .select()
      .from(narrativeSectionsTable)
      .where(and(eq(narrativeSectionsTable.projectId, projectId), eq(narrativeSectionsTable.sectionKey, sectionKey)));
    res.json(saved ?? { projectId, sectionKey, title, content, verified });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save section" });
  }
});

export default router;
