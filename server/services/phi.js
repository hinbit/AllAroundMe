// The regulatory spine: personal patient content belongs in the doctor's own
// WhatsApp/email with his patient — not in this platform's database.
//
// So a completed questionnaire is *handed over and let go of*:
//
//   1. deliverRunToDoctor() pushes the answers straight down the wire to the
//      doctor's own channel. It deliberately does not use the wa_outbox: an
//      outbox row would keep a verbatim copy of the answers here forever, which
//      is precisely what we are trying not to do. The cost is that we cannot
//      replay a send from a queue — so we retry from the answers themselves,
//      which are still here until delivery is confirmed.
//
//   2. purgeRun() then drops what identifies the patient. What stays is a
//      de-identified husk: which questions were answered and what was said,
//      with no name, no phone, no email, no profile link. That is enough for
//      the aggregate report and useless for re-identifying anyone.
//
// PHI_RETENTION=full switches step 2 off, for a clinic self-hosting this where
// the database *is* the doctor's own record.
import { query, queryOne } from '../db.js';
import { config } from '../env.js';
import { normalizePhone, transportSend } from './waTransport.js';
import { sendMail, mailEnabled } from './mailer.js';
import { visitSlotLabel } from './qr.js';

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// How the doctor is told who this is — the one line that decides whether these
// answers are usable to him. Each flow answers it differently:
//
//   identified — a verified WhatsApp number. The doctor gets it, because the
//                whole point of option b is an accountable sender he can reply
//                to directly, and because his reply is where the conversation
//                is supposed to live (this platform is not).
//   qr         — the moment of the scan, matched against his appointment book.
//                No name needed, and none is ever collected.
//   manual     — whatever the doctor himself typed when issuing it.
function whoLine(run) {
  const bits = [];
  if (run.patient_name) bits.push(`מטופל/ת: ${run.patient_name}`);
  if (run.source === 'identified' && run.patient_phone) {
    bits.push(`מספר מאומת: +${run.patient_phone} (אומת בוואטסאפ — אפשר להשיב ישירות)`);
  } else if (run.patient_phone) {
    bits.push(`טלפון: +${run.patient_phone}`);
  }
  if (run.visit_slot) bits.push(visitSlotLabel(run.visit_slot));
  if (!bits.length) bits.push('מטופל/ת שלא נדרש/ה להזדהות');
  return bits.join('\n');
}

export function buildDoctorMessage(run, payload, answers) {
  const lines = [
    `📋 ${payload.title}`,
    whoLine(run),
    '',
    ...answers.map((a) => `${a.question_idx + 1}. ${a.question}\n   ← ${a.answer}`),
  ];
  if (config.phiRetention === 'deidentify') {
    lines.push('', 'ההודעה הזו היא העותק שלך. המידע המזהה נמחק מהמערכת ונשאר אצלך בלבד.');
  }
  return lines.join('\n');
}

