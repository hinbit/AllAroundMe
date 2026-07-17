import express from 'express';
import { query, queryOne } from '../db.js';
import { config } from '../env.js';
import { handleInbound } from '../services/whatsapp.js';
import { deliverRunToDoctor } from '../services/phi.js';

const router = express.Router();

// ------------------------------------------------ WhatsApp inbound hooks ----

// GET /api/hooks/whatsapp — Meta Cloud API webhook verification handshake.
router.get('/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.send(req.query['hub.challenge'] || '');
  }
  res.sendStatus(403);
});

// POST /api/hooks/whatsapp — Meta Cloud API inbound messages: every text
// message from a patient advances their active questionnaire conversation.
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // ack fast — Meta retries otherwise
  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        for (const msg of change.value?.messages || []) {
          if (msg.type === 'text' && msg.from) {
            await handleInbound(msg.from, msg.text?.body);
          }
        }
      }
    }
  } catch (e) {
    console.error('[allaroundme] whatsapp webhook failed:', e.message);
  }
});

// POST /api/hooks/wa-inbound {from, text} — generic inbound for external bots
// (webhook mode) and for local testing of the conversation flow.
router.post('/wa-inbound', async (req, res) => {
  const result = await handleInbound(req.body?.from, req.body?.text);
  res.status(result.ok ? 200 : 404).json(result);
});

// POST /api/hooks/answers — the WhatsApp bot / email flow posts patient
// answers back here. Body: { run_id, answers: [{idx, answer}] }.
router.post('/answers', async (req, res) => {
  const runId = parseInt(req.body?.run_id, 10);
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (!runId || !answers.length) return res.status(400).json({ error: 'חסרים run_id או answers' });

  const run = await queryOne('SELECT id, payload FROM questionnaire_runs WHERE id = ?', [runId]);
  if (!run) return res.status(404).json({ error: 'הרצה לא נמצאה' });
  const payload = typeof run.payload === 'string' ? JSON.parse(run.payload) : run.payload;
  const byIdx = new Map((payload.questions || []).map((q) => [q.idx, q.q]));

  let saved = 0;
  for (const a of answers.slice(0, 100)) {
    const idx = parseInt(a.idx, 10);
    if (Number.isNaN(idx) || !byIdx.has(idx)) continue;
    await query(
      'INSERT INTO questionnaire_answers (run_id, question_idx, question, answer) VALUES (?,?,?,?)',
      [runId, idx, byIdx.get(idx), String(a.answer || '').slice(0, 4000)]
    );
    saved += 1;
  }
  if (saved) {
    await query(`UPDATE questionnaire_runs SET status = 'answered', sent_at = COALESCE(sent_at, NOW()) WHERE id = ?`, [runId]);
    // same rule as the WhatsApp flow: hand the answers to the doctor's own
    // channel, then drop our identifying copy
    await deliverRunToDoctor(runId);
  }
  res.json({ ok: true, saved });
});

// POST /api/hooks/sent — the bot confirms delivery. Body: { run_id }.
router.post('/sent', async (req, res) => {
  const runId = parseInt(req.body?.run_id, 10);
  if (!runId) return res.status(400).json({ error: 'חסר run_id' });
  await query(`UPDATE questionnaire_runs SET status = 'sent', sent_at = NOW() WHERE id = ? AND status = 'issued'`, [runId]);
  res.json({ ok: true });
});

export default router;
