-- ============================================================================
-- Preckon Tenant Plane — Preckon Core + Construction pack schema (MySQL 8)
-- ----------------------------------------------------------------------------
-- Translated from the PostgreSQL design (preckon-tenant-platform-design v1.2).
-- Import via phpMyAdmin (Import tab) or:  mysql -u root -p < db/schema.sql
--
-- Load-bearing translations from the Postgres spec:
--   • UUIDv7 PKs           -> CHAR(36), app-generated (uuidv7())
--   • jsonb                -> JSON
--   • timestamptz (UTC)    -> DATETIME(3), app writes/reads UTC
--   • native enums         -> MySQL ENUM (closed sets)
--   • numeric(4,3)         -> DECIMAL(4,3)
--   • vector(1024)         -> JSON  (MySQL has no pgvector; retrieval is a
--                             text-match stand-in, semantic search deferred)
--   • Row-Level Security   -> NOT AVAILABLE in MySQL. Tenant isolation is
--                             enforced in the app repository layer (lib/tenancy.ts):
--                             every scoped query carries `AND tenant_id = ?`.
--                             This is the one deliberate divergence the phpMyAdmin/
--                             MySQL choice forces; see README "Tenancy".
--   • plpgsql audit chain  -> stored procedure append_audit_event (per-tenant)
--   • recursive stale walk -> WITH RECURSIVE issued from the app (MySQL 8)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `preckon_tenant`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `preckon_tenant`;

-- ============================================================================
-- Better Auth tables (tenant identity pool). §1.1
-- Better Auth owns credentials/sessions; app_user layers the tenant profile.
-- ============================================================================

