-- 020 — DocLogix part two: distribution, review, retention, and the retrieval
-- index the chunk table has been waiting for since it was created.
--
-- 019 gave the module its spine — a controlled register, formal revisions and
-- transmittals. What it could not yet do is the daily work around them: decide
-- who a document goes to without retyping a list, run a review that has a due
-- date somebody can be late for, pin a comment to a place on a page, and know
-- which records may never be deleted.

-- ── Distribution lists ───────────────────────────────────────────────────────
--
-- A transmittal names recipients. Typing them each time is how the wrong party
-- gets left off an issue, and leaving a party off an issue is how a contractor
-- ends up building from a drawing the consultant never approved.
--
-- The list is a named group with a purpose: "IFC issue - structural" is not the
-- same audience as "for information - client team", and the difference matters
-- because one of them can act on what they receive.
CREATE TABLE IF NOT EXISTS distribution_list (
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

CREATE TABLE IF NOT EXISTS distribution_member (
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

-- ── Review cycles ────────────────────────────────────────────────────────────
--
-- A review with no due date is a request nobody can be late for, which is why
-- document review is the part of a project that silently absorbs float. The
-- cycle carries the date, the reviewers, and the decision each one reached.
--
-- Separate from the generic `workflow` tables because a document review has
-- domain rules those cannot express: a response code that is contractually
-- meaningful, a minimum number of approvals, and a rule that the document
-- cannot be issued while a review is open.
CREATE TABLE IF NOT EXISTS document_review (
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

CREATE TABLE IF NOT EXISTS document_review_assignee (
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

-- ── Comments pinned to a place ───────────────────────────────────────────────
--
-- "The dimension is wrong" is not review feedback. "The dimension on page 14,
-- here, is wrong" is. The anchor is a source_region, which 019 introduced for
-- exactly this class of problem — the comment and a quantity's provenance are
-- the same shape of fact: something asserted about a specific place in a
-- specific revision.
CREATE TABLE IF NOT EXISTS document_comment (
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

-- ── Retention and legal hold ─────────────────────────────────────────────────
--
-- Two different questions that look alike. Retention says how long a record
-- must be kept before it MAY be destroyed. A legal hold says a record must NOT
-- be destroyed regardless of what retention permits, because it is evidence in
-- a dispute.
--
-- A hold always wins. Getting that precedence backwards is a legal problem, not
-- a data problem, so it is enforced in code with a test rather than left to
-- whoever writes the next deletion job.
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS and every migration re-runs on every
-- deploy, so each add is guarded on information_schema.

SET @db := DATABASE();

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE document_register ADD COLUMN retention_years INT NULL AFTER retention',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'document_register' AND COLUMN_NAME = 'retention_years');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE document_register ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT FALSE AFTER retention_years',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'document_register' AND COLUMN_NAME = 'legal_hold');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE document_register ADD COLUMN legal_hold_reason VARCHAR(512) NULL AFTER legal_hold',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'document_register' AND COLUMN_NAME = 'legal_hold_reason');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE document_register ADD COLUMN legal_hold_at DATETIME(3) NULL AFTER legal_hold_reason',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'document_register' AND COLUMN_NAME = 'legal_hold_at');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Retrieval index ──────────────────────────────────────────────────────────
--
-- The `chunk` table already exists with a FULLTEXT index and an embedding
-- column, and nothing has ever written to it. These columns are what it needs
-- to be revision-aware, which is the safety property: answering from a
-- superseded revision is worse than not answering.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE chunk ADD COLUMN revision_id CHAR(36) NULL AFTER source_id',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chunk' AND COLUMN_NAME = 'revision_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE chunk ADD COLUMN page_number INT NULL AFTER revision_id',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chunk' AND COLUMN_NAME = 'page_number');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which extraction produced this chunk. A re-index under new chunking rules must
-- be able to replace its own output without disturbing anyone else's.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE chunk ADD COLUMN index_version VARCHAR(32) NOT NULL DEFAULT ''v1'' AFTER token_count',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chunk' AND COLUMN_NAME = 'index_version');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX chunk_revision_idx ON chunk (tenant_id, revision_id, ordinal)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chunk' AND INDEX_NAME = 'chunk_revision_idx');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
