// The desk-QR patient flow (option a).
//
// The patient scans the code on the doctor's desk and lands on /q/:id with a
// short-lived signature. Nothing about them is asked or stored: the scan itself
// says "this person was at this doctor's desk now", and that timestamp — the
// visit slot — is what identifies them to the doctor afterwards.
//
// Public, unauthenticated on purpose. The signature is the authority: see
// services/qr.js for why it rotates.
import express from 'express';
import { query, queryOne } from '../db.js';
import { blendQuestions } from './doctors.js';
import { verifyScan, signRunToken, verifyRunToken, visitSlotLabel, QR_WINDOW_SEC } from '../services/qr.js';
import { deliverRunToDoctor } from '../services/phi.js';

const router = express.Router();

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Express 4 does not catch a rejected async handler: it becomes an unhandled
// rejection, which on Node 20 tears the process down. These routes are public
// and unauthenticated, so an uncaught throw here is a one-request DoS for
// everyone. Every async handler in this file goes through here.
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(`[allaroundme] qr ${req.method} ${req.path} failed:`, e.stack || e.message);
  if (!res.headersSent) res.status(500).json({ error: 'שגיאה זמנית, נסו שוב' });
});

// A run stays open for the rest of the visit, so a patient who reloads the page
// or scans twice continues the same questionnaire instead of starting a new one.
const VISIT_WINDOW_MIN = 180;

// Light per-IP limit: a QR endpoint is public, and the signature check is the
// only thing standing between the internet and a pile of runs.
const hits = new Map();
router.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const rec = hits.get(key);
  if (!rec || now - rec.start > 60_000) {
    hits.set(key, { start: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return next();
  }
  rec.n += 1;
  if (rec.n > 40) return res.status(429).json({ error: 'יותר מדי בקשות, נסו שוב בעוד רגע' });
  next();
});

// POST /api/qr/resolve {assignment_id, w, s, uid}
// Validate the scan and open (or resume) this patient's run.
router.post('/resolve', route(async (req, res) => {
  const assignmentId = parseInt(req.body?.assignment_id, 10);
  const uid = String(req.body?.uid || '').slice(0, 24) || null;
  if (!assignmentId) return res.status(400).json({ error: 'קוד לא תקין' });

  const assignment = await queryOne(
    'SELECT * FROM questionnaire_assignments WHERE id = ? AND active = 1', [assignmentId]
  );
  if (!assignment) return res.status(404).json({ error: 'הקוד אינו משויך לרופא פעיל' });

  const scan = verifyScan(assignment, req.body?.w, req.body?.s);
  if (!scan.ok) {
    return res.status(403).json({
      error: scan.reason === 'expired'
        ? 'הקוד פג תוקף. יש לסרוק שוב את הקוד שעל שולחן הרופא.'
        : 'הקוד אינו תקין.',
      reason: scan.reason,
    });
  }

  const q = await queryOne('SELECT * FROM questionnaires WHERE id = ?', [assignment.questionnaire_id]);
  if (!q) return res.status(404).json({ error: 'השאלון לא נמצא' });

  // resume an open run from this visit rather than opening a second one
  if (uid) {
    const open = await queryOne(
      `SELECT id, payload FROM questionnaire_runs
        WHERE assignment_id = ? AND uid = ? AND status IN ('issued','sent')
          AND created_at > NOW() - INTERVAL ? MINUTE
        ORDER BY id DESC LIMIT 1`,
      [assignmentId, uid, VISIT_WINDOW_MIN]
    );
    if (open) {
      const payload = parseJson(open.payload);
      const answered = await query(
        'SELECT question_idx FROM questionnaire_answers WHERE run_id = ?', [open.id]
      );
      return res.json({
        ok: true, resumed: true,
        run_id: open.id, token: signRunToken(open.id),
        doctor: payload.doctor, title: payload.title,
        visit_slot_label: visitSlotLabel(payload.visit_slot),
        questions: payload.questions,
        answered_idx: answered.map((a) => a.question_idx),
      });
    }
  }

  const supers = await query(
    `SELECT s.id, s.title, s.questions FROM questionnaire_links ql
       JOIN questionnaires s ON s.id = ql.super_id WHERE ql.questionnaire_id = ?`, [q.id]
  );
  const questions = blendQuestions(
    parseJson(q.questions),
    supers.map((s) => ({ ...s, questions: parseJson(s.questions) }))
  );

  // The scan time is the visit slot — the whole point of the QR flow.
  const visitAt = new Date();
  const payload = {
    type: 'questionnaire',
    version: 1,
    questionnaire_id: q.id,
    assignment_id: assignment.id,
    title: q.title,
    doctor: { name: assignment.entity_name, specialty: assignment.entity_spec, alphon_entity_id: assignment.alphon_entity_id },
    // no patient block: a QR patient never identifies themselves
    patient: { name: null, phone: null, email: null },
    source: 'qr',
    visit_slot: visitAt.toISOString(),
    channel: 'web',
    theme: parseJson(q.theme),
    questions: questions.map(({ idx, q: text, expected, source }) => ({ idx, q: text, expected, source })),
  };

  const run = await query(
    `INSERT INTO questionnaire_runs
       (questionnaire_id, assignment_id, uid, source, visit_slot, channel, payload, status, sent_at)
     VALUES (?,?,?,'qr',?,'web',?,'sent',NOW())`,
    [q.id, assignment.id, uid, visitAt, JSON.stringify(payload)]
  );

  res.json({
    ok: true, resumed: false,
    run_id: run.insertId, token: signRunToken(run.insertId),
    doctor: payload.doctor, title: payload.title,
    visit_slot_label: visitSlotLabel(visitAt),
    questions: payload.questions,
    answered_idx: [],
  });
}));

