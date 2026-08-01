-- Programme settings — the one piece of schedule state that is NOT an activity.
--
-- A commencement date turns "day 14" into a real Tuesday. It belongs to the
-- project rather than to any activity, and it is a working preference rather
-- than a reviewable proposal, so it is not an artifact: nobody should have to
-- confirm a date picker.

CREATE TABLE IF NOT EXISTS project_programme (
  project_id        CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36)    NOT NULL,
  -- NULL means the Gantt stays in relative "day N" mode.
  commencement_date DATE        NULL,
  updated_by        CHAR(36),
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY prog_tenant_idx (tenant_id),
  CONSTRAINT fk_prog_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB;
