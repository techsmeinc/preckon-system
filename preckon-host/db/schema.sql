-- ============================================================================
-- Preckon Host — Control-plane schema (MySQL 8)
-- ----------------------------------------------------------------------------
-- Translated from the PostgreSQL design spec (preckon-host-backend-design v1.0).
-- Import via phpMyAdmin (Import tab) or:  mysql -u root -p < db/schema.sql
--
-- Load-bearing translations from the Postgres spec:
--   • UUIDv7 PKs           -> CHAR(36), generated in the app (uuidv7())
--   • citext (email)       -> utf8mb4_0900_ai_ci collation (case-insensitive)
--   • jsonb                -> JSON
--   • timestamptz (UTC)    -> DATETIME(3), app writes/reads UTC
--   • inet                 -> VARCHAR(45)
--   • bytea hash           -> CHAR(64) hex (SHA2-256)
--   • text[]               -> JSON array
--   • sequence             -> AUTO_INCREMENT
--   • partial unique index -> STORED generated column + UNIQUE KEY
--   • plpgsql audit chain  -> stored procedure append_audit_event + triggers
--   • resolution view      -> SQL VIEW tenant_entitlement_resolved
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- utf8mb4_unicode_ci is case-insensitive (covers the spec's citext emails) and
-- exists on BOTH MySQL 8 and MariaDB 10.4+ (XAMPP). Tables inherit this default.
CREATE DATABASE IF NOT EXISTS `preckon_host`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `preckon_host`;

-- ============================================================================
-- Better Auth tables (host-only identity pool). §1.1
-- Better Auth owns credentials/sessions/2FA. host_user layers the staff
-- profile on top via auth_user_id. If you change Better Auth's version,
-- `npx @better-auth/cli generate` is the source of truth for these four.
-- ============================================================================

CREATE TABLE `user` (
  id             VARCHAR(255) NOT NULL PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(320) NOT NULL UNIQUE,
  emailVerified  BOOLEAN      NOT NULL DEFAULT FALSE,
  image          TEXT,
  twoFactorEnabled BOOLEAN,
  createdAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE `session` (
  id         VARCHAR(255) NOT NULL PRIMARY KEY,
  expiresAt  DATETIME(3)  NOT NULL,
  token      VARCHAR(255) NOT NULL UNIQUE,
  ipAddress  VARCHAR(45),
  userAgent  TEXT,
  userId     VARCHAR(255) NOT NULL,
  createdAt  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
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

CREATE TABLE `twoFactor` (
  id          VARCHAR(255) NOT NULL PRIMARY KEY,
  secret      TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId      VARCHAR(255) NOT NULL,
  KEY twofactor_user_idx (userId),
  CONSTRAINT fk_twofactor_user FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §1 — Host IAM
-- ============================================================================

CREATE TABLE host_role (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  `key`       VARCHAR(64)  NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description TEXT,
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE host_permission (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  `key`       VARCHAR(64)  NOT NULL UNIQUE,
  category    VARCHAR(32)  NOT NULL,
  description TEXT         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE host_role_permission (
  role_id       CHAR(36) NOT NULL,
  permission_id CHAR(36) NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_hrp_role FOREIGN KEY (role_id) REFERENCES host_role(id) ON DELETE CASCADE,
  CONSTRAINT fk_hrp_perm FOREIGN KEY (permission_id) REFERENCES host_permission(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE host_user (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  auth_user_id       VARCHAR(255) NOT NULL UNIQUE,
  email              VARCHAR(320) NOT NULL UNIQUE,   -- case-insensitive via table collation
  display_name       VARCHAR(191) NOT NULL,
  role_id            CHAR(36)     NOT NULL,
  status             VARCHAR(16)  NOT NULL DEFAULT 'invited',
  two_factor_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login_at      DATETIME(3),
  created_by         CHAR(36),
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY host_user_role_idx (role_id),
  KEY host_user_status_idx (status),
  CONSTRAINT chk_host_user_status CHECK (status IN ('invited','active','suspended')),
  CONSTRAINT fk_host_user_role FOREIGN KEY (role_id) REFERENCES host_role(id),
  CONSTRAINT fk_host_user_creator FOREIGN KEY (created_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §2 — Audit (append-only, hash-chained)
-- ============================================================================

CREATE TABLE audit_event (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  seq                BIGINT       NOT NULL AUTO_INCREMENT,
  occurred_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_host_user_id CHAR(36),
  actor_type         VARCHAR(16)  NOT NULL DEFAULT 'host_user',
  action             VARCHAR(64)  NOT NULL,
  target_type        VARCHAR(32),
  target_id          CHAR(36),
  target_tenant_id   CHAR(36),
  summary            TEXT         NOT NULL,
  metadata           JSON         NOT NULL,
  correlation_id     CHAR(36),
  ip                 VARCHAR(45),
  user_agent         TEXT,
  prev_hash          CHAR(64),
  hash               CHAR(64)     NOT NULL,
  UNIQUE KEY audit_event_seq_uidx (seq),
  KEY audit_event_actor_idx  (actor_host_user_id),
  KEY audit_event_target_idx (target_type, target_id),
  KEY audit_event_tenant_idx (target_tenant_id),
  KEY audit_event_time_idx   (occurred_at),
  KEY audit_event_action_idx (action),
  CONSTRAINT chk_audit_actor_type CHECK (actor_type IN ('host_user','system','impersonated')),
  CONSTRAINT fk_audit_actor  FOREIGN KEY (actor_host_user_id) REFERENCES host_user(id),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (target_tenant_id)   REFERENCES tenant(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §4 — Product catalog (feature / edition defined before tenant, which FKs edition)
-- ============================================================================

CREATE TABLE feature (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  `key`          VARCHAR(64)  NOT NULL UNIQUE,
  name           VARCHAR(128) NOT NULL,
  description    TEXT,
  category       VARCHAR(16)  NOT NULL,
  type           VARCHAR(16)  NOT NULL,
  value_type     VARCHAR(16)  NOT NULL,
  unit           VARCHAR(32),
  allowed_values JSON,
  status         VARCHAR(16)  NOT NULL DEFAULT 'active',
  sort_order     INT          NOT NULL DEFAULT 0,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY feature_category_idx (category),
  KEY feature_type_idx     (type),
  KEY feature_status_idx   (status),
  CONSTRAINT chk_feature_category CHECK (category IN ('module','capability','limit','usage')),
  CONSTRAINT chk_feature_type     CHECK (type IN ('flag','limit','metric')),
  CONSTRAINT chk_feature_vtype    CHECK (value_type IN ('boolean','numeric','enum')),
  CONSTRAINT chk_feature_status   CHECK (status IN ('active','deprecated')),
  CONSTRAINT chk_feature_type_vtype CHECK (
       (type = 'flag'   AND value_type = 'boolean')
    OR (type = 'metric' AND value_type = 'numeric')
    OR (type = 'limit'  AND value_type IN ('numeric','enum'))
  )
) ENGINE=InnoDB;

CREATE TABLE edition (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  `key`       VARCHAR(64)  NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description TEXT,
  status      VARCHAR(16)  NOT NULL DEFAULT 'draft',
  is_public   BOOLEAN      NOT NULL DEFAULT TRUE,
  trial_days  INT          NOT NULL DEFAULT 0,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY edition_status_idx (status),
  CONSTRAINT chk_edition_status CHECK (status IN ('draft','published','archived'))
) ENGINE=InnoDB;

CREATE TABLE edition_feature (
  edition_id  CHAR(36)      NOT NULL,
  feature_id  CHAR(36)      NOT NULL,
  enabled     BOOLEAN       NOT NULL DEFAULT FALSE,
  limit_value DECIMAL(20,4),
  enum_value  VARCHAR(64),
  PRIMARY KEY (edition_id, feature_id),
  KEY edition_feature_feature_idx (feature_id),
  CONSTRAINT chk_edition_feature_limit CHECK (limit_value IS NULL OR limit_value >= 0),
  CONSTRAINT fk_ef_edition FOREIGN KEY (edition_id) REFERENCES edition(id) ON DELETE CASCADE,
  CONSTRAINT fk_ef_feature FOREIGN KEY (feature_id) REFERENCES feature(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §3 — Tenant management
-- ============================================================================

CREATE TABLE tenant (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  slug                  VARCHAR(64)  NOT NULL UNIQUE,
  name                  VARCHAR(191) NOT NULL,
  legal_name            VARCHAR(191),
  status                VARCHAR(16)  NOT NULL DEFAULT 'trial',
  region                VARCHAR(32)  NOT NULL,
  current_edition_id    CHAR(36)     NOT NULL,
  trial_ends_at         DATETIME(3),
  primary_contact_email VARCHAR(320) NOT NULL,
  provisioned_by        CHAR(36),
  suspended_at          DATETIME(3),
  suspended_reason      TEXT,
  offboarded_at         DATETIME(3),
  entitlement_version   BIGINT       NOT NULL DEFAULT 0,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY tenant_status_idx  (status),
  KEY tenant_edition_idx (current_edition_id),
  KEY tenant_region_idx  (region),
  CONSTRAINT chk_tenant_status CHECK (status IN ('trial','active','suspended','offboarding','offboarded')),
  CONSTRAINT fk_tenant_edition FOREIGN KEY (current_edition_id) REFERENCES edition(id),
  CONSTRAINT fk_tenant_provisioner FOREIGN KEY (provisioned_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

CREATE TABLE impersonation_session (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id        CHAR(36)    NOT NULL,
  host_user_id     CHAR(36)    NOT NULL,
  reason           TEXT        NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at       DATETIME(3) NOT NULL,
  ended_at         DATETIME(3),
  ip               VARCHAR(45),
  user_agent       TEXT,
  -- partial-unique emulation: NULL unless active, so only one active per host user.
  active_host_user CHAR(36) GENERATED ALWAYS AS (IF(status = 'active', host_user_id, NULL)) STORED,
  UNIQUE KEY impersonation_one_active_per_host_user (active_host_user),
  KEY impersonation_tenant_idx (tenant_id),
  CONSTRAINT chk_impersonation_status CHECK (status IN ('active','ended','expired')),
  CONSTRAINT fk_imp_tenant FOREIGN KEY (tenant_id)    REFERENCES tenant(id),
  CONSTRAINT fk_imp_host   FOREIGN KEY (host_user_id) REFERENCES host_user(id)
) ENGINE=InnoDB;

CREATE TABLE tenant_theme (
  tenant_id        CHAR(36) NOT NULL PRIMARY KEY,
  logo_object_key  TEXT,
  brand_color      VARCHAR(7),
  brand_color_dark VARCHAR(7),
  accent_color     VARCHAR(7),
  theme_tokens     JSON        NOT NULL,
  updated_by       CHAR(36),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_theme_brand   CHECK (brand_color      IS NULL OR brand_color      REGEXP '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT chk_theme_brand_d CHECK (brand_color_dark IS NULL OR brand_color_dark REGEXP '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT chk_theme_accent  CHECK (accent_color     IS NULL OR accent_color     REGEXP '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT fk_theme_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_theme_updater FOREIGN KEY (updated_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §5 — Entitlements
-- ============================================================================

CREATE TABLE tenant_entitlement_override (
  tenant_id                CHAR(36)      NOT NULL,
  feature_id               CHAR(36)      NOT NULL,
  enabled_override         BOOLEAN,
  limit_value_override     DECIMAL(20,4),
  limit_unlimited_override BOOLEAN       NOT NULL DEFAULT FALSE,
  enum_value_override      VARCHAR(64),
  reason                   TEXT          NOT NULL,
  expires_at               DATETIME(3),
  created_by               CHAR(36),
  created_at               DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, feature_id),
  KEY tenant_override_feature_idx (feature_id),
  CONSTRAINT chk_override_limit CHECK (limit_value_override IS NULL OR limit_value_override >= 0),
  CONSTRAINT chk_override_unlimited CHECK (NOT (limit_unlimited_override AND limit_value_override IS NOT NULL)),
  CONSTRAINT fk_override_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_override_feature FOREIGN KEY (feature_id) REFERENCES feature(id),
  CONSTRAINT fk_override_creator FOREIGN KEY (created_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §6 — Pricing & packaging
-- ============================================================================

CREATE TABLE currency (
  code       CHAR(3)     NOT NULL PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  symbol     VARCHAR(8)  NOT NULL,
  minor_unit INT         NOT NULL DEFAULT 2,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE edition_price (
  edition_id    CHAR(36)    NOT NULL,
  currency_code CHAR(3)     NOT NULL,
  `interval`    VARCHAR(16) NOT NULL,
  amount_minor  BIGINT      NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (edition_id, currency_code, `interval`),
  CONSTRAINT chk_edition_price_interval CHECK (`interval` IN ('monthly','annual')),
  CONSTRAINT chk_edition_price_amount   CHECK (amount_minor >= 0),
  CONSTRAINT fk_ep_edition  FOREIGN KEY (edition_id)    REFERENCES edition(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_currency FOREIGN KEY (currency_code) REFERENCES currency(code)
) ENGINE=InnoDB;

CREATE TABLE usage_rate (
  feature_id    CHAR(36)    NOT NULL,
  currency_code CHAR(3)     NOT NULL,
  amount_minor  BIGINT      NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (feature_id, currency_code),
  CONSTRAINT chk_usage_rate_amount CHECK (amount_minor >= 0),
  CONSTRAINT fk_ur_feature  FOREIGN KEY (feature_id)    REFERENCES feature(id),
  CONSTRAINT fk_ur_currency FOREIGN KEY (currency_code) REFERENCES currency(code)
) ENGINE=InnoDB;

CREATE TABLE coupon (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  code             VARCHAR(64)  NOT NULL UNIQUE,
  name             VARCHAR(128),
  discount_type    VARCHAR(16)  NOT NULL,
  percent_off      DECIMAL(5,2),
  amount_off_minor BIGINT,
  currency_code    CHAR(3),
  duration         VARCHAR(16)  NOT NULL DEFAULT 'once',
  duration_months  INT,
  max_redemptions  INT,
  redeemed_count   INT          NOT NULL DEFAULT 0,
  valid_from       DATETIME(3),
  valid_until      DATETIME(3),
  status           VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_by       CHAR(36),
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_coupon_disc_type CHECK (discount_type IN ('percent','fixed')),
  CONSTRAINT chk_coupon_percent   CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  CONSTRAINT chk_coupon_amount    CHECK (amount_off_minor IS NULL OR amount_off_minor > 0),
  CONSTRAINT chk_coupon_duration  CHECK (duration IN ('once','repeating','forever')),
  CONSTRAINT chk_coupon_dur_months CHECK (duration_months IS NULL OR duration_months > 0),
  CONSTRAINT chk_coupon_max_redemptions CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  CONSTRAINT chk_coupon_status    CHECK (status IN ('active','disabled','expired')),
  CONSTRAINT chk_coupon_shape CHECK (
       (discount_type = 'percent' AND percent_off IS NOT NULL AND amount_off_minor IS NULL)
    OR (discount_type = 'fixed'   AND amount_off_minor IS NOT NULL AND currency_code IS NOT NULL AND percent_off IS NULL)
  ),
  CONSTRAINT chk_coupon_repeating CHECK (duration <> 'repeating' OR duration_months IS NOT NULL),
  CONSTRAINT fk_coupon_currency FOREIGN KEY (currency_code) REFERENCES currency(code),
  CONSTRAINT fk_coupon_creator  FOREIGN KEY (created_by)    REFERENCES host_user(id)
) ENGINE=InnoDB;

-- ============================================================================
-- §7 — Subscriptions & billing
-- ============================================================================

CREATE TABLE subscription (
  id                     CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id              CHAR(36)     NOT NULL,
  edition_id             CHAR(36)     NOT NULL,
  currency_code          CHAR(3)      NOT NULL,
  `interval`             VARCHAR(16)  NOT NULL,
  status                 VARCHAR(16)  NOT NULL,
  seats                  INT,
  coupon_id              CHAR(36),
  custom_amount_minor    BIGINT,
  trial_end              DATETIME(3),
  current_period_start   DATETIME(3),
  current_period_end     DATETIME(3),
  cancel_at_period_end   BOOLEAN      NOT NULL DEFAULT FALSE,
  canceled_at            DATETIME(3),
  stripe_customer_id     VARCHAR(64),
  stripe_subscription_id VARCHAR(64)  UNIQUE,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- partial-unique emulation: one live (non-canceled) subscription per tenant.
  live_tenant CHAR(36) GENERATED ALWAYS AS (IF(status <> 'canceled', tenant_id, NULL)) STORED,
  UNIQUE KEY subscription_one_live_per_tenant (live_tenant),
  KEY subscription_status_idx  (status),
  KEY subscription_edition_idx (edition_id),
  CONSTRAINT chk_sub_interval CHECK (`interval` IN ('monthly','annual')),
  CONSTRAINT chk_sub_status CHECK (status IN ('trialing','active','past_due','unpaid','paused','canceled','incomplete')),
  CONSTRAINT fk_sub_tenant   FOREIGN KEY (tenant_id)     REFERENCES tenant(id),
  CONSTRAINT fk_sub_edition  FOREIGN KEY (edition_id)    REFERENCES edition(id),
  CONSTRAINT fk_sub_currency FOREIGN KEY (currency_code) REFERENCES currency(code),
  CONSTRAINT fk_sub_coupon   FOREIGN KEY (coupon_id)     REFERENCES coupon(id)
) ENGINE=InnoDB;

CREATE TABLE invoice (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36)     NOT NULL,
  subscription_id    CHAR(36),
  currency_code      CHAR(3)      NOT NULL,
  number             VARCHAR(64),
  status             VARCHAR(16)  NOT NULL,
  subtotal_minor     BIGINT       NOT NULL DEFAULT 0,
  discount_minor     BIGINT       NOT NULL DEFAULT 0,
  tax_minor          BIGINT       NOT NULL DEFAULT 0,
  total_minor        BIGINT       NOT NULL DEFAULT 0,
  amount_paid_minor  BIGINT       NOT NULL DEFAULT 0,
  amount_due_minor   BIGINT       NOT NULL DEFAULT 0,
  period_start       DATETIME(3),
  period_end         DATETIME(3),
  due_date           DATETIME(3),
  issued_at          DATETIME(3),
  paid_at            DATETIME(3),
  attempt_count      INT          NOT NULL DEFAULT 0,
  stripe_invoice_id  VARCHAR(64)  UNIQUE,
  hosted_invoice_url TEXT,
  pdf_url            TEXT,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY invoice_tenant_idx (tenant_id),
  KEY invoice_status_idx (status),
  CONSTRAINT chk_invoice_status CHECK (status IN ('draft','open','paid','void','uncollectible')),
  CONSTRAINT fk_invoice_tenant   FOREIGN KEY (tenant_id)       REFERENCES tenant(id),
  CONSTRAINT fk_invoice_sub      FOREIGN KEY (subscription_id) REFERENCES subscription(id),
  CONSTRAINT fk_invoice_currency FOREIGN KEY (currency_code)   REFERENCES currency(code)
) ENGINE=InnoDB;

CREATE TABLE invoice_line (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id        CHAR(36)      NOT NULL,
  kind              VARCHAR(16)   NOT NULL,
  feature_id        CHAR(36),
  description       TEXT          NOT NULL,
  quantity          DECIMAL(20,4) NOT NULL DEFAULT 1,
  unit_amount_minor BIGINT        NOT NULL DEFAULT 0,
  amount_minor      BIGINT        NOT NULL DEFAULT 0,
  period_start      DATETIME(3),
  period_end        DATETIME(3),
  stripe_line_id    VARCHAR(64),
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY invoice_line_invoice_idx (invoice_id),
  CONSTRAINT chk_invoice_line_kind CHECK (kind IN ('plan','usage','proration','one_off','discount','tax')),
  CONSTRAINT fk_il_invoice FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE CASCADE,
  CONSTRAINT fk_il_feature FOREIGN KEY (feature_id) REFERENCES feature(id)
) ENGINE=InnoDB;

CREATE TABLE usage_record (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id              CHAR(36)      NOT NULL,
  feature_id             CHAR(36)      NOT NULL,
  subscription_id        CHAR(36),
  quantity               DECIMAL(20,4) NOT NULL DEFAULT 1,
  occurred_at            DATETIME(3)   NOT NULL,
  idempotency_key        VARCHAR(191)  NOT NULL UNIQUE,
  reported_to_stripe     BOOLEAN       NOT NULL DEFAULT FALSE,
  reported_at            DATETIME(3),
  stripe_usage_record_id VARCHAR(64),
  metadata               JSON          NOT NULL,
  created_at             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY usage_record_tfn_idx (tenant_id, feature_id, occurred_at),
  KEY usage_record_unreported_idx (reported_to_stripe),
  CONSTRAINT chk_usage_quantity CHECK (quantity > 0),
  CONSTRAINT fk_usage_tenant  FOREIGN KEY (tenant_id)       REFERENCES tenant(id),
  CONSTRAINT fk_usage_feature FOREIGN KEY (feature_id)      REFERENCES feature(id),
  CONSTRAINT fk_usage_sub     FOREIGN KEY (subscription_id) REFERENCES subscription(id)
) ENGINE=InnoDB;

CREATE TABLE stripe_webhook_event (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  type         VARCHAR(64)  NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'received',
  received_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3),
  error        TEXT,
  payload      JSON,
  CONSTRAINT chk_swe_status CHECK (status IN ('received','processed','failed','ignored'))
) ENGINE=InnoDB;

-- ============================================================================
-- §8 — Notifications
-- ============================================================================

CREATE TABLE notification (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  author_host_user_id CHAR(36),
  title               VARCHAR(191) NOT NULL,
  body                TEXT         NOT NULL,
  audience_type       VARCHAR(16)  NOT NULL,
  audience_filter     JSON         NOT NULL,
  deliver_in_app      BOOLEAN      NOT NULL DEFAULT TRUE,
  deliver_email       BOOLEAN      NOT NULL DEFAULT FALSE,
  status              VARCHAR(16)  NOT NULL DEFAULT 'draft',
  scheduled_at        DATETIME(3),
  sent_at             DATETIME(3),
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY notification_status_idx (status),
  CONSTRAINT chk_notification_audience CHECK (audience_type IN ('all_tenants','by_edition','by_status','specific')),
  CONSTRAINT chk_notification_status   CHECK (status IN ('draft','sending','sent')),
  CONSTRAINT fk_notification_author FOREIGN KEY (author_host_user_id) REFERENCES host_user(id)
) ENGINE=InnoDB;

CREATE TABLE notification_delivery (
  notification_id CHAR(36)    NOT NULL,
  tenant_id       CHAR(36)    NOT NULL,
  read_at         DATETIME(3),
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (notification_id, tenant_id),
  KEY notification_delivery_tenant_idx (tenant_id),
  CONSTRAINT fk_nd_notification FOREIGN KEY (notification_id) REFERENCES notification(id) ON DELETE CASCADE,
  CONSTRAINT fk_nd_tenant       FOREIGN KEY (tenant_id)       REFERENCES tenant(id)
) ENGINE=InnoDB;

CREATE TABLE host_notification (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  kind                VARCHAR(16)  NOT NULL,
  severity            VARCHAR(16)  NOT NULL DEFAULT 'info',
  title               VARCHAR(191) NOT NULL,
  body                TEXT,
  link                TEXT,
  target_host_user_id CHAR(36),
  correlation_id      CHAR(36),
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY host_notification_target_idx (target_host_user_id),
  CONSTRAINT chk_host_notif_kind     CHECK (kind IN ('billing','tenant','security','system')),
  CONSTRAINT chk_host_notif_severity CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT fk_host_notif_target FOREIGN KEY (target_host_user_id) REFERENCES host_user(id)
) ENGINE=InnoDB;

CREATE TABLE host_notification_read (
  host_notification_id CHAR(36)    NOT NULL,
  host_user_id         CHAR(36)    NOT NULL,
  read_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (host_notification_id, host_user_id),
  CONSTRAINT fk_hnr_notif FOREIGN KEY (host_notification_id) REFERENCES host_notification(id) ON DELETE CASCADE,
  CONSTRAINT fk_hnr_user  FOREIGN KEY (host_user_id)         REFERENCES host_user(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- §9 — Platform settings
-- ============================================================================

CREATE TABLE platform_setting (
  `key`       VARCHAR(128) NOT NULL PRIMARY KEY,
  value       JSON         NOT NULL,
  description TEXT,
  updated_by  CHAR(36),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_setting_updater FOREIGN KEY (updated_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

CREATE TABLE ai_provider (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  `key`              VARCHAR(64)  NOT NULL UNIQUE,
  name               VARCHAR(128) NOT NULL,
  kind               VARCHAR(16)  NOT NULL,
  base_url           TEXT,
  api_key_secret_ref TEXT         NOT NULL,
  status             VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_ai_provider_kind   CHECK (kind IN ('llm','embedding','reranker')),
  CONSTRAINT chk_ai_provider_status CHECK (status IN ('active','disabled'))
) ENGINE=InnoDB;

CREATE TABLE ai_routing_rule (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tier        VARCHAR(32)  NOT NULL,
  provider_id CHAR(36)     NOT NULL,
  model       VARCHAR(128) NOT NULL,
  priority    INT          NOT NULL DEFAULT 0,
  params      JSON         NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_routing_tier_provider_model (tier, provider_id, model),
  UNIQUE KEY ai_routing_tier_priority (tier, priority),
  KEY ai_routing_rule_tier_idx (tier),
  CONSTRAINT fk_arr_provider FOREIGN KEY (provider_id) REFERENCES ai_provider(id)
) ENGINE=InnoDB;

CREATE TABLE email_domain (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  domain      VARCHAR(191) NOT NULL UNIQUE,
  status      VARCHAR(16)  NOT NULL DEFAULT 'pending',
  dns_records JSON         NOT NULL,
  verified_at DATETIME(3),
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_email_domain_status CHECK (status IN ('pending','verified','failed'))
) ENGINE=InnoDB;

-- ============================================================================
-- §10 — Observability
-- ============================================================================

CREATE TABLE job_failure (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  job_id          VARCHAR(128) NOT NULL,
  job_type        VARCHAR(128) NOT NULL,
  queue           VARCHAR(64)  NOT NULL,
  tenant_id       CHAR(36),
  error_class     VARCHAR(191) NOT NULL,
  error_message   TEXT         NOT NULL,
  traceback       TEXT,
  attempt         INT          NOT NULL DEFAULT 0,
  max_attempts    INT,
  envelope        JSON         NOT NULL,
  correlation_id  CHAR(36),
  failed_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved        BOOLEAN      NOT NULL DEFAULT FALSE,
  resolved_by     CHAR(36),
  resolved_at     DATETIME(3),
  resolution_note TEXT,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY job_failure_type_idx (job_type),
  KEY job_failure_resolved_idx (resolved),
  KEY job_failure_tenant_idx (tenant_id),
  CONSTRAINT fk_job_failure_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenant(id),
  CONSTRAINT fk_job_failure_resolver FOREIGN KEY (resolved_by) REFERENCES host_user(id)
) ENGINE=InnoDB;

-- ============================================================================
-- Idempotency store (§0.5 Idempotency-Key). Operational support table.
-- ============================================================================

CREATE TABLE idempotency_key (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  `key`         VARCHAR(191) NOT NULL,
  route         VARCHAR(191) NOT NULL,
  host_user_id  CHAR(36),
  response_code INT,
  response_body JSON,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)  NOT NULL,
  UNIQUE KEY idempotency_key_route_uidx (`key`, route)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- §5.2 — Entitlement resolution view
--   Always query WITH `WHERE tenant_id = ?`. Emulates the Postgres view; note
--   MySQL evaluates NOW() per-row at query time (expiry honored live).
-- ============================================================================

CREATE OR REPLACE VIEW tenant_entitlement_resolved AS
SELECT
  t.id AS tenant_id,
  f.`key`,
  f.type,
  f.value_type,
  COALESCE(o.enabled_override, ef.enabled, FALSE) AS included,
  CASE
    WHEN o.tenant_id IS NOT NULL AND o.limit_unlimited_override THEN NULL
    WHEN o.limit_value_override IS NOT NULL THEN o.limit_value_override
    ELSE ef.limit_value
  END AS limit_value,
  COALESCE(o.enum_value_override, ef.enum_value) AS enum_value,
  CASE WHEN o.tenant_id IS NOT NULL THEN 'override' ELSE 'edition' END AS source
FROM tenant t
CROSS JOIN feature f
LEFT JOIN edition_feature ef
  ON ef.edition_id = t.current_edition_id AND ef.feature_id = f.id
LEFT JOIN tenant_entitlement_override o
  ON o.tenant_id = t.id AND o.feature_id = f.id
     AND (o.expires_at IS NULL OR o.expires_at > NOW())
WHERE f.status = 'active';

-- ============================================================================
-- §2.2 — Audit hash chain: append procedure + immutability triggers
-- ============================================================================

DROP PROCEDURE IF EXISTS append_audit_event;
DELIMITER $$
CREATE PROCEDURE append_audit_event(
  IN  p_id                 CHAR(36),
  IN  p_actor_host_user_id CHAR(36),
  IN  p_actor_type         VARCHAR(16),
  IN  p_action             VARCHAR(64),
  IN  p_target_type        VARCHAR(32),
  IN  p_target_id          CHAR(36),
  IN  p_target_tenant_id   CHAR(36),
  IN  p_summary            TEXT,
  IN  p_metadata           JSON,
  IN  p_correlation_id     CHAR(36),
  IN  p_ip                 VARCHAR(45),
  IN  p_user_agent         TEXT
)
BEGIN
  DECLARE v_prev_hash CHAR(64);
  DECLARE v_seq       BIGINT;
  DECLARE v_occurred  DATETIME(3);
  DECLARE v_canon     LONGTEXT;
  DECLARE v_hash      CHAR(64);

  -- Serialize concurrent appends so the chain has a defined order.
  SELECT GET_LOCK('platform.audit_event', 10) INTO @lock_ok;
  IF @lock_ok <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit chain lock timeout';
  END IF;

  SELECT hash INTO v_prev_hash
    FROM audit_event ORDER BY seq DESC LIMIT 1;

  SET v_occurred = CURRENT_TIMESTAMP(3);

  INSERT INTO audit_event (
    id, occurred_at, actor_host_user_id, actor_type, action,
    target_type, target_id, target_tenant_id, summary, metadata,
    correlation_id, ip, user_agent, prev_hash, hash
  ) VALUES (
    p_id, v_occurred, p_actor_host_user_id, p_actor_type, p_action,
    p_target_type, p_target_id, p_target_tenant_id, p_summary,
    COALESCE(p_metadata, JSON_OBJECT()), p_correlation_id, p_ip, p_user_agent,
    v_prev_hash, REPEAT('0', 64)
  );

  SELECT seq INTO v_seq FROM audit_event WHERE id = p_id;

  SET v_canon = CONCAT_WS('|',
    v_seq,
    CAST(UNIX_TIMESTAMP(v_occurred) AS CHAR),
    COALESCE(p_actor_host_user_id, ''),
    p_action,
    COALESCE(p_target_type, ''),
    COALESCE(p_target_id, ''),
    COALESCE(p_target_tenant_id, ''),
    CAST(COALESCE(p_metadata, JSON_OBJECT()) AS CHAR),
    COALESCE(v_prev_hash, '')
  );
  SET v_hash = SHA2(v_canon, 256);

  -- Chain-writer bypass so the immutability trigger allows THIS finalize.
  SET @audit_chain_writer = 1;
  UPDATE audit_event SET hash = v_hash WHERE id = p_id;
  SET @audit_chain_writer = NULL;

  DO RELEASE_LOCK('platform.audit_event');
END$$

-- Belt-and-braces immutability: reject any UPDATE except the chain finalize,
-- and reject all DELETEs. (§2.2)
CREATE TRIGGER trg_audit_event_no_update
BEFORE UPDATE ON audit_event
FOR EACH ROW
BEGIN
  IF @audit_chain_writer IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only (UPDATE rejected)';
  END IF;
END$$

CREATE TRIGGER trg_audit_event_no_delete
BEFORE DELETE ON audit_event
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only (DELETE rejected)';
END$$

DELIMITER ;

-- End of schema.