// POST /api/qr/answers {token, answers:[{idx, answer}], done}
// The run token is the credential — an anonymous patient has nothing else.
router.post('/answers', route(async (req, res) => {
  const runId = verifyRunToken(req.body?.token);
  if (!runId) return res.status(403).json({ error: 'הטופס אינו תקין, יש לסרוק שוב' });

  const run = await queryOne('SELECT * FROM questionnaire_runs WHERE id = ?', [runId]);
  if (!run) return res.status(404).json({ error: 'הטופס לא נמצא' });
  if (run.status === 'answered' || run.status === 'closed') {
    return res.status(409).json({ error: 'השאלון כבר נשלח לרופא' });
  }

  const payload = parseJson(run.payload);
  const byIdx = new Map((payload.questions || []).map((q) => [q.idx, q.q]));
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

  let saved = 0;
  for (const a of answers.slice(0, 100)) {
    const idx = parseInt(a.idx, 10);
    const text = String(a.answer ?? '').trim();
    if (Number.isNaN(idx) || !byIdx.has(idx) || !text) continue;
    // a patient correcting an answer replaces it rather than appending a second one
    await query('DELETE FROM questionnaire_answers WHERE run_id = ? AND question_idx = ?', [runId, idx]);
    await query(
      'INSERT INTO questionnaire_answers (run_id, question_idx, question, answer) VALUES (?,?,?,?)',
      [runId, idx, byIdx.get(idx), text.slice(0, 4000)]
    );
    saved += 1;
  }

  if (!req.body?.done) return res.json({ ok: true, saved, done: false });

  await query(`UPDATE questionnaire_runs SET status = 'answered' WHERE id = ?`, [runId]);
  const handoff = await deliverRunToDoctor(runId);
  res.json({
    ok: true, saved, done: true,
    delivered: handoff.ok,
    // the patient is told the truth about where their answers went
    notice: handoff.ok
      ? 'התשובות נשלחו ישירות לרופא/ה. המערכת לא שומרת את הפרטים המזהים שלך.'
      : 'התשובות נשמרו ויועברו לרופא/ה בהקדם.',
  });
}));

