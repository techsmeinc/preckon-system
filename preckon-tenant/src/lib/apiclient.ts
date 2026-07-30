"use client";

// Typed browser client for the tenant API (/api/v1). Routes return the resource
// directly (arrays/objects); errors come back as the §X.2 envelope
// { error: { code, message, details } }.

const BASE = "/api/v1";

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: any) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? {};
    // Session expired → return to login instead of showing an error everywhere.
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiClientError(e.code ?? "error", e.message ?? `Request failed (${res.status})`, res.status, e.details);
  }
  return json as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>("GET", path),
  post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T = any>(path: string) => request<T>("DELETE", path),
  // multipart upload (files)
  upload: async <T = any>(path: string, file: File): Promise<T> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", body: fd });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new ApiClientError(e.code ?? "error", e.message ?? "Upload failed", res.status, e.details);
    }
    return json as T;
  },
};
