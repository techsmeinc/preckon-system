-- Migration 003 — tenant-owned, user-configurable domains. A tenant picks an
-- industry template; it is cloned into a domain that belongs to the tenant and
-- stored as one editable pack document. Idempotent.

CREATE TABLE IF NOT EXISTS tenant_domain (
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

-- domain gains ownership + template flags (first-party rows keep NULL/0).
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain' AND COLUMN_NAME='owner_tenant_id');
SET @d1 := IF(@c1=0, 'ALTER TABLE domain ADD COLUMN owner_tenant_id CHAR(36) NULL', 'SELECT 1');
PREPARE s1 FROM @d1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain' AND COLUMN_NAME='is_template');
SET @d2 := IF(@c2=0, 'ALTER TABLE domain ADD COLUMN is_template TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE s2 FROM @d2; EXECUTE s2; DEALLOCATE PREPARE s2;
