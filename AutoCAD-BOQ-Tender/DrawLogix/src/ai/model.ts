/**
 * Central model config for DrawLogix's Claude agents. One place to bump the model so
 * the architect copilot, the DXF-edit copilot and the document-understanding pass all
 * move together.
 *
 * Default: Opus 4.8 — the current top-tier Claude model, best for architectural
 * reasoning + multi-step tool use. Override per-deployment with DRAWLOGIX_MODEL.
 */
export const MODEL = process.env.DRAWLOGIX_MODEL?.trim() || "claude-opus-4-8";
