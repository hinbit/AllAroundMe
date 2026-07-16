// Seeds demo doctor accounts (all three roles), demo questionnaires including
// a super questionnaire, one issued run, and a couple of demo reviews.
// Idempotent: keyed lookups + INSERT IGNORE.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { dbConfig, log } from './env.js';

const PASSWORD = process.env.DEFAULT_DOCTOR_PASSWORD || 'Doctor!2026';

async function upsertDoctor(conn, email, name, role, specialty) {
  const [rows] = await conn.query('SELECT id FROM doctors WHERE email = ?', [email]);
  if (rows.length) return rows[0].id;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [r] = await conn.query(
    'INSERT INTO doctors (email, password_hash, name, role, specialty) VALUES (?,?,?,?,?)',
    [email, hash, name, role, specialty]
  );
  log(`seeded doctor ${email} (${role})`);
  return r.insertId;
}

async function upsertQuestionnaire(conn, doctorId, title, kind, extra = {}) {
  const [rows] = await conn.query(
    'SELECT id FROM questionnaires WHERE doctor_id = ? AND title = ?',
    [doctorId, title]
  );
  if (rows.length) return rows[0].id;
  const [r] = await conn.query(
    'INSERT INTO questionnaires (doctor_id, title, kind, theme, target, schedule, questions) VALUES (?,?,?,?,?,?,?)',
    [
      doctorId, title, kind,
      JSON.stringify(extra.theme || null),
      JSON.stringify(extra.target || null),
      JSON.stringify(extra.schedule || null),
      JSON.stringify(extra.questions || []),
    ]
  );
  log(`seeded questionnaire "${title}" (${kind})`);
  return r.insertId;
}

