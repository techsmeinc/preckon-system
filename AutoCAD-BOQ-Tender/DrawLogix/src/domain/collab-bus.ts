import { EventEmitter } from "node:events";
import type { ChatMessage } from "./chat";

/**
 * In-process collaboration bus for live (Server-Sent Events) delivery. One Node process
 * serves the whole app, so an EventEmitter is enough — server actions publish, the SSE
 * route subscribes, and every connected teammate gets chat + model changes instantly.
 * (Behind a proxy, SSE needs buffering OFF — the route sets `X-Accel-Buffering: no`.)
 * If DrawLogix is ever scaled to multiple processes, swap this for Redis pub/sub.
 */

export type CollabEvent =
  | { type: "chat"; message: ChatMessage }
  | { type: "model"; meta: { updatedAtMs: number; updatedByName: string | null; updatedById: string | null } };

// Survive dev HMR / duplicate module instances by pinning to globalThis.
const g = globalThis as unknown as { __dlCollabBus?: EventEmitter };
const bus = (g.__dlCollabBus ??= new EventEmitter());
bus.setMaxListeners(0); // many concurrent SSE subscribers

const channel = (orgId: string, projectId: string) => `p:${orgId}:${projectId}`;

export function publishCollab(orgId: string, projectId: string, ev: CollabEvent): void {
  bus.emit(channel(orgId, projectId), ev);
}

export function subscribeCollab(orgId: string, projectId: string, cb: (ev: CollabEvent) => void): () => void {
  const c = channel(orgId, projectId);
  bus.on(c, cb);
  return () => bus.off(c, cb);
}
