-- 013 — the reader's view of a drawing, kept beside the parser's.
--
-- `cad_extraction.summary` is everything the parser saw: every text annotation
-- on the sheet, every row of everything it read as a table, per-layer geometry,
-- per-block attribute samples. On a dense plan that is megabytes of JSON, and
-- it is the right thing to keep — an agent asked to justify a quantity needs
-- all of it.
--
-- The Drawings panel needs almost none of it. It shows units, a footprint, a
-- title block, the top layers, the top blocks, a capped set of schedules and a
-- capped set of notes: a few kilobytes. But it was deriving those few kilobytes
-- on every single sheet open, which meant MySQL shipping the whole summary
-- across the connection and Node JSON.parse-ing it, twice a second while
-- somebody paged through a thirteen-sheet set.
--
-- So the derivation is done once and kept. `view_json` is a cache, not a source
-- of truth: it is computed from `summary`, it can be dropped at any time, and
-- the route rebuilds it on the next read. Nothing is ever answered from it that
-- could not be recomputed from the summary beside it.
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS and every migration is re-run on
-- every deploy, so the add is guarded on information_schema.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cad_extraction ADD COLUMN view_json JSON NULL AFTER summary',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cad_extraction' AND COLUMN_NAME = 'view_json'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- `view_version` is what makes the cache safe to change. When the panel starts
-- showing something the cached view does not carry, this number goes up in the
-- code and every stored view is rebuilt on next read — without it, a deploy
-- would keep serving yesterday's shape forever.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cad_extraction ADD COLUMN view_version SMALLINT NOT NULL DEFAULT 0 AFTER view_json',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cad_extraction' AND COLUMN_NAME = 'view_version'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