async function main() {
  const conn = await mysql.createConnection({ ...dbConfig, charset: 'utf8mb4' });

  // --- doctors: one of each role -------------------------------------------
  const drLevi = await upsertDoctor(conn, process.env.DEFAULT_DOCTOR_EMAIL || 'doctor@allaroundme.local',
    'ד"ר דנה לוי', 'doctor', 'אורתופדיה');
  const drCohen = await upsertDoctor(conn, 'cohen@allaroundme.local', 'ד"ר יוסי כהן', 'doctor', 'אונקולוגיה');
  const clinicOwner = await upsertDoctor(conn, 'clinic@allaroundme.local', 'ד"ר רות בעלת המרפאה', 'clinic_owner', 'רפואת משפחה');
  const trialMgr = await upsertDoctor(conn, 'trial@allaroundme.local', 'פרופ׳ אבי מנהל הניסוי', 'trial_manager', 'מחקר קליני');

  await conn.query(
    `INSERT IGNORE INTO doctor_links (owner_id, doctor_id, link_type) VALUES (?,?,'clinic'),(?,?,'clinic'),(?,?,'trial')`,
    [clinicOwner, drLevi, clinicOwner, drCohen, trialMgr, drLevi]
  );

  // --- questionnaires -------------------------------------------------------
  const superQ = await upsertQuestionnaire(conn, trialMgr, 'שאלון-על: מדדי איכות חיים', 'super', {
    theme: { name: 'מחקרי', by: 'indication', value: 'כללי' },
    questions: [
      { q: 'איך היית מדרג/ת את איכות השינה שלך השבוע (1-5)?', expected: 'מספר 1-5' },
      { q: 'כמה ימים השבוע הרגשת כאב שהפריע לתפקוד?', expected: 'מספר ימים' },
      { q: 'האם נטלת את התרופות לפי ההנחיות?', expected: 'כן / לא / חלקית' },
      { q: 'איך מצב הרוח הכללי שלך (1-5)?', expected: 'מספר 1-5' },
      { q: 'האם היית ממליץ/ה על הטיפול לחבר במצב דומה?', expected: 'כן / לא + סיבה' },
    ],
  });

  const kneeQ = await upsertQuestionnaire(conn, drLevi, 'מעקב אחרי ניתוח ברך', 'regular', {
    theme: { name: 'בהיר-מלווה', by: 'age', value: '60+' },
    target: { types: ['אחרי ניתוח'], patient_group: 'ניתוחי ברך', symptom: 'כאב ברך', times: ['אחרי 5 ימים', 'אחרי שבועיים'] },
    schedule: [{ after_days: 5 }, { after_days: 14 }],
    questions: [
      { q: 'מה רמת הכאב בברך כרגע (1-10)?', expected: 'מספר 1-10' },
      { q: 'האם יש נפיחות או אודם סביב הצלקת?', expected: 'כן / לא + תיאור' },
      { q: 'כמה צעדים הצלחת ללכת היום בערך?', expected: 'הערכה מספרית' },
      { q: 'האם ביצעת את תרגילי הפיזיותרפיה היום?', expected: 'כן / לא' },
      { q: 'האם נטלת משככי כאבים היום? אילו?', expected: 'שם תרופה ומינון' },
      { q: 'האם יש חום מעל 38?', expected: 'כן / לא' },
      { q: 'האם אתה מצליח לישון בלילה?', expected: 'כן / לא / חלקית' },
      { q: 'עד כמה אתה מרוצה מההתקדמות (1-5)?', expected: 'מספר 1-5' },
    ],
  });
  await conn.query('INSERT IGNORE INTO questionnaire_links (questionnaire_id, super_id) VALUES (?,?)', [kneeQ, superQ]);

  await upsertQuestionnaire(conn, drCohen, 'מעקב טיפול אונקולוגי', 'regular', {
    theme: { name: 'רגוע-כהה', by: 'indication', value: 'אונקולוגיה' },
    target: { types: ['בטיפול פעיל'], patient_group: 'כימותרפיה', symptom: null, times: ['אחרי כל מחזור'] },
    schedule: [{ after_days: 3 }],
    questions: [
      { q: 'האם חווית בחילות מאז המחזור האחרון?', expected: 'כן / לא + חומרה' },
      { q: 'מה רמת העייפות שלך (1-10)?', expected: 'מספר 1-10' },
      { q: 'האם יש חום או סימני זיהום?', expected: 'כן / לא' },
      { q: 'האם הצלחת לאכול כרגיל?', expected: 'כן / לא / חלקית' },
    ],
  });

  // joint-run collaboration example: dr Cohen is a co-runner on dr Levi's knee questionnaire
  await conn.query(
    `INSERT IGNORE INTO questionnaire_collaborators (questionnaire_id, doctor_id, role) VALUES (?,?,'co_runner')`,
    [kneeQ, drCohen]
  );
  // GDPR-consented share: Levi shares reports with Cohen
  await conn.query(
    `INSERT IGNORE INTO data_shares (owner_doctor_id, target_doctor_id, scope, gdpr_consent, consent_text)
     VALUES (?,?,'reports',1,'שיתוף דוחות מעקב ברך לצורך מחקר משותף, בהסכמת GDPR')`,
    [drLevi, drCohen]
  );

  // --- demo user-side data --------------------------------------------------
  const demoUid = 'demo000000000000000000ab';
  await conn.query(
    `INSERT IGNORE INTO profiles (uid, visits, searches, points, reviews_given, allow_reviews) VALUES (?,?,?,?,?,1)`,
    [demoUid, 7, 12, 46, 2]
  );
  const [revs] = await conn.query('SELECT id FROM reviews WHERE uid = ?', [demoUid]);
  if (!revs.length) {
    await conn.query(
      `INSERT INTO reviews (uid, entity_name, entity_id, overall_stars, domains, text) VALUES
       (?, 'ד"ר משה ברק', NULL, 5, NULL, 'רופא מדהים, הסביר הכל בסבלנות'),
       (?, 'ד"ר רונית שלו', NULL, NULL, ?, 'מקצועית מאוד, הצוות נחמד')`,
      [demoUid, demoUid, JSON.stringify([{ name: 'מקצועיות', stars: 5 }, { name: 'יחס', stars: 4 }, { name: 'זמינות', stars: 3 }])]
    );
    log('seeded demo reviews');
  }

  await conn.end();
  log('db:seed done.');
  log(`doctor logins (password: ${PASSWORD}):`);
  log('  doctor@allaroundme.local  (doctor)      cohen@allaroundme.local (doctor)');
  log('  clinic@allaroundme.local  (clinic_owner) trial@allaroundme.local (trial_manager)');
}

main().catch((err) => {
  console.error('[allaroundme] db:seed failed:', err.message);
  process.exit(1);
});
