-- Multi-agent BOQ result cache: fingerprint column on projects.
-- Idempotent (MariaDB 10.5 supports ADD COLUMN IF NOT EXISTS).
--   mysql -u root boq_tender < scripts/boq-cache-migration.sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_fingerprint VARCHAR(64) NULL;
