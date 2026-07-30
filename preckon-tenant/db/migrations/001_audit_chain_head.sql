-- Migration 001 — fix audit-chain serialization under concurrency.
-- Replaces the release-before-commit GET_LOCK in append_audit_event with an
-- InnoDB row lock on a per-tenant chain-head row (audit_chain), held until the
-- caller's transaction commits. Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS audit_chain (
  tenant_id  CHAR(36) NOT NULL PRIMARY KEY,
  last_seq   BIGINT NOT NULL DEFAULT 0,
  last_hash  CHAR(64)
) ENGINE=InnoDB;

-- Backfill each tenant's head from the current max-seq audit row.
INSERT INTO audit_chain (tenant_id, last_seq, last_hash)
SELECT e.tenant_id, e.seq, e.hash
FROM audit_event e
JOIN (SELECT tenant_id, MAX(seq) AS mseq FROM audit_event GROUP BY tenant_id) m
  ON m.tenant_id = e.tenant_id AND m.mseq = e.seq
ON DUPLICATE KEY UPDATE last_seq = VALUES(last_seq), last_hash = VALUES(last_hash);

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

  UPDATE audit_chain SET last_seq = v_seq, last_hash = v_hash
    WHERE tenant_id = p_tenant_id;
END$$
DELIMITER ;
