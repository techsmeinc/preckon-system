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
  ordinal     INT NOT NULL DEFAULT 0,
  text        LONGTEXT NOT NULL,
  embedding   JSON,
  token_count INT,
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
