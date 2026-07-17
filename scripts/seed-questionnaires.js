// Seeds the four after-visit questionnaire categories and assigns them to 30
// real doctors from the Eshkolot phonebook.
//
// The doctors are taken through the alphon's *public* API, never its database:
// that endpoint already drops inactive, no_share and non-shareable-phone
// contacts, so seeding cannot reach around the alphon's own sharing rules. A
// doctor is assigned a questionnaire without ever registering here — the
// assignment points at his alphon entity id.
//
// Idempotent: templates are keyed by (owner, title) and assignments by
// (questionnaire_id, alphon_entity_id), so re-running tops the set back up to
// 30 rather than duplicating it.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { dbConfig, log } from './env.js';

const ESHKOLOT_API = String(process.env.ESHKOLOT_API_URL || 'http://127.0.0.1:3070/api').replace(/\/$/, '');
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'manager@allaroundme.local';
const PASSWORD = process.env.DEFAULT_DOCTOR_PASSWORD || 'Doctor!2026';
const TOTAL_DOCTORS = 30;

// Four after-visit questionnaires. `search` is how the category maps onto the
// alphon's free-text specialty fields; `count` sums to TOTAL_DOCTORS.
const CATEGORIES = [
  {
    name: 'רפואת ילדים',
    search: 'רפואת ילדים',
    count: 8,
    title: 'אחרי הביקור · רפואת ילדים',
    theme: { name: 'בהיר-ידידותי', by: 'age', value: '0-12' },
    target: { types: ['אחרי ביקור'], patient_group: 'ילדים והורים', symptom: null, times: ['יומיים אחרי הביקור'] },
    schedule: [{ after_days: 2 }],
    questions: [
      { q: 'איך הילד/ה מרגיש/ה היום לעומת יום הביקור?', expected: 'טוב יותר / דומה / פחות טוב' },
      { q: 'האם החום ירד או נעלם?', expected: 'כן / לא / לא היה חום' },
      { q: 'האם הילד/ה אוכל/ת ושותה כרגיל?', expected: 'כן / לא / חלקית' },
      { q: 'האם נתתם את התרופה לפי ההנחיות ובמינון שנרשם?', expected: 'כן / לא / חלקית' },
      { q: 'האם הופיעה תופעה חדשה (פריחה, הקאות, נשימה מאומצת)?', expected: 'תיאור קצר או "אין"' },
      { q: 'האם ההסבר שקיבלתם בביקור היה ברור מספיק?', expected: 'מספר 1-5' },
    ],
  },
  {
    name: 'אף אוזן גרון',
    search: 'אף אוזן גרון',
    count: 8,
    title: 'אחרי הביקור · אף אוזן גרון',
    theme: { name: 'רגוע', by: 'indication', value: 'אא"ג' },
    target: { types: ['אחרי ביקור'], patient_group: 'מטופלי אא"ג', symptom: 'כאב אוזניים / גרון', times: ['3 ימים אחרי הביקור'] },
    schedule: [{ after_days: 3 }],
    questions: [
      { q: 'מה רמת הכאב באוזן/בגרון כרגע (1-10)?', expected: 'מספר 1-10' },
      { q: 'האם יש הפרשה מהאוזן או מהאף?', expected: 'כן / לא + צבע' },
      { q: 'האם השמיעה חזרה לקדמותה?', expected: 'כן / לא / חלקית' },
      { q: 'האם יש קושי בבליעה או בנשימה?', expected: 'כן / לא + תיאור' },
      { q: 'האם התחלת את הטיפול (טיפות/אנטיביוטיקה) שנרשם?', expected: 'כן / לא' },
      { q: 'האם יש חום מעל 38?', expected: 'כן / לא' },
    ],
  },
  {
    name: 'אונקולוגיה',
    search: 'אונקולוג',
    count: 7,
    title: 'אחרי הביקור · אונקולוגיה',
    theme: { name: 'רגוע-כהה', by: 'indication', value: 'אונקולוגיה' },
    target: { types: ['אחרי ביקור'], patient_group: 'מטופלים אונקולוגיים', symptom: null, times: ['3 ימים אחרי הביקור'] },
    schedule: [{ after_days: 3 }],
    questions: [
      { q: 'איך את/ה מרגיש/ה מאז הביקור?', expected: 'תיאור חופשי' },
      { q: 'מה רמת העייפות שלך (1-10)?', expected: 'מספר 1-10' },
      { q: 'האם היו בחילות או הקאות?', expected: 'כן / לא + חומרה' },
      { q: 'האם יש חום או סימני זיהום?', expected: 'כן / לא' },
      { q: 'האם הצלחת לאכול ולשתות כרגיל?', expected: 'כן / לא / חלקית' },
      { q: 'האם ההסבר על המשך הטיפול היה ברור?', expected: 'מספר 1-5' },
    ],
  },
  {
    name: 'כאב',
    search: 'כאב',
    count: 7,
    title: 'אחרי הביקור · מרפאת כאב',
    theme: { name: 'רגוע', by: 'indication', value: 'כאב כרוני' },
    target: { types: ['אחרי ביקור'], patient_group: 'מטופלי מרפאת כאב', symptom: 'כאב כרוני', times: ['שבוע אחרי הביקור'] },
    schedule: [{ after_days: 7 }],
    questions: [
      { q: 'מה רמת הכאב הממוצעת שלך מאז הביקור (1-10)?', expected: 'מספר 1-10' },
      { q: 'האם הטיפול שהותאם הפחית את הכאב?', expected: 'כן / לא / חלקית' },
      { q: 'כמה שעות שינה רצופות את/ה מצליח/ה לישון?', expected: 'מספר שעות' },
      { q: 'האם הכאב מפריע לתפקוד היומיומי?', expected: 'מספר 1-5' },
      { q: 'האם היו תופעות לוואי מהתרופות?', expected: 'תיאור קצר או "אין"' },
      { q: 'האם את/ה זקוק/ה להתאמת מינון מוקדמת?', expected: 'כן / לא' },
    ],
  },
];

