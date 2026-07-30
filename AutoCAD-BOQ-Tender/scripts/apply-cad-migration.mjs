// Targeted migration runner for the CAD/RAG additions.
//
// Idempotent: queries information_schema first, only runs DDL that's missing.
// We do NOT use drizzle-kit push because it wants to truncate unrelated tables
// (pre-existing schema drift on `conversations`).
//
// Usage:
//   node scripts/apply-cad-migration.mjs
// Honours DATABASE_URL; defaults to the local XAMPP MySQL used by drizzle.config.

import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";

const conn = await mysql.createConnection({ uri: url, multipleStatements: false });
const safeUrl = url.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
console.log(`connected to ${safeUrl}`);

async function tableExists(name) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name],
  );
  return rows[0].n > 0;
}

async function columnExists(table, column) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column],
  );
  return rows[0].n > 0;
}

async function run(label, sql) {
  await conn.query(sql);
  console.log(`  ✓ ${label}`);
}

async function skip(label) {
  console.log(`  · ${label} (already present)`);
}

// 1. documents.cad_extraction_status
if (await columnExists("documents", "cad_extraction_status")) {
  await skip("documents.cad_extraction_status");
} else {
  await run(
    "documents.cad_extraction_status",
    "ALTER TABLE documents ADD COLUMN cad_extraction_status VARCHAR(32) DEFAULT 'pending'",
  );
}

// 2. boq_items.drawing_references
if (await columnExists("boq_items", "drawing_references")) {
  await skip("boq_items.drawing_references");
} else {
  await run(
    "boq_items.drawing_references",
    "ALTER TABLE boq_items ADD COLUMN drawing_references JSON NULL",
  );
}

// 3. cad_extractions
if (await tableExists("cad_extractions")) {
  await skip("cad_extractions");
} else {
  await run(
    "cad_extractions",
    `CREATE TABLE cad_extractions (
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
    ) ENGINE=InnoDB`,
  );
}

// 4a. cad_chunks.source_document_type (added in v0.3 — generic doc ingest)
if (await tableExists("cad_chunks")) {
  if (await columnExists("cad_chunks", "source_document_type")) {
    await skip("cad_chunks.source_document_type");
  } else {
    await run(
      "cad_chunks.source_document_type",
      "ALTER TABLE cad_chunks ADD COLUMN source_document_type VARCHAR(32) NULL",
    );
  }
  if (await columnExists("cad_chunks", "section")) {
    await skip("cad_chunks.section");
  } else {
    await run(
      "cad_chunks.section",
      "ALTER TABLE cad_chunks ADD COLUMN section VARCHAR(500) NULL",
    );
  }
  if (await columnExists("cad_chunks", "page")) {
    await skip("cad_chunks.page");
  } else {
    await run(
      "cad_chunks.page",
      "ALTER TABLE cad_chunks ADD COLUMN page INT NULL",
    );
  }
}

// 4b. cad_chunks  (full-table creation if it doesn't exist yet)
if (await tableExists("cad_chunks")) {
  await skip("cad_chunks");
} else {
  await run(
    "cad_chunks",
    `CREATE TABLE cad_chunks (
      id INT NOT NULL AUTO_INCREMENT,
      extraction_id INT NOT NULL,
      document_id INT NOT NULL,
      project_id INT NOT NULL,
      chunk_type VARCHAR(32) NOT NULL,
      source_document_type VARCHAR(32) NULL,
      section VARCHAR(500) NULL,
      page INT NULL,
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
    ) ENGINE=InnoDB`,
  );
}

await conn.end();
console.log("\nMigration complete.");
