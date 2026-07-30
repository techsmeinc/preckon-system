import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages, documentsTable, boqItemsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getAIClient, type Provider, type ProviderConfig } from "../lib/ai-provider";
import {
  CreateOpenaiConversationBody,
  SendOpenaiMessageBody,
} from "@workspace/api-zod";

const router = Router();

// GET /openai/conversations
router.get("/openai/conversations", async (req, res) => {
  try {
    const list = await db.select().from(conversations).orderBy(asc(conversations.createdAt));
    res.json(list);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /openai/conversations
router.post("/openai/conversations", async (req, res) => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  try {
    const [{ id: newId }] = await db
      .insert(conversations)
      .values({
        title: parsed.data.title,
        projectId: parsed.data.projectId ?? null,
      } as { title: string; projectId: number | null })
      .$returningId();
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, newId));
    res.status(201).json(conv);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /openai/conversations/:id
router.get("/openai/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
    res.json({ ...conv, messages: msgs });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /openai/conversations/:id
router.delete("/openai/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(conversations).where(eq(conversations.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /openai/conversations/:id/messages
router.get("/openai/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
    res.json(msgs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /openai/conversations/:id/messages (SSE streaming)
router.post("/openai/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = SendOpenaiMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const provider: Provider = req.body?.provider ?? "openai";
  const model: string = req.body?.model ?? "gpt-5.1";
  const providerConfig: ProviderConfig = {
    ollamaUrl: req.body?.providerConfig?.ollamaUrl,
    openrouterKey: req.body?.providerConfig?.openrouterKey,
    groqKey: req.body?.providerConfig?.groqKey,
    anthropicKey: req.body?.providerConfig?.anthropicKey,
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) {
      res.write(`data: ${JSON.stringify({ error: "Conversation not found" })}\n\n`);
      res.end();
      return;
    }

    await db.insert(messages).values({
      conversationId: id,
      role: "user",
      content: parsed.data.content,
    });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    let projectContext = "";
    if (conv.projectId) {
      const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, conv.projectId));
      const boqItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, conv.projectId)).limit(30);

      if (docs.length > 0) {
        projectContext += `\n\nProject has ${docs.length} uploaded document(s): ${docs.map(d => d.originalName).join(", ")}`;
      }
      if (boqItems.length > 0) {
        const boqSummary = boqItems.slice(0, 10).map(b =>
          `- ${b.description}: ${b.quantity} ${b.unit} @ ${b.unitPrice ?? "TBD"}`
        ).join("\n");
        projectContext += `\n\nBOQ Items (sample):\n${boqSummary}`;
        if (boqItems.length > 10) projectContext += `\n... and ${boqItems.length - 10} more items`;
      }
    }

    const systemMessage = `You are an expert AI assistant for a BOQ (Bill of Quantities) and Tender Intelligence Platform. You help construction engineers and project managers analyze drawings, tender documents, and BOQ data.

You can help with:
- Explaining BOQ items and quantities
- Analyzing tender requirements
- Estimating costs and quantities
- Interpreting construction drawings
- Reviewing scope of work documents
- Answering questions about construction specifications${projectContext}

Be precise, professional, and helpful. Use engineering terminology appropriately.`;

    const chatMessages = [
      { role: "system" as const, content: systemMessage },
      ...history.slice(-20).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const client = getAIClient(provider, providerConfig);

    let fullResponse = "";
    const stream = await client.chat.completions.create({
      model,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    await db.insert(messages).values({
      conversationId: id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error(err);
    res.write(`data: ${JSON.stringify({ error: `Failed to process message: ${err instanceof Error ? err.message : "Unknown error"}` })}\n\n`);
    res.end();
  }
});

export default router;
