-- 019 — DocLogix: the controlled document register, formal revisions and
-- transmittals. Plus source_region, which the whole platform has been missing.
--
-- Until now a "document" here was a `file` row: bytes, a name, a checksum. That
-- is a file store. A CDE is the governed record ABOUT the file — its number, its
-- revision, what it is suitable for, who holds a copy, and which revision was
-- current on the day somebody built from it. None of that lives in a filename.
--
-- ── WHY THE REGISTER IS SEPARATE FROM `file` ─────────────────────────────────
--
-- The obvious shortcut is to bolt document_number and revision onto `file`. It
-- breaks immediately, because the relationship is not one-to-one in either
-- direction:
--
--   * one controlled document has many revisions, each with its own file
--   * one revision can gain several file versions (page 3 scanned blank, someone
--     re-exported the PDF) without the revision changing at all
--   * a controlled document can exist with no file yet — registered and awaited,
--     which is exactly what a document register is for
--
-- So: document_register is the identity, document_revision is the contractual
-- series, and `file` stays what it is — bytes.
--
-- ── SOURCE_REGION ────────────────────────────────────────────────────────────
--
-- PCM §15.1 defines it and four separate blueprints depend on it: it is the
-- anchor from a derived value back to the exact page and polygon that produced
-- it. "Click a quantity, highlight the contributing objects" is claimed as the
-- product's differentiator throughout the documents, and it could not work,
-- because provenance stopped at the artifact and never reached the drawing.
--
-- It lives in this migration rather than a PCM one because a region is a region
-- of a DOCUMENT. QuantLogix is the loudest consumer, but the anchor belongs to
-- the document layer that owns pages.

-- ── Numbering schemes ────────────────────────────────────────────────────────
--
-- The scheme is data, not code. Every client has their own convention and a
-- project routinely runs two at once — the employer's for issued documents and
-- the contractor's for internal. A convention expressed as data can be added by
-- an administrator on a live project; one expressed as code needs a deploy.
CREATE TABLE IF NOT EXISTS numbering_scheme (
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

-- ── The controlled document ──────────────────────────────────────────────────
--
-- The identity. Not the file, not the revision — the thing the project refers to
-- when it says "M-0103".
CREATE TABLE IF NOT EXISTS document_register (
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

-- ── Formal revisions ─────────────────────────────────────────────────────────
--
-- The contractual series. Distinct from file version, workflow status and
-- purpose of issue, all of which move independently — see
-- src/lib/doc/revision.ts for why conflating them makes a register untrustworthy.
CREATE TABLE IF NOT EXISTS document_revision (
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

-- ── Transmittals ─────────────────────────────────────────────────────────────
--
-- A structured business object, not a generated PDF. The PDF is a rendering of
-- it. This is frequently the evidence in a dispute: how a contractor shows the
-- consultant held the revised drawing on the 14th.
CREATE TABLE IF NOT EXISTS transmittal (
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

-- The line items point at a REVISION, never at a document.
--
-- If they pointed at the document, issuing Rev D next month would silently
-- rewrite history: the transmittal sent in March would start claiming it had
-- sent Rev D, which nobody had in March. That is not a filing error, it is a
-- record that actively misleads. RESTRICT on delete for the same reason — a
-- revision that has been issued to somebody cannot be removed underneath the
-- evidence that it was.
CREATE TABLE IF NOT EXISTS transmittal_item (
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

CREATE TABLE IF NOT EXISTS transmittal_recipient (
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

-- ── Source regions ───────────────────────────────────────────────────────────
--
-- The anchor from a derived value back to the exact evidence that produced it:
-- page 14, this polygon, this text run. Four blueprints depend on it and none of
-- them could work without it.
--
-- `entity_type` + `entity_id` rather than a foreign key per consumer: a region
-- is cited by PCM objects, quantities, artifacts, requirements and spec clauses,
-- and adding a nullable FK column for each new consumer is how this table ends
-- up thirty columns wide. The cost is that MySQL cannot enforce the target
-- exists, which is why the application always writes the region and its citation
-- in the same transaction.
CREATE TABLE IF NOT EXISTS source_region (
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
