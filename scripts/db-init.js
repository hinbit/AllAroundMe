// Creates the schema. Idempotent (CREATE TABLE IF NOT EXISTS + column migrations).
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { dbConfig, ROOT_DIR, log } from './env.js';
import { applyMigrations } from './migrations.js';

async function main() {
  const schemaPath = path.join(ROOT_DIR, 'server', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  log(`db:init connecting to ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  await conn.query(sql);
  await applyMigrations(conn, log);
  await conn.end();
  log('db:init done — schema is up to date.');
}

main().catch((err) => {
  console.error('[allaroundme] db:init failed:', err.message);
  process.exit(1);
});
