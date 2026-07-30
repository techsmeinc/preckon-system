import { Router } from "express";
import { db } from "@workspace/db";
import { companyProfileTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const PROFILE_ID = 1;

const EMPTY_PROFILE = {
  id: PROFILE_ID,
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  phone: "",
  email: "",
  website: "",
  refPrefix: "QO",
  currencyCode: "KWD",
  notes: null as string | null,
  updatedAt: new Date(),
};

async function loadOrCreate() {
  const [existing] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, PROFILE_ID));
  if (existing) return existing;
  await db.insert(companyProfileTable).values({ id: PROFILE_ID }).onDuplicateKeyUpdate({ set: { id: PROFILE_ID } });
  const [row] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, PROFILE_ID));
  return row ?? EMPTY_PROFILE;
}

// GET /company-profile
router.get("/company-profile", async (req, res) => {
  try {
    const row = await loadOrCreate();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /company-profile
router.put("/company-profile", async (req, res) => {
  const body = req.body ?? {};
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v.trim() : fallback;

  const values = {
    companyName: str(body.companyName),
    addressLine1: str(body.addressLine1),
    addressLine2: str(body.addressLine2),
    phone: str(body.phone),
    email: str(body.email),
    website: str(body.website),
    refPrefix: str(body.refPrefix, "QO") || "QO",
    currencyCode: str(body.currencyCode, "KWD") || "KWD",
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    updatedAt: new Date(),
  };

  try {
    await loadOrCreate();
    await db.update(companyProfileTable).set(values).where(eq(companyProfileTable.id, PROFILE_ID));
    const [row] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, PROFILE_ID));
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
