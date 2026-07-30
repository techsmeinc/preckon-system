import { Router } from "express";
import { db } from "@workspace/db";
import { boqItemsTable, cadChunksTable, cadExtractionsTable, companyProfileTable, documentsTable, projectResourcesTable, projectsTable, scheduleActivitiesTable, sowSectionsTable, projectCalendarsTable, resourceLeaveTable, activityResourcesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { UpdateBoqItemBody } from "@workspace/api-zod";
import { getAIClient, extractJSON, type Provider, type ProviderConfig } from "../lib/ai-provider";
import { buildAigccWorkbook, buildScheduleWorkbook } from "../lib/aigcc-excel";
import { footprintFromSummaries, resolveTbdQuantity } from "../lib/tbd-resolver";
import {
  assessItemQuality, scopeTypeRemark, qualityNote, validateQuantity, reviewSuffix,
  quantityConfidence, confidenceSuffix, isTbdQuantity,
} from "../lib/estimator-style";
import { extractSowOutline } from "../lib/sow-outline";
import { generateProjectSchedule } from "../lib/schedule-builder";
import { parseDependencies, serializeDependencies, type Dependency } from "@workspace/db/schedule-cpm";
import { defaultCalendar } from "@workspace/db/calendar-engine";
import ExcelJS from "exceljs";
import fs from "fs";

function toRoman(n: number): string {
  if (n < 1) return "";
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rem = n;
  for (const [value, sym] of map) {
    while (rem >= value) { out += sym; rem -= value; }
  }
  return out;
}

function toLetterCode(n: number): string {
  // 1->A, 2->B ... 26->Z, 27->AA
  let out = "";
  let rem = n;
  while (rem > 0) {
    const r = (rem - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    rem = Math.floor((rem - 1) / 26);
  }
  return out;
}

const router = Router();

// GET /projects/:id/boq
router.get("/projects/:id/boq", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const items = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/boq - manually create a single BOQ item
router.post("/projects/:id/boq", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body ?? {};
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  const quantity = Number(body.quantity);

  if (!category || !description || !unit || !Number.isFinite(quantity)) {
    res.status(400).json({ error: "category, description, unit, and quantity are required" });
    return;
  }

  const itemCode = typeof body.itemCode === "string" && body.itemCode.trim() ? body.itemCode.trim() : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const unitPriceRaw = body.unitPrice;
  const unitPrice =
    unitPriceRaw === null || unitPriceRaw === undefined || unitPriceRaw === ""
      ? null
      : Number(unitPriceRaw);
  if (unitPrice !== null && !Number.isFinite(unitPrice)) {
    res.status(400).json({ error: "unitPrice must be a number" });
    return;
  }
  const totalPrice = unitPrice !== null ? (quantity * unitPrice).toFixed(2) : null;

  try {
    const [{ id: insertedId }] = await db
      .insert(boqItemsTable)
      .values({
        projectId: id,
        category,
        itemCode,
        description,
        unit,
        quantity: quantity.toString(),
        unitPrice: unitPrice?.toString() ?? null,
        totalPrice,
        notes,
        aiConfidence: null,
      })
      .$returningId();
    const [saved] = await db.select().from(boqItemsTable).where(eq(boqItemsTable.id, insertedId));
    res.status(201).json(saved);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects/:id/boq/summary
router.get("/projects/:id/boq/summary", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const items = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));

    const categoryMap = new Map<string, { itemCount: number; totalCost: number }>();
    let totalCost = 0;

    for (const item of items) {
      const cost = item.totalPrice ? parseFloat(item.totalPrice) : 0;
      totalCost += cost;
      const existing = categoryMap.get(item.category) ?? { itemCount: 0, totalCost: 0 };
      categoryMap.set(item.category, {
        itemCount: existing.itemCount + 1,
        totalCost: existing.totalCost + cost,
      });
    }

    const categories = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      ...data,
    }));

    res.json({ categories, totalItems: items.length, totalCost });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/generate-boq (SSE streaming)
router.post("/projects/:id/generate-boq", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

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

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: "progress", message: "Loading project documents..." });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) {
      sendEvent({ type: "error", message: "Project not found" });
      res.end();
      return;
    }

    await db.update(projectsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(projectsTable.id, id));

    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));

    if (documents.length === 0) {
      sendEvent({ type: "progress", message: "No documents found. Generating sample BOQ for demonstration..." });
    } else {
      sendEvent({ type: "progress", message: `Found ${documents.length} document(s). Extracting content...` });
    }

    let extractedContent = "";
    for (const doc of documents) {
      sendEvent({ type: "progress", message: `Processing ${doc.originalName}...` });
      try {
        if (doc.mimeType === "application/pdf" || doc.mimeType?.startsWith("text/")) {
          if (fs.existsSync(doc.filePath)) {
            const content = fs.readFileSync(doc.filePath, "utf-8").slice(0, 5000);
            extractedContent += `\n\n--- Document: ${doc.originalName} ---\n${content}`;
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    sendEvent({ type: "progress", message: `Connecting to ${provider === "ollama" ? "Ollama" : provider === "openrouter" ? "OpenRouter" : "OpenAI"} (${model})...` });

    const systemPrompt = `You are an expert quantity surveyor. Based on the provided project documents, generate a comprehensive Bill of Quantities (BOQ).
If no documents are provided, generate a realistic sample BOQ for a typical office fit-out project.

Return ONLY a JSON object. No markdown fences, no commentary.

STRICT RULES — items that violate these will be rejected:
  • "description" must be a real specific item like "Recessed LED downlight 12W IP44". Not empty, not the word "string".
  • "unit" must be EXACTLY ONE short token. Pick the single best unit for the item. Valid tokens are: No., m, m2, m3, kg, LS, set, hr, roll, lm. Do NOT include pipes or multiple values.
  • "category" must be a real category like "Electrical". Not the word "string".
  • "quantity" must be a positive number (not the word "number" or a string).

Exact JSON shape — copy this structure but fill each field with REAL values:
{
  "items": [
    {
      "category": "Electrical",
      "itemCode": "E-01",
      "description": "Single-phase 13A switched socket outlet, white moulded plastic, flush mounted",
      "unit": "No.",
      "quantity": 64,
      "unitPrice": null,
      "notes": null,
      "aiConfidence": 0.8
    }
  ]
}

Generate 15-25 realistic BOQ items across multiple categories.`;

    const userPrompt = extractedContent
      ? `Generate a BOQ based on these project documents:\n${extractedContent}`
      : `Generate a sample BOQ for a typical office fit-out project on Floor 2 of a commercial building. Include items for electrical (lighting, power outlets, DB boards), HVAC (AHUs, ducts, grilles), civil/structural (partition walls, false ceiling), and finishing works.`;

    sendEvent({ type: "progress", message: "Generating BOQ items with AI..." });

    const client = getAIClient(provider, providerConfig);

    // JSON-mode support varies wildly:
    //  - OpenAI: full native support, very reliable.
    //  - Ollama: 0.1.30+ supports response_format on the OpenAI-compatible
    //    /v1/chat/completions endpoint — and small models like llama3.1:8b
    //    need it badly (without it they emit prose or echo the schema).
    //  - Groq llama-3.3-70b: 400s intermittently with json_object, so we skip.
    //  - OpenRouter: forwards to varied downstream models, inconsistent.
    const supportsJsonMode = provider === "openai" || provider === "ollama";

    const completionParams: Parameters<typeof client.chat.completions.create>[0] = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(supportsJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    };

    const response: any = await client.chat.completions.create(completionParams);
    const rawContent = response?.choices?.[0]?.message?.content ?? "{}";
    const jsonStr = extractJSON(rawContent);

    let parsed: { items?: Array<{
      category: string;
      itemCode?: string | null;
      description: string;
      unit: string;
      quantity: number;
      unitPrice?: number | null;
      notes?: string | null;
      aiConfidence?: number | null;
    }> } = {};

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Surface what the model actually returned so the user can see why it
      // failed — small models often return prose or commentary instead of JSON.
      const sample = rawContent.slice(0, 300).replace(/\s+/g, " ");
      sendEvent({
        type: "error",
        message: `Failed to parse AI response. Try a stronger model (qwen2.5:14b+, gpt-4.1-mini, or Claude). Model returned: "${sample}"`,
      });
      res.end();
      return;
    }

    const items = parsed.items ?? [];

    // Same garbage filter the multi-agent pipeline uses: rejects items where
    // the model echoed the schema placeholders ("string", "No.|m|m2|..." etc.)
    // verbatim as field values. Catches the llama3.1:8b failure mode.
    const PLACEHOLDERS = new Set(["string", "number", "boolean", "null", "undefined"]);
    function isGarbage(it: { description?: string; unit?: string; category?: string; quantity?: number | string }): string | null {
      const desc = String(it.description ?? "").trim();
      const unit = String(it.unit ?? "").trim();
      const cat = String(it.category ?? "").trim();
      if (!desc || desc.length < 5 || PLACEHOLDERS.has(desc.toLowerCase())) return "description";
      if (!cat || PLACEHOLDERS.has(cat.toLowerCase())) return "category";
      if (!unit || unit.includes("|") || unit.length > 12 || PLACEHOLDERS.has(unit.toLowerCase())) return "unit";
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return "quantity";
      return null;
    }

    const accepted: typeof items = [];
    let rejectedCount = 0;
    const rejectedReasons: string[] = [];
    for (const it of items) {
      const reason = isGarbage(it);
      if (reason) {
        rejectedCount++;
        if (rejectedReasons.length < 3) rejectedReasons.push(`bad ${reason}`);
      } else {
        accepted.push(it);
      }
    }
    if (rejectedCount > 0) {
      sendEvent({
        type: "progress",
        message: `Rejected ${rejectedCount} garbage item(s) (${rejectedReasons.join(", ")}). Use a stronger model for better results.`,
      });
    }
    if (accepted.length === 0) {
      sendEvent({
        type: "error",
        message: "All AI-generated items failed validation — the model returned placeholder values instead of real BOQ data. Switch to qwen2.5:14b+, gpt-4.1-mini, or Claude.",
      });
      res.end();
      return;
    }

    sendEvent({ type: "progress", message: `Saving ${accepted.length} BOQ items...` });

    await db.delete(boqItemsTable).where(eq(boqItemsTable.projectId, id));

    const savedItems = [];
    for (const item of accepted) {
      const qty = item.quantity ?? 0;
      const unitPrice = item.unitPrice ?? null;
      const totalPrice = unitPrice !== null ? (qty * unitPrice).toFixed(2) : null;

      const [{ id: insertedId }] = await db
        .insert(boqItemsTable)
        .values({
          projectId: id,
          category: item.category,
          itemCode: item.itemCode ?? null,
          description: item.description,
          unit: item.unit,
          quantity: qty.toString(),
          unitPrice: unitPrice?.toString() ?? null,
          totalPrice: totalPrice,
          notes: item.notes ?? null,
          aiConfidence: item.aiConfidence?.toString() ?? null,
        })
        .$returningId();
      const [saved] = await db.select().from(boqItemsTable).where(eq(boqItemsTable.id, insertedId));

      savedItems.push(saved);
      sendEvent({ type: "item", item: saved });
    }

    await db.update(projectsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(projectsTable.id, id));

    sendEvent({ type: "progress", message: `BOQ generation complete! ${savedItems.length} items generated.` });
    sendEvent({ done: true });
    res.end();
  } catch (err) {
    req.log.error(err);
    sendEvent({ type: "error", message: `BOQ generation failed: ${err instanceof Error ? err.message : "Unknown error"}` });
    res.end();
  }
});

