-- 021 — AI governance: policy, model registry, prompt registry, usage ledger
-- and the response cache.
--
-- Five tables the AI Fabric blueprint calls mandatory (§29) and which have never
-- existed. Without them the platform cannot answer four questions a customer
-- will ask on day one of an enterprise deal:
--
--   what may this data be sent to        (ai_tenant_policy)
--   which model actually ran it          (ai_model_registry)
--   which prompt produced this output    (ai_prompt_version)
--   what did it cost                     (ai_usage_ledger)
--
-- ── WHY A SEPARATE LEDGER WHEN ai_job ALREADY HAS TOKENS ─────────────────────
--
-- ai_job carries input_tokens, output_tokens and cost_minor, and it looked like
-- enough. It is not, because there is one row per JOB and those columns are
-- overwritten on every retry.
--
-- A job that spends tokens on attempt 1, fails validation, retries and succeeds
-- on attempt 2 records only attempt 2. Attempt 1's spend disappears — and failed
-- attempts are disproportionately the expensive ones, because they are the ones
-- that got retried. AI cost has therefore been under-counted by exactly the
-- amount most worth seeing, and every budget measured against it permits more
-- than the customer agreed to.
--
-- §20 asks for "an immutable usage event for every AI execution attempt". This
-- is that: append-only, one row per attempt, never updated.

SET @db := DATABASE();

-- ── Tenant AI policy ─────────────────────────────────────────────────────────
--
-- The gate that makes Private AI and Sovereign AI sellable rather than slides.
-- Versioned because the version is part of every cache key: an answer computed
-- under a looser policy must not be served after the policy tightens.
CREATE TABLE IF NOT EXISTS ai_tenant_policy (
  tenant_id       CHAR(36)    NOT NULL PRIMARY KEY,
  policy_version  INT         NOT NULL DEFAULT 1,
  deployment_mode ENUM('saas','private','sovereign') NOT NULL DEFAULT 'saas',
  policy_json     JSON        NOT NULL,
  updated_by      CHAR(36)    NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- Every version ever in force, so a usage row from March can be explained
-- against the policy that was actually applied at the time.
CREATE TABLE IF NOT EXISTS ai_tenant_policy_history (
  id             CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)    NOT NULL,
  policy_version INT         NOT NULL,
  policy_json    JSON        NOT NULL,
  changed_by     CHAR(36)    NULL,
  changed_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_policy_history_uidx (tenant_id, policy_version),
  KEY ai_policy_history_scope_idx (tenant_id, changed_at)
) ENGINE=InnoDB;

-- ── Model registry ───────────────────────────────────────────────────────────
--
-- Aliases, not model names. Provider prices live here rather than in code
-- because §9.11 is explicit that they are mutable configuration — a price
-- compiled into a build is wrong the day the provider changes it, and every
-- cost report built on it is quietly wrong afterwards.
--
-- Global rather than tenant-scoped: the catalogue of approved models is a
-- platform fact. What a TENANT may use is decided by ai_tenant_policy.
CREATE TABLE IF NOT EXISTS ai_model_registry (
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

-- ── Prompt registry ──────────────────────────────────────────────────────────
--
-- §18: no production prompt should live as an untracked string buried in module
-- source. Every prompt in worker/src currently does, which means an output
-- cannot be attributed to the exact instruction that produced it — and when a
-- model's behaviour changes, nobody can tell whether the prompt moved.
CREATE TABLE IF NOT EXISTS ai_prompt_version (
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

-- ── Usage ledger ─────────────────────────────────────────────────────────────
--
-- Append-only. One row per execution ATTEMPT. Never updated — the whole value is
-- that a row, once written, is what happened.
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
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

-- ── Response cache ───────────────────────────────────────────────────────────
--
-- The key carries every dimension that could change the answer, so a mismatch
-- cannot produce a hit at all. The columns beside it are there to explain a hit
-- and to scope invalidation — not to be consulted for safety, which the key
-- already settled.
CREATE TABLE IF NOT EXISTS ai_response_cache (
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

-- ── ai_job keeps its columns ─────────────────────────────────────────────────
--
-- Deliberately not dropped. They remain the "last attempt" summary the job list
-- reads, which is the right thing for that screen. The ledger is the record of
-- what was actually spent, and the two answer different questions. A comment
-- rather than a constraint, because nothing enforces the distinction except
-- knowing it.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'SELECT 1',
  'ALTER TABLE ai_job COMMENT = ''Job state and LAST-attempt summary. Total spend lives in ai_usage_ledger, one row per attempt.''')
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
