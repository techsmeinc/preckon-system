/** Pure role definitions — safe to import from client OR server code. */

export const ROLES = ["admin", "coordinator", "architectural", "structural", "civil", "electrical", "mechanical", "plumbing", "fire"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  coordinator: "Project Coordinator",
  architectural: "Architect",
  structural: "Structural Engineer",
  civil: "Civil / Site Engineer",
  electrical: "Electrical Engineer",
  mechanical: "HVAC / Mechanical Engineer",
  plumbing: "Plumbing Engineer",
  fire: "Fire Protection Engineer",
};

/** Just the construction-division roles (excludes admin/coordinator). */
export const DIVISION_ROLES: Role[] = ROLES.filter((r) => r !== "admin" && r !== "coordinator");

export const isManager = (role: string): boolean => role === "admin" || role === "coordinator";
export const roleLabel = (role: string): string => ROLE_LABELS[role as Role] ?? role;