// GET /projects/:id/boq/export.xlsx
// Streams a styled Excel quotation in the JTC layout (Roman → Letter → Number
// hierarchy) using the saved company profile as the letterhead.
router.get("/projects/:id/boq/export.xlsx", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    // Human-in-the-loop gate: only reviewer-approved items are exported.
    const allItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    const items = allItems.filter(i => (i.approvalStatus ?? "pending") === "approved");
    const [profile] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, 1));

    const company = profile ?? {
      companyName: "",
      addressLine1: "",
      addressLine2: "",
      phone: "",
      email: "",
      website: "",
      refPrefix: "QO",
      currencyCode: "KWD",
    };

    const currency = company.currencyCode || "KWD";
    const today = new Date();
    const submissionDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const year = String(today.getFullYear()).slice(-2);
    const quotationRef =
      typeof req.query.ref === "string" && req.query.ref.trim()
        ? req.query.ref.trim()
        : `${company.refPrefix || "QO"}/${id}/${year}`;
    const submittingTo = typeof req.query.client === "string" ? req.query.client.trim() : "";
    const projectLocation = typeof req.query.location === "string" ? req.query.location.trim() : "";

    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || "TenderLogix";
    wb.created = today;
    const ws = wb.addWorksheet("BOQ");

    // Column widths to mimic the JTC sample layout
    ws.columns = [
      { width: 7 },   // A — SL.NO
      { width: 5 },   // B — Roman (As per SOW ref.No)
      { width: 5 },   // C — Letter (BOQ Ref No)
      { width: 5 },   // D — Number (Sub Ref.No)
      { width: 60 },  // E — Description
      { width: 11 },  // F — Quantity
      { width: 9 },   // G — Unit
      { width: 14 },  // H — Rate
      { width: 16 },  // I — Amount
    ];

    const thin = { style: "thin", color: { argb: "FF000000" } } as const;
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const center = { horizontal: "center", vertical: "middle", wrapText: true } as const;
    const left = { horizontal: "left", vertical: "middle", wrapText: true } as const;
    const right = { horizontal: "right", vertical: "middle", wrapText: true } as const;
    const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } } as const;
    const sectionFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAEAEA" } } as const;
    const totalFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } as const;

    // ── Letterhead ─────────────────────────────────────────────────────────
    let row = 1;
    if (company.companyName) {
      ws.mergeCells(`A${row}:I${row}`);
      ws.getCell(`A${row}`).value = company.companyName.toUpperCase();
      ws.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 16, color: { argb: "FFB91C1C" } };
      ws.getCell(`A${row}`).alignment = center;
      ws.getRow(row).height = 26;
      row++;
    }
    const addrLine = [company.addressLine1, company.addressLine2].filter(Boolean).join(", ");
    if (addrLine) {
      ws.mergeCells(`A${row}:I${row}`);
      ws.getCell(`A${row}`).value = addrLine;
      ws.getCell(`A${row}`).font = { name: "Arial", size: 9 };
      ws.getCell(`A${row}`).alignment = center;
      row++;
    }
    const contactBits = [company.phone, company.email, company.website].filter(Boolean).join("  ·  ");
    if (contactBits) {
      ws.mergeCells(`A${row}:I${row}`);
      ws.getCell(`A${row}`).value = contactBits;
      ws.getCell(`A${row}`).font = { name: "Arial", size: 9, italic: true };
      ws.getCell(`A${row}`).alignment = center;
      row++;
    }
    row++; // spacer

    // ── Project meta (left label, right value) ─────────────────────────────
    const writeMeta = (label: string, value: string) => {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 10 };
      ws.mergeCells(`A${row}:D${row}`);
      ws.mergeCells(`E${row}:I${row}`);
      ws.getCell(`E${row}`).value = value;
      ws.getCell(`E${row}`).font = { name: "Arial", size: 10 };
      ws.getCell(`A${row}`).alignment = left;
      ws.getCell(`E${row}`).alignment = left;
      row++;
    };
    writeMeta("Quotation Ref No:", quotationRef);
    writeMeta("Project Name:", project.name ?? "");
    writeMeta("Project Number:", `#${project.id}`);
    writeMeta("Project Location:", projectLocation);
    writeMeta("Submitting To:", submittingTo);
    writeMeta("Submission Date:", submissionDate);
    row++; // spacer

    // ── Table headers (two-row) ────────────────────────────────────────────
    const headerTop = row;
    ws.getCell(`A${headerTop}`).value = "SL .NO";
    ws.mergeCells(`A${headerTop}:A${headerTop + 1}`);
    ws.mergeCells(`B${headerTop}:D${headerTop}`);
    ws.getCell(`B${headerTop}`).value = "REFERENCE";
    ws.mergeCells(`E${headerTop}:E${headerTop + 1}`);
    ws.getCell(`E${headerTop}`).value = "DESCRIPTION";
    ws.mergeCells(`F${headerTop}:F${headerTop + 1}`);
    ws.getCell(`F${headerTop}`).value = "QUANTITY";
    ws.mergeCells(`G${headerTop}:G${headerTop + 1}`);
    ws.getCell(`G${headerTop}`).value = "UNIT";
    ws.mergeCells(`H${headerTop}:H${headerTop + 1}`);
    ws.getCell(`H${headerTop}`).value = `RATE (IN\n${currency})`;
    ws.mergeCells(`I${headerTop}:I${headerTop + 1}`);
    ws.getCell(`I${headerTop}`).value = `AMOUNT (IN\n${currency})`;

    const headerBottom = headerTop + 1;
    ws.getCell(`B${headerBottom}`).value = "As per SOW ref. No";
    ws.getCell(`C${headerBottom}`).value = "BOQ Ref No";
    ws.getCell(`D${headerBottom}`).value = "Sub Ref. No";

    for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
      for (const r of [headerTop, headerBottom]) {
        const cell = ws.getCell(`${col}${r}`);
        cell.font = { name: "Arial", bold: true, size: 10 };
        cell.alignment = center;
        cell.fill = headerFill;
        cell.border = border;
      }
    }
    ws.getRow(headerTop).height = 28;
    ws.getRow(headerBottom).height = 28;
    row = headerBottom + 1;

    // ── Group items by category (Roman) then by itemCode prefix (Letter) ──
    type Item = typeof items[number];
    const byCategory = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.category || "Uncategorized";
      const arr = byCategory.get(key) ?? [];
      arr.push(it);
      byCategory.set(key, arr);
    }

    // Sub-grouping derived from itemCode: take portion before first dot/space.
    // Items without a recognisable prefix sit in a default subgroup (single letter A).
    function subGroupKey(it: Item): string {
      const code = (it.itemCode ?? "").trim();
      if (!code) return "_default";
      const m = code.match(/^([A-Za-z]+)/);
      return m ? m[1].toUpperCase() : "_default";
    }

    let grandTotal = 0;
    const totalsFormulaCells: string[] = [];
    let romanIdx = 0;

    for (const [categoryName, catItems] of byCategory.entries()) {
      romanIdx++;
      const roman = toRoman(romanIdx);

      // Roman section header row
      ws.getCell(`B${row}`).value = roman;
      ws.mergeCells(`E${row}:I${row}`);
      ws.getCell(`E${row}`).value = categoryName;
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
        const cell = ws.getCell(`${col}${row}`);
        cell.font = { name: "Arial", bold: true, size: 11 };
        cell.fill = sectionFill;
        cell.alignment = col === "E" ? left : center;
        cell.border = border;
      }
      ws.getRow(row).height = 22;
      row++;

      // Build subgroups in stable order, mapping prefix → letter index
      const subMap = new Map<string, Item[]>();
      for (const it of catItems) {
        const k = subGroupKey(it);
        const arr = subMap.get(k) ?? [];
        arr.push(it);
        subMap.set(k, arr);
      }

      let letterIdx = 0;
      const onlyDefault = subMap.size === 1 && subMap.has("_default");
      for (const [, subItems] of subMap.entries()) {
        letterIdx++;
        const letter = toLetterCode(letterIdx);

        // If there are multiple subgroups, write a subgroup header row when the
        // group has more than 1 item (matches JTC nesting feel). Otherwise items
        // get the letter directly.
        const writeSubHeader = !onlyDefault && subItems.length > 1;
        if (writeSubHeader) {
          ws.getCell(`C${row}`).value = letter;
          ws.mergeCells(`E${row}:I${row}`);
          ws.getCell(`E${row}`).value = subItems[0].category || categoryName;
          for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
            const cell = ws.getCell(`${col}${row}`);
            cell.font = { name: "Arial", bold: true, size: 10 };
            cell.alignment = col === "E" ? left : center;
            cell.border = border;
          }
          row++;
        }

        let subItemIdx = 0;
        for (const it of subItems) {
          subItemIdx++;
          const qty = it.quantity ? parseFloat(it.quantity) : 0;
          const rate = it.unitPrice ? parseFloat(it.unitPrice) : null;
          const amount = it.totalPrice ? parseFloat(it.totalPrice) : (rate !== null ? qty * rate : null);

          ws.getCell(`A${row}`).value = subItemIdx;
          if (!writeSubHeader) ws.getCell(`B${row}`).value = "";
          ws.getCell(`C${row}`).value = writeSubHeader ? "" : letter;
          ws.getCell(`D${row}`).value = writeSubHeader ? subItemIdx : "";
          ws.getCell(`E${row}`).value = it.description ?? "";
          ws.getCell(`F${row}`).value = qty;
          ws.getCell(`G${row}`).value = it.unit ?? "";
          if (rate !== null) ws.getCell(`H${row}`).value = rate;
          if (amount !== null) {
            ws.getCell(`I${row}`).value = { formula: `F${row}*H${row}`, result: amount };
            totalsFormulaCells.push(`I${row}`);
            grandTotal += amount;
          }

          for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
            const cell = ws.getCell(`${col}${row}`);
            cell.font = { name: "Arial", size: 10 };
            cell.border = border;
            cell.alignment = col === "E" ? left : (col === "F" || col === "H" || col === "I" ? right : center);
            if (col === "H" || col === "I") cell.numFmt = "#,##0.000;[Red]-#,##0.000";
            if (col === "F") cell.numFmt = "#,##0.###";
          }
          row++;
        }
      }
    }

    // ── Totals block ──────────────────────────────────────────────────────
    const sumRange = totalsFormulaCells.length > 0
      ? `=${totalsFormulaCells.join("+")}`
      : "=0";

    const writeTotal = (label: string, formula: string | number, bold = false) => {
      ws.mergeCells(`A${row}:H${row}`);
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`A${row}`).alignment = right;
      ws.getCell(`A${row}`).font = { name: "Arial", bold, size: 11 };
      ws.getCell(`A${row}`).fill = totalFill;
      const amtCell = ws.getCell(`I${row}`);
      amtCell.value = typeof formula === "number" ? formula : { formula: formula.replace(/^=/, ""), result: grandTotal };
      amtCell.numFmt = "#,##0.000;[Red]-#,##0.000";
      amtCell.alignment = right;
      amtCell.font = { name: "Arial", bold, size: 11 };
      amtCell.fill = totalFill;
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) ws.getCell(`${col}${row}`).border = border;
      row++;
    };
    writeTotal(`Total in ${currency}`, sumRange, false);
    writeTotal(`Special Discount Total in ${currency}`, 0, false);
    // Grand total = Total - Discount, referencing the two cells above.
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = `Grand Total in ${currency}`;
    ws.getCell(`A${row}`).alignment = right;
    ws.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 12 };
    ws.getCell(`A${row}`).fill = totalFill;
    const grandCell = ws.getCell(`I${row}`);
    grandCell.value = { formula: `I${row - 2}-I${row - 1}`, result: grandTotal };
    grandCell.numFmt = "#,##0.000;[Red]-#,##0.000";
    grandCell.alignment = right;
    grandCell.font = { name: "Arial", bold: true, size: 12 };
    grandCell.fill = totalFill;
    for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) ws.getCell(`${col}${row}`).border = border;
    row += 2;

    // ── Signatures ────────────────────────────────────────────────────────
    const sigRow = row;
    const sigBlocks = ["Prepared By", "Reviewed By", "Customer Acceptance"];
    const sigCols: [string, string][] = [["A", "C"], ["D", "F"], ["G", "I"]];
    sigCols.forEach((cols, i) => {
      const [start, end] = cols;
      ws.mergeCells(`${start}${sigRow}:${end}${sigRow}`);
      ws.getCell(`${start}${sigRow}`).value = sigBlocks[i];
      ws.getCell(`${start}${sigRow}`).font = { name: "Arial", bold: true, size: 10 };
      ws.getCell(`${start}${sigRow}`).alignment = center;
      ws.getCell(`${start}${sigRow}`).fill = headerFill;
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) ws.getCell(`${col}${sigRow}`).border = border;

      ws.mergeCells(`${start}${sigRow + 1}:${end}${sigRow + 1}`);
      ws.getRow(sigRow + 1).height = 60;
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) ws.getCell(`${col}${sigRow + 1}`).border = border;
    });

    // Print setup
    ws.pageSetup.orientation = "portrait";
    ws.pageSetup.paperSize = 9; // A4
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 0;
    ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    ws.pageSetup.printTitlesRow = `${headerTop}:${headerBottom}`;

    const safeName = (project.name || `project-${id}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-") || `project-${id}`;
    const filename = `${safeName}-BOQ.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Never let the browser serve a cached (stale) copy of a re-generated BOQ.
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate Excel" });
    else res.end();
  }
});

