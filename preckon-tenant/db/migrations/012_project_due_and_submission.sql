-- 012 — the two things a project carries that no agent produces.
--
-- A submission DATE, because the deadline the tender document happens to state
-- is not always the one the team is working to: an addendum moves it, a client
-- grants an extension, and until now the only date the list could show came
-- from whatever TenderLogix read out of the tender. There was no way to say
-- "actually, it is the 14th".
--
-- And the submission REGISTER: the covering letter, the bonds, the insurances,
-- the signed form of tender. None of that is derived from the drawings or the
-- bill — it is chased, collected and ticked off — so it belongs on the project
-- rather than in the artifact chain, where every record has to be produced by
-- something.
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS and every migration re-runs on
-- deploy, so each add is guarded on information_schema.

SET @db := DATABASE();

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE project ADD COLUMN due_date DATE NULL AFTER ref_no',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'project' AND COLUMN_NAME = 'due_date');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The register as JSON rather than a table: it is a checklist owned by one
-- project, always read whole, and never joined against. A table would buy
-- nothing and cost a migration every time the standard list changes.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE project ADD COLUMN submission JSON NULL AFTER due_date',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'project' AND COLUMN_NAME = 'submission');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
