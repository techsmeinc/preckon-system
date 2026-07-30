import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// POST /settings/email/domains/{id}/verify — mock DNS check → verified (§9.5)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.write");
  const { id } = await params;

  const domain = await queryOne<{ id: string; domain: string; status: string }>(
    "SELECT id, domain, status FROM email_domain WHERE id = ?",
    [id]
  );
  if (!domain) throw errNotFound("Email domain");

  const updated = await useCase(ctx, async (conn, audit) => {
    // Mock DNS check — in prod this resolves the published SPF/DKIM records.
    await conn.query(
      "UPDATE email_domain SET status='verified', verified_at=NOW() WHERE id=?",
      [id]
    );
    audit({
      action: "email.domain.verify",
      targetType: "email_domain",
      targetId: id,
      summary: `Verified email domain ${domain.domain}`,
      metadata: { domain: domain.domain },
    });
    return queryOne("SELECT * FROM email_domain WHERE id = ?", [id]);
  });

  return ok(updated);
});
