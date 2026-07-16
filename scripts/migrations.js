// Column-level migrations for existing databases. schema.sql only covers
// fresh installs (CREATE TABLE IF NOT EXISTS); this brings older tables up
// to date. Idempotent — safe to run on every db:init / db:migrate.
export async function applyMigrations(conn, log = () => {}) {
  const [dbRow] = await conn.query('SELECT DATABASE() AS db');
  const db = dbRow[0].db;

  async function hasColumn(table, column) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [db, table, column]
    );
    return rows.length > 0;
  }

  async function addColumn(table, column, ddl) {
    if (await hasColumn(table, column)) return;
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    log(`migrate: added ${table}.${column}`);
  }

  await addColumn('profiles', 'phone', 'phone VARCHAR(32) NULL');
  await addColumn('profiles', 'phone_verified_at', 'phone_verified_at DATETIME NULL');
  await addColumn('profiles', 'ui_lang', 'ui_lang VARCHAR(8) NULL');
  const [idx] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'profiles' AND INDEX_NAME = 'uq_profile_phone'`,
    [db]
  );
  if (!idx.length) {
    await conn.query('ALTER TABLE profiles ADD UNIQUE KEY uq_profile_phone (phone)');
    log('migrate: added profiles.uq_profile_phone');
  }

  await addColumn('doctors', 'phone', 'phone VARCHAR(32) NULL');
  await addColumn('doctors', 'digest_enabled', 'digest_enabled TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('doctors', 'last_digest_at', 'last_digest_at DATETIME NULL');

  await addColumn('reviews', 'verified_visit', 'verified_visit TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('reviews', 'reply_text', 'reply_text TEXT NULL');
  await addColumn('reviews', 'reply_doctor_name', 'reply_doctor_name VARCHAR(190) NULL');
  await addColumn('reviews', 'reply_at', 'reply_at DATETIME NULL');

  // widen the reviews.status enum to include 'flagged'
  const [statusCol] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'status'`,
    [db]
  );
  if (statusCol.length && !statusCol[0].t.includes('flagged')) {
    await conn.query(
      `ALTER TABLE reviews MODIFY COLUMN status ENUM('visible','hidden','flagged') NOT NULL DEFAULT 'visible'`
    );
    log('migrate: widened reviews.status enum (+flagged)');
  }
}
