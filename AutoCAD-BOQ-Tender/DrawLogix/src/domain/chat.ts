import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { publishCollab } from "./collab-bus";

/** Live per-project team chat with @-mentions. Polled by the client for a live feel. */

export interface ChatMessage {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string | null;
  body: string;
  mentions: string[];
  at: number;
}

export async function postMessage(
  orgId: string,
  projectId: string,
  user: { id: string; name: string; role: string },
  body: string,
  mentions: string[],
): Promise<ChatMessage | null> {
  const b = (body ?? "").trim().slice(0, 2000);
  if (!b) return null;
  const id = randomUUID();
  const clean = [...new Set(mentions.filter(Boolean))].slice(0, 20);
  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.projectChat).values({ id, orgId, projectId, userId: user.id, userName: user.name, userRole: user.role, body: b, mentions: clean });
  });
  const msg: ChatMessage = { id, userId: user.id, userName: user.name, userRole: user.role, body: b, mentions: clean, at: Date.now() };
  publishCollab(orgId, projectId, { type: "chat", message: msg }); // live fan-out to connected teammates
  return msg;
}

export async function listMessages(orgId: string, projectId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(schema.projectChat)
    .where(and(eq(schema.projectChat.orgId, orgId), eq(schema.projectChat.projectId, projectId), isNull(schema.projectChat.archivedAt)))
    .orderBy(asc(schema.projectChat.createdAt))
    .limit(300);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    userRole: r.userRole,
    body: r.body,
    mentions: (r.mentions as string[] | null) ?? [],
    at: r.createdAt?.getTime() ?? 0,
  }));
}
