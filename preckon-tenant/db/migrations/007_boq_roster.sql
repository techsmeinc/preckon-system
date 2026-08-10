-- How a bill was actually built.
--
-- The BOQ is produced by a roster the Agent Designer invents for the project —
-- a Synthetic Turf Specialist here, a Submersible Pump Specialist there — and
-- then audited against project-specific completeness checks. That roster is not
-- a proposal anyone confirms, so it is not an artifact; it is the provenance of
-- the run. Without it the pipeline is invisible and a reviewer looking at 200
-- lines has no way to judge whether the right people wrote them.
--
-- Kept on the job rather than in its own table: it belongs to exactly one run,
-- and dies with it.

-- Guarded on information_schema, like every other add here. MySQL 8 has no
-- ADD COLUMN IF NOT EXISTS, and the runner applies every migration on every
-- deploy — so a bare ALTER stops the whole deploy dead the second time it runs,
-- on a column that was already there and already correct.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_job ADD COLUMN roster JSON NULL AFTER result',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND COLUMN_NAME = 'roster'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
