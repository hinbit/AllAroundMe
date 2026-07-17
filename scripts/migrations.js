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

  // Widen an ENUM to include `value`. Keyed on the value rather than on the
  // full type, so re-running is a no-op once the value is in.
  async function widenEnum(table, column, value, ddl) {
    const [rows] = await conn.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [db, table, column]
    );
    if (!rows.length || rows[0].t.includes(`'${value}'`)) return;
    await conn.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${ddl}`);
    log(`migrate: widened ${table}.${column} enum (+${value})`);
  }

  async function addIndex(table, name, ddl) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [db, table, name]
    );
    if (rows.length) return;
    await conn.query(`ALTER TABLE ${table} ADD ${ddl}`);
    log(`migrate: added ${table}.${name}`);
  }

  async function addForeignKey(table, name, ddl) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
      [db, table, name]
    );
    if (rows.length) return;
    await conn.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${ddl}`);
    log(`migrate: added ${table}.${name}`);
  }

  await addColumn('profiles', 'phone', 'phone VARCHAR(32) NULL');
  await addColumn('profiles', 'phone_verified_at', 'phone_verified_at DATETIME NULL');
  await addColumn('profiles', 'ui_lang', 'ui_lang VARCHAR(8) NULL');
  await addIndex('profiles', 'uq_profile_phone', 'UNIQUE KEY uq_profile_phone (phone)');

  await addColumn('doctors', 'phone', 'phone VARCHAR(32) NULL');
  await addColumn('doctors', 'digest_enabled', 'digest_enabled TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('doctors', 'last_digest_at', 'last_digest_at DATETIME NULL');

  // platform manager role (phonebook + questionnaire assignments)
  await widenEnum('doctors', 'role', 'manager',
    `ENUM('doctor','clinic_owner','trial_manager','manager') NOT NULL DEFAULT 'doctor'`);

  // QR desk flow + identified-patient flow + the PHI hand-off trail
  await addColumn('questionnaire_runs', 'assignment_id', 'assignment_id INT UNSIGNED NULL');
  await addColumn('questionnaire_runs', 'uid', 'uid CHAR(24) NULL');
  await addColumn('questionnaire_runs', 'source',
    `source ENUM('manual','qr','identified') NOT NULL DEFAULT 'manual'`);
  await addColumn('questionnaire_runs', 'visit_slot', 'visit_slot DATETIME NULL');
  await addColumn('questionnaire_runs', 'delivered_to_doctor_at', 'delivered_to_doctor_at DATETIME NULL');
  await addColumn('questionnaire_runs', 'purged_at', 'purged_at DATETIME NULL');
  // a QR patient answers on the web, not over WhatsApp/email
  await widenEnum('questionnaire_runs', 'channel', 'web',
    `ENUM('whatsapp','email','web') NOT NULL DEFAULT 'whatsapp'`);
  await addIndex('questionnaire_runs', 'idx_runs_assignment', 'INDEX idx_runs_assignment (assignment_id)');
  await addIndex('questionnaire_runs', 'idx_runs_uid', 'INDEX idx_runs_uid (uid)');
  await addForeignKey('questionnaire_runs', 'fk_run_assign',
    'FOREIGN KEY (assignment_id) REFERENCES questionnaire_assignments(id) ON DELETE SET NULL');

  await addColumn('reviews', 'verified_visit', 'verified_visit TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('reviews', 'reply_text', 'reply_text TEXT NULL');
  await addColumn('reviews', 'reply_doctor_name', 'reply_doctor_name VARCHAR(190) NULL');
  await addColumn('reviews', 'reply_at', 'reply_at DATETIME NULL');

  await widenEnum('reviews', 'status', 'flagged',
    `ENUM('visible','hidden','flagged') NOT NULL DEFAULT 'visible'`);
}
