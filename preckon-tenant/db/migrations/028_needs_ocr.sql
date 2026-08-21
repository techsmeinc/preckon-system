-- A file that was stored but could not be read.
--
-- The upload route records a PDF as 'ingested' whatever came out of it. A
-- scanned drawing set extracts to nothing and is recorded as ingested anyway:
-- the file appears in the register, every agent downstream reads an empty
-- document, and whatever it contained is simply absent from the bill, the risk
-- register and the compliance check. Nothing errors at any point.
--
-- The CAD branch of the same function already guards against this and says why:
-- "the chain must not treat an unreadable file as understood — that is how a
-- BOQ ends up quietly missing a discipline." A scan takes the other branch.
--
-- ── WHY NOT JUST 'failed' ────────────────────────────────────────────────────
--
-- 'failed' already exists and would stop the lie. But the two states have
-- different remedies, and that difference is the whole value of the record:
--
--   failed     we could not parse this file. Send a different one.
--   needs_ocr  we parsed it fine. It is a photograph of paper, and running OCR
--              over it would produce something readable.
--
-- Collapsing them means a scanned set looks like a corrupt upload, somebody
-- re-uploads the same file, and it fails identically. The remedy is knowable
-- from the diagnosis only if the diagnosis is kept.

SET @col := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'file' AND COLUMN_NAME = 'status');

-- Guarded so the migration stays re-runnable, like every other ALTER here.
SET @ddl := IF(@col IS NOT NULL AND LOCATE('needs_ocr', @col) = 0,
  'ALTER TABLE file MODIFY COLUMN status ENUM(''pending'',''uploaded'',''ingesting'',''ingested'',''failed'',''needs_ocr'') NOT NULL DEFAULT ''pending''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- file_page.method needs no change: it is already VARCHAR(16) and will simply
-- carry 'ocr' alongside the existing 'native' and 'cad'. Noted here rather than
-- left implicit, because that column is what tells retrieval and prompt
-- assembly a figure was RECOGNISED rather than read — at drawing type sizes an
-- engine confuses 3 with 8 routinely, and a quantity taken from an OCR'd
-- dimension string is not the same evidence as one taken from a text layer.
