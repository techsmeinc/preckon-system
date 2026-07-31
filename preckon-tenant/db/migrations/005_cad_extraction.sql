-- CAD extraction — what the sidecar read out of a .dxf/.dwg upload.
--
-- Deliberately NOT an artifact. An artifact is a proposal a human confirms;
-- this is a deterministic parse of a file the human already uploaded, and
-- re-parsing the same bytes gives the same answer. There is nothing to review.
-- What DOES become an artifact is a quantity an agent derives FROM this, which
-- is a judgement and carries a confidence.
--
-- One row per file. `summary` holds the extractor's JSON verbatim: layers with
-- measured geometry, block instance counts, dimensions, title-block fields and
-- detected schedules. `units` is lifted out because every downstream metric
-- conversion needs it and digging it out of JSON on every read is wasteful.

CREATE TABLE IF NOT EXISTS cad_extraction (
  file_id     CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  project_id  CHAR(36)    NOT NULL,
  units       VARCHAR(16),
  -- Denormalised counts so the Documents list can show "12 layers · 148 blocks"
  -- without parsing the whole summary for every row.
  layer_count INT         NOT NULL DEFAULT 0,
  block_count INT         NOT NULL DEFAULT 0,
  sheet_count INT         NOT NULL DEFAULT 0,
  summary     JSON        NOT NULL,
  -- Non-fatal problems the parse hit (recovered errors, missing ODA converter
  -- on a DWG, unresolved xrefs). Shown to the estimator, not swallowed.
  warnings    JSON,
  svg         LONGTEXT,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY cad_scope_idx (tenant_id, project_id),
  CONSTRAINT fk_cad_file FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
) ENGINE=InnoDB;
