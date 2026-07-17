import express from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { query, queryOne } from '../db.js';
import { signDoctorToken, requireDoctor, requireManager, scopedDoctorIds, ownDoctorIds } from '../middleware/auth.js';
import { config } from '../env.js';
import { enqueueRunDelivery, dispatchDueOutbox, normalizePhone } from '../services/whatsapp.js';
import { sendDigest } from '../services/digest.js';
import { deskUrl, newDeskSecret, QR_WINDOW_SEC } from '../services/qr.js';

const router = express.Router();

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Where this server is reachable, for the desk QR. PUBLIC_URL wins (behind a
// proxy it is the only thing that knows the real public name); the request's
// own origin is the dev fallback so a local run still prints a scannable code.
const requestOrigin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

// ------------------------------------------------------------------ auth ----
router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const doctor = await queryOne('SELECT * FROM doctors WHERE email = ?', [email]);
  if (!doctor || !(await bcrypt.compare(password, doctor.password_hash))) {
    return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  }
  res.json({
    token: signDoctorToken(doctor),
    doctor: { id: doctor.id, name: doctor.name, email: doctor.email, role: doctor.role, specialty: doctor.specialty },
  });
});

router.use(requireDoctor);

router.get('/me', async (req, res) => {
  const ids = await scopedDoctorIds(req.doctor);
  const linked = await query(
    `SELECT d.id, d.name, d.role, d.specialty, dl.link_type
       FROM doctor_links dl JOIN doctors d ON d.id = dl.doctor_id
      WHERE dl.owner_id = ?`, [req.doctor.id]
  );
  const sharedWithMe = await query(
    `SELECT d.id, d.name, ds.scope FROM data_shares ds
       JOIN doctors d ON d.id = ds.owner_doctor_id
      WHERE ds.target_doctor_id = ? AND ds.gdpr_consent = 1`, [req.doctor.id]
  );
  const settings = await queryOne(
    'SELECT phone, digest_enabled, last_digest_at FROM doctors WHERE id = ?', [req.doctor.id]
  );
  res.json({
    doctor: req.doctor, scope_doctor_ids: ids, linked_doctors: linked, shared_with_me: sharedWithMe,
    settings: { phone: settings?.phone || null, digest_enabled: !!settings?.digest_enabled, last_digest_at: settings?.last_digest_at || null },
  });
});

// -------------------------------------------------------- questionnaires ----
router.get('/questionnaires', async (req, res) => {
  const ids = await scopedDoctorIds(req.doctor, 'questionnaires');
  const rows = await query(
    `SELECT q.*, d.name AS doctor_name,
            (SELECT COUNT(*) FROM questionnaire_runs r WHERE r.questionnaire_id = q.id) AS runs
       FROM questionnaires q JOIN doctors d ON d.id = q.doctor_id
      WHERE q.doctor_id IN (${ids.map(() => '?').join(',')})
         OR q.id IN (SELECT questionnaire_id FROM questionnaire_collaborators WHERE doctor_id = ?)
      ORDER BY q.created_at DESC`,
    [...ids, req.doctor.id]
  );
  for (const r of rows) {
    r.theme = parseJson(r.theme); r.target = parseJson(r.target);
    r.schedule = parseJson(r.schedule); r.questions = parseJson(r.questions);
    r.supers = await query(
      `SELECT s.id, s.title FROM questionnaire_links ql JOIN questionnaires s ON s.id = ql.super_id
        WHERE ql.questionnaire_id = ?`, [r.id]
    );
  }
  res.json({ questionnaires: rows });
});

router.post('/questionnaires', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 190);
  const kind = b.kind === 'super' ? 'super' : 'regular';
  const questions = (Array.isArray(b.questions) ? b.questions : [])
    .map((q) => ({ q: String(q.q || '').slice(0, 500), expected: String(q.expected || '').slice(0, 300) }))
    .filter((q) => q.q);
  if (!title || !questions.length) return res.status(400).json({ error: 'נדרשים כותרת ולפחות שאלה אחת' });

  const r = await query(
    'INSERT INTO questionnaires (doctor_id, title, kind, theme, target, schedule, questions) VALUES (?,?,?,?,?,?,?)',
    [
      req.doctor.id, title, kind,
      JSON.stringify(b.theme || null), JSON.stringify(b.target || null),
      JSON.stringify(b.schedule || null), JSON.stringify(questions),
    ]
  );
  // link super questionnaires (blend sources) to a regular questionnaire
  if (kind === 'regular' && Array.isArray(b.super_ids)) {
    for (const sid of b.super_ids.slice(0, 4)) {
      await query('INSERT IGNORE INTO questionnaire_links (questionnaire_id, super_id) VALUES (?,?)',
        [r.insertId, parseInt(sid, 10)]);
    }
  }
  res.json({ ok: true, id: r.insertId });
});

