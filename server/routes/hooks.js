import express from 'express';
import { query, queryOne } from '../db.js';

const router = express.Router();

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
