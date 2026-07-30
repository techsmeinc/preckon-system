import { Router } from "express";
import { db } from "@workspace/db";
import { rfiItemsTable, documentsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAIClient, type Provider, type ProviderConfig } from "../lib/ai-provider";
import fs from "fs";

const router = Router();

router.get("/projects/:id/rfi", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const items = await db.select().from(rfiItemsTable).where(eq(rfiItemsTable.projectId, projectId));
  res.json(items);
});

router.post("/projects/:id/rfi", async (req, res) => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { query, raisedBy, deadline } = req.body;
  if (!query) { res.status(400).json({ error: "query required" }); return; }
  const existing = await db.select().from(rfiItemsTable).where(eq(rfiItemsTable.projectId, projectId));
  const queryNumber = `RFI-${String(existing.length + 1).padStart(3, "0")}`;
  const [{ id: newId }] = await db.insert(rfiItemsTable).values({
    projectId, queryNumber, query,
    raisedBy: raisedBy ?? null,
    deadline: deadline ?? null,
  }).$returningId();
  const [item] = await db.select().from(rfiItemsTable).where(eq(rfiItemsTable.id, newId));
  res.json(item);
});

router.patch("/rfi/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { answer, status, answeredBy } = req.body;
  await db.update(rfiItemsTable)
    .set({
      ...(answer !== undefined && { answer }),
      ...(status && { status }),
      ...(answeredBy && { answeredBy }),
      updatedAt: new Date(),
    })
    .where(eq(rfiItemsTable.id, id));
  const [updated] = await db.select().from(rfiItemsTable).where(eq(rfiItemsTable.id, id));
  res.json(updated);
});

router.delete("/rfi/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(rfiItemsTable).where(eq(rfiItemsTable.id, id));
  res.json({ success: true });
});

router.post("/projects/:id/rfi/:rfiId/draft-answer", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const rfiId = parseInt(req.params.rfiId);
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
    const [rfi] = await db.select().from(rfiItemsTable).where(eq(rfiItemsTable.id, rfiId));
    if (!rfi) { send({ type: "error", message: "RFI not found" }); res.end(); return; }

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId));

    let docContext = "";
    for (const doc of documents.slice(0, 3)) {
      try {
        if (fs.existsSync(doc.filePath)) {
          docContext += `\n--- ${doc.originalName} ---\n${fs.readFileSync(doc.filePath, "utf-8").slice(0, 2000)}`;
        }
      } catch {}
    }

    const client = getAIClient(provider, providerConfig);
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      messages: [
        {
          role: "system",
          content: `You are a senior bid manager drafting formal, professional answers to tender queries and RFIs for project "${project?.name}". 
Write in a clear, professional construction industry style. Be technically accurate. Answer directly without restating the question. Use 2-4 paragraphs.`,
        },
        {
          role: "user",
          content: `Draft a professional answer to this tender query:

${rfi.queryNumber}: ${rfi.query}

Available project context:
${docContext || "No documents uploaded — draft based on standard construction practice and reasonable assumptions."}`,
        },
      ],
    });

    let fullAnswer = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        fullAnswer += delta;
        send({ type: "delta", content: delta });
      }
    }

    await db.update(rfiItemsTable)
      .set({ answer: fullAnswer, status: "answered", updatedAt: new Date() })
      .where(eq(rfiItemsTable.id, rfiId));

    send({ type: "done", answer: fullAnswer });
    res.end();
  } catch (err) {
    req.log.error(err);
    send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    res.end();
  }
});

export default router;
