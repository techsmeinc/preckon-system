import { describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { emitArtifact, getArtifact, readArtifacts } from "@/lib/store";

// RLS-equivalent: MySQL has no Row-Level Security, so tenant isolation is enforced
// in the app repository layer — every scoped read carries `AND tenant_id = ?`. This
// asserts a cross-tenant read returns nothing (the §X.4 "fails closed" property,
// implemented app-side).
const TENANT_A = "00000000-0000-7000-8000-000000000001"; // seeded demo tenant
const TENANT_B = "00000000-0000-7000-8000-0000000000bb"; // a foreign tenant

describe("tenancy isolation (app-layer, MySQL has no RLS)", () => {
  it("a cross-tenant read returns zero rows", async () => {
    // Create a project + artifact under tenant A.
    const projectId = newId();
    await query(
      "INSERT INTO project (id, tenant_id, name, status, created_by) VALUES (?,?,?, 'active', NULL)",
      [projectId, TENANT_A, "Isolation Test"]
    );
    const emitted = await emitArtifact({
      tenantId: TENANT_A,
      projectId,
      typeKey: "boq_line",
      payload: { code: "X1", description: "isolation probe", quantity: 1, unit: "nr" },
      source: "human",
      createdBy: null,
    });

    // Tenant A sees it.
    const asA = await getArtifact(TENANT_A, emitted.id);
    expect(asA).not.toBeNull();

    // Tenant B does NOT — the tenant_id predicate excludes it.
    const asB = await getArtifact(TENANT_B, emitted.id);
    expect(asB).toBeNull();

    // And a typed read scoped to B's (nonexistent) project returns nothing.
    const readB = await readArtifacts({
      tenantId: TENANT_B,
      projectId,
      typeKey: "boq_line",
      status: "confirmed",
    });
    expect(readB.length).toBe(0);
  });
});
