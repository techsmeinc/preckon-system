-- 011 — the fields a tender submission needs on its cover.
--
-- The exported bill and programme carry a header block: reference number,
-- project number, location, who it is submitted to. Three of those had nowhere
-- to live, so the exports rendered them blank and an estimator had to fill them
-- in Excel after every download — which means the next download loses them
-- again.
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS and every migration re-runs on deploy,
-- so each add is guarded on information_schema.

SET @db := DATABASE();

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE project ADD COLUMN location VARCHAR(255) NULL AFTER client_name',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'project' AND COLUMN_NAME = 'location');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE project ADD COLUMN submitted_to VARCHAR(255) NULL AFTER location',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'project' AND COLUMN_NAME = 'submitted_to');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The quotation reference as it is printed on the submission. Free text rather
-- than generated: every contractor numbers quotations their own way, and a
-- reference the office cannot recognise is worse than none.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE project ADD COLUMN ref_no VARCHAR(64) NULL AFTER submitted_to',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'project' AND COLUMN_NAME = 'ref_no');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