async function ownedQuestionnaire(req, res) {
  const q = await queryOne('SELECT * FROM questionnaires WHERE id = ?', [parseInt(req.params.id, 10)]);
  if (!q) { res.status(404).json({ error: 'שאלון לא נמצא' }); return null; }
  const ids = await scopedDoctorIds(req.doctor, 'questionnaires');
  const collab = await queryOne(
    'SELECT id FROM questionnaire_collaborators WHERE questionnaire_id = ? AND doctor_id = ?',
    [q.id, req.doctor.id]
  );
  if (!ids.includes(q.doctor_id) && !collab) {
    res.status(403).json({ error: 'אין הרשאה לשאלון הזה' });
    return null;
  }
  return q;
}

// -------------------------------------------------- blend + issue as JSON ---
// Each linked super questionnaire (שאלון-על) contributes 20% of the issued
// questions, capped at two supers (40%); the doctor's own questions are the
// remaining share (min 60%). One super -> 80/20.
export function blendQuestions(own, supers) {
  const active = supers.filter((s) => s.questions.length).slice(0, 2);
  const superShare = 0.2 * active.length;              // 0 / 0.2 / 0.4
  const total = Math.max(own.length, Math.round(own.length / (1 - superShare)) || own.length);
  const out = own.map((q) => ({ ...q, source: 'own' }));
  for (const s of active) {
    const take = Math.max(1, Math.round(total * 0.2));
    for (let i = 0; i < take && i < s.questions.length; i++) {
      // spread picks evenly across the super's pool
      const idx = Math.floor((i * s.questions.length) / take);
      out.push({ ...s.questions[idx], source: `super:${s.title}` });
    }
  }
  // interleave supers into the list (every ~3rd slot) so they don't clump at the end
  const owns = out.filter((q) => q.source === 'own');
  const sups = out.filter((q) => q.source !== 'own');
  const mixed = [];
  let si = 0;
  for (let i = 0; i < owns.length; i++) {
    mixed.push(owns[i]);
    if ((i + 1) % 2 === 0 && si < sups.length) mixed.push(sups[si++]);
  }
  while (si < sups.length) mixed.push(sups[si++]);
  return mixed.map((q, idx) => ({ idx, ...q }));
}