async function upsertManager(conn) {
  const [rows] = await conn.query('SELECT id FROM doctors WHERE email = ?', [MANAGER_EMAIL]);
  if (rows.length) {
    // an older seed may have created this account before the manager role existed
    await conn.query(`UPDATE doctors SET role = 'manager' WHERE id = ?`, [rows[0].id]);
    return rows[0].id;
  }
  const [r] = await conn.query(
    'INSERT INTO doctors (email, password_hash, name, role, specialty) VALUES (?,?,?,?,?)',
    [MANAGER_EMAIL, await bcrypt.hash(PASSWORD, 10), 'מנהל המערכת', 'manager', 'ניהול']
  );
  log(`seeded manager ${MANAGER_EMAIL}`);
  return r.insertId;
}

async function upsertTemplate(conn, managerId, cat) {
  const [rows] = await conn.query(
    'SELECT id FROM questionnaires WHERE doctor_id = ? AND title = ?', [managerId, cat.title]
  );
  if (rows.length) return rows[0].id;
  const [r] = await conn.query(
    'INSERT INTO questionnaires (doctor_id, title, kind, theme, target, schedule, questions) VALUES (?,?,?,?,?,?,?)',
    [
      managerId, cat.title, 'regular',
      JSON.stringify(cat.theme), JSON.stringify(cat.target),
      JSON.stringify(cat.schedule), JSON.stringify(cat.questions),
    ]
  );
  log(`seeded template "${cat.title}"`);
  return r.insertId;
}

// Random doctors from one category: ask the directory how many exist, then read
// one random page of that range. has_whatsapp=1 (not merely has_phone) is what
// makes the assignment meaningful — the whole design hands answers to the
// doctor's own WhatsApp, so a doctor whose only listed number is a landline or
// a *3833 service line has nowhere to receive them.
async function fetchDoctors(cat, want) {
  const base = `${ESHKOLOT_API}/public/directory?type=${encodeURIComponent('רופא')}` +
    `&specialty=${encodeURIComponent(cat.search)}&has_whatsapp=1`;

  const head = await fetch(`${base}&limit=1`, { signal: AbortSignal.timeout(15_000) });
  if (!head.ok) throw new Error(`alphon directory ${head.status} — is ${ESHKOLOT_API} running the current code?`);
  const { total } = await head.json();
  if (!total) return [];

  const page = Math.min(100, Math.max(want * 3, want));
  const offset = Math.max(0, Math.floor(Math.random() * Math.max(1, total - page)));
  const r = await fetch(`${base}&limit=${page}&offset=${offset}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`alphon directory ${r.status}`);
  const { entities } = await r.json();

  // shuffle, so a re-run tops up with different doctors rather than the same head
  for (let i = entities.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entities[i], entities[j]] = [entities[j], entities[i]];
  }
  return entities;
}

async function main() {
  const conn = await mysql.createConnection({ ...dbConfig, charset: 'utf8mb4' });
  const managerId = await upsertManager(conn);

  let assigned = 0;
  for (const cat of CATEGORIES) {
    const templateId = await upsertTemplate(conn, managerId, cat);

    const [[have]] = await conn.query(
      'SELECT COUNT(*) AS n FROM questionnaire_assignments WHERE questionnaire_id = ?', [templateId]
    );
    const missing = cat.count - Number(have.n);
    if (missing <= 0) {
      log(`${cat.name}: already assigned to ${have.n} doctors`);
      assigned += Number(have.n);
      continue;
    }

    const candidates = await fetchDoctors(cat, missing);
    let added = 0;
    for (const d of candidates) {
      if (added >= missing) break;
      const [r] = await conn.query(
        `INSERT IGNORE INTO questionnaire_assignments
           (questionnaire_id, alphon_entity_id, entity_name, entity_spec, entity_city,
            category, deliver_phone, desk_secret)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          templateId, d.id, d.name, d.spec || null, d.city || null,
          cat.name, d.wa || null, crypto.randomBytes(32).toString('hex'),
        ]
      );
      if (r.affectedRows) added += 1;
    }
    assigned += Number(have.n) + added;
    log(`${cat.name}: assigned "${cat.title}" to ${added} more doctors (${Number(have.n) + added}/${cat.count})`);
  }

  await conn.end();
  log(`seed:questionnaires done — ${assigned} doctors carry an after-visit questionnaire.`);
  log(`manager login: ${MANAGER_EMAIL} (password: ${PASSWORD})`);
}

main().catch((err) => {
  console.error('[allaroundme] seed:questionnaires failed:', err.message);
  process.exit(1);
});
