-- ProcureLogix: enquiries, vendors and quotations.
--
-- Packages already exist as `procurement_package` artifacts produced by
-- agent.procurement. What had nowhere to live was everything that happens after
-- a package is formed: who was asked, what came back, and when it closed.
--
-- Two things are deliberate in this shape.
--
-- Revisions are rows, not edits. A vendor prices rfq.revision 2; if a scope
-- change overwrote it, the quote on file would answer a question nobody can
-- reconstruct. So a reissue writes a new rfq row against the same package and
-- the old one stays exactly as it was priced.
--
-- Exclusions are stored as their own rows rather than inferred from missing
-- lines. "I will not do this" and "I forgot to price this" produce the same
-- absence and mean very different things in a negotiation.

CREATE TABLE IF NOT EXISTS vendor (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  name           VARCHAR(200) NOT NULL,
  trade          VARCHAR(120) NULL,
  email          VARCHAR(200) NULL,
  phone          VARCHAR(60)  NULL,
  -- Prequalification is a tenant-level judgement, not a per-enquiry one.
  status         ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  prequalified   BOOLEAN      NOT NULL DEFAULT FALSE,
  notes          TEXT         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_vendor_tenant (tenant_id, status),
  KEY idx_vendor_trade (tenant_id, trade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rfq (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NOT NULL,
  package_id     CHAR(36)     NOT NULL,
  revision       INT          NOT NULL DEFAULT 1,
  title          VARCHAR(240) NOT NULL,
  status         ENUM('draft','issued','closed','awarded','cancelled') NOT NULL DEFAULT 'draft',
  -- The scope priced at THIS revision, frozen on issue.
  scope_json     JSON         NOT NULL,
  issued_at      DATETIME(3)  NULL,
  due_at         DATETIME(3)  NULL,
  closed_at      DATETIME(3)  NULL,
  awarded_vendor CHAR(36)     NULL,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rfq_package_revision (tenant_id, package_id, revision),
  KEY idx_rfq_project (tenant_id, project_id, status),
  KEY idx_rfq_due (tenant_id, status, due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rfq_vendor (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  rfq_id         CHAR(36)     NOT NULL,
  vendor_id      CHAR(36)     NOT NULL,
  state          ENUM('invited','viewed','declined','quoted','no_response') NOT NULL DEFAULT 'invited',
  decline_reason VARCHAR(400) NULL,
  invited_at     DATETIME(3)  NULL,
  responded_at   DATETIME(3)  NULL,
  UNIQUE KEY uq_rfq_vendor (rfq_id, vendor_id),
  KEY idx_rfq_vendor_state (rfq_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  rfq_id         CHAR(36)     NOT NULL,
  vendor_id      CHAR(36)     NOT NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'AED',
  -- As submitted, over the lines the vendor actually priced. The like-for-like
  -- figure is derived at comparison time and deliberately NOT stored: it
  -- depends on the rest of the field, which changes as quotes arrive.
  quoted_minor   BIGINT       NOT NULL DEFAULT 0,
  valid_until    DATE         NULL,
  lead_time_days INT          NULL,
  qualifications JSON         NULL,
  submitted_at   DATETIME(3)  NOT NULL,
  -- Set against the rfq deadline at the moment of receipt, so a later
  -- extension cannot retrospectively make a late quote punctual.
  late           BOOLEAN      NOT NULL DEFAULT FALSE,
  received_by    CHAR(36)     NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_quote_rfq_vendor (rfq_id, vendor_id),
  KEY idx_quote_tenant (tenant_id, rfq_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_line (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  quote_id       CHAR(36)     NOT NULL,
  scope_item_id  VARCHAR(64)  NOT NULL,
  rate_minor     BIGINT       NOT NULL DEFAULT 0,
  -- Present only when the vendor priced a different quantity than the scope
  -- states; a silent quantity change is its own kind of exclusion.
  qty            DECIMAL(18,4) NULL,
  excluded       BOOLEAN      NOT NULL DEFAULT FALSE,
  note           VARCHAR(400) NULL,
  UNIQUE KEY uq_quote_line (quote_id, scope_item_id),
  KEY idx_quote_line_scope (scope_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
