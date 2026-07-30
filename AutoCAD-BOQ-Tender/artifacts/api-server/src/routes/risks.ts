import { Router } from "express";
import { db } from "@workspace/db";
import { riskItemsTable, documentsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAIClient, extractJSON, type Provider, type ProviderConfig } from "../lib/ai-provider";
import fs from "fs";

const router = Router();

router.get("/projects/:id/risks", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const items = await db.select().from(riskItemsTable).where(eq(riskItemsTable.projectId, projectId));
  res.json(items);
});

router.post("/projects/:id/risks", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, description, category, likelihood, impact, mitigation, owner } = req.body;
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const existing = await db.select().from(riskItemsTable).where(eq(riskItemsTable.projectId, projectId));
  const riskCode = `RISK-${String(existing.length + 1).padStart(3, "0")}`;
  const [{ id: newId }] = await db.insert(riskItemsTable).values({
    projectId, riskCode, title,
    description: description ?? null,
    category: category ?? "Other",
    likelihood: likelihood ?? "Medium",
    impact: impact ?? "Medium",
    mitigation: mitigation ?? null,
    owner: owner ?? null,
    aiGenerated: "false",
  }).$returningId();
  const [item] = await db.select().from(riskItemsTable).where(eq(riskItemsTable.id, newId));
  res.json(item);
});

router.patch("/risks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;
  const allowed = ["title", "description", "category", "likelihood", "impact", "mitigation", "owner"];
  const filtered: Record<string, unknown> = {};
  for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
  await db.update(riskItemsTable).set(filtered).where(eq(riskItemsTable.id, id));
  const [updated] = await db.select().from(riskItemsTable).where(eq(riskItemsTable.id, id));
  res.json(updated);
});

router.delete("/risks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(riskItemsTable).where(eq(riskItemsTable.id, id));
  res.json({ success: true });
});

router.post("/projects/:id/generate-risks", async (req, res) => {
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
    for (const doc of documents.slice(0, 3)) {
      try {
        if (fs.existsSync(doc.filePath)) {
          docContext += `\n--- ${doc.originalName} ---\n${fs.readFileSync(doc.filePath, "utf-8").slice(0, 2000)}`;
        }
      } catch {}
    }

    send({ type: "progress", message: "Analysing project scope and generating risk register..." });

    const client = getAIClient(provider, providerConfig);
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a Senior Construction Risk Manager with 20+ years of experience in Middle East and international projects.
Generate a comprehensive risk register specific to this tender. Cover: Commercial, Technical, Environmental, Schedule, Regulatory, Supply Chain, Interface, Financial.
Return ONLY a raw JSON object (no markdown):
{
  "risks": [
    {
      "title": "string — specific risk title",
      "description": "string — 1-2 sentences explaining the risk",
      "category": "Commercial|Technical|Environmental|Schedule|Regulatory|Supply Chain|Interface|Financial",
      "likelihood": "Low|Medium|High",
      "impact": "Low|Medium|High",
      "mitigation": "string — concrete mitigation action"
    }
  ]
}
Generate 7-10 project-specific risks. Be specific, not generic.`,
        },
        {
          role: "user",
          content: `Generate a risk register for: "${project.name}"${project.description ? `\nDescription: ${project.description}` : ""}${docContext ? `\n\nProject documents:\n${docContext}` : "\n\nNo documents — base on typical construction tender risks for this project type."}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let risks: Record<string, unknown>[] = [];
    try { risks = (JSON.parse(extractJSON(raw)) as { risks?: Record<string, unknown>[] }).risks ?? []; } catch {}

    const existing = await db.select().from(riskItemsTable).where(eq(riskItemsTable.projectId, projectId));
    for (const r of existing.filter(r => r.aiGenerated === "true")) {
      await db.delete(riskItemsTable).where(eq(riskItemsTable.id, r.id));
    }

    const manualCount = existing.filter(r => r.aiGenerated !== "true").length;
    for (let i = 0; i < risks.length; i++) {
      const risk = risks[i] as Record<string, string>;
      const riskCode = `RISK-${String(manualCount + i + 1).padStart(3, "0")}`;
      const [{ id: insertedId }] = await db.insert(riskItemsTable).values({
        projectId, riskCode,
        title: risk.title ?? "Unnamed Risk",
        description: risk.description ?? null,
        category: risk.category ?? "Other",
        likelihood: risk.likelihood ?? "Medium",
        impact: risk.impact ?? "Medium",
        mitigation: risk.mitigation ?? null,
        aiGenerated: "true",
      }).$returningId();
      const [saved] = await db.select().from(riskItemsTable).where(eq(riskItemsTable.id, insertedId));
      send({ type: "risk", risk: saved });
    }

    send({ type: "done", count: risks.length });
    res.end();
  } catch (err) {
    req.log.error(err);
    send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    res.end();
  }
});

export default router;
