// Logs in, GETs every read endpoint, and writes a compact shape report to
// docs/api-shapes.md — ground truth for wiring the console screens.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const email = process.env.OWNER_EMAIL ?? "admin@techsme.com";
const password = process.env.OWNER_PASSWORD ?? "preckon-admin-2026";
const SVC = process.env.INTERNAL_SERVICE_TOKEN ?? "dev-internal-service-token";
const T1 = "10000000-0000-4000-8000-000000000001"; // Cedar

async function login() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")])
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("no session cookie — is the dev server running & owner seeded?");
  return cookie;
}

// Recursive shape: objects → {key: type}, arrays → [shape of first item] (len).
function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [`len=${v.length}`, shape(v[0], depth + 1)] : "[]";
  if (typeof v === "object") {
    if (depth > 4) return "{…}";
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return typeof v;
}

const endpoints = [
  ["GET", "/api/host/v1/me"],
  ["GET", "/api/host/v1/tenants?limit=2"],
  ["GET", `/api/host/v1/tenants/${T1}`],
  ["GET", `/api/host/v1/tenants/${T1}/entitlements`],
  ["GET", `/api/host/v1/tenants/${T1}/entitlement-overrides`],
  ["GET", `/api/host/v1/tenants/${T1}/subscription`],
  ["GET", `/api/host/v1/tenants/${T1}/usage`],
  ["GET", `/api/host/v1/tenants/${T1}/theme`],
  ["GET", `/api/host/v1/tenants/${T1}/impersonation-sessions`],
  ["GET", "/api/host/v1/subscriptions?limit=2"],
  ["GET", "/api/host/v1/invoices?limit=2"],
  ["GET", "/api/host/v1/billing/summary"],
  ["GET", "/api/host/v1/editions"],
  ["GET", "/api/host/v1/editions/matrix"],
  ["GET", "/api/host/v1/features?limit=3"],
  ["GET", "/api/host/v1/pricing"],
  ["GET", "/api/host/v1/currencies"],
  ["GET", "/api/host/v1/usage-rates"],
  ["GET", "/api/host/v1/coupons"],
  ["GET", "/api/host/v1/host-users?limit=3"],
  ["GET", "/api/host/v1/roles"],
  ["GET", "/api/host/v1/permissions"],
  ["GET", "/api/host/v1/audit-events?limit=3"],
  ["GET", "/api/host/v1/audit-events/verify"],
  ["GET", "/api/host/v1/notifications?limit=3"],
  ["GET", "/api/host/v1/notifications/audience-preview?audience_type=all_tenants&filter=%7B%7D"],
  ["GET", "/api/host/v1/host-notifications"],
  ["GET", "/api/host/v1/host-notifications/unread-count"],
  ["GET", "/api/host/v1/settings"],
  ["GET", "/api/host/v1/settings/ai/providers"],
  ["GET", "/api/host/v1/settings/ai/routing"],
  ["GET", "/api/host/v1/settings/email"],
  ["GET", "/api/host/v1/observability/queues"],
  ["GET", "/api/host/v1/observability/throughput?window=1h"],
  ["GET", "/api/host/v1/observability/ai-health"],
  ["GET", "/api/host/v1/observability/failed-jobs?limit=3"],
  ["SVC", `/api/host/v1/internal/entitlements/${T1}`],
];

const cookie = await login();
let md = `# Preckon Host — live API response shapes\n\nCaptured from the running server. Use as the ground-truth contract when wiring console screens.\n\n`;
for (const [kind, path] of endpoints) {
  const headers = kind === "SVC" ? { authorization: `Bearer ${SVC}` } : { Cookie: cookie };
  try {
    const res = await fetch(BASE + path, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
    md += `## ${path}\n\`\`\`json\n${JSON.stringify({ status: res.status, shape: shape(body) }, null, 2)}\n\`\`\`\n\n`;
    console.log(res.status, path);
  } catch (e) {
    md += `## ${path}\n\`\`\`\nERROR ${e.message}\n\`\`\`\n\n`;
    console.log("ERR", path, e.message);
  }
}
writeFileSync(join(root, "docs", "api-shapes.md"), md);
console.log("\n→ wrote docs/api-shapes.md");
