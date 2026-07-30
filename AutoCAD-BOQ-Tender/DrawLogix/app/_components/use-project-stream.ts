"use client";

import { useEffect, useRef } from "react";

/**
 * Subscribe to a project's live collaboration stream (SSE): chat messages + model
 * changes, pushed instantly. Auto-reconnects with a small backoff. `EventSource` isn't
 * basePath-aware, so we prefix the app's basePath manually.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/drawlogix";

type ModelMeta = { updatedAtMs: number; updatedByName: string | null; updatedById: string | null };
type ChatMsg = { id: string; userId: string | null; userName: string; userRole: string | null; body: string; mentions: string[]; at: number };

interface Handlers {
  onChat?: (m: ChatMsg) => void;
  onModel?: (meta: ModelMeta) => void;
  onStatus?: (s: "open" | "closed") => void;
}

export function useProjectStream(projectId: string | undefined, handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!projectId) return;
    let closed = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`${BASE_PATH}/api/chat/${encodeURIComponent(projectId)}`);
      es.addEventListener("open", () => ref.current.onStatus?.("open"));
      es.addEventListener("chat", (e) => {
        try {
          ref.current.onChat?.(JSON.parse((e as MessageEvent).data).message);
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener("model", (e) => {
        try {
          ref.current.onModel?.(JSON.parse((e as MessageEvent).data).meta);
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener("error", () => {
        ref.current.onStatus?.("closed");
        es?.close();
        if (!closed) {
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 3000);
        }
      });
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [projectId]);
}
