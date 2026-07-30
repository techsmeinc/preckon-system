// §1.2 — The Core permission catalog (18 keys, first-party, fixed). Seeded into
// tenant_permission. Packs may ADD keys (construction adds `bid.approve`) but
// never diverge these.
export interface CorePermission {
  key: string;
  domain: string;
  description: string;
}

export const CORE_PERMISSIONS: CorePermission[] = [
  { key: "project.create", domain: "project", description: "create projects" },
  { key: "project.read", domain: "project", description: "read projects the user is a member of" },
  { key: "project.read_all", domain: "project", description: "read every project in the tenant" },
  { key: "project.update", domain: "project", description: "edit project metadata" },
  { key: "project.archive", domain: "project", description: "archive/restore projects" },
  { key: "project.member.manage", domain: "project", description: "add/remove project members" },
  { key: "artifact.read", domain: "artifact", description: "read artifacts + review queue" },
  { key: "artifact.confirm", domain: "artifact", description: "confirm/reject proposals" },
  { key: "artifact.edit", domain: "artifact", description: "edit artifacts (new version)" },
  { key: "workflow.read", domain: "workflow", description: "view workflows, runs, agents" },
  { key: "workflow.run", domain: "workflow", description: "start / cancel / re-run workflows" },
  { key: "library.read", domain: "library", description: "read reference data" },
  { key: "library.manage", domain: "library", description: "edit rate books, standards, precedent" },
  { key: "admin.users", domain: "admin", description: "manage users, invites, role assignments" },
  { key: "admin.branding", domain: "admin", description: "white-label (logo, brand colour)" },
  { key: "admin.settings", domain: "admin", description: "tenant settings (incl. auto-accept threshold)" },
  { key: "billing.view", domain: "billing", description: "view plan & usage (read-only from Host)" },
  { key: "tenant.transfer_ownership", domain: "tenant", description: "transfer the Owner role" },
];

/** All Core permission keys, for expanding role wildcards like `project.*`. */
export const ALL_CORE_KEYS = CORE_PERMISSIONS.map((p) => p.key);