// POST /projects/:id/boq/approve-reviewed
// One-click QS sign-off for the lines the Quantity Validator flagged
// (verificationStatus="needs_review"). It first RESOLVES footprint-based TBD
// quantities (so approved lines carry a real preliminary number instead of TBD),
// then approves every flagged line. Resolved lines are marked "reviewed"; lines
// that still have no measurable evidence (MEP lengths, vertical walls) stay
// "needs_review" and will render TBD in the export — honest, not faked.
// Body (optional): { footprint?: number }  // override the CAD footprint (m²)
router.post("/projects/:id/boq/approve-reviewed", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    // Act on every line that needs attention: the Quantity-Validator flags AND
    // any line still showing TBD (incl. ones a previous click already marked
    // reviewed but left without a number). This is what makes the export stop
    // showing TBD after approval.
    const allItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    const targets = allItems.filter(it => {
      const refCount = Array.isArray(it.drawingReferences) ? (it.drawingReferences as unknown[]).length : 0;
      const ev = { description: it.description, category: it.category, unit: it.unit, notes: it.notes, quantity: it.quantity, drawingRefCount: refCount };
      return it.verificationStatus === "needs_review" || isTbdQuantity(ev);
    });
    if (targets.length === 0) { res.json({ approved: 0, resolved: 0, stillTbd: 0 }); return; }

    // Footprint for TBD resolution: request override, else derive from the CAD.
    const override = typeof req.body?.footprint === "number" && req.body.footprint > 0 ? req.body.footprint : null;
    const extractions = await db.select({ summary: cadExtractionsTable.summary })
      .from(cadExtractionsTable)
      .innerJoin(documentsTable, eq(documentsTable.id, cadExtractionsTable.documentId))
      .where(and(eq(documentsTable.projectId, id), eq(cadExtractionsTable.status, "succeeded")));
    const footprint = footprintFromSummaries(extractions.map(e => e.summary).filter(Boolean), override);

    let resolved = 0;
    let stillTbd = 0;
    for (const it of targets) {
      const refCount = Array.isArray(it.drawingReferences) ? (it.drawingReferences as unknown[]).length : 0;
      const ev = { description: it.description, category: it.category, unit: it.unit, notes: it.notes, quantity: it.quantity, drawingRefCount: refCount };
      const wasTbd = isTbdQuantity(ev);

      const update: Partial<typeof boqItemsTable.$inferInsert> = { approvalStatus: "approved" };

      if (wasTbd) {
        const fix = resolveTbdQuantity(ev, footprint);
        if (fix) {
          // Write the resolved number + a fresh evidence basis, recompute tags.
          const resolvedItem = { description: it.description, category: it.category, unit: it.unit, notes: fix.basis, quantity: fix.quantity, drawingRefCount: refCount };
          const qa = assessItemQuality(resolvedItem);
          const qv = validateQuantity(resolvedItem);
          const conf = quantityConfidence(resolvedItem);
          update.quantity = String(fix.quantity);
          update.notes = `${fix.basis} ${qualityNote(qa)}${reviewSuffix(qv)}${confidenceSuffix(conf)}`;
          if (!it.remarks || it.remarks === scopeTypeRemark(qa.scopeType)) update.remarks = scopeTypeRemark(qa.scopeType) || null;
          if (it.unitPrice) update.totalPrice = (fix.quantity * parseFloat(it.unitPrice)).toFixed(2);
          update.verificationStatus = "reviewed";
          resolved++;
        } else {
          // Genuinely unmeasurable (needs MEP/site drawings) — approved but kept
          // flagged so the QS still sees it; it will render TBD in the export.
          stillTbd++;
        }
      } else {
        // Flagged for a non-TBD reason (unit mismatch etc.) — QS approval clears it.
        update.verificationStatus = "reviewed";
      }
      await db.update(boqItemsTable).set(update).where(eq(boqItemsTable.id, it.id));
    }

    res.json({ approved: targets.length, resolved, stillTbd, footprint: footprint?.m2 ?? null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to approve reviewed items" });
  }
});

