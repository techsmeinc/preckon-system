// Migration runner for the P6/PIMS Work Programme calendar + resource layer.
//
// Idempotent: checks information_schema first, only runs the missing DDL. Mirrors
// scripts/apply-cad-migration.mjs (drizzle-kit push is broken on this MariaDB).
//
// Usage:
//   node scripts/apply-programme-resources-migration.mjs
// Honours DATABASE_URL; defaults to the local MySQL used by tools/dev.mjs.

import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";
const conn = await mysql.createConnection({ uri: url, multipleStatements: false });
console.log(`connected to ${url.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@")}`);

async function columnExists(table, column) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column],
  );
  return rows[0].n > 0;
}
async function tableExists(name) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name],
  );
  return rows[0].n > 0;
}
async function addColumn(table, column, ddl) {
  if (await columnExists(table, column)) { console.log(`  · ${table}.${column} (present)`); return; }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`  ✓ ${table}.${column}`);
}
async function createTable(name, ddl) {
  if (await tableExists(name)) { console.log(`  · ${name} (present)`); return; }
  await conn.query(ddl);
  console.log(`  ✓ ${name}`);
}

// ── project_resources: new P6 attribute columns ──
await addColumn("project_resources", "kind", "kind VARCHAR(16) NOT NULL DEFAULT 'labour'");
await addColumn("project_resources", "rate_basis", "rate_basis VARCHAR(8) NOT NULL DEFAULT 'daily'");
await addColumn("project_resources", "rate", "rate DECIMAL(14,3) NULL");
await addColumn("project_resources", "currency", "currency VARCHAR(8) NULL");
await addColumn("project_resources", "power_kw", "power_kw DECIMAL(10,3) NULL");
await addColumn("project_resources", "capacity", "capacity INT NOT NULL DEFAULT 1");
await addColumn("project_resources", "status", "status VARCHAR(16) NOT NULL DEFAULT 'active'");
await addColumn("project_resources", "calendar_id", "calendar_id INT NULL");

// ── project_calendars ──
await createTable("project_calendars", `CREATE TABLE project_calendars (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT 'Project Calendar',
  is_default INT NOT NULL DEFAULT 0,
  weekend_days TEXT NULL,
  hours_per_day DECIMAL(5,2) NOT NULL DEFAULT 8,
  holidays TEXT NULL,
  preset VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY project_calendars_project_id_idx (project_id),
  CONSTRAINT project_calendars_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB`);

// ── resource_leave ──
await createTable("resource_leave", `CREATE TABLE resource_leave (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NOT NULL,
  resource_id INT NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'vacation',
  from_date VARCHAR(20) NOT NULL,
  to_date VARCHAR(20) NOT NULL,
  note VARCHAR(200) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY resource_leave_project_id_idx (project_id),
  KEY resource_leave_resource_id_idx (resource_id),
  CONSTRAINT resource_leave_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT resource_leave_resource_id_project_resources_id_fk
    FOREIGN KEY (resource_id) REFERENCES project_resources(id) ON DELETE CASCADE
) ENGINE=InnoDB`);

// ── activity_resources (multi-resource assignment join) ──
await createTable("activity_resources", `CREATE TABLE activity_resources (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NOT NULL,
  activity_id INT NOT NULL,
  resource_id INT NOT NULL,
  allocation_pct INT NOT NULL DEFAULT 100,
  units_per_day DECIMAL(8,2) NOT NULL DEFAULT 1,
  is_driving INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY activity_resources_project_id_idx (project_id),
  KEY activity_resources_activity_id_idx (activity_id),
  KEY activity_resources_resource_id_idx (resource_id),
  CONSTRAINT activity_resources_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT activity_resources_activity_id_schedule_activities_id_fk
    FOREIGN KEY (activity_id) REFERENCES schedule_activities(id) ON DELETE CASCADE,
  CONSTRAINT activity_resources_resource_id_project_resources_id_fk
    FOREIGN KEY (resource_id) REFERENCES project_resources(id) ON DELETE CASCADE
) ENGINE=InnoDB`);

// ── Backfill existing single resource_id into activity_resources ──
const [bf] = await conn.query(`INSERT INTO activity_resources (project_id, activity_id, resource_id, allocation_pct, units_per_day, is_driving)
  SELECT sa.project_id, sa.id, sa.resource_id, 100, 1, 1
  FROM schedule_activities sa
  WHERE sa.resource_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM activity_resources ar WHERE ar.activity_id = sa.id)`);
console.log(`  ✓ backfilled ${bf.affectedRows} assignment(s) from schedule_activities.resource_id`);

await conn.end();
console.log("\nMigration complete.");