// POST /:id/issue {patient_name, patient_phone, patient_email, channel}
// Freezes the blended question list into a run payload — JSON instructions
// ready for the WhatsApp bot or an email sender.
router.post('/questionnaires/:id/issue', async (req, res) => {
  const q = await ownedQuestionnaire(req, res);
  if (!q) return;
  if (q.kind === 'super') return res.status(400).json({ error: 'שאלון-על אינו מונפק ישירות — חברו אותו לשאלון רגיל' });

  const b = req.body || {};
  const channel = b.channel === 'email' ? 'email' : 'whatsapp';
  const patientPhone = String(b.patient_phone || '').replace(/[^\d+]/g, '').slice(0, 60) || null;
  const patientEmail = String(b.patient_email || '').trim().slice(0, 190) || null;
  if (channel === 'whatsapp' && !patientPhone) return res.status(400).json({ error: 'נדרש מספר וואטסאפ' });
  if (channel === 'email' && !patientEmail) return res.status(400).json({ error: 'נדרש אימייל' });

  const supers = await query(
    `SELECT s.id, s.title, s.questions FROM questionnaire_links ql
       JOIN questionnaires s ON s.id = ql.super_id WHERE ql.questionnaire_id = ?`, [q.id]
  );
  const questions = blendQuestions(
    parseJson(q.questions),
    supers.map((s) => ({ ...s, questions: parseJson(s.questions) }))
  );

  const doctor = await queryOne('SELECT name, specialty FROM doctors WHERE id = ?', [q.doctor_id]);
  const schedule = parseJson(q.schedule) || [];
  const now = Date.now();
  const payload = {
    type: 'questionnaire',
    version: 1,
    questionnaire_id: q.id,
    title: q.title,
    doctor: { name: doctor.name, specialty: doctor.specialty },
    patient: { name: String(b.patient_name || '').slice(0, 190) || null, phone: patientPhone, email: patientEmail },
    channel,
    theme: parseJson(q.theme),
    target: parseJson(q.target),
    intro: `שלום ${b.patient_name || ''}, כאן המרפאה של ${doctor.name}. נשמח לשמוע מה שלומך — כמה שאלות קצרות:`.trim(),
    schedule: schedule.map((s) => ({
      after_days: s.after_days,
      send_at: new Date(now + (s.after_days || 0) * 86400_000).toISOString(),
    })),
    questions: questions.map(({ idx, q: text, expected, source }) => ({ idx, q: text, expected, source })),
    answer_webhook: { method: 'POST', path: '/api/hooks/answers', body: { run_id: '<run_id>', answers: [{ idx: 0, answer: '...' }] } },
  };

  const run = await query(
    `INSERT INTO questionnaire_runs (questionnaire_id, patient_name, patient_phone, patient_email, channel, payload, scheduled_for)
     VALUES (?,?,?,?,?,?,?)`,
    [
      q.id, payload.patient.name, patientPhone, patientEmail, channel, JSON.stringify(payload),
      payload.schedule.length ? new Date(payload.schedule[0].send_at) : null,
    ]
  );
  payload.run_id = run.insertId;
  await query('UPDATE questionnaire_runs SET payload = ? WHERE id = ?', [JSON.stringify(payload), run.insertId]);

  // hand delivery to the built-in engine: one outbox row per scheduled send
  // (immediately when there's no schedule); due rows go out on the next tick
  const runRow = await queryOne('SELECT * FROM questionnaire_runs WHERE id = ?', [run.insertId]);
  const enqueued = await enqueueRunDelivery(runRow, payload);
  setImmediate(() => dispatchDueOutbox().catch((e) => console.error('[allaroundme] dispatch:', e.message)));

  res.json({ ok: true, run_id: run.insertId, enqueued_sends: enqueued, delivery_mode: config.whatsapp.mode, payload });
});

// GET /:id/runs — runs of one questionnaire.
router.get('/questionnaires/:id/runs', async (req, res) => {
  const q = await ownedQuestionnaire(req, res);
  if (!q) return;
  const runs = await query(
    `SELECT id, patient_name, patient_phone, patient_email, channel, status, scheduled_for, sent_at, created_at,
            (SELECT COUNT(*) FROM questionnaire_answers a WHERE a.run_id = questionnaire_runs.id) AS answers
       FROM questionnaire_runs WHERE questionnaire_id = ? ORDER BY created_at DESC`, [q.id]
  );
  res.json({ runs });
});

// GET /:id/report — dashboard report: runs, response rate, answers per question.
router.get('/questionnaires/:id/report', async (req, res) => {
  const q = await ownedQuestionnaire(req, res);
  if (!q) return;
  const totals = await queryOne(
    `SELECT COUNT(*) AS runs,
            SUM(status = 'answered') AS answered,
            SUM(status = 'issued') AS pending
       FROM questionnaire_runs WHERE questionnaire_id = ?`, [q.id]
  );
  const perQuestion = await query(
    `SELECT a.question_idx, a.question, COUNT(*) AS answers,
            GROUP_CONCAT(a.answer ORDER BY a.answered_at DESC SEPARATOR ' | ') AS sample
       FROM questionnaire_answers a
       JOIN questionnaire_runs r ON r.id = a.run_id
      WHERE r.questionnaire_id = ?
      GROUP BY a.question_idx, a.question ORDER BY a.question_idx`, [q.id]
  );
  for (const p of perQuestion) p.sample = String(p.sample || '').split(' | ').slice(0, 10);
  const collaborators = await query(
    `SELECT d.name, qc.role FROM questionnaire_collaborators qc JOIN doctors d ON d.id = qc.doctor_id
      WHERE qc.questionnaire_id = ?`, [q.id]
  );
  res.json({
    questionnaire: { id: q.id, title: q.title, kind: q.kind, theme: parseJson(q.theme), target: parseJson(q.target) },
    totals: { runs: Number(totals.runs), answered: Number(totals.answered || 0), pending: Number(totals.pending || 0) },
    per_question: perQuestion,
    collaborators,
  });
});

