"use server";

import { requireUser } from "@/auth/session";
import { bimModelMeta, type BimMeta, loadBimModel, saveBimModel } from "@/domain/bim-store";
import { canAccessProject } from "@/domain/access";
import { type ChatMessage, listMessages, postMessage } from "@/domain/chat";

async function assertAccess(projectId: string) {
  const user = await requireUser();
  if (!(await canAccessProject(user, projectId))) throw new Error("You don't have access to this project.");
  return user;
}

/** Save the project's shared BIM model (any assigned member). */
export async function saveBimModelAction(projectId: string, doc: unknown): Promise<{ savedAtMs: number }> {
  const user = await assertAccess(projectId);
  const savedAtMs = await saveBimModel(user.orgId, projectId, doc, { id: user.id, name: user.name });
  return { savedAtMs };
}

/** Load the project's shared BIM model + who last changed it. */
export async function loadBimModelAction(projectId: string): Promise<{ doc: unknown | null; meta: BimMeta | null }> {
  const user = await assertAccess(projectId);
  const res = await loadBimModel(user.orgId, projectId);
  return res ? { doc: res.doc, meta: res.meta } : { doc: null, meta: null };
}

/** Cheap poll: has the model changed and by whom? */
export async function bimMetaAction(projectId: string): Promise<BimMeta | null> {
  const user = await assertAccess(projectId);
  return bimModelMeta(user.orgId, projectId);
}

/** Post a chat message (with @-mentioned user ids); returns the stored message. */
export async function postChatAction(projectId: string, body: string, mentions: string[]): Promise<ChatMessage | null> {
  const user = await assertAccess(projectId);
  return postMessage(user.orgId, projectId, { id: user.id, name: user.name, role: user.role }, body, mentions);
}

/** Fetch the project chat (polled by the client). */
export async function chatAction(projectId: string): Promise<ChatMessage[]> {
  const user = await assertAccess(projectId);
  return listMessages(user.orgId, projectId);
}
