import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { isManager, type Role } from "./roles";

/**
 * DrawLogix authentication (server-only). Email + password login, an HMAC-signed httpOnly
 * session cookie, and password hashing. Pure role helpers live in ./roles (client-safe).
 * No public sign-up — a Coordinator/Admin creates accounts.
 */

export { DIVISION_ROLES, isManager, type Role, ROLE_LABELS, ROLES, roleLabel } from "./roles";

const SESSION_COOKIE = "dl_session";
const secret = () => process.env.DRAWLOGIX_SESSION_SECRET || "drawlogix-dev-secret-change-me";

// ── Password hashing (scrypt; salt:hash hex) ─────────────────────────────────
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored ?? "").split(":");
  if (!salt || !hash) return false;
  const calc = scryptSync(pw, salt, 64);
  const want = Buffer.from(hash, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}

// ── Signed session token (userId.HMAC) ───────────────────────────────────────
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");
const makeToken = (userId: string) => `${userId}.${sign(userId)}`;
function readToken(tok: string): string | null {
  const i = tok.lastIndexOf(".");
  if (i < 0) return null;
  const id = tok.slice(0, i);
  const sig = tok.slice(i + 1);
  return sign(id) === sig ? id : null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
}

/** Current logged-in user (verifies the signed cookie + loads from DB), or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const tok = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  const id = readToken(tok);
  if (!id) return null;
  const u = (await db.select().from(schema.dlUsers).where(and(eq(schema.dlUsers.id, id), isNull(schema.dlUsers.archivedAt))).limit(1))[0];
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, orgId: u.orgId };
}

/** Require a logged-in user (for server actions). */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Not signed in.");
  return u;
}
export async function requireManager(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isManager(u.role)) throw new Error("Only a Coordinator or Admin can do that.");
  return u;
}

export async function setSession(userId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, makeToken(userId), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
}
export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