// ------------------------------------------------- sharing / collaboration --
// POST /shares {target_doctor_id, scope, consent_text} — GDPR-consented share.
router.post('/shares', async (req, res) => {
  const target = parseInt(req.body?.target_doctor_id, 10);
  const scope = ['reports', 'questionnaires', 'all'].includes(req.body?.scope) ? req.body.scope : 'reports';
  if (!target || target === req.doctor.id) return res.status(400).json({ error: 'יעד שיתוף לא תקין' });
  if (!req.body?.gdpr_consent) return res.status(400).json({ error: 'שיתוף מחייב אישור GDPR מפורש' });
  const exists = await queryOne('SELECT id FROM doctors WHERE id = ?', [target]);
  if (!exists) return res.status(404).json({ error: 'הרופא לא נמצא' });
  await query(
    `INSERT INTO data_shares (owner_doctor_id, target_doctor_id, scope, gdpr_consent, consent_text)
     VALUES (?,?,?,1,?) ON DUPLICATE KEY UPDATE gdpr_consent = 1, consent_text = VALUES(consent_text)`,
    [req.doctor.id, target, scope, String(req.body?.consent_text || '').slice(0, 500) || null]
  );
  res.json({ ok: true });
});

router.get('/shares', async (req, res) => {
  const given = await query(
    `SELECT ds.id, ds.scope, ds.consent_text, ds.created_at, d.name AS target_name, d.id AS target_id
       FROM data_shares ds JOIN doctors d ON d.id = ds.target_doctor_id
      WHERE ds.owner_doctor_id = ?`, [req.doctor.id]
  );
  const received = await query(
    `SELECT ds.id, ds.scope, ds.created_at, d.name AS owner_name, d.id AS owner_id
       FROM data_shares ds JOIN doctors d ON d.id = ds.owner_doctor_id
      WHERE ds.target_doctor_id = ? AND ds.gdpr_consent = 1`, [req.doctor.id]
  );
  res.json({ given, received });
});

router.delete('/shares/:id', async (req, res) => {
  await query('DELETE FROM data_shares WHERE id = ? AND owner_doctor_id = ?',
    [parseInt(req.params.id, 10), req.doctor.id]);
  res.json({ ok: true });
});

