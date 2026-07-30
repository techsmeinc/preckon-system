import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";

// GET/PUT /settings — the workspace's own settings row (§5.3 tenant_setting).
//
// `extra` carries the white-label theme (§7): the tenant's display name and
// brand accent, which the shell injects as the --brand CSS variable. The design
// calls this `tenant_theme` and provisions it from the Host; storing it here
// keeps it tenant-scoped and audited while the Host seam catches up.

interface Theme {
  workspaceName?: string;
  brandColor?: string;
  /** Workspace default UI language; each user may override it for themselves. */
  locale?: "en" | "ar" | "fr";
}

function readTheme(extra: any): Theme {
  const t = extra && typeof extra === "object" ? extra.theme : null;
  return t && typeof t === "object" ? t : {};
}

export const GET = route(async (_req, ctx) => {
  const row = await queryOne<{ auto_accept_threshold: string; default_tier: string; extra: any }>(
    "SELECT auto_accept_threshold, default_tier, extra FROM tenant_setting WHERE tenant_id = ?",
    [ctx.tenantId]
  );
  const theme = readTheme(row?.extra);
  return ok({
    workspaceName: theme.workspaceName ?? null,
    brandColor: theme.brandColor ?? null,
    locale: theme.locale ?? null,
    autoAcceptThreshold: row ? Number(row.auto_accept_threshold) : null,
    defaultTier: row?.default_tier ?? null,
  });
});

const Edit = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
  // #rrggbb only — this value is written straight into a CSS custom property.
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  locale: z.enum(["en", "ar", "fr"]).optional(),
});

export const PUT = route(async (req, ctx) => {
  requirePermission(ctx, "admin.settings");
  const edits = Edit.parse(await req.json());

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const row = await queryOne<{ extra: any }>("SELECT extra FROM tenant_setting WHERE tenant_id = ?", [ctx.tenantId]);
    const extra = row?.extra && typeof row.extra === "object" ? row.extra : {};
    const theme: Theme = { ...readTheme(extra), ...edits };
    const next = JSON.stringify({ ...extra, theme });

    if (row) {
      await query("UPDATE tenant_setting SET extra = ?, updated_at = NOW(3) WHERE tenant_id = ?", [next, ctx.tenantId]);
    } else {
      await query(
        "INSERT INTO tenant_setting (tenant_id, auto_accept_threshold, type_thresholds, default_tier, extra) VALUES (?, 0.900, '{}', 'deep', ?)",
        [ctx.tenantId, next]
      );
    }
    audit({ action: "tenant.theme.update", targetKind: "tenant", targetId: ctx.tenantId, summary: edits });
  });

  const row = await queryOne<{ extra: any }>("SELECT extra FROM tenant_setting WHERE tenant_id = ?", [ctx.tenantId]);
  const theme = readTheme(row?.extra);
  return ok({ workspaceName: theme.workspaceName ?? null, brandColor: theme.brandColor ?? null, locale: theme.locale ?? null });
});
