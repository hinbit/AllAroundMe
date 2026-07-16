// WhatsApp delivery: pluggable transport + the one-question-at-a-time
// questionnaire conversation. Everything outgoing goes through the wa_outbox
// table so the trail is auditable and scheduled sends survive restarts.
//
// WHATSAPP_MODE:
//   log     — dev default: messages are printed to the server log
//   cloud   — Meta WhatsApp Cloud API (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID)
//   webhook — POST {to, text, run_id, kind} to an external bot (WHATSAPP_BOT_URL)
import { query, queryOne } from '../db.js';
import { config } from '../env.js';
import { sendMail, mailEnabled } from './mailer.js';

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Normalize a phone to digits with country code (Israeli 0-prefix -> 972).
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '972' + p.slice(1);
  return p.length >= 8 && p.length <= 15 ? p : '';
}

// ------------------------------------------------------------ transports ----
async function transportSend(to, text, meta = {}) {
  const { mode, token, phoneId, botUrl } = config.whatsapp;
  if (mode === 'cloud' && token && phoneId) {
    const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`cloud API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return 'cloud';
  }
  if (mode === 'webhook' && botUrl) {
    const r = await fetch(botUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text, ...meta }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`bot webhook ${r.status}`);
    return 'webhook';
  }
  console.log(`[allaroundme] [wa:log] -> ${to}\n${text.split('\n').map((l) => '    ' + l).join('\n')}`);
  return 'log';
}

// Send now + record in the outbox (kind: otp / digest / system).
export async function sendWhatsApp(to, text, kind = 'system', runId = null) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error('מספר טלפון לא תקין');
  let mode = null, error = null;
  try {
    mode = await transportSend(phone, text, { kind, run_id: runId });
  } catch (e) {
    error = String(e.message || e).slice(0, 300);
  }
  await query(
    `INSERT INTO wa_outbox (kind, channel, to_phone, body, run_id, status, attempts, mode, last_error, sent_at)
     VALUES (?,?,?,?,?,?,1,?,?,${error ? 'NULL' : 'NOW()'})`,
    [kind, 'whatsapp', phone, text.slice(0, 4000), runId, error ? 'failed' : 'sent', mode, error]
  );
  if (error) throw new Error(error);
  return { mode };
}

// -------------------------------------------- questionnaire conversation ----
function questionText(payload, pos) {
  const q = payload.questions[pos];
  const total = payload.questions.length;
  return `שאלה ${pos + 1}/${total}:\n${q.q}`;
}

// Dispatch one due questionnaire outbox row: send intro + first question,
// open (or restart) the conversation for this phone.
export async function dispatchQuestionnaireRow(row) {
  const run = await queryOne('SELECT * FROM questionnaire_runs WHERE id = ?', [row.run_id]);
  if (!run) throw new Error(`run ${row.run_id} not found`);
  const payload = parseJson(run.payload);

  if (row.channel === 'email' || run.channel === 'email') {
    const to = run.patient_email;
    if (!to) throw new Error('אין אימייל למטופל');
    const lines = payload.questions.map((q, i) => `${i + 1}. ${q.q}`);
    await sendMail(
      to,
      `שאלון מ${payload.doctor?.name || 'המרפאה'}: ${payload.title}`,
      `${payload.intro}\n\n${lines.join('\n')}\n\nאפשר להשיב במייל חוזר על כל שאלה בשורה נפרדת.`
    );
  } else {
    const phone = normalizePhone(run.patient_phone);
    if (!phone) throw new Error('אין מספר וואטסאפ למטופל');
    // a new scheduled send restarts the flow (follow-up round on the same run)
    await query(
      `UPDATE wa_conversations SET status = 'expired' WHERE phone = ? AND status = 'active'`,
      [phone]
    );
    await query(
      'INSERT INTO wa_conversations (phone, run_id, question_pos) VALUES (?,?,0)',
      [phone, run.id]
    );
    await transportSend(phone, `${payload.intro}\n\n${questionText(payload, 0)}`, {
      kind: 'questionnaire', run_id: run.id,
    });
  }
  await query(
    `UPDATE questionnaire_runs SET status = 'sent', sent_at = COALESCE(sent_at, NOW())
      WHERE id = ? AND status IN ('issued','sent')`,
    [run.id]
  );
}

// Handle an inbound patient message (from the Meta webhook, an external bot,
// or the local simulator): store the answer, ask the next question.
export async function handleInbound(fromPhone, text) {
  const phone = normalizePhone(fromPhone);
  const body = String(text || '').trim().slice(0, 4000);
  if (!phone || !body) return { ok: false, reason: 'empty' };

  const conv = await queryOne(
    `SELECT * FROM wa_conversations WHERE phone = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (!conv) return { ok: false, reason: 'no-active-conversation' };

  const run = await queryOne('SELECT * FROM questionnaire_runs WHERE id = ?', [conv.run_id]);
  const payload = parseJson(run.payload);
  const pos = conv.question_pos;
  const q = payload.questions[pos];
  if (!q) { // shouldn't happen — close defensively
    await query(`UPDATE wa_conversations SET status = 'done' WHERE id = ?`, [conv.id]);
    return { ok: false, reason: 'out-of-range' };
  }

  await query(
    'INSERT INTO questionnaire_answers (run_id, question_idx, question, answer) VALUES (?,?,?,?)',
    [run.id, q.idx, q.q, body]
  );

  const nextPos = pos + 1;
  if (nextPos < payload.questions.length) {
    await query('UPDATE wa_conversations SET question_pos = ? WHERE id = ?', [nextPos, conv.id]);
    await transportSend(phone, questionText(payload, nextPos), { kind: 'questionnaire', run_id: run.id });
    return { ok: true, saved: true, next: nextPos, done: false };
  }

  await query(`UPDATE wa_conversations SET status = 'done' WHERE id = ?`, [conv.id]);
  await query(`UPDATE questionnaire_runs SET status = 'answered' WHERE id = ?`, [run.id]);
  await transportSend(
    phone,
    `תודה רבה ${payload.patient?.name || ''}! 🙏 התשובות הועברו ל${payload.doctor?.name || 'המרפאה'}. רפואה שלמה 🎯`.replace('  ', ' '),
    { kind: 'questionnaire', run_id: run.id }
  );
  return { ok: true, saved: true, done: true };
}

// Enqueue delivery for a freshly issued run — one outbox row per schedule
// entry (or one immediate row when there is no schedule).
export async function enqueueRunDelivery(run, payload) {
  const times = (payload.schedule || []).map((s) => new Date(s.send_at)).filter((d) => !isNaN(d));
  if (!times.length) times.push(new Date());
  for (const due of times) {
    await query(
      'INSERT INTO wa_outbox (kind, channel, to_phone, to_email, run_id, due_at) VALUES (?,?,?,?,?,?)',
      ['questionnaire', payload.channel === 'email' ? 'email' : 'whatsapp',
       normalizePhone(run.patient_phone) || null, run.patient_email || null, run.id, due]
    );
  }
  return times.length;
}

// One scheduler tick: send everything that is due.
export async function dispatchDueOutbox() {
  const due = await query(
    `SELECT * FROM wa_outbox WHERE status = 'pending' AND due_at <= NOW() AND attempts < 3
      ORDER BY due_at LIMIT 20`
  );
  let sent = 0;
  for (const row of due) {
    try {
      if (row.kind === 'questionnaire') {
        await dispatchQuestionnaireRow(row);
      } else if (row.channel === 'email') {
        await sendMail(row.to_email, 'מסביב · AllAroundMe', row.body || '');
      } else {
        await transportSend(row.to_phone, row.body || '', { kind: row.kind, run_id: row.run_id });
      }
      await query(
        `UPDATE wa_outbox SET status = 'sent', attempts = attempts + 1, mode = ?, sent_at = NOW() WHERE id = ?`,
        [config.whatsapp.mode, row.id]
      );
      sent += 1;
    } catch (e) {
      const err = String(e.message || e).slice(0, 300);
      await query(
        `UPDATE wa_outbox SET attempts = attempts + 1, last_error = ?,
                status = IF(attempts + 1 >= 3, 'failed', 'pending') WHERE id = ?`,
        [err, row.id]
      );
      console.error(`[allaroundme] outbox #${row.id} (${row.kind}) failed: ${err}`);
    }
  }
  return { due: due.length, sent };
}

export { mailEnabled };