CREATE TABLE `user` (
  id            VARCHAR(255) NOT NULL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(320) NOT NULL UNIQUE,
  emailVerified BOOLEAN      NOT NULL DEFAULT FALSE,
  image         TEXT,
  createdAt     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE `session` (
  id        VARCHAR(255) NOT NULL PRIMARY KEY,
  expiresAt DATETIME(3)  NOT NULL,
  token     VARCHAR(255) NOT NULL UNIQUE,
  ipAddress VARCHAR(45),
  userAgent TEXT,
  userId    VARCHAR(255) NOT NULL,
  createdAt DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY session_user_idx (userId),
  CONSTRAINT fk_session_user FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `account` (
  id                    VARCHAR(255) NOT NULL PRIMARY KEY,
  accountId             VARCHAR(255) NOT NULL,
  providerId            VARCHAR(255) NOT NULL,
  userId                VARCHAR(255) NOT NULL,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  DATETIME(3),
  refreshTokenExpiresAt DATETIME(3),
  scope                 TEXT,
  password              TEXT,
  createdAt             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY account_user_idx (userId),
  CONSTRAINT fk_account_user FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `verification` (
  id         VARCHAR(255) NOT NULL PRIMARY KEY,
  identifier VARCHAR(320) NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  DATETIME(3) NOT NULL,
  createdAt  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY verification_identifier_idx (identifier)
) ENGINE=InnoDB;

-- ============================================================================
-- §D — Domain pack catalog (first-party, compiled-in; registered so runtime,
-- bootstrap and Host can read them). §D.2
-- ============================================================================

CREATE TABLE domain (
  `key`           VARCHAR(64) NOT NULL PRIMARY KEY,   -- 'construction' or a tenant domain key
  name            VARCHAR(128) NOT NULL,
  version         VARCHAR(32)  NOT NULL,
  manifest        JSON         NOT NULL,
  enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
  owner_tenant_id CHAR(36)     NULL,               -- NULL = first-party; else tenant-owned
  is_template     TINYINT      NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- A tenant's own configured domain (its "assistant"), cloned from a template and
-- editable. One per tenant; pack_json is the single source of truth we re-project.
CREATE TABLE tenant_domain (
  tenant_id    CHAR(36)     NOT NULL PRIMARY KEY,
  domain_key   VARCHAR(64)  NOT NULL,
  name         VARCHAR(128) NOT NULL,
  industry     VARCHAR(128),
  template_key VARCHAR(64),
  pack_json    JSON         NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY tenant_domain_key_idx (domain_key)
) ENGINE=InnoDB;

-- ============================================================================
-- §2.1 — Artifact type registry (platform-level shared vocabulary)
-- ============================================================================

CREATE TABLE artifact_type (
  `key`          VARCHAR(96)  NOT NULL PRIMARY KEY,   -- 'construction.boq_line'
  name           VARCHAR(128) NOT NULL,
  payload_schema JSON         NOT NULL,
  is_reviewable  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §3.1 — Agent registry (first-party; runtime & Host read model)
-- ============================================================================

CREATE TABLE agent (
  `key`           VARCHAR(96) NOT NULL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  kind            ENUM('worker','service','supervisor') NOT NULL,
  consumes        JSON NOT NULL,                  -- artifact_type keys read
  produces        JSON NOT NULL,                  -- artifact_type keys emitted
  job_types       JSON NOT NULL,                  -- AI job definitions it enqueues
  permission_keys JSON NOT NULL,
  entitlement_key VARCHAR(96),
  version         INT  NOT NULL DEFAULT 1,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §4.1 — Workflow registry (data-only DAG definitions)
-- ============================================================================

CREATE TABLE workflow (
  `key`           VARCHAR(96) NOT NULL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  module_key      VARCHAR(64) NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  definition      JSON NOT NULL,
  entitlement_key VARCHAR(96),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §6.4.4 — Supervisor persona profiles (pack data seeded at bootstrap)
-- ============================================================================

CREATE TABLE supervisor_profile (
  agent_key       VARCHAR(96) NOT NULL PRIMARY KEY,
  scope           JSON NOT NULL,                  -- {module_keys[],workflow_keys[],artifact_types[]}
  deviation_kinds JSON NOT NULL,                  -- allowed subset; [] = all
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_supervisor_agent FOREIGN KEY (agent_key) REFERENCES agent(`key`)
) ENGINE=InnoDB;

-- ============================================================================
-- §1.2 — Permission catalog (platform-level, first-party, fixed set)
-- ============================================================================

CREATE TABLE tenant_permission (
  `key`       VARCHAR(64) NOT NULL PRIMARY KEY,   -- 'project.create'
  domain      VARCHAR(32) NOT NULL,
  description TEXT NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §0 / §1.4 — Project (the namespace a run + its artifacts live in)
-- ============================================================================

CREATE TABLE project (
  id                 CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36) NOT NULL,
  name               VARCHAR(255) NOT NULL,
  code               VARCHAR(64),
  client_name        VARCHAR(255),
  status             VARCHAR(16) NOT NULL DEFAULT 'active',
  lifecycle_key      VARCHAR(64),                 -- a pack-declared lifecycle; null = none
  lifecycle_state    VARCHAR(64) NOT NULL DEFAULT 'start',
  lifecycle_state_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  autopilot          TINYINT NOT NULL DEFAULT 0,   -- 1 = run the whole pursuit automatically (auto-accept)
  created_by         CHAR(36),
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY project_tenant_idx (tenant_id, status)
) ENGINE=InnoDB;

-- ============================================================================
-- §1.1 — App user (tenant-scoped authorization profile)
-- ============================================================================

CREATE TABLE app_user (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  email        VARCHAR(320) NOT NULL,
  name         VARCHAR(255),
  avatar_url   TEXT,
  status       ENUM('invited','active','suspended') NOT NULL DEFAULT 'invited',
  auth_user_id VARCHAR(255),                      -- soft link to Better Auth user
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY app_user_tenant_email_uidx (tenant_id, email),
  KEY app_user_auth_idx (auth_user_id)
) ENGINE=InnoDB;

-- ============================================================================
-- §1.2 — RBAC (roles tenant-scoped; catalog platform-level)
-- ============================================================================

CREATE TABLE tenant_role (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id  CHAR(36) NOT NULL,
  `key`      VARCHAR(64) NOT NULL,                -- 'owner','estimator',...
  name       VARCHAR(128) NOT NULL,
  tier       ENUM('owner_admin','delivery','review','view') NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY tenant_role_uidx (tenant_id, `key`)
) ENGINE=InnoDB;

CREATE TABLE tenant_role_permission (
  tenant_id      CHAR(36) NOT NULL,
  role_id        CHAR(36) NOT NULL,
  permission_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  KEY trp_tenant_idx (tenant_id),
  CONSTRAINT fk_trp_role FOREIGN KEY (role_id) REFERENCES tenant_role(id) ON DELETE CASCADE,
  CONSTRAINT fk_trp_perm FOREIGN KEY (permission_key) REFERENCES tenant_permission(`key`)
) ENGINE=InnoDB;

CREATE TABLE user_role (
  tenant_id  CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  role_id    CHAR(36) NOT NULL,
  granted_by CHAR(36),
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  KEY ur_tenant_idx (tenant_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES tenant_role(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §1.3 — Invites
-- ============================================================================

CREATE TABLE tenant_invite (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  email       VARCHAR(320) NOT NULL,
  role_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  status      ENUM('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
  -- partial unique (one live invite per email) -> stored generated column
  active_email VARCHAR(320) GENERATED ALWAYS AS
    (CASE WHEN status = 'pending' THEN email ELSE NULL END) STORED,
  invited_by  CHAR(36),
  expires_at  DATETIME(3) NOT NULL,
  accepted_at DATETIME(3),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY tenant_invite_active_uidx (tenant_id, active_email),
  CONSTRAINT fk_invite_role FOREIGN KEY (role_id) REFERENCES tenant_role(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §1.4 — Project membership
-- ============================================================================

CREATE TABLE project_member (
  tenant_id  CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  added_by   CHAR(36),
  added_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, user_id),
  KEY pm_tenant_idx (tenant_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §1.5 — Provisioning marker (idempotent by tenant_id)
-- ============================================================================

CREATE TABLE tenant_bootstrap (
  tenant_id       CHAR(36) NOT NULL PRIMARY KEY,
  domain_key      VARCHAR(64) NOT NULL,
  bootstrapped_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source          ENUM('host_provision','manual') NOT NULL,
  idempotency_key VARCHAR(128)
) ENGINE=InnoDB;

-- ============================================================================
-- §5.3 — Tenant AI/settings policy (one row per tenant)
-- ============================================================================

CREATE TABLE tenant_setting (
  tenant_id             CHAR(36) NOT NULL PRIMARY KEY,
  auto_accept_threshold DECIMAL(4,3) NOT NULL DEFAULT 0.900,
  type_thresholds       JSON NOT NULL,
  default_tier          ENUM('routing','standard','deep') NOT NULL DEFAULT 'deep',
  extra                 JSON NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §2.2 — The artifact (one shared graph per project)
-- ============================================================================

CREATE TABLE artifact (
  id               CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id        CHAR(36) NOT NULL,
  project_id       CHAR(36) NOT NULL,
  type_key         VARCHAR(96) NOT NULL,
  payload          JSON NOT NULL,
  source           ENUM('human','agent') NOT NULL,
  source_agent_key VARCHAR(96),
  source_run_id    CHAR(36),
  source_step_id   CHAR(36),
  status           ENUM('pending','confirmed','rejected','stale','superseded') NOT NULL DEFAULT 'pending',
  confidence       DECIMAL(4,3),
  version          INT NOT NULL DEFAULT 1,
  supersedes_id    CHAR(36),
  created_by       CHAR(36),
  confirmed_by     CHAR(36),
  confirmed_at     DATETIME(3),
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY artifact_scope_idx (tenant_id, project_id, type_key, status),
  KEY artifact_run_idx   (source_run_id),
  KEY artifact_type_fk_idx (type_key),
  CONSTRAINT fk_artifact_project FOREIGN KEY (project_id) REFERENCES project(id),
  CONSTRAINT fk_artifact_type    FOREIGN KEY (type_key)   REFERENCES artifact_type(`key`)
) ENGINE=InnoDB;

-- ============================================================================
-- §2.3 — Provenance edges (the DAG)
-- ============================================================================

CREATE TABLE artifact_provenance (
  id                 CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36) NOT NULL,
  artifact_id        CHAR(36) NOT NULL,           -- derived
  source_artifact_id CHAR(36) NOT NULL,           -- an input it came from
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY prov_uidx (artifact_id, source_artifact_id),
  KEY prov_src_idx (source_artifact_id),
  KEY prov_art_idx (artifact_id),
  CONSTRAINT fk_prov_art FOREIGN KEY (artifact_id)        REFERENCES artifact(id) ON DELETE CASCADE,
  CONSTRAINT fk_prov_src FOREIGN KEY (source_artifact_id) REFERENCES artifact(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §4.2 — The run + steps (the process model)
-- ============================================================================

CREATE TABLE workflow_run (
  id               CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id        CHAR(36) NOT NULL,
  project_id       CHAR(36) NOT NULL,
  workflow_key     VARCHAR(96) NOT NULL,
  workflow_version INT NOT NULL,
  status           ENUM('running','awaiting_review','completed','failed','cancelled') NOT NULL DEFAULT 'running',
  context          JSON NOT NULL,
  started_by       CHAR(36),
  started_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at         DATETIME(3),
  KEY run_scope_idx (tenant_id, project_id, status),
  CONSTRAINT fk_run_project  FOREIGN KEY (project_id)   REFERENCES project(id),
  CONSTRAINT fk_run_workflow FOREIGN KEY (workflow_key) REFERENCES workflow(`key`)
) ENGINE=InnoDB;

CREATE TABLE workflow_run_step (
  id                  CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36) NOT NULL,
  run_id              CHAR(36) NOT NULL,
  node_id             VARCHAR(64) NOT NULL,
  kind                ENUM('agent','gate','map') NOT NULL,
  agent_key           VARCHAR(96),
  parent_step_id      CHAR(36),
  map_index           INT,
  status              ENUM('pending','running','awaiting_review','completed','skipped','failed') NOT NULL DEFAULT 'pending',
  attempt             INT NOT NULL DEFAULT 0,
  input_artifact_ids  JSON NOT NULL,
  output_artifact_ids JSON NOT NULL,
  job_id              CHAR(36),
  gate_types          JSON,
  started_at          DATETIME(3),
  ended_at            DATETIME(3),
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY run_step_run_idx (run_id, status),
  CONSTRAINT fk_step_run   FOREIGN KEY (run_id)    REFERENCES workflow_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_step_agent FOREIGN KEY (agent_key) REFERENCES agent(`key`)
) ENGINE=InnoDB;

-- ============================================================================
-- §5.3 — AI jobs
-- ============================================================================

CREATE TABLE ai_job (
  id              CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id       CHAR(36) NOT NULL,
  project_id      CHAR(36) NOT NULL,
  run_id          CHAR(36),
  step_id         CHAR(36),
  agent_key       VARCHAR(96) NOT NULL,
  job_type        VARCHAR(96) NOT NULL,
  status          ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  tier            ENUM('routing','standard','deep') NOT NULL,
  model           VARCHAR(96),
  attempt         INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  envelope        JSON NOT NULL,
  result          JSON,
  error           JSON,
  prompt_ref      VARCHAR(128),
  trace_id        VARCHAR(128),
  input_tokens    INT,
  output_tokens   INT,
  cost_minor      BIGINT,
  idempotency_key VARCHAR(128),
  queued_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at      DATETIME(3),
  ended_at        DATETIME(3),
  KEY ai_job_scope_idx (tenant_id, project_id, status),
  KEY ai_job_run_idx   (run_id),
  KEY ai_job_step_idx  (step_id),
  UNIQUE KEY ai_job_idem_uidx (tenant_id, idempotency_key),
  CONSTRAINT fk_aijob_agent FOREIGN KEY (agent_key) REFERENCES agent(`key`)
) ENGINE=InnoDB;

-- ============================================================================
-- §6.1 — Orchestrator conversations & messages
-- ============================================================================

CREATE TABLE orchestrator_conversation (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36) NOT NULL,
  project_id     CHAR(36) NOT NULL,
  run_id         CHAR(36),
  supervisor_key VARCHAR(96),                     -- persona owning the thread; null = default
  title          VARCHAR(255),
  created_by     CHAR(36),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY conv_scope_idx (tenant_id, project_id),
  CONSTRAINT fk_conv_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE orchestrator_message (
  id                      CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id               CHAR(36) NOT NULL,
  conversation_id         CHAR(36) NOT NULL,
  role                    ENUM('user','assistant','system') NOT NULL,
  content                 TEXT NOT NULL,
  referenced_artifact_ids JSON NOT NULL,
  referenced_step_ids     JSON NOT NULL,
  job_id                  CHAR(36),
  author_user_id          CHAR(36),
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY msg_conv_idx (conversation_id, created_at),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES orchestrator_conversation(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §6.1 — Run deviations (bounded supervisor control)
-- ============================================================================

CREATE TABLE run_deviation (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36) NOT NULL,
  project_id     CHAR(36) NOT NULL,
  run_id         CHAR(36) NOT NULL,
  proposed_by    VARCHAR(96) NOT NULL,            -- supervisor agent key
  kind           ENUM('rerun_step','insert_review_gate','skip_step','request_review','flag') NOT NULL,
  target_step_id CHAR(36),
  rationale      TEXT NOT NULL,
  payload        JSON NOT NULL,
  status         ENUM('proposed','approved','rejected','applied','auto_applied') NOT NULL DEFAULT 'proposed',
  decided_by     CHAR(36),
  decided_at     DATETIME(3),
  applied_at     DATETIME(3),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY deviation_run_idx (run_id, status),
  CONSTRAINT fk_deviation_run FOREIGN KEY (run_id) REFERENCES workflow_run(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §7.1 — Files & pages (object storage: local FS in dev)
-- ============================================================================

CREATE TABLE file (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  project_id  CHAR(36) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  filename    VARCHAR(512) NOT NULL,
  mime        VARCHAR(128),
  size_bytes  BIGINT,
  checksum    CHAR(64),
  status      ENUM('pending','uploaded','ingesting','ingested','failed') NOT NULL DEFAULT 'pending',
  page_count  INT,
  uploaded_by CHAR(36),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY file_scope_idx (tenant_id, project_id, status),
  CONSTRAINT fk_file_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE file_page (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id  CHAR(36) NOT NULL,
  file_id    CHAR(36) NOT NULL,
  page_no    INT NOT NULL,
  text       LONGTEXT,
  raster_key VARCHAR(512),
  method     VARCHAR(16),
  width_px   INT,
  height_px  INT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY file_page_uidx (file_id, page_no),
  CONSTRAINT fk_page_file FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §7.3 — Retrieval chunks (embedding stored as JSON; no pgvector in MySQL)
-- ============================================================================

CREATE TABLE chunk (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  project_id  CHAR(36) NOT NULL,
  source_kind ENUM('file_page','artifact','library') NOT NULL,
  source_id   CHAR(36) NOT NULL,
  revision_id CHAR(36),
  page_number INT,
  ordinal     INT NOT NULL DEFAULT 0,
  text        LONGTEXT NOT NULL,
  embedding   JSON,
  token_count INT,
  index_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY chunk_scope_idx  (tenant_id, project_id, source_kind),
  KEY chunk_source_idx (source_kind, source_id),
  FULLTEXT KEY chunk_text_ft (text)
) ENGINE=InnoDB;

-- ============================================================================
-- §8.2 — Entitlement snapshot (cache of the Host-resolved license)
-- ============================================================================

CREATE TABLE entitlement_snapshot (
  tenant_id            CHAR(36) NOT NULL PRIMARY KEY,
  edition_ref          VARCHAR(64) NOT NULL,
  version              BIGINT NOT NULL,
  licensed_modules     JSON NOT NULL,
  max_tier             ENUM('routing','standard','deep') NOT NULL DEFAULT 'deep',
  seats                INT,
  limits               JSON NOT NULL,
  features             JSON NOT NULL,
  forbidden_deviations JSON NOT NULL,
  resolved_at          DATETIME(3) NOT NULL,
  fetched_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- ============================================================================
-- §8.4 — Usage outbox (reverse metering to the Host)
-- ============================================================================

CREATE TABLE usage_outbox (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  event_type  VARCHAR(32) NOT NULL,
  quantity    BIGINT NOT NULL,
  unit        VARCHAR(32) NOT NULL,
  ref_id      CHAR(36),
  occurred_at DATETIME(3) NOT NULL,
  reported_at DATETIME(3),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY usage_unreported_idx (reported_at)
) ENGINE=InnoDB;

-- ============================================================================
-- §M.1 — Library (cross-project memory: reference data + promoted precedent)
-- ============================================================================

CREATE TABLE library_entry (
  id                 CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36) NOT NULL,
  collection         VARCHAR(64) NOT NULL,        -- 'rate_book','standard','precedent_bid','template'
  entry_key          VARCHAR(128),
  payload            JSON NOT NULL,
  version            INT NOT NULL DEFAULT 1,
  supersedes_id      CHAR(36),
  source_artifact_id CHAR(36),
  status             ENUM('active','superseded') NOT NULL DEFAULT 'active',
  created_by         CHAR(36),
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY library_scope_idx (tenant_id, collection, status)
) ENGINE=InnoDB;

-- ============================================================================
-- §M.2 — Decision outcomes (calibration signal; separate from audit chain)
-- ============================================================================

CREATE TABLE decision_outcome (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36) NOT NULL,
  project_id     CHAR(36) NOT NULL,
  artifact_id    CHAR(36) NOT NULL,
  agent_key      VARCHAR(96),
  type_key       VARCHAR(96) NOT NULL,
  confidence     DECIMAL(4,3),
  outcome        ENUM('confirmed','rejected','edited','auto_accepted') NOT NULL,
  edit_magnitude DECIMAL(4,3),
  decided_by     CHAR(36),
  decided_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY decision_calib_idx (tenant_id, agent_key, type_key, outcome)
) ENGINE=InnoDB;

-- ============================================================================
-- §X.5 — Event outbox (reliable notification delivery)
-- ============================================================================

CREATE TABLE event_outbox (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  project_id   CHAR(36),
  event_type   VARCHAR(48) NOT NULL,
  payload      JSON NOT NULL,
  occurred_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY event_undelivered_idx (delivered_at)
) ENGINE=InnoDB;

-- ============================================================================
-- §9.1 — Audit spine (append-only, hash-chained, ONE chain per tenant)
-- ============================================================================

CREATE TABLE audit_event (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  seq         BIGINT NOT NULL,                    -- monotonic PER tenant
  actor_kind  ENUM('user','service','agent','system') NOT NULL,
  actor_id    VARCHAR(96),
  action      VARCHAR(64) NOT NULL,
  target_kind VARCHAR(32),
  target_id   CHAR(36),
  project_id  CHAR(36),
  summary     JSON NOT NULL,
  prev_hash   CHAR(64),
  hash        CHAR(64) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY audit_tenant_seq_uidx (tenant_id, seq),
  KEY audit_scope_idx  (tenant_id, project_id, created_at),
  KEY audit_target_idx (target_kind, target_id)
) ENGINE=InnoDB;

-- Per-tenant chain head. append_audit_event locks this row FOR UPDATE and holds
-- the lock until the surrounding transaction commits — that is what serializes
-- the hash chain correctly under concurrency (e.g. a workflow `map` fan-out
-- completing several steps at once). A connection-scoped GET_LOCK cannot: it is
-- released when the procedure returns, before the app transaction commits, so two
-- appenders would read the same seq and collide on (tenant_id, seq).
CREATE TABLE audit_chain (
  tenant_id  CHAR(36) NOT NULL PRIMARY KEY,
  last_seq   BIGINT NOT NULL DEFAULT 0,
  last_hash  CHAR(64)
) ENGINE=InnoDB;

-- ============================================================================
-- Views
-- ============================================================================

-- §1.2 — effective permissions = union of a user's roles' permissions
CREATE OR REPLACE VIEW user_effective_permission AS
SELECT DISTINCT ur.tenant_id, ur.user_id, rp.permission_key
FROM user_role ur
JOIN tenant_role_permission rp ON rp.role_id = ur.role_id;

-- §2.5 — the review queue is a projection over pending proposals
CREATE OR REPLACE VIEW review_queue AS
SELECT id, tenant_id, project_id, type_key, source_agent_key, confidence, source_run_id, created_at
FROM artifact
WHERE status = 'pending';

-- §M.2 — calibration stat (per agent, per type)
CREATE OR REPLACE VIEW calibration_stat AS
SELECT tenant_id, agent_key, type_key,
       COUNT(*) AS decisions,
       AVG(CASE WHEN outcome = 'confirmed' THEN 1 ELSE 0 END) AS accept_rate,
       AVG(confidence) AS avg_confidence
FROM decision_outcome
WHERE agent_key IS NOT NULL
GROUP BY tenant_id, agent_key, type_key;

-- ============================================================================
-- §9.1 — Audit append procedure (per-tenant hash chain) + immutability triggers
-- ============================================================================

DROP PROCEDURE IF EXISTS append_audit_event;
DELIMITER $$
CREATE PROCEDURE append_audit_event(
  IN p_id          CHAR(36),
  IN p_tenant_id   CHAR(36),
  IN p_actor_kind  VARCHAR(16),
  IN p_actor_id    VARCHAR(96),
  IN p_action      VARCHAR(64),
  IN p_target_kind VARCHAR(32),
  IN p_target_id   CHAR(36),
  IN p_project_id  CHAR(36),
  IN p_summary     JSON
)
BEGIN
  DECLARE v_prev_hash CHAR(64);
  DECLARE v_seq       BIGINT;
  DECLARE v_created   DATETIME(3);
  DECLARE v_canon     LONGTEXT;
  DECLARE v_hash      CHAR(64);

  -- Serialize appends within a tenant so the chain has a defined order + seq.
  -- Ensure the tenant's head row exists, then take an InnoDB row lock on it with
  -- a locking read. That lock is held until the caller's transaction COMMITs, so
  -- a concurrent appender blocks here until we finish — the correct total order
  -- for the hash chain. (No user-level GET_LOCK: it would release too early.)
  INSERT INTO audit_chain (tenant_id, last_seq, last_hash)
    VALUES (p_tenant_id, 0, NULL)
    ON DUPLICATE KEY UPDATE tenant_id = tenant_id;
  SELECT last_seq, last_hash INTO v_seq, v_prev_hash
    FROM audit_chain WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF v_seq IS NULL THEN SET v_seq = 0; END IF;
  SET v_seq = v_seq + 1;
  SET v_created = CURRENT_TIMESTAMP(3);

  SET v_canon = CONCAT_WS('|',
    p_tenant_id,
    v_seq,
    CAST(UNIX_TIMESTAMP(v_created) AS CHAR),
    p_actor_kind,
    COALESCE(p_actor_id, ''),
    p_action,
    COALESCE(p_target_kind, ''),
    COALESCE(p_target_id, ''),
    COALESCE(p_project_id, ''),
    CAST(COALESCE(p_summary, JSON_OBJECT()) AS CHAR),
    COALESCE(v_prev_hash, '')
  );
  SET v_hash = SHA2(v_canon, 256);

  INSERT INTO audit_event (
    id, tenant_id, seq, actor_kind, actor_id, action,
    target_kind, target_id, project_id, summary, prev_hash, hash, created_at
  ) VALUES (
    p_id, p_tenant_id, v_seq, p_actor_kind, p_actor_id, p_action,
    p_target_kind, p_target_id, p_project_id,
    COALESCE(p_summary, JSON_OBJECT()), v_prev_hash, v_hash, v_created
  );

  -- Advance the head. The row lock releases with the caller's COMMIT.
  UPDATE audit_chain SET last_seq = v_seq, last_hash = v_hash
    WHERE tenant_id = p_tenant_id;
END$$

CREATE TRIGGER trg_audit_event_no_update
BEFORE UPDATE ON audit_event
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only (UPDATE rejected)';
END$$

CREATE TRIGGER trg_audit_event_no_delete
BEFORE DELETE ON audit_event
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only (DELETE rejected)';
END$$

DELIMITER ;

SET FOREIGN_KEY_CHECKS = 1;

-- End of schema. Seed data (core catalog + construction pack + demo tenant) is
-- loaded separately by `npm run seed` (scripts/seed.mjs) so it stays idempotent
-- and can reference the compiled-in pack definitions (src/lib/pack/*).


-- ============================================================================
-- DocLogix — controlled register, formal revisions, transmittals, source regions
-- (migration 019). Kept here so a fresh install matches a migrated one, and so
-- the tenant-scoping guard can see these tables are tenant-scoped.
-- ============================================================================

CREATE TABLE numbering_scheme (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  -- NULL project_id makes it an organisation-wide template.
  project_id  CHAR(36)     NULL,
  `key`       VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  `separator` VARCHAR(4)   NOT NULL DEFAULT '-',
  -- Segment[] — see src/lib/doc/numbering.ts.
  segments    JSON         NOT NULL,
  -- Sequence blocks never to allocate: employer-reserved, or already used on
  -- paper before the project came onto the platform.
  reserved    JSON         NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY numbering_scheme_uidx (tenant_id, project_id, `key`),
  KEY numbering_scheme_scope_idx (tenant_id, project_id),
  CONSTRAINT fk_numscheme_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE document_register (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36)     NOT NULL,
  project_id        CHAR(36)     NOT NULL,

  document_number   VARCHAR(255) NOT NULL,
  title             VARCHAR(512) NOT NULL,
  scheme_id         CHAR(36)     NULL,
  -- Parsed segments, so the register can filter by discipline or level without
  -- re-parsing the number on every query.
  segments          JSON         NULL,

  doc_type          VARCHAR(64)  NULL,
  discipline        VARCHAR(64)  NULL,
  originator        VARCHAR(128) NULL,
  volume            VARCHAR(32)  NULL,
  `level`           VARCHAR(32)  NULL,
  zone              VARCHAR(64)  NULL,
  package           VARCHAR(128) NULL,
  classification    VARCHAR(128) NULL,
  confidentiality   ENUM('public','internal','confidential','restricted') NOT NULL DEFAULT 'internal',

  -- Denormalised pointer to the current revision. Derived, and rebuildable from
  -- document_revision at any time — but every register view needs it, and the
  -- join to find it on each row is the difference between a register that opens
  -- and one that times out.
  current_revision_id CHAR(36)   NULL,

  -- 'registered' means the number is allocated and the document is awaited. A
  -- register that can only hold documents that have arrived cannot tell anyone
  -- what is late, which is most of its job.
  status            ENUM('registered','in_progress','issued','superseded','archived','void')
                    NOT NULL DEFAULT 'registered',

  retention         VARCHAR(64)  NULL,
  retention_years   INT          NULL,
  legal_hold        BOOLEAN      NOT NULL DEFAULT FALSE,
  legal_hold_reason VARCHAR(512) NULL,
  legal_hold_at     DATETIME(3)  NULL,
  handover_category VARCHAR(64)  NULL,
  required_by       DATE         NULL,

  created_by        CHAR(36)     NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- Duplicate detection, at the only level that actually holds it. Two documents
  -- sharing a number on one project is the failure the numbering engine exists
  -- to prevent, and application checks race.
  UNIQUE KEY document_register_number_uidx (tenant_id, project_id, document_number),
  KEY document_register_scope_idx (tenant_id, project_id, status),
  KEY document_register_disc_idx  (tenant_id, project_id, discipline),
  FULLTEXT KEY document_register_ft (document_number, title),
  CONSTRAINT fk_docreg_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE document_revision (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  project_id    CHAR(36)     NOT NULL,
  document_id   CHAR(36)     NOT NULL,

  revision_code VARCHAR(16)  NOT NULL,
  -- Which sequence the code belongs to, so ordering does not have to guess.
  scheme        ENUM('alpha','numeric','iso19650') NOT NULL DEFAULT 'alpha',
  -- Rank within the scheme, maintained by the application. Lets MySQL order
  -- revisions correctly without teaching SQL that C01 outranks P99.
  sort_rank     INT          NOT NULL DEFAULT 0,

  state         ENUM('draft','current','superseded') NOT NULL DEFAULT 'draft',
  -- ISO 19650 suitability: S0-S7, A1-A5, B1-B5, D1-D4, CR.
  suitability   VARCHAR(8)   NULL,
  description   VARCHAR(512) NULL,

  -- The bytes for this revision. Nullable: a revision can be recorded before its
  -- file arrives, which is how a register tracks what is outstanding.
  file_id       CHAR(36)     NULL,
  -- Bumped when the file is replaced without the revision changing.
  file_version  INT          NOT NULL DEFAULT 1,

  -- Set the moment this revision is transmitted or formally issued. From then on
  -- it is immutable: somebody else holds a copy, and a register that disagrees
  -- with the copy on their desk is worse than no register.
  frozen        BOOLEAN      NOT NULL DEFAULT FALSE,
  issued_at     DATETIME(3)  NULL,
  superseded_at DATETIME(3)  NULL,

  created_by    CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY document_revision_uidx (document_id, revision_code),
  KEY document_revision_doc_idx   (tenant_id, project_id, document_id, sort_rank),
  KEY document_revision_state_idx (tenant_id, project_id, state),
  CONSTRAINT fk_docrev_document FOREIGN KEY (document_id) REFERENCES document_register(id) ON DELETE CASCADE,
  CONSTRAINT fk_docrev_file     FOREIGN KEY (file_id)     REFERENCES file(id)              ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE transmittal (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36)     NOT NULL,
  project_id          CHAR(36)     NOT NULL,

  transmittal_number  VARCHAR(64)  NOT NULL,
  subject             VARCHAR(512) NULL,
  -- What the recipient may do with it: review, build from it, or file it.
  purpose             VARCHAR(255) NOT NULL,
  instructions        TEXT         NULL,

  sender_party        VARCHAR(255) NULL,
  sender_user_id      CHAR(36)     NULL,

  status              ENUM('draft','sent','acknowledged','closed','recalled') NOT NULL DEFAULT 'draft',
  sent_at             DATETIME(3)  NULL,
  required_response_at DATE        NULL,
  recalled_at         DATETIME(3)  NULL,
  recall_reason       VARCHAR(512) NULL,

  created_by          CHAR(36)     NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY transmittal_number_uidx (tenant_id, project_id, transmittal_number),
  KEY transmittal_scope_idx (tenant_id, project_id, status),
  CONSTRAINT fk_transmittal_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE transmittal_item (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)    NOT NULL,
  transmittal_id CHAR(36)   NOT NULL,
  revision_id   CHAR(36)    NOT NULL,
  -- Copied at send time so the line still reads correctly even if the register
  -- is later reorganised.
  document_number VARCHAR(255) NOT NULL,
  revision_code VARCHAR(16)  NOT NULL,
  seq           INT          NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY transmittal_item_uidx (transmittal_id, revision_id),
  KEY transmittal_item_rev_idx (revision_id),
  CONSTRAINT fk_tritem_transmittal FOREIGN KEY (transmittal_id) REFERENCES transmittal(id)        ON DELETE CASCADE,
  CONSTRAINT fk_tritem_revision    FOREIGN KEY (revision_id)    REFERENCES document_revision(id)  ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE transmittal_recipient (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  transmittal_id CHAR(36)     NOT NULL,
  party          VARCHAR(255) NOT NULL,
  user_id        CHAR(36)     NULL,
  email          VARCHAR(320) NULL,
  -- 'to' owes an acknowledgement by default; 'cc' is informed only. A copied-in
  -- party must not hold the transmittal open.
  kind           ENUM('to','cc') NOT NULL DEFAULT 'to',
  requires_ack   BOOLEAN      NOT NULL DEFAULT TRUE,
  ack            ENUM('pending','acknowledged','declined') NOT NULL DEFAULT 'pending',
  ack_at         DATETIME(3)  NULL,
  ack_note       VARCHAR(512) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY transmittal_recipient_uidx (transmittal_id, party),
  KEY transmittal_recipient_ack_idx (tenant_id, ack),
  CONSTRAINT fk_trrecip_transmittal FOREIGN KEY (transmittal_id) REFERENCES transmittal(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE source_region (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  project_id    CHAR(36)     NOT NULL,

  -- Where the evidence lives.
  file_id       CHAR(36)     NULL,
  revision_id   CHAR(36)     NULL,
  page_number   INT          NULL,

  region_type   ENUM('bounding_box','polygon','text_range','model_object') NOT NULL,
  -- Shape in the coordinate space of the page or model. {x,y,w,h} for a box,
  -- [[x,y],...] for a polygon, {from,to} for a text range.
  coordinates   JSON         NULL,
  -- The originating application's own handle, kept for round-trip fidelity.
  native_id     VARCHAR(255) NULL,
  extracted_text TEXT        NULL,

  -- What cites this region.
  entity_type   VARCHAR(64)  NOT NULL,
  entity_id     CHAR(36)     NOT NULL,

  -- How the citation was established, and how much to trust it.
  method        ENUM('manual','import','ai','rule') NOT NULL DEFAULT 'manual',
  confidence    DECIMAL(5,4) NULL,

  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY source_region_entity_idx (tenant_id, entity_type, entity_id),
  KEY source_region_file_idx   (tenant_id, file_id, page_number),
  KEY source_region_rev_idx    (revision_id),
  CONSTRAINT fk_srcregion_project  FOREIGN KEY (project_id)  REFERENCES project(id)           ON DELETE CASCADE,
  CONSTRAINT fk_srcregion_file     FOREIGN KEY (file_id)     REFERENCES file(id)              ON DELETE CASCADE,
  CONSTRAINT fk_srcregion_revision FOREIGN KEY (revision_id) REFERENCES document_revision(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- ============================================================================
-- DocLogix part two — distribution, review, comments (migration 020).
-- Kept here so the tenant-scoping guard can see these tables are scoped.
-- ============================================================================

CREATE TABLE distribution_list (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  -- NULL project_id makes it an organisation-wide list.
  project_id  CHAR(36)     NULL,
  name        VARCHAR(255) NOT NULL,
  description VARCHAR(512) NULL,
  -- Filters that decide when this list is offered: discipline, doc_type,
  -- package. Suggesting every list on every issue is the same as suggesting
  -- none.
  applies_to  JSON         NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY distribution_list_uidx (tenant_id, project_id, name),
  KEY distribution_list_scope_idx (tenant_id, project_id),
  CONSTRAINT fk_distlist_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE distribution_member (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  list_id     CHAR(36)     NOT NULL,
  party       VARCHAR(255) NOT NULL,
  email       VARCHAR(320) NULL,
  user_id     CHAR(36)     NULL,
  -- 'to' owes an acknowledgement, 'cc' is informed only. Carried onto the
  -- transmittal so the distinction survives the copy.
  kind        ENUM('to','cc') NOT NULL DEFAULT 'to',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY distribution_member_uidx (list_id, party),
  KEY distribution_member_scope_idx (tenant_id, list_id),
  CONSTRAINT fk_distmember_list FOREIGN KEY (list_id) REFERENCES distribution_list(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE document_review (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  project_id    CHAR(36)     NOT NULL,
  -- Reviews attach to a REVISION. Reviewing "the document" is meaningless when
  -- the content changes underneath the reviewer.
  revision_id   CHAR(36)     NOT NULL,

  stage         VARCHAR(64)  NOT NULL DEFAULT 'internal',
  status        ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
  -- How many approvals are needed before the cycle can complete. 0 means every
  -- assigned reviewer must respond.
  min_approvals INT          NOT NULL DEFAULT 0,
  due_at        DATETIME(3)  NULL,
  opened_by     CHAR(36)     NULL,
  opened_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at     DATETIME(3)  NULL,
  outcome       ENUM('approved','approved_with_comments','revise_and_resubmit','rejected') NULL,

  KEY document_review_rev_idx   (tenant_id, revision_id, status),
  KEY document_review_due_idx   (tenant_id, project_id, status, due_at),
  CONSTRAINT fk_docreview_revision FOREIGN KEY (revision_id) REFERENCES document_revision(id) ON DELETE CASCADE,
  CONSTRAINT fk_docreview_project  FOREIGN KEY (project_id)  REFERENCES project(id)           ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE document_review_assignee (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  review_id   CHAR(36)     NOT NULL,
  party       VARCHAR(255) NOT NULL,
  user_id     CHAR(36)     NULL,
  -- ISO 19650 response codes are contractual language, not opinions: a
  -- "revise and resubmit" obliges the originator to act.
  decision    ENUM('pending','approved','approved_with_comments','revise_and_resubmit','rejected')
              NOT NULL DEFAULT 'pending',
  decided_at  DATETIME(3)  NULL,
  note        VARCHAR(1000) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY document_review_assignee_uidx (review_id, party),
  KEY document_review_assignee_scope_idx (tenant_id, review_id, decision),
  CONSTRAINT fk_docreviewassignee_review FOREIGN KEY (review_id) REFERENCES document_review(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE document_comment (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)     NOT NULL,
  project_id   CHAR(36)     NOT NULL,
  revision_id  CHAR(36)     NOT NULL,
  review_id    CHAR(36)     NULL,
  -- Where on the page. NULL for a comment about the document as a whole.
  region_id    CHAR(36)     NULL,

  body         TEXT         NOT NULL,
  -- Threading, so a reply is attached to what it answers.
  parent_id    CHAR(36)     NULL,
  status       ENUM('open','resolved','withdrawn') NOT NULL DEFAULT 'open',
  -- A comment that obliges a change is different from an observation, and the
  -- difference decides whether the revision can be issued.
  is_blocking  BOOLEAN      NOT NULL DEFAULT FALSE,

  author_id    CHAR(36)     NULL,
  author_party VARCHAR(255) NULL,
  resolved_by  CHAR(36)     NULL,
  resolved_at  DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  KEY document_comment_rev_idx    (tenant_id, revision_id, status),
  KEY document_comment_review_idx (tenant_id, review_id),
  KEY document_comment_thread_idx (parent_id),
  CONSTRAINT fk_doccomment_revision FOREIGN KEY (revision_id) REFERENCES document_revision(id) ON DELETE CASCADE,
  CONSTRAINT fk_doccomment_region   FOREIGN KEY (region_id)   REFERENCES source_region(id)     ON DELETE SET NULL,
  CONSTRAINT fk_doccomment_review   FOREIGN KEY (review_id)   REFERENCES document_review(id)   ON DELETE SET NULL
) ENGINE=InnoDB;


-- ============================================================================
-- AI governance — policy, model registry, prompt registry, usage ledger and
-- response cache (migration 021).
-- ============================================================================

CREATE TABLE ai_tenant_policy (
  tenant_id       CHAR(36)    NOT NULL PRIMARY KEY,
  policy_version  INT         NOT NULL DEFAULT 1,
  deployment_mode ENUM('saas','private','sovereign') NOT NULL DEFAULT 'saas',
  policy_json     JSON        NOT NULL,
  updated_by      CHAR(36)    NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE ai_tenant_policy_history (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)    NOT NULL,
  policy_version INT         NOT NULL,
  policy_json    JSON        NOT NULL,
  changed_by     CHAR(36)    NULL,
  changed_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_policy_history_uidx (tenant_id, policy_version),
  KEY ai_policy_history_scope_idx (tenant_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE ai_model_registry (
  alias              VARCHAR(96)  NOT NULL PRIMARY KEY,
  provider           VARCHAR(96)  NOT NULL,
  provider_model     VARCHAR(160) NOT NULL,
  boundary           ENUM('local','preckon','external') NOT NULL,
  is_frontier        BOOLEAN      NOT NULL DEFAULT FALSE,
  capabilities_json  JSON         NOT NULL,
  context_limit      INT          NOT NULL,
  rate_card_json     JSON         NOT NULL,
  typical_latency_ms INT          NULL,
  licence            VARCHAR(160) NULL,
  -- §33: a model may not become approved until it has a measured evaluation.
  evaluation_version VARCHAR(64)  NULL,
  status             ENUM('approved','candidate','retired') NOT NULL DEFAULT 'candidate',
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_model_status_idx (status, boundary)
) ENGINE=InnoDB;

CREATE TABLE ai_prompt_version (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  prompt_key    VARCHAR(128) NOT NULL,
  version       INT          NOT NULL,
  task_type     VARCHAR(96)  NOT NULL,
  -- system prefix, task instructions, output schema, model overrides.
  prompt_json   JSON         NOT NULL,
  -- Stable prefixes improve provider prompt-cache reuse (§9.11), so the hash of
  -- the prefix is stored to make drift visible.
  prefix_hash   CHAR(64)     NULL,
  status        ENUM('draft','approved','retired') NOT NULL DEFAULT 'draft',
  eval_version  VARCHAR(64)  NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_prompt_version_uidx (prompt_key, version),
  KEY ai_prompt_task_idx (task_type, status)
) ENGINE=InnoDB;

CREATE TABLE ai_usage_ledger (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36)     NOT NULL,
  project_id          CHAR(36)     NULL,
  job_id              CHAR(36)     NULL,
  request_id          VARCHAR(64)  NULL,
  -- Which attempt of that job this row is. The column ai_job cannot express.
  attempt             INT          NOT NULL DEFAULT 1,

  module              VARCHAR(64)  NULL,
  task_type           VARCHAR(96)  NULL,
  execution_class     ENUM('deterministic','cache','local','preckon','external','stub') NOT NULL DEFAULT 'external',
  model_alias         VARCHAR(96)  NULL,
  provider            VARCHAR(96)  NULL,
  provider_model      VARCHAR(160) NULL,
  prompt_key          VARCHAR(128) NULL,
  prompt_version      INT          NULL,
  sensitivity         VARCHAR(24)  NULL,
  policy_version      INT          NULL,

  input_tokens        BIGINT       NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT       NOT NULL DEFAULT 0,
  output_tokens       BIGINT       NOT NULL DEFAULT 0,
  retrieval_tokens    BIGINT       NOT NULL DEFAULT 0,
  gpu_milliseconds    BIGINT       NOT NULL DEFAULT 0,
  cost_minor          BIGINT       NOT NULL DEFAULT 0,
  latency_ms          INT          NOT NULL DEFAULT 0,

  cache_hit           BOOLEAN      NOT NULL DEFAULT FALSE,
  confidence          DECIMAL(8,6) NULL,
  validation_status   VARCHAR(32)  NULL,
  outcome             ENUM('succeeded','failed','rejected','cancelled') NOT NULL,
  error_code          VARCHAR(64)  NULL,
  created_at          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  KEY ai_usage_tenant_idx  (tenant_id, created_at),
  KEY ai_usage_project_idx (tenant_id, project_id, created_at),
  KEY ai_usage_job_idx     (job_id, attempt),
  KEY ai_usage_task_idx    (tenant_id, module, task_type, created_at)
) ENGINE=InnoDB;

CREATE TABLE ai_response_cache (
  cache_key      CHAR(64)     NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NULL,
  task_type      VARCHAR(96)  NOT NULL,
  sensitivity    VARCHAR(24)  NOT NULL,
  policy_version INT          NOT NULL,
  prompt_version VARCHAR(64)  NOT NULL,
  schema_version VARCHAR(64)  NULL,
  model_alias    VARCHAR(96)  NULL,
  -- Sorted, comma-joined revision keys, so invalidating one revision can find
  -- every answer computed from it without parsing JSON.
  revision_keys  TEXT         NULL,
  response_json  JSON         NOT NULL,
  input_tokens   BIGINT       NOT NULL DEFAULT 0,
  output_tokens  BIGINT       NOT NULL DEFAULT 0,
  cost_minor     BIGINT       NOT NULL DEFAULT 0,
  hits           INT          NOT NULL DEFAULT 0,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_hit_at    DATETIME(3)  NULL,
  KEY ai_cache_scope_idx (tenant_id, project_id, task_type),
  KEY ai_cache_policy_idx (tenant_id, policy_version),
  KEY ai_cache_prompt_idx (tenant_id, prompt_version)
) ENGINE=InnoDB;


-- ============================================================================
-- Tables that had drifted: created in a migration but never declared here, so
-- the tenant-scoping guard could not see them. Found by schema-drift.test.ts.
-- ============================================================================

CREATE TABLE bim_document (
  project_id  CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  doc         JSON        NOT NULL,
  -- Bumped on every save; the client sends the version it loaded so a stale tab
  -- can't silently overwrite a colleague's model.
  version     INT         NOT NULL DEFAULT 1,
  updated_by  CHAR(36),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY bim_tenant_idx (tenant_id),
  CONSTRAINT fk_bim_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB;

CREATE TABLE cad_extraction (
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

CREATE TABLE project_programme (
  project_id        CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36)    NOT NULL,
  -- NULL means the Gantt stays in relative "day N" mode.
  commencement_date DATE        NULL,
  updated_by        CHAR(36),
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY prog_tenant_idx (tenant_id),
  CONSTRAINT fk_prog_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB;

CREATE TABLE learned_lesson (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  -- Where it was FIRST learned. Kept for provenance, never for filtering: the
  -- whole point is that it applies to the next project, not this one.
  project_id   CHAR(36),
  type_key     VARCHAR(120) NOT NULL,      -- construction.cost_line, …
  -- The natural key a future record is matched on: a BOQ code, an item
  -- description, a layer name. Lowercased on write so matching is stable.
  subject      VARCHAR(255) NOT NULL,
  field        VARCHAR(64) NOT NULL,       -- which field was corrected
  was_value    TEXT,                       -- what the agent proposed
  now_value    TEXT NOT NULL,              -- what the human made it
  -- How many times a human has made this same correction. One is an anecdote.
  times_seen   INT NOT NULL DEFAULT 1,
  -- Retired rather than deleted: a lesson that turned out to be wrong is worth
  -- keeping visible, and a hard delete loses the fact that it was ever applied.
  status       ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_by   CHAR(36),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- The lookup a run does: everything this tenant knows about these subjects,
  -- for this kind of record. Never a scan.
  KEY lesson_lookup_idx (tenant_id, type_key, subject, status),
  -- One row per (tenant, type, subject, field). A repeat correction increments
  -- times_seen rather than adding a second row that says the same thing.
  UNIQUE KEY lesson_unique (tenant_id, type_key, subject, field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pcm_coordinate_system (
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
