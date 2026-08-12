-- 015 — PCM v1: the construction object model.
--
-- WHY THIS EXISTS
--
-- Everything the platform sells rests on one sentence: "this BOQ line came from
-- these objects, on this drawing, at this revision." Today it cannot be said.
-- A bill line is a record with the word "door" in a description field; there is
-- no door. BIM Studio holds one JSON blob per project, so its walls have no
-- identity outside that blob. The drawing editor holds lines, polylines and
-- text — geometry with no meaning attached.
--
-- These tables are the missing middle: typed construction objects with stable
-- identity, that a quantity can point AT and a drawing can be the source OF.
--
-- SCOPE — deliberately nine tables, not the sixty in the blueprint.
--
-- This is PCM v1 as the Engineering Blueprint's own first sprint defines it
-- (Appendix B): spatial tree, objects, types, relationships, ChangeSets,
-- revisions, quantities, BOQ mapping. Enough to pass the acceptance
-- demonstration, and nothing beyond it. Families, classification systems,
-- constraints, validation results and design branches are real and are NOT
-- here; they are additions to this shape rather than changes to it.
--
-- TWO DELIBERATE DIVERGENCES FROM THE BLUEPRINT, both worth knowing:
--
--  1. MySQL, not PostgreSQL/PostGIS (ADR-005). This platform is on MySQL 8 and
--     migrating the database and the domain model at the same time is how both
--     fail. Spatial queries use indexed bounding-box columns instead of PostGIS,
--     which carries a project to tens of thousands of objects — past pilot
--     scale. Revisit when spatial query time actually bites, not before.
--
--  2. Property VALUES without a property DEFINITION table. The blueprint's
--     hybrid model (§7) wants typed definitions; v1 stores a code plus typed
--     columns, which is searchable, honest about units, and upgrades to
--     definitions without touching the values.

