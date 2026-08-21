-- MFA: TOTP with backup codes.
--
-- Better Auth's two-factor plugin owns the protocol; this is the storage it
-- expects. Column names are camelCase to match the rest of the auth tables
-- (`user`, `session`, `account`, `verification`) rather than the snake_case
-- the application tables use — the plugin builds its own queries and will not
-- find snake_case columns.
--
-- Two things worth stating because they are security decisions rather than
-- schema decisions:
--
--   The secret is the whole factor. Anyone who reads this column can generate
--   valid codes forever, so it is never returned by the API (the plugin marks
--   it returned:false) and it belongs in the set of columns that a future
--   encryption-at-rest pass must cover first.
--
--   Backup codes are stored hashed by the plugin and are single-use. A user who
--   loses their phone uses one; a user who has used all ten needs an
--   administrator, which is the correct amount of friction for recovering a
--   second factor.

CREATE TABLE IF NOT EXISTS twoFactor (
  id          VARCHAR(255) NOT NULL PRIMARY KEY,
  secret      TEXT         NOT NULL,
  backupCodes TEXT         NOT NULL,
  userId      VARCHAR(255) NOT NULL,
  KEY idx_twofactor_user (userId),
  KEY idx_twofactor_secret (secret(64)),
  CONSTRAINT fk_twofactor_user FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Whether the user has completed enrolment. Guarded so the migration stays
-- re-runnable, like every other ALTER in this directory.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'twoFactorEnabled');
SET @ddl := IF(@col = 0,
  'ALTER TABLE `user` ADD COLUMN twoFactorEnabled BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