// GET /projects/:id/boq/export-aigcc.xlsx
// Streams an AIGCC-house-style priced BOQ. The 4-level hierarchy
// (SOW Ref. No. → Our Ref. No. → Sub. Ref. → Sr.No.) comes from the SOW-driven
// multi-agent pipeline. Items missing those fields fall under "Unclassified".
//
// Query params (all optional):
//   ref       — quotation reference, e.g. "AIGCC/AASAB/QO/1158/25"
//   client    — "Submitted to" value
//   location  — "Project Location" value
//   number    — overrides "Project Number" (defaults to the project's DB id)
//   date      — "Submission Date" (e.g. "23rd August 2025")
router.get("/projects/:id/boq/export-aigcc.xlsx", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    // Human-in-the-loop gate: only items a reviewer has approved are exported.
    const allItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    const items = allItems.filter(i => (i.approvalStatus ?? "pending") === "approved");
    const [profile] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, 1));
    // SOW outline is optional enrichment (real division titles). If the table
    // hasn't been migrated yet (pnpm push), fall back to empty and let the
    // export title from the item category tags instead of failing the download.
    let sowSections: typeof sowSectionsTable.$inferSelect[] = [];
    try {
      sowSections = await db.select().from(sowSectionsTable)
        .where(eq(sowSectionsTable.projectId, id))
        .orderBy(sowSectionsTable.seq);
    } catch (err) {
      req.log.warn({ err }, "sow_sections unavailable — exporting with category-fallback titles (run pnpm push)");
    }

    // Export meta: a query param (one-off override) wins, else the value saved on
    // the project, else undefined (the workbook builder supplies its own default).
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).trim() : "");
    const wb = await buildAigccWorkbook({
      project,
      items,
      company: profile ?? null,
      sowSections,
      quotationRef: q("ref") || project.quotationRef || undefined,
      submittingTo: q("client") || project.client || undefined,
      projectLocation: q("location") || project.location || undefined,
      projectNumber: q("number") || undefined,
      submissionDate: q("date") || project.submissionDate || undefined,
    });

    const safeName = (project.name || `project-${id}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-") || `project-${id}`;
    const filename = `Priced-BOQ-${safeName}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Never let the browser serve a cached (stale) copy of a re-generated BOQ.
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate AIGCC Excel" });
    else res.end();
  }
});

// GET /projects/:id/programme/export.xlsx
// Streams the work programme (time schedule) as its OWN standalone workbook —
// deliberately separate from the priced BOQ export so the two are distinct files.
// Same optional query params as the BOQ export (ref/client/location/number/date)
// so the Programme sheet carries an identical letterhead + meta block.
router.get("/projects/:id/programme/export.xlsx", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const schedule = await db.select().from(scheduleActivitiesTable).where(eq(scheduleActivitiesTable.projectId, id));
    if (schedule.length === 0) {
      res.status(404).json({ error: "No work programme generated for this project yet" });
      return;
    }
    const [profile] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, 1));
    const resources = await db.select().from(projectResourcesTable).where(eq(projectResourcesTable.projectId, id)).orderBy(projectResourcesTable.id);
    const calendar = await ensureDefaultCalendar(id);
    const leave = await db.select().from(resourceLeaveTable).where(eq(resourceLeaveTable.projectId, id));
    const assignmentsRows = await db.select().from(activityResourcesTable).where(eq(activityResourcesTable.projectId, id));

    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).trim() : "");
    const wb = await buildScheduleWorkbook({
      project,
      items: [],
      company: profile ?? null,
      schedule,
      resources,
      calendar,
      leave,
      assignments: assignmentsRows,
      quotationRef: q("ref") || project.quotationRef || undefined,
      submittingTo: q("client") || project.client || undefined,
      projectLocation: q("location") || project.location || undefined,
      projectNumber: q("number") || undefined,
      submissionDate: q("date") || project.submissionDate || undefined,
    });

    const safeName = (project.name || `project-${id}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-") || `project-${id}`;
    const filename = `Work-Programme-${safeName}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate work programme Excel" });
    else res.end();
  }
});

// GET /projects/:id/schedule
// Returns the stored work-programme activities for a project (ordered).
router.get("/projects/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db
      .select()
      .from(scheduleActivitiesTable)
      .where(eq(scheduleActivitiesTable.projectId, id))
      .orderBy(scheduleActivitiesTable.seq);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load schedule" });
  }
});

// ── Project Resources / Team (P6-style assignees) ────────────────────────────
// A small palette so a new resource gets a distinct colour without the user
// having to pick one. Cycled by current resource count.
const RESOURCE_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#0d9488", "#d97706", "#db2777", "#16a34a", "#4f46e5", "#0284c7", "#ca8a04"];

const RESOURCE_KINDS = new Set(["labour", "equipment", "material"]);
const RATE_BASES = new Set(["hourly", "daily"]);
const RESOURCE_STATUSES = new Set(["active", "inactive"]);

function readResourceBody(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("name") || !partial) out.name = (b.name ? String(b.name) : "New resource").trim().slice(0, 120) || "New resource";
  if (has("role") || !partial) out.role = b.role ? String(b.role).slice(0, 120) : null;
  if (has("color") || !partial) out.color = typeof b.color === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(b.color) ? (b.color.startsWith("#") ? b.color : `#${b.color}`).slice(0, 9) : null;
  // ── P6 attributes ──
  if (has("kind") || !partial) out.kind = RESOURCE_KINDS.has(String(b.kind)) ? String(b.kind) : "labour";
  if (has("rateBasis") || !partial) out.rateBasis = RATE_BASES.has(String(b.rateBasis)) ? String(b.rateBasis) : "daily";
  // Numeric cost rate; stored as a decimal string. null when blank/non-positive.
  if (has("rate") || !partial) {
    const n = Number(b.rate);
    out.rate = Number.isFinite(n) && n > 0 ? n.toFixed(3) : null;
  }
  if (has("currency") || !partial) out.currency = b.currency ? String(b.currency).slice(0, 8) : null;
  if (has("powerKw") || !partial) {
    const n = Number(b.powerKw);
    out.powerKw = Number.isFinite(n) && n > 0 ? n.toFixed(3) : null;
  }
  if (has("capacity") || !partial) out.capacity = Number.isFinite(Number(b.capacity)) ? Math.max(1, Math.round(Number(b.capacity))) : 1;
  if (has("status") || !partial) out.status = RESOURCE_STATUSES.has(String(b.status)) ? String(b.status) : "active";
  if (has("calendarId") || !partial) out.calendarId = Number.isFinite(Number(b.calendarId)) && Number(b.calendarId) > 0 ? Math.round(Number(b.calendarId)) : null;
  return out;
}

// GET /projects/:id/resources — the project's team list.
router.get("/projects/:id/resources", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(projectResourcesTable).where(eq(projectResourcesTable.projectId, id)).orderBy(projectResourcesTable.id);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load resources" });
  }
});

