-- 009 — render state on cad_extraction.
--
-- The rendered sheet was computed exactly once, at upload, and any failure was
-- swallowed: renderCad() returned null and the row kept svg = NULL forever. The
-- Drawings stage then said "this drawing measured cleanly but could not be
-- rendered" with no reason, no retry and no way back — the only remedy was to
-- delete the file and upload it again, which is not a remedy an estimator will
-- discover.
--
-- Two columns fix that. `render_error` keeps WHY the render failed so the screen
-- can say it (a missing xref and a drawing too dense to draw are different
-- problems with different answers). `rendered_at` distinguishes "never tried"
-- from "tried and failed", which is what makes an on-demand retry safe to offer:
-- NULL means the viewer should attempt it, a timestamp means it already did.
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS, and every migration is re-run on
-- every deploy, so each add is guarded on information_schema.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cad_extraction ADD COLUMN render_error VARCHAR(1000) NULL AFTER svg',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cad_extraction' AND COLUMN_NAME = 'render_error'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cad_extraction ADD COLUMN rendered_at DATETIME(3) NULL AFTER render_error',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cad_extraction' AND COLUMN_NAME = 'rendered_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rows that already carry an SVG were rendered successfully at upload; stamping
-- them stops the viewer from re-rendering a sheet it can already draw.
UPDATE cad_extraction SET rendered_at = created_at WHERE svg IS NOT NULL AND rendered_at IS NULL;
