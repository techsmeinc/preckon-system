-- 016 — coordinates and units, and AI proposals that a human commits.
--
-- Two unrelated-looking problems with the same root: something changing the
-- model without saying what it did.
--
-- ── UNITS ────────────────────────────────────────────────────────────────────
--
-- PCM v1 assumes metres. That is true of BIM Studio and it is NOT true of your
-- drawings: the CAD sidecar reads $INSUNITS, and most issued sheets are in
-- millimetres. A 5,100 mm wall imported without a transform becomes a 5,100 m
-- wall, and every test in the repo passes while it happens — the arithmetic is
-- right, the input was wrong by a factor of a thousand.
--
-- The blueprint is explicit (§11): "Every imported model must receive a
-- transform into PCM project coordinates. Never silently modify imported
-- coordinates without retaining the original transform."
--
-- So the transform is a record. What the source said its units were, what was
-- applied, and by whom — recoverable later when somebody asks why a wall is
-- the length it is.
--
-- ── PROPOSALS ────────────────────────────────────────────────────────────────
--
-- The BIM assistant wrote its result directly into bim_document. That is the
-- pattern both blueprints forbid in as many words: "Never let an LLM directly
-- mutate production model state." The user saw the model change and had undo,
-- which is not the same as having agreed to it.
--
-- A proposal is the model the assistant WOULD write, held to one side until a
-- human looks at it and says yes.

-- Canonical coordinate/unit setting per project. One row; PCM works in metres,
-- and this records that decision rather than leaving it implicit in the code.
CREATE TABLE IF NOT EXISTS pcm_coordinate_system (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36) NOT NULL,
  project_id    CHAR(36) NOT NULL,
  name          VARCHAR(120) NOT NULL DEFAULT 'Project local',
  -- The unit every stored coordinate is in. Metres, and stated so that a future
  -- change is a migration rather than an assumption somebody has to discover.
  linear_unit   VARCHAR(20) NOT NULL DEFAULT 'm',
  -- Where project (0,0) sits on the site, when that is known. Null until a
  -- survey point is given; never guessed.
  origin_east   DECIMAL(18,6),
  origin_north  DECIMAL(18,6),
  rotation_deg  DECIMAL(10,6) NOT NULL DEFAULT 0,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY pcm_crs_project (tenant_id, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- How one source file was brought into project coordinates. Kept per import, so
-- "this wall is 5.1 m because the DXF said 5100 and declared millimetres" is a
-- question with an answer.
CREATE TABLE IF NOT EXISTS pcm_source_transform (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36) NOT NULL,
  project_id     CHAR(36) NOT NULL,
  source_kind    ENUM('BIM_STUDIO','DXF','DWG','PDF','IFC','MANUAL','OTHER') NOT NULL,
  source_file_id CHAR(36),
  -- What the file said about itself. NULL means it said nothing, which is a
  -- fact worth keeping: an assumed unit and a declared one carry very different
  -- confidence and should not look alike afterwards.
  declared_unit  VARCHAR(20),
  -- What was actually applied, and why. `scale_to_m` multiplied every
  -- coordinate; `basis` says whether that came from the file, a project
  -- default, or a human overriding both.
  scale_to_m     DECIMAL(20,10) NOT NULL DEFAULT 1,
  basis          ENUM('DECLARED','INFERRED','PROJECT_DEFAULT','USER_OVERRIDE') NOT NULL DEFAULT 'DECLARED',
  offset_x       DECIMAL(18,6) NOT NULL DEFAULT 0,
  offset_y       DECIMAL(18,6) NOT NULL DEFAULT 0,
  rotation_deg   DECIMAL(10,6) NOT NULL DEFAULT 0,
  note           VARCHAR(500),
  created_by     CHAR(36),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY pcm_xform_src_idx (tenant_id, project_id, source_file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- What the assistant would do, before it does it.
--
-- Held server-side rather than round-tripped through the browser so that the
-- thing committed is provably the thing the model produced and the human read —
-- not whatever the page happened to post back.
CREATE TABLE IF NOT EXISTS bim_proposal (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  project_id   CHAR(36) NOT NULL,
  -- The version this was drafted against. Committing onto a model that has
  -- moved is refused rather than silently overwriting somebody else's work.
  base_version INT NOT NULL,
  instruction  VARCHAR(2000) NOT NULL,
  specialist   VARCHAR(40),
  -- The whole proposed document. A patch would be smaller and would also mean
  -- reconstructing state to show a preview; the document is a few hundred KB
  -- and this is the copy a human actually approved.
  doc          JSON NOT NULL,
  -- What changed, in the terms the reader thinks in: 4 walls added, 1 door
  -- moved. Computed once at proposal time.
  diff         JSON NOT NULL,
  reply        TEXT,
  status       ENUM('PROPOSED','APPLIED','DISCARDED','EXPIRED') NOT NULL DEFAULT 'PROPOSED',
  created_by   CHAR(36),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at   DATETIME(3),
  KEY bim_prop_scope_idx (tenant_id, project_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
