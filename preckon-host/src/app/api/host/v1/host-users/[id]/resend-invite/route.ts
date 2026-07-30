import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { email } from "@/lib/integrations";

type Params = { params: Promise<{ id: string }> };

// POST /host-users/{id}/resend-invite — re-send the invite email. Audited. (§1.4)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.manage");
  const { id } = await params;

  const user = await queryOne<{ id: string; email: string; display_name: string; status: string }>(
    "SELECT id, email, display_name, status FROM host_user WHERE id = ?",
    [id]
  );
  if (!user) throw errNotFound("Host user");

  await email.send({
    to: user.email,
    subject: "Your Preckon Host invitation",
    body: `Hi ${user.display_name}, here is your invitation to the Preckon Host console. Set your password to activate your account.`,
  });

  await useCase(ctx, async (_conn, audit) => {
    audit({
      action: "host_user.resend_invite",
      targetType: "host_user",
      targetId: id,
      summary: `Re-sent invite to ${user.display_name} (${user.email})`,
      metadata: { email: user.email, status: user.status },
    });
  });

  return ok({ resent: true, email: user.email });
});
