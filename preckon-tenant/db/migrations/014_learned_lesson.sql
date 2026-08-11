-- 014 — what this workspace has learned from being corrected.
--
-- THE GAP THIS CLOSES
--
-- Corrections already travel WITHIN a project: an agent only ever reads
-- artifacts a human confirmed, so a quantity you fix is the quantity every
-- downstream stage prices. Between projects, nothing carried. The estimator who
-- corrects the same rate on four tenders corrects it four times, and the agent
-- proposes the same wrong number on the fifth.
--
-- WHAT THIS IS NOT
--
-- It is not model training. No weights change, and deliberately so: a
-- fine-tuned model cannot tell you WHY it produced a number, and this product
-- is built on being able to. A lesson here is a row somebody can read, argue
-- with, and switch off — and when an agent uses one it can cite it, which a
-- trained-in habit could never do.
--
-- WHAT A LESSON IS
--
-- One correction, reduced to its reusable part: on records of THIS kind, about
-- THIS subject, a human changed THIS field from what the agent proposed to
-- something else. `times_seen` is what separates a house rule from a one-off —
-- the same correction made three times is how this contractor works; made once
-- it might be a remote site with a lorry surcharge, and repeating it elsewhere
-- would be worse than not learning at all.

CREATE TABLE IF NOT EXISTS learned_lesson (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36) NOT NULL,
  -- Where it was FIRST learned. Kept for provenance, never for filtering: the
  -- whole point is that it applies to the next project, not this one.
  project_id   CHAR(36),
  type_key     VARCHAR(120) NOT NULL,      -- construction.cost_line, …
  -- The natural key a future record is matched on: a BOQ code, an item
  -- description, a layer name. Lowercased on write so matching is stable.
  subject      VARCHAR(255) NOT NULL,
  field        VARCHAR(64) NOT NULL,       -- which field was corrected
  was_value    TEXT,                       -- what the agent proposed
  now_value    TEXT NOT NULL,              -- what the human made it
  -- How many times a human has made this same correction. One is an anecdote.
  times_seen   INT NOT NULL DEFAULT 1,
  -- Retired rather than deleted: a lesson that turned out to be wrong is worth
  -- keeping visible, and a hard delete loses the fact that it was ever applied.
  status       ENUM('active','retired') NOT NULL DEFAULT 'active',
  created_by   CHAR(36),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- The lookup a run does: everything this tenant knows about these subjects,
  -- for this kind of record. Never a scan.
  KEY lesson_lookup_idx (tenant_id, type_key, subject, status),
  -- One row per (tenant, type, subject, field). A repeat correction increments
  -- times_seen rather than adding a second row that says the same thing.
  UNIQUE KEY lesson_unique (tenant_id, type_key, subject, field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