-- ── Revisions ────────────────────────────────────────────────────────────────
-- A monotonic counter per project. Optimistic concurrency hangs off this: a
-- client sends the revision it read, and a commit against a stale one is
-- refused rather than silently overwriting somebody's work.
CREATE TABLE IF NOT EXISTS pcm_project_revision (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36) NOT NULL,
  project_id    CHAR(36) NOT NULL,
  revision      BIGINT   NOT NULL,
  change_set_id CHAR(36),
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- The unique key IS the concurrency control: two commits racing for the same
  -- revision number, one of them loses on insert rather than on a read-check
  -- that another transaction has already invalidated.
  UNIQUE KEY pcm_rev_unique (tenant_id, project_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Spatial hierarchy ────────────────────────────────────────────────────────
-- Project → Site → Building → Level → Zone → Space. Not hard-coded to
-- buildings: an industrial job uses plants, yards and process areas, and the
-- blueprint is explicit that the tree must not assume otherwise.
CREATE TABLE IF NOT EXISTS pcm_spatial_node (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  project_id   CHAR(36) NOT NULL,
  parent_id    CHAR(36),
  node_type    ENUM('PROJECT','SITE','FACILITY','BUILDING','LEVEL','ZONE','SPACE','AREA','EXTERNAL_AREA','CUSTOM') NOT NULL,
  code         VARCHAR(100),
  name         VARCHAR(255) NOT NULL,
  elevation_mm DECIMAL(14,3),
  sort_order   INT NOT NULL DEFAULT 0,
  metadata     JSON,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY pcm_node_tree_idx (tenant_id, project_id, parent_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Object types ─────────────────────────────────────────────────────────────
-- Data-driven, so a new discipline is a row rather than a migration. Seeded by
-- the pack; a tenant may add its own.
CREATE TABLE IF NOT EXISTS pcm_object_type (
  id                 CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36),                       -- NULL = system type
  code               VARCHAR(100) NOT NULL,          -- WALL, DOOR, COLUMN…
  name               VARCHAR(255) NOT NULL,
  discipline         ENUM('ARCHITECTURE','STRUCTURE','MECHANICAL','ELECTRICAL','PLUMBING','CIVIL','FIRE','LANDSCAPE','GENERAL','CUSTOM') NOT NULL,
  geometry_behavior  ENUM('LINEAR','AREA','POINT','HOSTED','SPATIAL') NOT NULL,
  -- How this type is measured. The measurement engine reads it; nothing else
  -- decides how a wall becomes square metres.
  measurement_rules  JSON,
  ifc_entity         VARCHAR(100),                   -- IfcWall, IfcDoor… for later export
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY pcm_type_code (tenant_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Objects ──────────────────────────────────────────────────────────────────
-- The thing the whole platform was missing. A wall here is not geometry; it is
-- an identity that a quantity, a BOQ line, a PO and an inspection can all point
-- at, for as long as the project exists.
CREATE TABLE IF NOT EXISTS pcm_object (
  id                CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36) NOT NULL,
  project_id        CHAR(36) NOT NULL,
  object_type_code  VARCHAR(100) NOT NULL,
  name              VARCHAR(255),
  mark              VARCHAR(100),                    -- W-1034, D104 — the drawing's own label
  spatial_node_id   CHAR(36),
  -- Canonical SEMANTIC geometry (blueprint §9.1): a baseline and a thickness,
  -- not a mesh. Compact, editable, and the thing measurements are computed
  -- from. Display meshes are derived and never stored here.
  geometry          JSON,
  -- Denormalised bounds, indexed. This is the PostGIS substitute: enough for
  -- "what is in this view" and "what is near this" without a spatial extension.
  min_x DECIMAL(16,4), min_y DECIMAL(16,4), max_x DECIMAL(16,4), max_y DECIMAL(16,4),
  lifecycle_state   ENUM('PROPOSED','DESIGNED','COORDINATED','ISSUED','APPROVED','PROCURED','INSTALLED','INSPECTED','HANDED_OVER','DEMOLISHED','VOID') NOT NULL DEFAULT 'DESIGNED',
  -- How this object came to exist, and how sure we are. An object recognised
  -- from a PDF at 0.62 confidence must never be indistinguishable from one an
  -- engineer drew.
  source_method     ENUM('MANUAL','IMPORT','AI','RULE','INTEGRATION') NOT NULL DEFAULT 'MANUAL',
  source_confidence DECIMAL(5,4),
  -- What it was recognised FROM: the file, and the region on it. This is the
  -- evidence behind "why is this wall here".
  source_file_id    CHAR(36),
  source_region     JSON,
  revision          BIGINT NOT NULL DEFAULT 1,
  deleted_at        DATETIME(3),                     -- soft: an audited model never hard-deletes
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by        CHAR(36),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY pcm_obj_scope_idx (tenant_id, project_id, object_type_code, deleted_at),
  KEY pcm_obj_spatial_idx (tenant_id, project_id, spatial_node_id),
  KEY pcm_obj_bbox_idx (tenant_id, project_id, min_x, min_y),
  KEY pcm_obj_source_idx (tenant_id, source_file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Properties ───────────────────────────────────────────────────────────────
-- Typed columns rather than one JSON bag, so "every wall with a fire rating
-- under 120" is a query rather than a scan-and-parse.
CREATE TABLE IF NOT EXISTS pcm_property_value (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36) NOT NULL,
  entity_id     CHAR(36) NOT NULL,
  code          VARCHAR(150) NOT NULL,               -- fireRatingMin, acousticRatingStc…
  value_string  TEXT,
  value_decimal DECIMAL(20,6),
  value_boolean TINYINT(1),
  unit          VARCHAR(50),
  source_method ENUM('MANUAL','IMPORT','AI','RULE','INTEGRATION') NOT NULL DEFAULT 'MANUAL',
  confidence    DECIMAL(5,4),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY pcm_prop_unique (tenant_id, entity_id, code),
  KEY pcm_prop_lookup_idx (tenant_id, code, value_decimal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Relationships ────────────────────────────────────────────────────────────
-- The typed edges that make the lifecycle traversable:
--   Door HOSTED_BY Wall · Wall MEASURED_BY Quantity · Quantity CONTRIBUTES_TO_BOQ
-- Kept out of pcm_object on purpose — a wall does not own its relationships,
-- and forcing them into columns is what stops the graph growing.
CREATE TABLE IF NOT EXISTS pcm_relationship (
  id                CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36) NOT NULL,
  project_id        CHAR(36) NOT NULL,
  source_entity_id  CHAR(36) NOT NULL,
  relationship_type VARCHAR(60) NOT NULL,            -- HOSTED_BY, CONTAINS, REPRESENTED_IN…
  target_entity_id  CHAR(36) NOT NULL,
  source_method     ENUM('MANUAL','IMPORT','AI','RULE','INTEGRATION') NOT NULL DEFAULT 'MANUAL',
  confidence        DECIMAL(5,4),
  metadata          JSON,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Both directions are queried constantly — "what does this host" and "what
  -- hosts this" — so both get an index.
  KEY pcm_rel_out_idx (tenant_id, source_entity_id, relationship_type),
  KEY pcm_rel_in_idx  (tenant_id, target_entity_id, relationship_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ChangeSets ───────────────────────────────────────────────────────────────
-- Every authoritative mutation goes through one. This is what makes ADR-003
-- enforceable rather than aspirational: an AI produces a DRAFT that a human
-- previews and commits, and the model has no other door in.
CREATE TABLE IF NOT EXISTS pcm_change_set (
  id                    CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id             CHAR(36) NOT NULL,
  project_id            CHAR(36) NOT NULL,
  change_type           ENUM('USER_EDIT','AI_EDIT','IMPORT','INTEGRATION','RULE','MERGE','REVISION') NOT NULL,
  status                ENUM('DRAFT','VALIDATING','AWAITING_APPROVAL','APPROVED','COMMITTED','REJECTED','FAILED') NOT NULL DEFAULT 'DRAFT',
  title                 VARCHAR(255) NOT NULL,
  description           TEXT,
  requested_by          CHAR(36),
  approved_by           CHAR(36),
  base_project_revision BIGINT NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  committed_at          DATETIME(3),
  KEY pcm_cs_scope_idx (tenant_id, project_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pcm_change_operation (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36) NOT NULL,
  change_set_id CHAR(36) NOT NULL,
  sequence      INT NOT NULL,
  operation     ENUM('CREATE','UPDATE','DELETE','RELATE','UNRELATE','TRANSFORM','RETYPE') NOT NULL,
  entity_type   VARCHAR(60) NOT NULL,
  entity_id     CHAR(36) NOT NULL,
  -- The before/after that make undo an inverse ChangeSet rather than a deletion
  -- of history, and that let the preview show a real diff instead of a summary.
  before_state  JSON,
  after_state   JSON,
  KEY pcm_op_set_idx (tenant_id, change_set_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Quantities ───────────────────────────────────────────────────────────────
-- Derived, never authored. A quantity records which rule produced it, from
-- which object, at which project revision — so a stale one can be recognised
-- as stale instead of quietly presented as current.
CREATE TABLE IF NOT EXISTS pcm_quantity (
  id                    CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id             CHAR(36) NOT NULL,
  project_id            CHAR(36) NOT NULL,
  entity_id             CHAR(36) NOT NULL,           -- the object measured
  rule_code             VARCHAR(100) NOT NULL,       -- NET_WALL_AREA:v1
  quantity_value        DECIMAL(20,6) NOT NULL,
  unit                  VARCHAR(20) NOT NULL,
  status                ENUM('CURRENT','DIRTY','SUPERSEDED','ERROR') NOT NULL DEFAULT 'CURRENT',
  source_project_revision BIGINT NOT NULL,
  -- The arithmetic, kept. "386.42 m²" is not an answer to "why"; the working
  -- out is, and it is what an estimator argues with.
  calculation           JSON,
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY pcm_qty_unique (tenant_id, entity_id, rule_code),
  KEY pcm_qty_status_idx (tenant_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── BOQ mapping ──────────────────────────────────────────────────────────────
-- The join the platform has been missing: which objects, through which
-- quantities, make up this bill line. Mapping is a record with its own source
-- and approval state, because an AI may propose one and only a QS may bless it.
CREATE TABLE IF NOT EXISTS pcm_boq_map (
  id                CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36) NOT NULL,
  project_id        CHAR(36) NOT NULL,
  boq_artifact_id   CHAR(36) NOT NULL,               -- the existing boq_line artifact
  entity_id         CHAR(36),
  quantity_id       CHAR(36),
  allocation_factor DECIMAL(10,6) NOT NULL DEFAULT 1,
  mapping_source    ENUM('MANUAL','RULE','AI','IMPORT') NOT NULL DEFAULT 'RULE',
  confidence        DECIMAL(5,4),
  status            ENUM('PROPOSED','APPROVED','REJECTED') NOT NULL DEFAULT 'PROPOSED',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY pcm_map_boq_idx (tenant_id, boq_artifact_id, status),
  KEY pcm_map_entity_idx (tenant_id, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
