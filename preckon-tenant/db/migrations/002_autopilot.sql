-- Migration 002 — per-project autopilot flag. When 1, the pursuit orchestrator
-- runs every licensed workflow in dependency order and auto-accepts all agent
-- proposals (no manual gate confirmation), advancing the lifecycle automatically.
-- Idempotent guard via information_schema so re-running is safe.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'autopilot');
SET @ddl := IF(@col = 0,
  'ALTER TABLE project ADD COLUMN autopilot TINYINT NOT NULL DEFAULT 0 AFTER lifecycle_state_at',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
