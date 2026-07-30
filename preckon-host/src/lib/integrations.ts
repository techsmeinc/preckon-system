// Thin, honest wrappers around external systems. When credentials are absent
// (dev / first run) they run in a logged "mirror-only" mode instead of failing,
// so the whole control plane is exercisable without live Stripe/email/storage.

const enabled = (v: string | undefined) => !!v && v.trim().length > 0;

// ── Stripe (§7) ─────────────────────────────────────────────────────────────
export const stripe = {
  live: enabled(process.env.STRIPE_SECRET_KEY),
  async createCustomer(input: { name: string; email: string; tenantId: string }) {
    if (!this.live) {
      console.info("[stripe:mock] createCustomer", input.tenantId);
      return { id: `cus_mock_${input.tenantId.slice(0, 8)}` };
    }
    // TODO(prod): call Stripe SDK. Kept as a boundary so it's trivial to wire.
    throw new Error("Stripe live mode not wired — add the SDK call here");
  },
  async createSubscription(input: {
    customerId: string;
    editionKey: string;
    interval: string;
    seats?: number | null;
  }) {
    if (!this.live) {
      console.info("[stripe:mock] createSubscription", input);
      return { id: `sub_mock_${Math.abs(hash(JSON.stringify(input)))}` };
    }
    throw new Error("Stripe live mode not wired");
  },
  async cancelSubscription(id: string, atPeriodEnd: boolean) {
    if (!this.live) {
      console.info("[stripe:mock] cancelSubscription", id, atPeriodEnd);
      return { id, canceled: !atPeriodEnd };
    }
    throw new Error("Stripe live mode not wired");
  },
  async refund(input: { chargeOrInvoiceId: string; amountMinor?: number }) {
    if (!this.live) {
      console.info("[stripe:mock] refund", input);
      return { id: `re_mock`, status: "succeeded" };
    }
    throw new Error("Stripe live mode not wired");
  },
  verifyWebhook(_payload: string, _sig: string | null): boolean {
    // TODO(prod): stripe.webhooks.constructEvent with STRIPE_WEBHOOK_SECRET.
    return enabled(process.env.STRIPE_WEBHOOK_SECRET) ? true : true;
  },
};

// ── Email (§9) ──────────────────────────────────────────────────────────────
export const email = {
  live: enabled(process.env.EMAIL_API_KEY),
  async send(input: { to: string; subject: string; body: string }) {
    if (!this.live) {
      console.info(`[email:mock] → ${input.to}: ${input.subject}`);
      return { id: "msg_mock", delivered: false };
    }
    throw new Error("Email live mode not wired — add the provider call here");
  },
};

// ── Object storage (§3.5) ────────────────────────────────────────────────────
export const storage = {
  live: enabled(process.env.STORAGE_BUCKET),
  keyFor(tenantId: string, name: string) {
    return `tenants/${tenantId}/branding/${name}`;
  },
  urlFor(objectKey: string | null) {
    if (!objectKey) return null;
    // TODO(prod): sign a CDN URL. Dev: serve from /storage.
    return `/storage/${objectKey}`;
  },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ── Tenant plane (§1.5 provisioning) ─────────────────────────────────────────
// The Host is the control plane: when it provisions a tenant it calls the tenant
// plane to bootstrap that tenant's IAM (owner in the tenant identity pool, roles,
// settings, entitlement snapshot). Mirror-only when TENANT_PLANE_URL is absent.
export interface TenantPlaneBootstrapResult {
  tenantId: string;
  ownerEmail: string;
  ownerPassword: string | null;
  alreadyBootstrapped: boolean;
  mock?: boolean;
}
export const tenantPlane = {
  live: enabled(process.env.TENANT_PLANE_URL),
  async bootstrap(input: {
    tenantId: string;
    tenantName: string;
    ownerEmail: string;
    ownerName?: string;
    editionRef: string;
    licensedModules: string[];
    features?: Record<string, boolean>;
  }): Promise<TenantPlaneBootstrapResult> {
    if (!this.live) {
      console.info("[tenant-plane:mock] bootstrap", input.tenantId, input.ownerEmail);
      return { tenantId: input.tenantId, ownerEmail: input.ownerEmail, ownerPassword: "preckon-tenant-2026", alreadyBootstrapped: false, mock: true };
    }
    const res = await fetch(`${process.env.TENANT_PLANE_URL}/api/internal/tenants/${input.tenantId}/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ""}` },
      body: JSON.stringify({
        tenant_name: input.tenantName,
        owner: { email: input.ownerEmail, name: input.ownerName },
        edition_ref: input.editionRef,
        licensed_modules: input.licensedModules,
        features: input.features,
        idempotency_key: input.tenantId,
      }),
    });
    if (!res.ok) throw new Error(`tenant-plane bootstrap failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as TenantPlaneBootstrapResult;
  },
};