// POST /projects/:id/resources — add a team member.
router.post("/projects/:id/resources", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readResourceBody(req.body ?? {}, false);
    if (!values.color) {
      const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(projectResourcesTable).where(eq(projectResourcesTable.projectId, id));
      values.color = RESOURCE_COLORS[Number(n) % RESOURCE_COLORS.length];
    }
    const [{ id: insertId }] = await db.insert(projectResourcesTable).values({ projectId: id, ...(values as object) } as typeof projectResourcesTable.$inferInsert).$returningId();
    const [row] = await db.select().from(projectResourcesTable).where(eq(projectResourcesTable.id, insertId));
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add resource" });
  }
});

// PUT /projects/:id/resources/:resourceId — edit name/role/colour.
router.put("/projects/:id/resources/:resourceId", async (req, res) => {
  const id = parseInt(req.params.id);
  const resourceId = parseInt(req.params.resourceId);
  if (isNaN(id) || isNaN(resourceId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readResourceBody(req.body ?? {}, true);
    if (Object.keys(values).length > 0) {
      await db.update(projectResourcesTable).set(values).where(and(eq(projectResourcesTable.id, resourceId), eq(projectResourcesTable.projectId, id)));
    }
    const [row] = await db.select().from(projectResourcesTable).where(eq(projectResourcesTable.id, resourceId));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update resource" });
  }
});

// DELETE /projects/:id/resources/:resourceId — remove; activities fall back to
// unassigned (resource_id ON DELETE SET NULL).
router.delete("/projects/:id/resources/:resourceId", async (req, res) => {
  const id = parseInt(req.params.id);
  const resourceId = parseInt(req.params.resourceId);
  if (isNaN(id) || isNaN(resourceId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(projectResourcesTable).where(and(eq(projectResourcesTable.id, resourceId), eq(projectResourcesTable.projectId, id)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete resource" });
  }
});

// ── Work calendars (working/non-working days, weekends, holidays) ────────────
// Coerce a raw body into clean calendar column values. weekendDays/holidays are
// stored as JSON text.
function readCalendarBody(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("name") || !partial) out.name = (b.name ? String(b.name) : "Project Calendar").slice(0, 120);
  if (has("weekendDays") || !partial) {
    const arr = Array.isArray(b.weekendDays) ? b.weekendDays : [];
    const days = [...new Set(arr.map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 6))];
    out.weekendDays = JSON.stringify(days);
  }
  if (has("hoursPerDay") || !partial) {
    const n = Number(b.hoursPerDay);
    out.hoursPerDay = Number.isFinite(n) && n > 0 && n <= 24 ? n.toFixed(2) : "8";
  }
  if (has("holidays") || !partial) {
    const arr = Array.isArray(b.holidays) ? b.holidays : [];
    const clean = arr
      .map((h: Record<string, unknown>) => {
        const o: Record<string, string> = {};
        if (h?.date) o.date = String(h.date).slice(0, 10);
        if (h?.from) o.from = String(h.from).slice(0, 10);
        if (h?.to) o.to = String(h.to).slice(0, 10);
        if (h?.name) o.name = String(h.name).slice(0, 120);
        return o;
      })
      .filter((o) => o.date || o.from);
    out.holidays = JSON.stringify(clean);
  }
  if (has("preset") || !partial) out.preset = b.preset ? String(b.preset).slice(0, 32) : null;
  return out;
}

// Ensure a project has a default calendar; create a GCC default on first access.
async function ensureDefaultCalendar(projectId: number) {
  const existing = await db
    .select()
    .from(projectCalendarsTable)
    .where(and(eq(projectCalendarsTable.projectId, projectId), eq(projectCalendarsTable.isDefault, 1)));
  if (existing.length > 0) return existing[0];
  const def = defaultCalendar();
  const [{ id: insertId }] = await db
    .insert(projectCalendarsTable)
    .values({
      projectId,
      name: "Project Calendar",
      isDefault: 1,
      weekendDays: JSON.stringify(def.weekendDays),
      hoursPerDay: String(def.hoursPerDay),
      holidays: JSON.stringify(def.holidays),
      preset: "uae",
    } as typeof projectCalendarsTable.$inferInsert)
    .$returningId();
  const [row] = await db.select().from(projectCalendarsTable).where(eq(projectCalendarsTable.id, insertId));
  return row;
}

// GET /projects/:id/calendars — all calendars (default auto-created if missing).
router.get("/projects/:id/calendars", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await ensureDefaultCalendar(id);
    const rows = await db.select().from(projectCalendarsTable).where(eq(projectCalendarsTable.projectId, id)).orderBy(projectCalendarsTable.id);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load calendars" });
  }
});

// PUT /projects/:id/calendar — upsert the project's DEFAULT calendar.
router.put("/projects/:id/calendar", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const def = await ensureDefaultCalendar(id);
    const values = readCalendarBody(req.body ?? {}, true);
    if (Object.keys(values).length > 0) {
      await db.update(projectCalendarsTable).set(values).where(eq(projectCalendarsTable.id, def.id));
    }
    const [row] = await db.select().from(projectCalendarsTable).where(eq(projectCalendarsTable.id, def.id));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save calendar" });
  }
});

// POST /projects/:id/calendars — add a named (non-default) calendar.
router.post("/projects/:id/calendars", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readCalendarBody(req.body ?? {}, false);
    const [{ id: insertId }] = await db
      .insert(projectCalendarsTable)
      .values({ projectId: id, isDefault: 0, ...(values as object) } as typeof projectCalendarsTable.$inferInsert)
      .$returningId();
    const [row] = await db.select().from(projectCalendarsTable).where(eq(projectCalendarsTable.id, insertId));
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add calendar" });
  }
});

