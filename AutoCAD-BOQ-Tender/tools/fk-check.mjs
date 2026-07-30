import mysql from "mysql2/promise";
const url = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";
const conn = await mysql.createConnection(url);
const [fks] = await conn.query(`
  SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'documents'
`);
console.log("FKs referencing documents:");
for (const f of fks) console.log(`  ${f.TABLE_NAME}.${f.COLUMN_NAME} -> documents (${f.CONSTRAINT_NAME})`);
// Check delete rules
const [rules] = await conn.query(`
  SELECT rc.TABLE_NAME, rc.CONSTRAINT_NAME, rc.DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS rc
  WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.REFERENCED_TABLE_NAME = 'documents'
`);
console.log("Delete rules:");
for (const r of rules) console.log(`  ${r.TABLE_NAME} (${r.CONSTRAINT_NAME}): ON DELETE ${r.DELETE_RULE}`);
await conn.end();
