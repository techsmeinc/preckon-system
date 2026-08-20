-- QuantLogix: measurement rules as data.
--
-- Measurement logic lived in code, which meant Preckon measured one way and the
-- contract measured another. Two quantity surveyors measuring the same wall get
-- different numbers and both are right, because they are working to different
-- rules: NRM2 does not deduct openings below a threshold, CESMM says something
-- else, and a client's preambles override both.
--
-- Rule sets are versioned rather than edited. A quantity measured last month was
-- measured under the rules as they stood last month, and a set that could be
-- edited in place would make every historic quantity unexplainable — the working
-- would cite a rule that no longer says what it said.

CREATE TABLE IF NOT EXISTS measurement_rule_set (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  -- NULL project_id = a tenant-wide library set, available to every project.
  project_id    CHAR(36)     NULL,
  `key`         VARCHAR(64)  NOT NULL,
  name          VARCHAR(200) NOT NULL,
  -- The standard being worked to: NRM2, POMI, CESMM4, or a project's own.
  standard      VARCHAR(64)  NOT NULL,
  version       INT          NOT NULL DEFAULT 1,
  status        ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  is_default    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rule_set_version (tenant_id, `key`, version),
  KEY idx_rule_set_project (tenant_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS measurement_rule (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  rule_set_id   CHAR(36)     NOT NULL,
  -- Order is part of the rule set, not a display preference: deducting
  -- openings before or after a waste factor gives different answers, and which
  -- is correct is a property of the standard.
  seq           INT          NOT NULL DEFAULT 0,
  `key`         VARCHAR(64)  NOT NULL,
  kind          ENUM('deduct_openings','minimum_quantity','round','waste_factor',
                     'convert_unit','threshold_exclude') NOT NULL,
  label         VARCHAR(200) NOT NULL,
  -- The clause. A rule with no reference cannot be cited in a measurement
  -- dispute, which is most of what these are for.
  reference     VARCHAR(120) NULL,
  threshold     DECIMAL(18,4) NULL,
  value         DECIMAL(18,4) NULL,
  applies_to    JSON          NULL,
  UNIQUE KEY uq_rule_key (rule_set_id, `key`),
  KEY idx_rule_seq (rule_set_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The quantity records which rule set produced it, so its working stays
-- explainable after the project moves to a later version of the rules.
-- Guarded on information_schema so the migration stays re-runnable, which is
-- what lets scripts/migrate.sh apply everything on every deploy without
-- bookkeeping.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pcm_quantity' AND COLUMN_NAME = 'rule_set_id');
SET @ddl := IF(@col = 0,
  'ALTER TABLE pcm_quantity ADD COLUMN rule_set_id CHAR(36) NULL AFTER status',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
