import { z } from "zod";
import { serviceRoute, ok } from "@/lib/http";
import { bootstrapTenant } from "@/lib/provisioning";

// §1.5 POST /internal/tenants/{tenantId}/bootstrap — the Host provisions a
// tenant's IAM here (service auth, idempotent by tenant_id). Creates the owner in
// the SEPARATE tenant identity pool (a customer email, not a Host staff email),
// seeds roles + settings, and caches the entitlement snapshot.
const Body = z.object({
  tenant_name: z.string().min(1),
  owner: z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().optional() }),
  edition_ref: z.string().optional(),
  licensed_modules: z.array(z.string()).optional(),
  max_tier: z.enum(["routing", "standard", "deep"]).optional(),
  features: z.record(z.boolean()).optional(),
  domain_key: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export const POST = serviceRoute<{ tenantId: string }>(async (req, { tenantId }) => {
  const b = Body.parse(await req.json());
  const result = await bootstrapTenant({
    tenantId,
    tenantName: b.tenant_name,
    ownerEmail: b.owner.email,
    ownerName: b.owner.name,
    ownerPassword: b.owner.password,
    editionRef: b.edition_ref,
    licensedModules: b.licensed_modules,
    maxTier: b.max_tier,
    features: b.features,
    domainKey: b.domain_key,
    source: "host_provision",
    idempotencyKey: b.idempotency_key,
  });
  return ok(result, result.alreadyBootstrapped ? 200 : 201);
});
