-- Targeted migration for the CAD/RAG additions.
-- Idempotent: safe to re-run. Only touches the columns/tables introduced by
-- the agentic-CAD pipeline; nothing else.
--
-- Run with:
--   mysql -u root boq_tender < scripts/cad-migration.sql

-- ── documents.cad_extraction_status ──────────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name   = 'documents'
     AND column_name  = 'cad_extraction_status'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE documents ADD COLUMN cad_extraction_status VARCHAR(32) DEFAULT ''pending''',
  'SELECT ''documents.cad_extraction_status already exists'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── boq_items.drawing_references ─────────────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name   = 'boq_items'
     AND column_name  = 'drawing_references'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE boq_items ADD COLUMN drawing_references JSON NULL',
  'SELECT ''boq_items.drawing_references already exists'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── cad_extractions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cad_extractions (
  id INT NOT NULL AUTO_INCREMENT,
  document_id INT NOT NULL,
  project_id INT NOT NULL,
  status ENUM('pending','running','succeeded','failed') NOT NULL DEFAULT 'pending',
  summary JSON NULL,
  error_message TEXT NULL,
  layer_count INT NULL,
  block_definition_count INT NULL,
  block_instance_total INT NULL,
  text_annotation_count INT NULL,
  schedule_count INT NULL,
  chunk_count INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cad_extractions_document_id_idx (document_id),
  KEY cad_extractions_project_id_idx (project_id),
  CONSTRAINT cad_extractions_document_id_documents_id_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT cad_extractions_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── cad_chunks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cad_chunks (
  id INT NOT NULL AUTO_INCREMENT,
  extraction_id INT NOT NULL,
  document_id INT NOT NULL,
  project_id INT NOT NULL,
  chunk_type VARCHAR(32) NOT NULL,
  layer VARCHAR(255) NULL,
  block_name VARCHAR(255) NULL,
  sheet VARCHAR(255) NULL,
  ref_id VARCHAR(255) NULL,
  text LONGTEXT NOT NULL,
  embedding JSON NULL,
  embedding_model VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cad_chunks_extraction_id_idx (extraction_id),
  KEY cad_chunks_document_id_idx (document_id),
  KEY cad_chunks_project_id_idx (project_id),
  KEY cad_chunks_chunk_type_idx (chunk_type),
  CONSTRAINT cad_chunks_extraction_id_cad_extractions_id_fk
    FOREIGN KEY (extraction_id) REFERENCES cad_extractions(id) ON DELETE CASCADE,
  CONSTRAINT cad_chunks_document_id_documents_id_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT cad_chunks_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;
