-- BIM Studio — the per-project model behind the Drawings stage.
--
-- Deliberately NOT an artifact. Artifacts are proposals a human confirms, and
-- they are versioned by supersession with a provenance chain. A BIM document is
-- a mutable working model edited hundreds of times a session with undo/redo;
-- forcing it through the artifact store would flood the review queue and the
-- audit chain with keystrokes. What DOES become an artifact is the takeoff
-- derived from it (drawing_measurement), which is the thing worth reviewing.
--
-- One document per project. `doc` holds the BimDocument as written by
-- src/lib/bim/model.ts — elements, order, seq, units.

CREATE TABLE IF NOT EXISTS bim_document (
  project_id  CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  doc         JSON        NOT NULL,
  -- Bumped on every save; the client sends the version it loaded so a stale tab
  -- can't silently overwrite a colleague's model.
  version     INT         NOT NULL DEFAULT 1,
  updated_by  CHAR(36),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY bim_tenant_idx (tenant_id),
  CONSTRAINT fk_bim_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB;