// PUT /projects/:id/calendars/:cid — edit a named calendar.
router.put("/projects/:id/calendars/:cid", async (req, res) => {
  const id = parseInt(req.params.id);
  const cid = parseInt(req.params.cid);
  if (isNaN(id) || isNaN(cid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readCalendarBody(req.body ?? {}, true);
    if (Object.keys(values).length > 0) {
      await db.update(projectCalendarsTable).set(values).where(and(eq(projectCalendarsTable.id, cid), eq(projectCalendarsTable.projectId, id)));
    }
    const [row] = await db.select().from(projectCalendarsTable).where(eq(projectCalendarsTable.id, cid));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update calendar" });
  }
});

// DELETE /projects/:id/calendars/:cid — remove a named calendar (not the default).
router.delete("/projects/:id/calendars/:cid", async (req, res) => {
  const id = parseInt(req.params.id);
  const cid = parseInt(req.params.cid);
  if (isNaN(id) || isNaN(cid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(projectCalendarsTable).where(and(eq(projectCalendarsTable.id, cid), eq(projectCalendarsTable.projectId, id), eq(projectCalendarsTable.isDefault, 0)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete calendar" });
  }
});

// ── Resource leave / vacations ───────────────────────────────────────────────
const LEAVE_TYPES = new Set(["vacation", "sick", "other"]);
function readLeaveBody(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (has("type") || !partial) out.type = LEAVE_TYPES.has(String(b.type)) ? String(b.type) : "vacation";
  if (has("fromDate") || !partial) out.fromDate = iso(b.fromDate);
  if (has("toDate") || !partial) out.toDate = iso(b.toDate) ?? iso(b.fromDate);
  if (has("note") || !partial) out.note = b.note ? String(b.note).slice(0, 200) : null;
  return out;
}

// GET /projects/:id/leave — all leave rows for the project's resources.
router.get("/projects/:id/leave", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(resourceLeaveTable).where(eq(resourceLeaveTable.projectId, id)).orderBy(resourceLeaveTable.fromDate);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load leave" });
  }
});

// POST /projects/:id/resources/:rid/leave — add a leave period.
router.post("/projects/:id/resources/:rid/leave", async (req, res) => {
  const id = parseInt(req.params.id);
  const rid = parseInt(req.params.rid);
  if (isNaN(id) || isNaN(rid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readLeaveBody(req.body ?? {}, false);
    if (!values.fromDate) { res.status(400).json({ error: "fromDate (YYYY-MM-DD) required" }); return; }
    const [{ id: insertId }] = await db
      .insert(resourceLeaveTable)
      .values({ projectId: id, resourceId: rid, ...(values as object) } as typeof resourceLeaveTable.$inferInsert)
      .$returningId();
    const [row] = await db.select().from(resourceLeaveTable).where(eq(resourceLeaveTable.id, insertId));
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add leave" });
  }
});

// PUT /projects/:id/resources/:rid/leave/:lid — edit a leave period.
router.put("/projects/:id/resources/:rid/leave/:lid", async (req, res) => {
  const id = parseInt(req.params.id);
  const lid = parseInt(req.params.lid);
  if (isNaN(id) || isNaN(lid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readLeaveBody(req.body ?? {}, true);
    if (Object.keys(values).length > 0) {
      await db.update(resourceLeaveTable).set(values).where(and(eq(resourceLeaveTable.id, lid), eq(resourceLeaveTable.projectId, id)));
    }
    const [row] = await db.select().from(resourceLeaveTable).where(eq(resourceLeaveTable.id, lid));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update leave" });
  }
});

// DELETE /projects/:id/resources/:rid/leave/:lid — remove a leave period.
router.delete("/projects/:id/resources/:rid/leave/:lid", async (req, res) => {
  const id = parseInt(req.params.id);
  const lid = parseInt(req.params.lid);
  if (isNaN(id) || isNaN(lid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(resourceLeaveTable).where(and(eq(resourceLeaveTable.id, lid), eq(resourceLeaveTable.projectId, id)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete leave" });
  }
});

// ── Activity ⇄ resource assignments (P6 multi-resource) ──────────────────────
function readAssignmentBody(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("resourceId") || !partial) out.resourceId = Math.round(Number(b.resourceId));
  if (has("allocationPct") || !partial) out.allocationPct = Number.isFinite(Number(b.allocationPct)) ? Math.min(1000, Math.max(1, Math.round(Number(b.allocationPct)))) : 100;
  if (has("unitsPerDay") || !partial) {
    const n = Number(b.unitsPerDay);
    out.unitsPerDay = Number.isFinite(n) && n > 0 ? n.toFixed(2) : "1";
  }
  if (has("isDriving") || !partial) out.isDriving = b.isDriving ? 1 : 0;
  return out;
}

// After any assignment change, keep schedule_activities.resource_id (the legacy
// single-assignee mirror) pointing at the driving assignment (or the first one).
async function syncDrivingResource(projectId: number, activityId: number) {
  const rows = await db
    .select()
    .from(activityResourcesTable)
    .where(and(eq(activityResourcesTable.projectId, projectId), eq(activityResourcesTable.activityId, activityId)))
    .orderBy(activityResourcesTable.id);
  const driving = rows.find((r) => r.isDriving === 1) ?? rows[0];
  await db
    .update(scheduleActivitiesTable)
    .set({ resourceId: driving ? driving.resourceId : null })
    .where(and(eq(scheduleActivitiesTable.id, activityId), eq(scheduleActivitiesTable.projectId, projectId)));
}

// GET /projects/:id/schedule/assignments — every assignment for the project.
router.get("/projects/:id/schedule/assignments", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(activityResourcesTable).where(eq(activityResourcesTable.projectId, id)).orderBy(activityResourcesTable.id);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load assignments" });
  }
});

// POST /projects/:id/schedule/activity/:aid/resources — assign a resource.
router.post("/projects/:id/schedule/activity/:aid/resources", async (req, res) => {
  const id = parseInt(req.params.id);
  const aid = parseInt(req.params.aid);
  if (isNaN(id) || isNaN(aid)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readAssignmentBody(req.body ?? {}, false);
    if (!Number.isFinite(values.resourceId as number) || (values.resourceId as number) <= 0) {
      res.status(400).json({ error: "resourceId required" }); return;
    }
    // First assignment on an activity becomes the driving one by default.
    const existing = await db.select().from(activityResourcesTable).where(and(eq(activityResourcesTable.projectId, id), eq(activityResourcesTable.activityId, aid)));
    if (existing.length === 0) values.isDriving = 1;
    const [{ id: insertId }] = await db
      .insert(activityResourcesTable)
      .values({ projectId: id, activityId: aid, ...(values as object) } as typeof activityResourcesTable.$inferInsert)
      .$returningId();
    await syncDrivingResource(id, aid);
    const [row] = await db.select().from(activityResourcesTable).where(eq(activityResourcesTable.id, insertId));
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to assign resource" });
  }
});

// PUT /projects/:id/schedule/activity/:aid/resources/:assignId — edit an assignment.
router.put("/projects/:id/schedule/activity/:aid/resources/:assignId", async (req, res) => {
  const id = parseInt(req.params.id);
  const aid = parseInt(req.params.aid);
  const assignId = parseInt(req.params.assignId);
  if (isNaN(id) || isNaN(aid) || isNaN(assignId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readAssignmentBody(req.body ?? {}, true);
    // Driving is exclusive per activity: promoting one demotes the rest.
    if (values.isDriving === 1) {
      await db.update(activityResourcesTable).set({ isDriving: 0 }).where(and(eq(activityResourcesTable.projectId, id), eq(activityResourcesTable.activityId, aid)));
    }
    if (Object.keys(values).length > 0) {
      await db.update(activityResourcesTable).set(values).where(and(eq(activityResourcesTable.id, assignId), eq(activityResourcesTable.activityId, aid)));
    }
    await syncDrivingResource(id, aid);
    const [row] = await db.select().from(activityResourcesTable).where(eq(activityResourcesTable.id, assignId));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

// DELETE /projects/:id/schedule/activity/:aid/resources/:assignId — unassign.
router.delete("/projects/:id/schedule/activity/:aid/resources/:assignId", async (req, res) => {
  const id = parseInt(req.params.id);
  const aid = parseInt(req.params.aid);
  const assignId = parseInt(req.params.assignId);
  if (isNaN(id) || isNaN(aid) || isNaN(assignId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(activityResourcesTable).where(and(eq(activityResourcesTable.id, assignId), eq(activityResourcesTable.activityId, aid), eq(activityResourcesTable.projectId, id)));
    await syncDrivingResource(id, aid);
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

// ── Work-programme commencement date (day-0 anchor for calendar dates) ───────
// GET /projects/:id/commencement  → { commencementDate: "YYYY-MM-DD" | null }
router.get("/projects/:id/commencement", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [project] = await db
      .select({ commencementDate: projectsTable.commencementDate })
      .from(projectsTable)
      .where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    res.json({ commencementDate: project.commencementDate ?? null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load commencement date" });
  }
});

// PUT /projects/:id/commencement  { commencementDate: "YYYY-MM-DD" | null }
router.put("/projects/:id/commencement", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const raw = req.body?.commencementDate;
  const value: string | null = raw == null || raw === "" ? null : String(raw).slice(0, 20);
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { res.status(400).json({ error: "Date must be YYYY-MM-DD" }); return; }
  try {
    await db.update(projectsTable).set({ commencementDate: value }).where(eq(projectsTable.id, id));
    res.json({ commencementDate: value });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save commencement date" });
  }
});

// Coerce a raw request body into a clean set of schedule-activity column values.
// `partial` controls whether absent keys are skipped (PUT) or defaulted (POST).
function readActivityBody(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("phase") || !partial) out.phase = b.phase ? String(b.phase).slice(0, 120) : null;
  if (has("sowRef") || !partial) out.sowRef = b.sowRef ? String(b.sowRef).slice(0, 32) : null;
  if (has("activity") || !partial) out.activity = (b.activity ? String(b.activity) : "New activity").slice(0, 500);
  if (has("parentId") || !partial) out.parentId = typeof b.parentId === "number" ? b.parentId : null;
  if (has("durationDays") || !partial) out.durationDays = Number.isFinite(Number(b.durationDays)) ? Math.max(0, Math.round(Number(b.durationDays))) : 1;
  if (has("startOffsetDays") || !partial) out.startOffsetDays = Number.isFinite(Number(b.startOffsetDays)) ? Math.max(0, Math.round(Number(b.startOffsetDays))) : 0;
  if (has("predecessor") || !partial) out.predecessor = b.predecessor ? String(b.predecessor).slice(0, 200) : null;
  // Typed dependency network (source of truth) + legacy id mirror, normalised
  // together so they never drift. Accepts `dependencies` as a JSON string or an
  // array; falls back to a legacy `predecessorIds` list (treated as FS links).
  if (has("dependencies") || has("predecessorIds") || !partial) {
    const depsRaw = b.dependencies == null
      ? null
      : (typeof b.dependencies === "string" ? b.dependencies : JSON.stringify(b.dependencies));
    const deps = parseDependencies({
      dependencies: depsRaw,
      predecessorIds: b.predecessorIds != null ? String(b.predecessorIds) : null,
    });
    out.dependencies = serializeDependencies(deps);
    out.predecessorIds = deps.length ? deps.map((d) => d.id).join(",").slice(0, 200) : null;
  }
  if (has("isMilestone") || !partial) out.isMilestone = b.isMilestone ? 1 : 0;
  // Assigned resource (P6-style). 0/null/absent → unassigned.
  if (has("resourceId") || !partial) out.resourceId = Number.isFinite(Number(b.resourceId)) && Number(b.resourceId) > 0 ? Math.round(Number(b.resourceId)) : null;
  // Progress 0–100, clamped.
  if (has("percentComplete") || !partial) out.percentComplete = Number.isFinite(Number(b.percentComplete)) ? Math.min(100, Math.max(0, Math.round(Number(b.percentComplete)))) : 0;
  if (has("notes") || !partial) out.notes = b.notes ? String(b.notes) : null;
  if (has("seq")) out.seq = Number.isFinite(Number(b.seq)) ? Math.round(Number(b.seq)) : 0;
  return out;
}

// POST /projects/:id/schedule/activity
// Create a top-level activity (parentId null) or a sub-activity (parentId set).
// A new Section is created simply by posting an activity with a new `phase`.
router.post("/projects/:id/schedule/activity", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readActivityBody(req.body ?? {}, false);
    if (values.seq === undefined) {
      const [{ maxSeq }] = await db
        .select({ maxSeq: sql<number>`COALESCE(MAX(${scheduleActivitiesTable.seq}), -1)` })
        .from(scheduleActivitiesTable)
        .where(eq(scheduleActivitiesTable.projectId, id));
      values.seq = (Number(maxSeq) || 0) + 1;
    }
    const [{ id: insertId }] = await db
      .insert(scheduleActivitiesTable)
      .values({ projectId: id, ...(values as object) } as typeof scheduleActivitiesTable.$inferInsert)
      .$returningId();
    const [row] = await db.select().from(scheduleActivitiesTable).where(eq(scheduleActivitiesTable.id, insertId));
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add activity" });
  }
});

// PUT /projects/:id/schedule/activity/:activityId — edit any activity fields.
router.put("/projects/:id/schedule/activity/:activityId", async (req, res) => {
  const id = parseInt(req.params.id);
  const activityId = parseInt(req.params.activityId);
  if (isNaN(id) || isNaN(activityId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const values = readActivityBody(req.body ?? {}, true);
    if (Object.keys(values).length > 0) {
      await db
        .update(scheduleActivitiesTable)
        .set(values)
        .where(and(eq(scheduleActivitiesTable.id, activityId), eq(scheduleActivitiesTable.projectId, id)));
    }
    const [row] = await db.select().from(scheduleActivitiesTable).where(eq(scheduleActivitiesTable.id, activityId));
    res.json(row ?? null);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update activity" });
  }
});

// DELETE /projects/:id/schedule/activity/:activityId — removes the activity AND
// any sub-activities hanging off it.
router.delete("/projects/:id/schedule/activity/:activityId", async (req, res) => {
  const id = parseInt(req.params.id);
  const activityId = parseInt(req.params.activityId);
  if (isNaN(id) || isNaN(activityId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(scheduleActivitiesTable).where(and(eq(scheduleActivitiesTable.projectId, id), eq(scheduleActivitiesTable.parentId, activityId)));
    await db.delete(scheduleActivitiesTable).where(and(eq(scheduleActivitiesTable.projectId, id), eq(scheduleActivitiesTable.id, activityId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

// POST /projects/:id/schedule/section/rename  { from, to } — rename a Section
// (phase) across all of its activities.
router.post("/projects/:id/schedule/section/rename", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const from = req.body?.from == null ? null : String(req.body.from);
  const to = String(req.body?.to ?? "").slice(0, 120);
  if (!to.trim()) { res.status(400).json({ error: "New section name required" }); return; }
  try {
    await db
      .update(scheduleActivitiesTable)
      .set({ phase: to })
      .where(and(
        eq(scheduleActivitiesTable.projectId, id),
        from == null ? sql`${scheduleActivitiesTable.phase} IS NULL` : eq(scheduleActivitiesTable.phase, from),
      ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to rename section" });
  }
});

// POST /projects/:id/schedule/section/delete  { phase } — delete a whole Section.
router.post("/projects/:id/schedule/section/delete", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const phase = req.body?.phase == null ? null : String(req.body.phase);
  try {
    await db
      .delete(scheduleActivitiesTable)
      .where(and(
        eq(scheduleActivitiesTable.projectId, id),
        phase == null ? sql`${scheduleActivitiesTable.phase} IS NULL` : eq(scheduleActivitiesTable.phase, phase),
      ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete section" });
  }
});

// POST /projects/:id/schedule/auto-link
// Infers a dependency NETWORK for an existing programme so a real critical path
// emerges, without regenerating (and without losing manual edits). For every
// activity that has no link yet and does not start at day 0, we attach a single
// Finish-to-Start predecessor: the activity whose finish is the latest one at or
// before this activity's start. The lag is set so the activity keeps its current
// date exactly (lag = thisStart − predFinish). Because links only ever point
// backwards in time the result is always acyclic. Activities that already have
// links (e.g. ones the user set by hand) are left untouched.
router.post("/projects/:id/schedule/auto-link", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const acts = await db.select().from(scheduleActivitiesTable).where(eq(scheduleActivitiesTable.projectId, id));
    const fin = (a: typeof acts[number]) => Math.max(0, a.startOffsetDays) + (a.isMilestone === 1 ? 0 : Math.max(1, a.durationDays));

    // Successor → [predecessor ids] adjacency, seeded with the EXISTING links so
    // a proposed edge is only added when it cannot close a loop. A new edge
    // a→b (a depends on b) is safe iff b cannot already reach a.
    const predIds = new Map<number, number[]>();
    for (const a of acts) predIds.set(a.id, parseDependencies(a).map((d) => d.id));
    const reaches = (from: number, target: number): boolean => {
      const stack = [from];
      const seen = new Set<number>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === target) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const p of predIds.get(cur) ?? []) stack.push(p);
      }
      return false;
    };

    let linked = 0;
    // Sequential (not parallel) so the adjacency map stays consistent as we add edges.
    for (const a of acts) {
      if ((predIds.get(a.id) ?? []).length > 0) continue;     // keep existing/manual links
      const start = Math.max(0, a.startOffsetDays);
      if (start <= 0) continue;                                // anchors at day 0
      // Pick the closest predecessor: earlier in sequence, finishing on/before
      // this start, with the latest finish (then the nearest seq).
      let best: typeof acts[number] | null = null;
      let bestFin = -1;
      for (const b of acts) {
        if (b.id === a.id || b.seq >= a.seq) continue;         // earlier-in-sequence only ⇒ acyclic core
        const bf = fin(b);
        if (bf > start) continue;
        if (!best || bf > bestFin || (bf === bestFin && b.seq > best.seq)) { best = b; bestFin = bf; }
      }
      if (!best || reaches(best.id, a.id)) continue;           // skip if it would create a cycle
      const deps = serializeDependencies([{ id: best.id, type: "FS", lag: start - bestFin }]);
      if (!deps) continue;
      await db
        .update(scheduleActivitiesTable)
        .set({ dependencies: deps, predecessorIds: String(best.id) })
        .where(eq(scheduleActivitiesTable.id, a.id));
      predIds.set(a.id, [best.id]);
      linked++;
    }
    res.json({ linked });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to auto-link schedule" });
  }
});

// POST /projects/:id/generate-schedule
// Generates the project WORK PROGRAMME (time schedule) from the SOW/project
// documents and stores it in schedule_activities. The AIGCC export then renders
// it as a dedicated "Programme" sheet (week-by-week Gantt).
//
// Streams Server-Sent Events so the UI can show progress, mirroring the
// /generate-boq-multi flow. Body: { provider, model, providerConfig }.
router.post("/projects/:id/generate-schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

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
  res.setHeader("X-Accel-Buffering", "no"); // tell nginx not to buffer the SSE stream
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // The outline + programme LLM calls are long and SILENT (~1-2 min total). With
  // no bytes on the wire, nginx's proxy_read_timeout (default 60s) drops the SSE
  // connection mid-generation and the UI hangs on "Generating...". A periodic
  // comment line keeps the connection alive (EventSource ignores ": ..." lines).
  const heartbeat = setInterval(() => { try { res.write(`: keep-alive\n\n`); } catch { /* socket gone */ } }, 15_000);

  try {
    send({ type: "schedule", stage: "loading", message: "Loading project and documents..." });
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { send({ type: "error", message: "Project not found" }); res.end(); return; }

    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    const boqItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));

    // ── Interconnect requirement: the work programme is the time dimension of
    //    the SAME scope the documents describe and the BOQ prices. Require both
    //    to be present before we generate, so the programme is always grounded.
    if (documents.length === 0) {
      send({ type: "error", message: "Upload the project documents before generating the work programme." });
      res.end(); return;
    }
    if (boqItems.length === 0) {
      send({ type: "error", message: "Generate the BOQ first — the work programme is built from the priced Bill of Quantities and project documents." });
      res.end(); return;
    }

    // ── Collect SOW/scope text from the parsed CAD chunks (same source the BOQ
    //    pipeline reads), falling back to documents.extractedText. ────────────
    let sowText = "";
    const succeededDocIds = documents.filter(d => d.cadExtractionStatus === "succeeded").map(d => d.id);
    if (succeededDocIds.length > 0) {
      const chunks = await db
        .select({
          documentId: cadChunksTable.documentId,
          chunkType: cadChunksTable.chunkType,
          text: cadChunksTable.text,
        })
        .from(cadChunksTable)
        .where(and(
          inArray(cadChunksTable.documentId, succeededDocIds),
          inArray(cadChunksTable.chunkType, ["vision_finding", "document_section", "title_block", "schedule", "text"]),
        ));
      const PRIORITY: Record<string, number> = { vision_finding: 5, document_section: 4, title_block: 3, schedule: 2, text: 1 };
      const byDoc = new Map<number, typeof chunks>();
      for (const c of chunks) { const arr = byDoc.get(c.documentId) ?? []; arr.push(c); byDoc.set(c.documentId, arr); }
      for (const doc of documents) {
        const docChunks = byDoc.get(doc.id);
        if (!docChunks || docChunks.length === 0) continue;
        const ordered = [...docChunks].sort((a, b) => (PRIORITY[b.chunkType] ?? 0) - (PRIORITY[a.chunkType] ?? 0));
        sowText += `\n\n========= ${doc.originalName} (${doc.documentType ?? "other"}) =========\n${ordered.map(c => c.text).join("\n\n")}`;
      }
    }
    if (!sowText.trim()) {
      sowText = documents.map(d => d.extractedText ?? "").filter(Boolean).join("\n\n");
    }

    const client = getAIClient(provider, providerConfig);

    send({ type: "schedule", stage: "outline", message: "Reading the SOW to build the scope outline..." });
    const outline = await extractSowOutline({ client, model, sowText, projectName: project.name });

    send({ type: "schedule", stage: "programme", message: `Generating the work programme from ${outline.sections.length} scope area(s) and ${boqItems.length} BOQ item(s)...` });
    const schedule = await generateProjectSchedule({
      client, model, projectName: project.name, projectScope: outline.projectScope, outline, sowText,
      boqItems: boqItems.map(b => ({
        category: b.category,
        description: b.description,
        unit: b.unit,
        quantity: b.quantity,
      })),
    });

    // ── Persist: wipe the previous programme, insert the new activities ───────
    await db.delete(scheduleActivitiesTable).where(eq(scheduleActivitiesTable.projectId, id));
    if (schedule.activities.length > 0) {
      await db.insert(scheduleActivitiesTable).values(
        schedule.activities.map((a, idx) => ({
          projectId: id,
          seq: idx,
          phase: a.phase,
          sowRef: a.sowRef,
          activity: a.activity.slice(0, 500),
          durationDays: a.durationDays,
          startOffsetDays: a.startOffsetDays,
          predecessor: a.predecessor ? a.predecessor.slice(0, 200) : null,
          isMilestone: a.isMilestone ? 1 : 0,
          notes: a.notes,
        })),
      );

      // ── Wire up the dependency network ──────────────────────────────────────
      // The builder expresses predecessor links by 1-based INDEX into the
      // activity list; now that the rows exist we can map those indices to the
      // real auto-increment ids and persist the typed `dependencies` JSON (plus
      // the legacy `predecessorIds` mirror) that the CPM engine reads.
      const inserted = await db
        .select({ id: scheduleActivitiesTable.id })
        .from(scheduleActivitiesTable)
        .where(eq(scheduleActivitiesTable.projectId, id))
        .orderBy(scheduleActivitiesTable.seq);
      const idByIndex = inserted.map((r) => r.id); // seq order === activity-array order
      // Build a CYCLE-SAFE edge set first: the LLM occasionally emits
      // contradictory links (e.g. A depends on B *and* B depends on A), which
      // would persist a loop and break the critical-path engine. We add a
      // proposed edge only when the predecessor cannot already reach this
      // activity, so the saved network is always acyclic. Edges are resolved in
      // activity order, building the adjacency as we go.
      const predIds = new Map<number, number[]>(); // activityId -> [predecessor ids]
      const reaches = (from: number, target: number): boolean => {
        const stack = [from];
        const seen = new Set<number>();
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === target) return true;
          if (seen.has(cur)) continue;
          seen.add(cur);
          for (const p of predIds.get(cur) ?? []) stack.push(p);
        }
        return false;
      };
      const depsByActivity = new Map<number, Dependency[]>();
      schedule.activities.forEach((a, idx) => {
        const selfId = idByIndex[idx];
        if (!a.dependsOn || a.dependsOn.length === 0) return;
        const kept: Dependency[] = [];
        for (const d of a.dependsOn) {
          const predId = idByIndex[d.on - 1];
          if (!Number.isFinite(predId) || predId === selfId) continue;        // self / out-of-range
          if (reaches(predId, selfId)) continue;                              // would close a loop ⇒ skip
          kept.push({ id: predId, type: d.type, lag: d.lag });
          predIds.set(selfId, [...(predIds.get(selfId) ?? []), predId]);
        }
        if (kept.length) depsByActivity.set(selfId, kept);
      });
      await Promise.all(
        [...depsByActivity.entries()].map(([selfId, deps]) =>
          db
            .update(scheduleActivitiesTable)
            .set({ dependencies: serializeDependencies(deps), predecessorIds: deps.map((d) => d.id).join(",") || null })
            .where(eq(scheduleActivitiesTable.id, selfId)),
        ),
      );
    }

    send({
      type: "schedule",
      stage: "complete",
      message: `Work programme ready: ${schedule.activities.length} activities over ≈ ${Math.ceil(schedule.totalDurationDays / 7)} weeks${schedule.isFallback ? " (heuristic fallback — LLM did not return structured data)" : ""}. Use "Export Programme" to download it as its own Excel file.`,
      activityCount: schedule.activities.length,
      totalDurationDays: schedule.totalDurationDays,
      isFallback: schedule.isFallback,
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate schedule" });
    else { send({ type: "error", message: err instanceof Error ? err.message : String(err) }); res.end(); }
  } finally {
    clearInterval(heartbeat);
  }
});

// PATCH /boq/:id
router.patch("/boq/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateBoqItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  try {
    const data = parsed.data;
    const updateData: Record<string, string | null> = {};

    if (data.quantity !== undefined) updateData.quantity = data.quantity.toString();
    if (data.unitPrice !== undefined) {
      updateData.unitPrice = data.unitPrice.toString();
    }
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.unit !== undefined) updateData.unit = data.unit;

    // Fields the generated UpdateBoqItemBody zod doesn't cover but the
    // human-in-the-loop review UI needs: category/itemCode edits and the
    // approval gate. Read straight from the raw body (zod strips unknown keys).
    const rawCategory = typeof req.body?.category === "string" ? req.body.category.trim() : undefined;
    if (rawCategory) updateData.category = rawCategory;
    if (typeof req.body?.itemCode === "string") {
      const c = req.body.itemCode.trim();
      updateData.itemCode = c === "" ? null : c;
    }
    const rawApproval = req.body?.approvalStatus;
    if (rawApproval === "approved" || rawApproval === "pending") {
      updateData.approvalStatus = rawApproval;
    }
    // The review UI clears the Quantity-Validator flag when a QS approves a
    // flagged line (needs_review → reviewed). Whitelisted to known states.
    const rawVerif = req.body?.verificationStatus;
    if (typeof rawVerif === "string" &&
        ["needs_review", "reviewed", "agreed", "unverified", "primary_only", "secondary_only", "discrepancy"].includes(rawVerif)) {
      updateData.verificationStatus = rawVerif;
    }

    if (data.quantity !== undefined || data.unitPrice !== undefined) {
      const [existing] = await db.select().from(boqItemsTable).where(eq(boqItemsTable.id, id));
      if (existing) {
        const qty = data.quantity ?? parseFloat(existing.quantity);
        const unitPrice = data.unitPrice ?? (existing.unitPrice ? parseFloat(existing.unitPrice) : null);
        updateData.totalPrice = unitPrice !== null ? (qty * unitPrice).toFixed(2) : null;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await db
        .update(boqItemsTable)
        .set(updateData)
        .where(eq(boqItemsTable.id, id));
    }

    const [updated] = await db.select().from(boqItemsTable).where(eq(boqItemsTable.id, id));
    if (!updated) { res.status(404).json({ error: "BOQ item not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/boq/purge-garbage
// Removes BOQ items in this project that look like they came from a
// schema-echoing small model: empty descriptions, pipe-separated unit values,
// or placeholder words. Safe to re-run; never touches real items.
router.post("/projects/:id/boq/purge-garbage", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const items = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    const PLACEHOLDERS = new Set(["string", "number", "boolean", "null", "undefined", "your domain name", "be specific and technical"]);
    const toDelete: number[] = [];
    const reasons: Record<number, string> = {};
    for (const it of items) {
      const desc = (it.description ?? "").trim();
      const unit = (it.unit ?? "").trim();
      const cat = (it.category ?? "").trim();
      let reason: string | null = null;
      if (!desc || desc.length < 5 || PLACEHOLDERS.has(desc.toLowerCase())) reason = "bad description";
      else if (!unit || unit.includes("|") || unit.length > 12 || PLACEHOLDERS.has(unit.toLowerCase())) reason = "bad unit";
      else if (!cat || PLACEHOLDERS.has(cat.toLowerCase())) reason = "bad category";
      if (reason) {
        toDelete.push(it.id);
        reasons[it.id] = reason;
      }
    }
    if (toDelete.length === 0) {
      res.json({ purged: 0, kept: items.length, message: "No garbage items found." });
      return;
    }
    // Drizzle's where(inArray()) would be cleaner; using individual deletes
    // for portability and to log per-row reasons.
    for (const dbId of toDelete) {
      await db.delete(boqItemsTable).where(eq(boqItemsTable.id, dbId));
    }
    res.json({
      purged: toDelete.length,
      kept: items.length - toDelete.length,
      reasons,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /boq/:id
router.delete("/boq/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(boqItemsTable).where(eq(boqItemsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
