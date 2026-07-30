-- Migration for the P6/PIMS-style Work Programme resource & calendar layer.
-- Idempotent: safe to re-run. Adds work calendars, resource leave, multi-resource
-- assignments, and extra cost/power/status columns on project_resources.
--
-- Run with:
--   mysql -u root boq_tender < scripts/programme-resources-migration.sql

-- ── project_resources: new attribute columns ────────────────────────────────
-- Helper pattern: add a column only when it doesn't already exist.

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'kind');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT ''labour''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'rate_basis');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN rate_basis VARCHAR(8) NOT NULL DEFAULT ''daily''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'rate');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN rate DECIMAL(14,3) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'currency');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN currency VARCHAR(8) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'power_kw');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN power_kw DECIMAL(10,3) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'capacity');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN capacity INT NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'status');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT ''active''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_resources' AND column_name = 'calendar_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE project_resources ADD COLUMN calendar_id INT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── project_calendars ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_calendars (
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
) ENGINE=InnoDB;

-- ── resource_leave ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_leave (
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
) ENGINE=InnoDB;

-- ── activity_resources (multi-resource assignment join) ──────────────────────
CREATE TABLE IF NOT EXISTS activity_resources (
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
) ENGINE=InnoDB;

-- ── Backfill: migrate the existing single resource_id into activity_resources ─
-- For any activity that has a legacy resource_id but no assignment rows yet,
-- create a driving assignment so multi-resource reads see today's data.
INSERT INTO activity_resources (project_id, activity_id, resource_id, allocation_pct, units_per_day, is_driving)
SELECT sa.project_id, sa.id, sa.resource_id, 100, 1, 1
FROM schedule_activities sa
WHERE sa.resource_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM activity_resources ar WHERE ar.activity_id = sa.id);
