import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { errBadRequest } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { validateAuthoredTool } from "@/lib/bim/authoring";
import { deleteAuthoredTool, listAuthoredTools, parseDef, saveAuthoredTool } from "@/lib/bim/authored-store";
import { buildRegistry } from "@/lib/bim/setup";

// Authoring mode: the tools a user writes for themselves.
//
// GET    — the built-in catalogue plus this user's own tools, so the UI can
//          show what a new tool is allowed to call.
// POST   — save one. Validated against the SAME function the runtime uses, so
//          nothing can be stored that would later fail to compile.
// DELETE — remove one of your own.
//
// A definition is DATA: steps naming built-in tools, with {{...}} templates
// substituted as plain values. Nothing here is evaluated, which is what makes
// user-authored automations safe to run server-side at all. See
// db/migrations/017 for the longer argument.

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const authored = await listAuthoredTools(ctx.tenantId, ctx.user.id);
  const { registry, skipped } = buildRegistry(authored);

  return ok({
    // Grouped the way the authoring UI presents them.
    tools: registry.all(ctx.user.id).map((t) => ({
      name: t.name, label: t.label, module: t.module, scope: t.scope,
      kind: t.kind, description: t.description, params: t.params,
    })),
    modules: registry.modules(ctx.user.id),
    authored: authored.map((a) => ({ id: a.id, name: a.name, label: a.label, module: a.module, description: a.description, steps: a.steps, params: a.params, updatedAt: a.updatedAt })),
    // Tools that no longer compile — shown rather than silently missing, so the
    // author can tell why the assistant stopped finding one.
    skipped,
  });
});

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  // Authoring a tool is authoring an edit — it needs the permission an edit needs.
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const def = parseDef(await req.json(), ctx.user.id);

  // Validated against a registry built WITHOUT this tool's previous version, so
  // an edit is checked as if it were new and cannot come to depend on itself.
  const others = (await listAuthoredTools(ctx.tenantId, ctx.user.id)).filter((t) => t.name !== def.name);
  const { registry } = buildRegistry(others);
  const errors = validateAuthoredTool(def, registry);
  if (errors.length) throw errBadRequest(errors.join("; "));

  const id = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const saved = await saveAuthoredTool({ tenantId: ctx.tenantId, userId: ctx.user.id, def });
    audit({
      action: "bim.tool.saved",
      targetKind: "bim_authored_tool",
      targetId: saved,
      projectId: pid,
      summary: { name: def.name, label: def.label, steps: def.steps.length, calls: def.steps.map((s) => s.tool) },
    });
    return saved;
  });

  return ok({ id, name: def.name });
});

export const DELETE = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw errBadRequest("id is required.");

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await deleteAuthoredTool(ctx.tenantId, ctx.user.id, id);
    audit({ action: "bim.tool.deleted", targetKind: "bim_authored_tool", targetId: id, projectId: pid, summary: {} });
  });

  return ok({ deleted: true });
});