// POST /api/qr/identified/start {uid, alphon_entity_id}
// Option b: no QR, no desk. A patient who has verified their number can pick a
// doctor and send that doctor their answers. What the verification buys is
// accountability — the doctor is receiving from a known person, not from an
// anonymous form — so unlike the QR flow, the run keeps the patient's number.
//
// KNOWN GAP: uid comes from the body and is not proof of ownership — the whole
// app identifies people this way (every /api/profile/* route does the same), so
// anyone holding someone else's uid could file answers under their verified
// number. That is tolerable for points and badges; it is weaker than it should
// be for something a doctor will act on. Closing it means binding uid to a
// signed cookie app-wide, which is a change to the app's identity model rather
// than to this route.
router.post('/identified/start', route(async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  const entityId = parseInt(req.body?.alphon_entity_id, 10);
  if (!uid || !entityId) return res.status(400).json({ error: 'חסרים פרטים' });

  const profile = await queryOne(
    'SELECT uid, phone, phone_verified_at FROM profiles WHERE uid = ?', [uid]
  );
  if (!profile) return res.status(404).json({ error: 'פרופיל לא נמצא' });
  if (!profile.phone_verified_at) {
    return res.status(403).json({ error: 'צריך לאמת מספר וואטסאפ לפני שליחת שאלון לרופא' });
  }

  const assignment = await queryOne(
    'SELECT * FROM questionnaire_assignments WHERE alphon_entity_id = ? AND active = 1', [entityId]
  );
  if (!assignment) return res.status(404).json({ error: 'לרופא/ה הזה אין שאלון פעיל' });

  const open = await queryOne(
    `SELECT id FROM questionnaire_runs
      WHERE assignment_id = ? AND uid = ? AND status IN ('issued','sent')
      ORDER BY id DESC LIMIT 1`,
    [assignment.id, uid]
  );
  if (open) {
    const row = await queryOne('SELECT payload FROM questionnaire_runs WHERE id = ?', [open.id]);
    const payload = parseJson(row.payload);
    const answered = await query('SELECT question_idx FROM questionnaire_answers WHERE run_id = ?', [open.id]);
    return res.json({
      ok: true, resumed: true, run_id: open.id, token: signRunToken(open.id),
      doctor: payload.doctor, title: payload.title,
      questions: payload.questions, answered_idx: answered.map((a) => a.question_idx),
    });
  }

  const q = await queryOne('SELECT * FROM questionnaires WHERE id = ?', [assignment.questionnaire_id]);
  if (!q) return res.status(404).json({ error: 'השאלון לא נמצא' });
  const supers = await query(
    `SELECT s.id, s.title, s.questions FROM questionnaire_links ql
       JOIN questionnaires s ON s.id = ql.super_id WHERE ql.questionnaire_id = ?`, [q.id]
  );
  const questions = blendQuestions(
    parseJson(q.questions),
    supers.map((s) => ({ ...s, questions: parseJson(s.questions) }))
  );

  const payload = {
    type: 'questionnaire',
    version: 1,
    questionnaire_id: q.id,
    assignment_id: assignment.id,
    title: q.title,
    doctor: { name: assignment.entity_name, specialty: assignment.entity_spec, alphon_entity_id: assignment.alphon_entity_id },
    patient: { name: null, phone: profile.phone, email: null, verified: true },
    source: 'identified',
    channel: 'web',
    theme: parseJson(q.theme),
    questions: questions.map(({ idx, q: text, expected, source }) => ({ idx, q: text, expected, source })),
  };

  const run = await query(
    `INSERT INTO questionnaire_runs
       (questionnaire_id, assignment_id, uid, source, patient_phone, channel, payload, status, sent_at)
     VALUES (?,?,?,'identified',?,'web',?,'sent',NOW())`,
    [q.id, assignment.id, uid, profile.phone, JSON.stringify(payload)]
  );

  res.json({
    ok: true, resumed: false, run_id: run.insertId, token: signRunToken(run.insertId),
    doctor: payload.doctor, title: payload.title,
    questions: payload.questions, answered_idx: [],
  });
}));

// GET /api/qr/window — how often the desk page should redraw its code.
router.get('/window', (req, res) => res.json({ window_sec: QR_WINDOW_SEC }));

export default router;
