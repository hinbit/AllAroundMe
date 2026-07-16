// Daily doctor digest: what happened since the last one — new questionnaire
// answers, new reviews about the doctor, abuse flags. Delivered by email
// (SMTP) and/or WhatsApp; in dev everything lands in the server log.
import { query, queryOne } from '../db.js';
import { scopedDoctorIds } from '../middleware/auth.js';
import { sendWhatsApp } from './whatsapp.js';
import { sendMail } from './mailer.js';

export async function buildDigest(doctor) {
  const since = doctor.last_digest_at || new Date(Date.now() - 86400_000);
  const ids = await scopedDoctorIds(doctor, 'reports');
  const names = (await query(
    `SELECT name FROM doctors WHERE id IN (${ids.map(() => '?').join(',')})`, ids
  )).map((r) => r.name);

  const answers = await queryOne(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT a.run_id) AS runs
       FROM questionnaire_answers a
       JOIN questionnaire_runs r ON r.id = a.run_id
       JOIN questionnaires q ON q.id = r.questionnaire_id
      WHERE q.doctor_id IN (${ids.map(() => '?').join(',')}) AND a.answered_at > ?`,
    [...ids, since]
  );
  const namePh = names.map(() => '?').join(',');
  const reviews = await queryOne(
    `SELECT COUNT(*) AS n FROM reviews WHERE entity_name IN (${namePh}) AND created_at > ?`,
    [...names, since]
  );
  const flags = await queryOne(
    `SELECT COUNT(*) AS n FROM review_flags f JOIN reviews r ON r.id = f.review_id
      WHERE r.entity_name IN (${namePh}) AND f.created_at > ?`,
    [...names, since]
  );
  const pendingRuns = await queryOne(
    `SELECT COUNT(*) AS n FROM questionnaire_runs r JOIN questionnaires q ON q.id = r.questionnaire_id
      WHERE q.doctor_id IN (${ids.map(() => '?').join(',')}) AND r.status IN ('issued','sent')`,
    ids
  );

  const counts = {
    answers: Number(answers.n), answered_runs: Number(answers.runs),
    reviews: Number(reviews.n), flags: Number(flags.n), pending_runs: Number(pendingRuns.n),
  };
  const lines = [`שלום ${doctor.name}, סיכום יומי ממסביב 🎯:`];
  if (counts.answers) lines.push(`💬 ${counts.answers} תשובות חדשות לשאלונים (${counts.answered_runs} מטופלים)`);
  if (counts.reviews) lines.push(`⭐ ${counts.reviews} ביקורות חדשות עליך`);
  if (counts.flags) lines.push(`🚩 ${counts.flags} דיווחים חדשים על ביקורות — כדאי להציץ`);
  if (counts.pending_runs) lines.push(`⏳ ${counts.pending_runs} שאלונים עדיין ממתינים לתשובות`);
  const hasNews = counts.answers || counts.reviews || counts.flags;
  if (!hasNews) lines.push('יום שקט — אין עדכונים חדשים.');
  lines.push('לדשבורד המלא: /doctor.html');
  return { counts, text: lines.join('\n'), hasNews: !!hasNews };
}

// Send the digest to one doctor over whatever channels they have.
export async function sendDigest(doctor, { force = false } = {}) {
  const digest = await buildDigest(doctor);
  if (!digest.hasNews && !force) {
    await query('UPDATE doctors SET last_digest_at = NOW() WHERE id = ?', [doctor.id]);
    return { skipped: true, counts: digest.counts };
  }
  const sentVia = [];
  if (doctor.phone) {
    try { await sendWhatsApp(doctor.phone, digest.text, 'digest'); sentVia.push('whatsapp'); }
    catch (e) { console.error(`[allaroundme] digest wa -> ${doctor.name}: ${e.message}`); }
  }
  try {
    await sendMail(doctor.email, 'מסביב 🎯 · הסיכום היומי שלך', digest.text);
    sentVia.push('email');
  } catch (e) { console.error(`[allaroundme] digest mail -> ${doctor.name}: ${e.message}`); }
  await query('UPDATE doctors SET last_digest_at = NOW() WHERE id = ?', [doctor.id]);
  return { skipped: false, counts: digest.counts, via: sentVia };
}

// Digest round for every enabled doctor who hasn't had one today.
export async function runDailyDigests({ force = false } = {}) {
  const doctors = await query(
    `SELECT * FROM doctors WHERE digest_enabled = 1
        AND (last_digest_at IS NULL OR DATE(last_digest_at) < CURDATE() ${force ? 'OR 1=1' : ''})`
  );
  const results = [];
  for (const d of doctors) {
    try { results.push({ doctor: d.name, ...(await sendDigest(d, { force })) }); }
    catch (e) { results.push({ doctor: d.name, error: e.message }); }
  }
  return results;
}
