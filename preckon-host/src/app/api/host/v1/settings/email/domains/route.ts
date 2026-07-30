import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errConflict } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

const Body = z.object({
  domain: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "must be a valid domain"),
});

/** Generate sample DNS records the operator must publish to verify the domain. */
function dnsRecordsFor(domain: string) {
  const selector = "preckon";
  return [
    {
      type: "TXT",
      host: domain,
      name: "SPF",
      value: "v=spf1 include:_spf.preckon.com ~all",
    },
    {
      type: "CNAME",
      host: `${selector}._domainkey.${domain}`,
      name: "DKIM",
      value: `${selector}.dkim.preckon.com`,
    },
    {
      type: "CNAME",
      host: `mail.${domain}`,
      name: "Return-Path",
      value: "bounces.preckon.com",
    },
  ];
}

// POST /settings/email/domains — add a domain to verify → returns DNS records (§9.5)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.write");
  const body = Body.parse(await req.json());
  const domain = body.domain.toLowerCase();

  const dup = await queryOne("SELECT id FROM email_domain WHERE domain = ?", [domain]);
  if (dup) throw errConflict("That domain is already registered", { domain });

  const records = dnsRecordsFor(domain);

  const created = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO email_domain (id, domain, status, dns_records)
       VALUES (?,?, 'pending', ?)`,
      [id, domain, JSON.stringify(records)]
    );
    audit({
      action: "email.domain.add",
      targetType: "email_domain",
      targetId: id,
      summary: `Added email domain ${domain} for verification`,
      metadata: { domain },
    });
    return { id, domain, status: "pending", dns_records: records };
  });

  return ok(created, 201);
});