// Deliver one answered run to the doctor's own channel.
// Returns {ok, mode} or {ok:false, reason} — never throws at the caller.
export async function deliverRunToDoctor(runId) {
  const run = await queryOne('SELECT * FROM questionnaire_runs WHERE id = ?', [runId]);
  if (!run) return { ok: false, reason: 'run-not-found' };
  if (run.delivered_to_doctor_at) return { ok: true, mode: 'already-delivered' };

  const answers = await query(
    'SELECT question_idx, question, answer FROM questionnaire_answers WHERE run_id = ? ORDER BY question_idx',
    [runId]
  );
  if (!answers.length) return { ok: false, reason: 'no-answers' };

  // Where does this doctor receive?
  //
  // These two cases must not blur into one another. An assignment names a
  // specific alphon doctor, and its channel is the ONLY acceptable destination
  // for that patient's answers. Falling back to the questionnaire's owner here
  // would be a leak, not a convenience: category templates are owned by the
  // *manager*, so an assignment with no channel would post the patient's
  // answers to the manager — who must never see them. Better undelivered (and
  // retried, and visibly missing a channel in the phonebook) than misdelivered.
  let phone = null, email = null;
  if (run.assignment_id) {
    const a = await queryOne(
      'SELECT deliver_phone, deliver_email FROM questionnaire_assignments WHERE id = ?', [run.assignment_id]
    );
    phone = a?.deliver_phone || null;
    email = a?.deliver_email || null;
    if (!phone && !email) return { ok: false, reason: 'doctor-has-no-channel' };
  } else {
    // no assignment: a registered doctor issued this from his own console, so
    // the questionnaire's owner *is* the treating doctor
    const d = await queryOne(
      `SELECT d.phone, d.email FROM questionnaires q JOIN doctors d ON d.id = q.doctor_id WHERE q.id = ?`,
      [run.questionnaire_id]
    );
    phone = d?.phone || null;
    email = d?.email || null;
    if (!phone && !email) return { ok: false, reason: 'doctor-has-no-channel' };
  }

  const payload = parseJson(run.payload);
  const text = buildDoctorMessage(run, payload, answers);

  let mode = null;
  try {
    if (phone) {
      mode = await transportSend(normalizePhone(phone), text, {
        kind: 'phi_handoff', purpose: 'questionnaire', run_id: run.id,
      });
    } else if (mailEnabled()) {
      await sendMail(email, `תשובות שאלון · ${payload.title}`, text);
      mode = 'email';
    } else {
      return { ok: false, reason: 'no-usable-channel' };
    }
  } catch (e) {
    // leave delivered_to_doctor_at NULL: the answers stay put and the sweep retries
    console.error(`[allaroundme] PHI hand-off for run #${run.id} failed: ${e.message}`);
    return { ok: false, reason: String(e.message || e).slice(0, 200) };
  }

  await query('UPDATE questionnaire_runs SET delivered_to_doctor_at = NOW() WHERE id = ?', [run.id]);
  if (config.phiRetention === 'deidentify') await purgeRun(run.id);
  return { ok: true, mode };
}

// Drop everything that ties these answers to a person. Only ever called after
// delivery is confirmed — before that, this data is the retry source.
export async function purgeRun(runId) {
  const run = await queryOne('SELECT payload, delivered_to_doctor_at FROM questionnaire_runs WHERE id = ?', [runId]);
  if (!run || !run.delivered_to_doctor_at) return { purged: false, reason: 'not-delivered' };

  // the frozen payload embeds the patient block and a personalised intro
  const payload = parseJson(run.payload) || {};
  payload.patient = { name: null, phone: null, email: null, purged: true };
  payload.intro = null;

  await query(
    `UPDATE questionnaire_runs
        SET patient_name = NULL, patient_phone = NULL, patient_email = NULL,
            uid = NULL, payload = ?, purged_at = NOW()
      WHERE id = ?`,
    [JSON.stringify(payload), runId]
  );

  // Clearing the run alone is not de-identification. The delivery machinery
  // keeps its own copies of the patient's number, each still joined to run_id —
  // and the answers stay. So one join re-identifies everyone:
  //
  //   SELECT c.phone, a.answer FROM wa_conversations c
  //     JOIN questionnaire_answers a ON a.run_id = c.run_id
  //
  // Every table that pairs a number with this run_id has to lose the number.
  // The rows themselves stay: they are the delivery audit trail, and 'done' /
  // 'sent' with no addressee is still a true record that something was sent.
  await query(
    `UPDATE wa_conversations SET status = 'done', phone = '' WHERE run_id = ?`, [runId]
  );
  await query(
    `UPDATE wa_outbox SET to_phone = NULL, to_email = NULL, body = NULL WHERE run_id = ?`, [runId]
  );
  return { purged: true };
}

// Retry sweep for runs whose answers never reached their doctor (transport was
// down, doctor had no channel yet). Runs on the scheduler tick.
export async function sweepUndelivered(limit = 20) {
  const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));  // interpolated: mysql2 won't bind LIMIT
  const rows = await query(
    `SELECT id FROM questionnaire_runs
      WHERE status = 'answered' AND delivered_to_doctor_at IS NULL
        AND created_at > NOW() - INTERVAL 14 DAY
      ORDER BY id LIMIT ${n}`
  );
  let delivered = 0;
  for (const r of rows) {
    const out = await deliverRunToDoctor(r.id);
    if (out.ok) delivered += 1;
  }
  return { pending: rows.length, delivered };
}