// POST /questionnaires/:id/collaborators {doctor_id, role} — joint runs / publication.
router.post('/questionnaires/:id/collaborators', async (req, res) => {
  const q = await ownedQuestionnaire(req, res);
  if (!q) return;
  const docId = parseInt(req.body?.doctor_id, 10);
  const role = ['co_runner', 'viewer', 'publisher'].includes(req.body?.role) ? req.body.role : 'viewer';
  if (!docId) return res.status(400).json({ error: 'חסר doctor_id' });
  await query(
    `INSERT INTO questionnaire_collaborators (questionnaire_id, doctor_id, role) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [q.id, docId, role]
  );
  res.json({ ok: true });
});

// -------------------------------------------------- reviews about me --------
// GET /reviews — reviews on me and on the doctors of my organisation (incl.
// flagged ones, so the doctor sees what the community reported). Uses
// ownDoctorIds, not data shares: a review inbox is not shareable research data.
router.get('/reviews', async (req, res) => {
  const ids = await ownDoctorIds(req.doctor);
  const names = (await query(
    `SELECT name FROM doctors WHERE id IN (${ids.map(() => '?').join(',')})`, ids
  )).map((r) => r.name);
  const rows = await query(
    `SELECT r.id, r.entity_name, r.overall_stars, r.domains, r.text, r.status,
            r.verified_visit, r.reply_text, r.reply_doctor_name, r.reply_at, r.created_at,
            (SELECT COUNT(*) FROM review_flags f WHERE f.review_id = r.id) AS flags
       FROM reviews r WHERE r.entity_name IN (${names.map(() => '?').join(',')})
      ORDER BY r.created_at DESC LIMIT 100`,
    names
  );
  for (const r of rows) r.domains = typeof r.domains === 'string' ? JSON.parse(r.domains) : r.domains;
  res.json({ names, reviews: rows });
});

// POST /reviews/:id/reply {text} — the doctor's right-of-reply, shown with the review.
router.post('/reviews/:id/reply', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!id || !text) return res.status(400).json({ error: 'חסר טקסט תגובה' });
  const review = await queryOne('SELECT id, entity_name FROM reviews WHERE id = ?', [id]);
  if (!review) return res.status(404).json({ error: 'הביקורת לא נמצאה' });
  // only the doctor herself or her clinic/trial owner may speak in her name
  const ids = await ownDoctorIds(req.doctor);
  const owner = await queryOne(
    `SELECT id FROM doctors WHERE name = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [review.entity_name, ...ids]
  );
  if (!owner) return res.status(403).json({ error: 'אפשר להגיב רק על ביקורות שלך או של המרפאה שלך' });
  await query(
    'UPDATE reviews SET reply_text = ?, reply_doctor_name = ?, reply_at = NOW() WHERE id = ?',
    [text, req.doctor.name, id]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------ digest settings -----
// PATCH /me {phone, digest_enabled} — WhatsApp number + on/off for the daily digest.
router.patch('/me', async (req, res) => {
  const sets = [], vals = [];
  if ('phone' in (req.body || {})) {
    const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
    if (req.body.phone && !phone) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    sets.push('phone = ?'); vals.push(phone);
  }
  if ('digest_enabled' in (req.body || {})) {
    sets.push('digest_enabled = ?'); vals.push(req.body.digest_enabled ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ error: 'אין מה לעדכן' });
  await query(`UPDATE doctors SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.doctor.id]);
  const me = await queryOne('SELECT id, phone, digest_enabled FROM doctors WHERE id = ?', [req.doctor.id]);
  res.json({ ok: true, phone: me.phone, digest_enabled: !!me.digest_enabled });
});

// POST /digest/preview — build + send my digest right now (also proves the channel).
router.post('/digest/preview', async (req, res) => {
  const doctor = await queryOne('SELECT * FROM doctors WHERE id = ?', [req.doctor.id]);
  const result = await sendDigest(doctor, { force: true });
  res.json({ ok: true, ...result });
});

// GET /doctors — directory for share/collaborator pickers.
router.get('/doctors', async (req, res) => {
  const rows = await query('SELECT id, name, role, specialty FROM doctors WHERE id <> ? ORDER BY name', [req.doctor.id]);
  res.json({ doctors: rows });
});

// ------------------------------------------------ ספר טלפונים (manager) -----
// GET /phonebook?q=&specialty=&city=&has_phone=&has_whatsapp=&has_questionnaire=&limit=&offset=
//
// The alphon's directory is the source of truth for *who exists*; this database
// is the source of truth for *who has a questionnaire*. Which one drives the
// query depends on the filter, because each can only paginate over what it
// knows:
//
//   רק עם שאלונים  -> our assignment table drives, and we resolve the page's
//                     cards from the alphon in one ids= hop. (Paging the alphon
//                     and filtering the page locally would search 70k contacts
//                     for 30 needles and return mostly empty pages.)
//   everything else -> the alphon drives, and we annotate its page with ours.
//
// Either way a manager sees the public card plus coverage — never an answer.
async function fetchDirectory(params) {
  const r = await fetch(`${config.eshkolotApi}/public/directory?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

async function assignmentsFor(entityIds) {
  if (!entityIds.length) return new Map();
  const rows = await query(
    `SELECT a.id, a.alphon_entity_id, a.category, a.active, a.deliver_phone, q.title,
            (SELECT COUNT(*) FROM questionnaire_runs r WHERE r.assignment_id = a.id) AS runs,
            (SELECT COUNT(*) FROM questionnaire_runs r WHERE r.assignment_id = a.id AND r.status = 'answered') AS answered
       FROM questionnaire_assignments a JOIN questionnaires q ON q.id = a.questionnaire_id
      WHERE a.alphon_entity_id IN (${entityIds.map(() => '?').join(',')})`,
    entityIds
  );
  return new Map(rows.map((a) => [a.alphon_entity_id, {
    assignment_id: a.id, title: a.title, category: a.category, active: !!a.active,
    runs: Number(a.runs), answered: Number(a.answered), deliverable: !!a.deliver_phone,
  }]));
}

router.get('/phonebook', requireManager, async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const truthy = (v) => ['1', 'true'].includes(String(v || '').toLowerCase());
  const onlyWithQ = truthy(req.query.has_questionnaire);
  const search = String(req.query.q || '').trim();

  try {
    if (onlyWithQ) {
      // --- our table drives ------------------------------------------------
      const where = ['1=1'], vals = [];
      if (search) {
        where.push('(a.entity_name LIKE ? OR a.entity_spec LIKE ? OR a.entity_city LIKE ?)');
        vals.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (req.query.category) { where.push('a.category = ?'); vals.push(String(req.query.category)); }
      if (req.query.city) { where.push('a.entity_city LIKE ?'); vals.push(`%${req.query.city}%`); }
      if (truthy(req.query.has_whatsapp)) where.push('a.deliver_phone IS NOT NULL');

      const totals = await queryOne(
        `SELECT COUNT(*) AS n FROM questionnaire_assignments a WHERE ${where.join(' AND ')}`, vals
      );
      // LIMIT/OFFSET are interpolated, not bound: mysql2's prepared statements
      // reject placeholders there. Both are already parseInt-clamped above.
      const rows = await query(
        `SELECT a.alphon_entity_id FROM questionnaire_assignments a
          WHERE ${where.join(' AND ')} ORDER BY a.entity_name LIMIT ${limit} OFFSET ${offset}`,
        vals
      );
      const ids = rows.map((r) => r.alphon_entity_id);

      // resolve this page's public cards in one hop; if the alphon is down we
      // still answer from our cached copy rather than failing the whole screen
      let cards = new Map();
      if (ids.length) {
        try {
          const up = await fetchDirectory(new URLSearchParams({ ids: ids.join(','), limit: String(ids.length) }));
          cards = new Map(up.entities.map((e) => [e.id, e]));
        } catch { /* fall through to the cached card below */ }
      }
      const local = ids.length
        ? await query(
            `SELECT alphon_entity_id, entity_name, entity_spec, entity_city, deliver_phone
               FROM questionnaire_assignments WHERE alphon_entity_id IN (${ids.map(() => '?').join(',')})`,
            ids
          )
        : [];
      const byId = new Map(local.map((l) => [l.alphon_entity_id, l]));
      const assignments = await assignmentsFor(ids);

      return res.json({
        total: Number(totals.n), limit, offset, count: ids.length, source: 'assignments',
        entities: ids.map((id) => {
          const card = cards.get(id);
          const l = byId.get(id);
          return card
            ? { ...card, questionnaire: assignments.get(id) || null }
            : {
                id, name: l.entity_name, spec: l.entity_spec, city: l.entity_city,
                type: 'רופא', org: null, address: null, verified: false,
                phone: null, wa: l.deliver_phone || null, stale_card: true,
                questionnaire: assignments.get(id) || null,
              };
        }),
      });
    }

    // --- the alphon drives ---------------------------------------------------
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const key of ['q', 'specialty', 'city', 'tag', 'type', 'has_phone', 'has_whatsapp']) {
      if (req.query[key]) params.set(key, String(req.query[key]));
    }
    const upstream = await fetchDirectory(params);
    const assignments = await assignmentsFor(upstream.entities.map((e) => e.id));
    res.json({
      total: upstream.total, limit, offset, count: upstream.entities.length, source: 'alphon',
      entities: upstream.entities.map((e) => ({ ...e, questionnaire: assignments.get(e.id) || null })),
    });
  } catch (e) {
    // Don't blame the alphon for our own faults — this catch covers our queries
    // too, and a wrong finger-point here costs someone an afternoon.
    console.error('[allaroundme] phonebook failed:', e.message);
    res.status(502).json({
      error: 'ספר הטלפונים אינו זמין כרגע',
      detail: String(e.message || e).slice(0, 120),
    });
  }
});

// GET /phonebook/categories — the assignment coverage, for the filter chips.
router.get('/phonebook/categories', requireManager, async (req, res) => {
  const rows = await query(
    `SELECT a.category, q.id AS questionnaire_id, q.title, COUNT(*) AS doctors,
            SUM(a.deliver_phone IS NOT NULL) AS reachable
       FROM questionnaire_assignments a JOIN questionnaires q ON q.id = a.questionnaire_id
      GROUP BY a.category, q.id, q.title ORDER BY a.category`
  );
  res.json({
    categories: rows.map((r) => ({
      category: r.category, questionnaire_id: r.questionnaire_id, title: r.title,
      doctors: Number(r.doctors), reachable: Number(r.reachable),
    })),
  });
});

// POST /phonebook/:entityId/assign {questionnaire_id} — put a category
// questionnaire on an alphon doctor who does not have one.
router.post('/phonebook/:entityId/assign', requireManager, async (req, res) => {
  const entityId = parseInt(req.params.entityId, 10);
  const qid = parseInt(req.body?.questionnaire_id, 10);
  if (!entityId || !qid) return res.status(400).json({ error: 'חסר מזהה רופא או שאלון' });

  const q = await queryOne('SELECT id, title FROM questionnaires WHERE id = ?', [qid]);
  if (!q) return res.status(404).json({ error: 'השאלון לא נמצא' });

  // The alphon is the authority on the doctor's card — never trust the client's
  // copy. Resolve by id, not by name: the card's `name` is title+display_name
  // ("ד\"ר לוי") while the alphon searches display_name ("לוי"), so a q= lookup
  // finds nothing for every titled doctor — which is all of them.
  let entity;
  try {
    const r = await fetch(`${config.eshkolotApi}/public/directory?ids=${entityId}&limit=1`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = await r.json();
    entity = (j.entities || [])[0];
  } catch {
    return res.status(502).json({ error: 'ספר הטלפונים אינו זמין כרגע' });
  }
  if (!entity) return res.status(404).json({ error: 'הרופא לא נמצא בספר הטלפונים' });

  const category = await queryOne(
    'SELECT category FROM questionnaire_assignments WHERE questionnaire_id = ? LIMIT 1', [qid]
  );
  // On re-assign, deliver_phone is left exactly as it is. Re-assigning means
  // "(re)activate this doctor's questionnaire", not "re-sync from the alphon" —
  // and a manager may have corrected the number by hand (PATCH /assignments/:id)
  // precisely because the alphon's listed one was wrong. Re-syncing it here
  // would silently undo that correction and send a patient's answers to the
  // wrong number. desk_secret is likewise only set on first insert: rotating it
  // would invalidate every printed desk code.
  await query(
    `INSERT INTO questionnaire_assignments
       (questionnaire_id, alphon_entity_id, entity_name, entity_spec, entity_city, category, deliver_phone, desk_secret)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE active = 1, entity_name = VALUES(entity_name),
       entity_spec = VALUES(entity_spec), entity_city = VALUES(entity_city)`,
    [
      qid, entity.id, entity.name, entity.spec || null, entity.city || null,
      category?.category || q.title, entity.wa || null, newDeskSecret(),
    ]
  );
  const row = await queryOne(
    'SELECT id FROM questionnaire_assignments WHERE questionnaire_id = ? AND alphon_entity_id = ?', [qid, entityId]
  );
  res.json({ ok: true, assignment_id: row.id, deliverable: !!entity.wa });
});

// PATCH /assignments/:id {active, deliver_phone, deliver_email}
router.patch('/assignments/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sets = [], vals = [];
  if ('active' in (req.body || {})) { sets.push('active = ?'); vals.push(req.body.active ? 1 : 0); }
  if ('deliver_phone' in (req.body || {})) {
    const phone = req.body.deliver_phone ? normalizePhone(req.body.deliver_phone) : null;
    if (req.body.deliver_phone && !phone) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    sets.push('deliver_phone = ?'); vals.push(phone);
  }
  if ('deliver_email' in (req.body || {})) {
    sets.push('deliver_email = ?'); vals.push(String(req.body.deliver_email || '').slice(0, 190) || null);
  }
  if (!sets.length) return res.status(400).json({ error: 'אין מה לעדכן' });
  await query(`UPDATE questionnaire_assignments SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  res.json({ ok: true });
});

// GET /assignments/:id/desk — the rotating desk QR.
//
// Returns the URL to encode *now* plus the seconds left on it; the desk page
// re-fetches on that beat. The desk secret itself never leaves the server.
router.get('/assignments/:id/desk', requireManager, async (req, res) => {
  const a = await queryOne('SELECT * FROM questionnaire_assignments WHERE id = ?', [parseInt(req.params.id, 10)]);
  if (!a) return res.status(404).json({ error: 'השיוך לא נמצא' });
  let url;
  try {
    url = deskUrl(a, { base: requestOrigin(req) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({
    assignment_id: a.id,
    doctor: { name: a.entity_name, specialty: a.entity_spec, alphon_entity_id: a.alphon_entity_id },
    url,
    window_sec: QR_WINDOW_SEC,
    expires_in_sec: QR_WINDOW_SEC - (Math.floor(Date.now() / 1000) % QR_WINDOW_SEC),
    deliverable: !!(a.deliver_phone || a.deliver_email),
  });
});

// GET /assignments/:id/desk.svg — the same rotating code, as a scannable image.
// Rendered server-side so the desk page needs no QR library, works offline, and
// never has to be told the URL it is encoding.
router.get('/assignments/:id/desk.svg', requireManager, async (req, res) => {
  const a = await queryOne('SELECT * FROM questionnaire_assignments WHERE id = ?', [parseInt(req.params.id, 10)]);
  if (!a) return res.status(404).send('not found');
  let svg;
  try {
    svg = await QRCode.toString(deskUrl(a, { base: requestOrigin(req) }), {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    });
  } catch (e) {
    return res.status(500).send(e.message);
  }
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'no-store');   // it changes every window — never cache it
  res.send(svg);
});

// GET /assignments/:id/report — de-identified results for one assigned doctor.
// There is no patient-level view here by design: once answers reach the doctor
// this database holds only the husk (see services/phi.js).
router.get('/assignments/:id/report', requireManager, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = await queryOne(
    `SELECT a.*, q.title FROM questionnaire_assignments a
       JOIN questionnaires q ON q.id = a.questionnaire_id WHERE a.id = ?`, [id]
  );
  if (!a) return res.status(404).json({ error: 'השיוך לא נמצא' });
  const totals = await queryOne(
    `SELECT COUNT(*) AS runs,
            SUM(status = 'answered') AS answered,
            SUM(source = 'qr') AS by_qr,
            SUM(source = 'identified') AS by_identified,
            SUM(delivered_to_doctor_at IS NOT NULL) AS delivered,
            SUM(purged_at IS NOT NULL) AS purged
       FROM questionnaire_runs WHERE assignment_id = ?`, [id]
  );
  res.json({
    assignment: { id: a.id, doctor: a.entity_name, category: a.category, title: a.title },
    totals: {
      runs: Number(totals.runs), answered: Number(totals.answered || 0),
      by_qr: Number(totals.by_qr || 0), by_identified: Number(totals.by_identified || 0),
      delivered: Number(totals.delivered || 0), purged: Number(totals.purged || 0),
    },
  });
});

// GET /analytics — role-scoped overview: sessions, transcripts, top actions.
router.get('/analytics', async (req, res) => {
  const sessions = await queryOne(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT uid) AS users,
            SUM(display_mode = 'standalone') AS pwa_sessions
       FROM app_sessions WHERE started_at > NOW() - INTERVAL 30 DAY`
  );
  const transcripts = await query(
    `SELECT id, source, transcript, ai_recommendation, urgent, action_taken, created_at
       FROM transcripts ORDER BY created_at DESC LIMIT 25`
  );
  const topEvents = await query(
    `SELECT type, COUNT(*) AS n FROM app_events
      WHERE created_at > NOW() - INTERVAL 30 DAY GROUP BY type ORDER BY n DESC LIMIT 12`
  );
  res.json({
    sessions: { total: Number(sessions.total), unique_users: Number(sessions.users), pwa: Number(sessions.pwa_sessions || 0) },
    latest_transcripts: transcripts,
    top_events: topEvents,
  });
});

export default router;
