-- SCIM provisioning: external id mapping and per-tenant tokens.
--
-- scim_external_id is the identity provider's own key for the user. Matching on
-- email alone breaks the moment somebody changes their name at work: the IdP
-- sends a rename, we fail to find the row, and provision a duplicate. Keeping
-- their key means a rename is an update rather than a second account.
--
-- Tokens are per tenant so a leaked one cannot reach another tenant's
-- directory, and revocable without deleting the row - what a token was used for
-- is worth keeping after it is withdrawn.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'scim_external_id');
SET @ddl := IF(@col = 0,
  'ALTER TABLE app_user ADD COLUMN scim_external_id VARCHAR(255) NULL AFTER auth_user_id',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND INDEX_NAME = 'idx_app_user_scim');
SET @ddl := IF(@idx = 0,
  'CREATE INDEX idx_app_user_scim ON app_user (tenant_id, scim_external_id)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS tenant_scim_token (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  token       VARCHAR(255) NOT NULL,
  label       VARCHAR(120) NULL,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  revoked_at  DATETIME(3)  NULL,
  UNIQUE KEY uq_scim_token (token),
  KEY idx_scim_tenant (tenant_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
