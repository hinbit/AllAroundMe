import express from 'express';
import { query, queryOne } from '../db.js';

const router = express.Router();

// POST /api/reviews — create a review for a doctor/entity.
// Either overall_stars (1-5) or up to five named domains each with 1-5 stars,
// plus optional text / transcribed voice note. Giving a review opts the user
// into the reviews community and marks the chosen doctor as rated.
router.post('/reviews', async (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '').slice(0, 24);
  const name = String(b.entity_name || '').trim().slice(0, 190);
  if (!uid || !name) return res.status(400).json({ error: 'חסרים uid או שם רופא' });

  const overall = b.overall_stars ? Math.min(5, Math.max(1, parseInt(b.overall_stars, 10))) : null;
  let domains = null;
  if (Array.isArray(b.domains) && b.domains.length) {
    domains = b.domains.slice(0, 5).map((d) => ({
      name: String(d.name || '').slice(0, 60),
      stars: Math.min(5, Math.max(1, parseInt(d.stars, 10) || 1)),
    })).filter((d) => d.name);
  }
  if (!overall && !domains) return res.status(400).json({ error: 'נדרש דירוג כוכבים או תחומים' });

  // "verified visit": the reviewer actually contacted this doctor through the
  // app (chosen_doctors rows are only created by the contact buttons on the map)
  const chosen = await queryOne(
    'SELECT id FROM chosen_doctors WHERE uid = ? AND entity_name = ?', [uid, name]
  );

  const r = await query(
    `INSERT INTO reviews (uid, entity_id, entity_name, overall_stars, domains, text, voice_transcript, verified_visit)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      uid, parseInt(b.entity_id, 10) || null, name, overall,
      domains ? JSON.stringify(domains) : null,
      String(b.text || '').slice(0, 4000) || null,
      String(b.voice_transcript || '').slice(0, 4000) || null,
      chosen ? 1 : 0,
    ]
  );
  await query('UPDATE chosen_doctors SET rated = 1 WHERE uid = ? AND entity_name = ?', [uid, name]);
  await query(
    'UPDATE profiles SET reviews_given = reviews_given + 1, points = points + 5, allow_reviews = 1 WHERE uid = ?',
    [uid]
  );
  res.json({ ok: true, review_id: r.insertId, points_earned: 5, verified_visit: !!chosen });
});

// POST /api/reviews/:id/flag {uid, reason} — community abuse report.
// Three distinct reporters auto-hide the review pending the doctor/moderation.
router.post('/reviews/:id/flag', async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  const uid = String(req.body?.uid || '').slice(0, 24);
  if (!reviewId || !uid) return res.status(400).json({ error: 'חסרים פרטים' });
  const review = await queryOne('SELECT id, uid, status FROM reviews WHERE id = ?', [reviewId]);
  if (!review) return res.status(404).json({ error: 'הביקורת לא נמצאה' });
  if (review.uid === uid) return res.status(400).json({ error: 'אי אפשר לדווח על ביקורת של עצמך' });
  await query(
    'INSERT IGNORE INTO review_flags (review_id, uid, reason) VALUES (?,?,?)',
    [reviewId, uid, String(req.body?.reason || '').slice(0, 300) || null]
  );
  const flags = await queryOne('SELECT COUNT(*) AS n FROM review_flags WHERE review_id = ?', [reviewId]);
  if (Number(flags.n) >= 3 && review.status === 'visible') {
    await query(`UPDATE reviews SET status = 'flagged' WHERE id = ?`, [reviewId]);
  }
  res.json({ ok: true, flags: Number(flags.n), hidden: Number(flags.n) >= 3 });
});

// GET /api/reviews/feed?uid= — what this user is entitled to see.
// Only users who gave reviews see others' reviews at all; a user with few
// reviews sees just 3-4 random ones; from 3 reviews up he unlocks the daily
// top-rated feed.
router.get('/reviews/feed', async (req, res) => {
  const uid = String(req.query.uid || '').slice(0, 24);
  const profile = uid ? await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]) : null;
  const given = profile ? profile.reviews_given : 0;
  if (!profile || !profile.allow_reviews || given < 1) {
    return res.json({ mode: 'locked', reviews: [], message: 'תנו ביקורת ראשונה כדי לראות ביקורות של אחרים' });
  }

  const withMeta = async (rows) => {
    for (const row of rows) {
      const meta = await queryOne(
        'SELECT COUNT(*) AS n, AVG(stars) AS avg_stars FROM review_reviews WHERE review_id = ?',
        [row.id]
      );
      row.meta_reviews = { count: Number(meta.n), avg_stars: meta.avg_stars ? Number(meta.avg_stars).toFixed(1) : null };
      row.domains = typeof row.domains === 'string' ? JSON.parse(row.domains) : row.domains;
      delete row.uid;
    }
    return rows;
  };

  if (given < 3) {
    const rows = await query(
      `SELECT id, entity_name, overall_stars, domains, text, created_at,
              verified_visit, reply_text, reply_doctor_name, reply_at
         FROM reviews WHERE status = 'visible' AND uid <> ? ORDER BY RAND() LIMIT 4`,
      [uid]
    );
    return res.json({ mode: 'random-few', given, reviews: await withMeta(rows) });
  }

  // daily top: highest rated (overall stars + meta-review stars), recent first
  const rows = await query(
    `SELECT r.id, r.entity_name, r.overall_stars, r.domains, r.text, r.created_at,
            r.verified_visit, r.reply_text, r.reply_doctor_name, r.reply_at,
            COALESCE(r.overall_stars, 3) + COALESCE((SELECT AVG(rr.stars) FROM review_reviews rr WHERE rr.review_id = r.id), 0) AS score
       FROM reviews r WHERE r.status = 'visible'
      ORDER BY score DESC, r.created_at DESC LIMIT 20`
  );
  res.json({ mode: 'daily-top', given, reviews: await withMeta(rows) });
});

// GET /api/reviews/entity?name=&uid= — reviews of a specific doctor (same gate).
router.get('/reviews/entity', async (req, res) => {
  const uid = String(req.query.uid || '').slice(0, 24);
  const name = String(req.query.name || '').trim().slice(0, 190);
  if (!name) return res.status(400).json({ error: 'חסר שם' });
  const profile = uid ? await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]) : null;
  if (!profile || profile.reviews_given < 1) {
    const agg = await queryOne(
      `SELECT COUNT(*) AS n, AVG(overall_stars) AS avg_stars FROM reviews WHERE entity_name = ? AND status = 'visible'`,
      [name]
    );
    return res.json({ mode: 'locked', count: Number(agg.n), avg_stars: agg.avg_stars ? Number(agg.avg_stars).toFixed(1) : null, reviews: [] });
  }
  const rows = await query(
    `SELECT id, entity_name, overall_stars, domains, text, created_at,
            verified_visit, reply_text, reply_doctor_name, reply_at
       FROM reviews WHERE entity_name = ? AND status = 'visible' ORDER BY created_at DESC LIMIT 20`,
    [name]
  );
  for (const row of rows) row.domains = typeof row.domains === 'string' ? JSON.parse(row.domains) : row.domains;
  res.json({ mode: 'open', reviews: rows });
});

// POST /api/reviews/:id/review — review-on-review (ביקורת על ביקורת).
router.post('/reviews/:id/review', async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  const uid = String(req.body?.uid || '').slice(0, 24);
  const stars = Math.min(5, Math.max(1, parseInt(req.body?.stars, 10) || 0));
  if (!reviewId || !uid || !stars) return res.status(400).json({ error: 'חסרים פרטים' });
  const exists = await queryOne('SELECT id, uid FROM reviews WHERE id = ?', [reviewId]);
  if (!exists) return res.status(404).json({ error: 'הביקורת לא נמצאה' });
  if (exists.uid === uid) return res.status(400).json({ error: 'אי אפשר לדרג ביקורת של עצמך' });
  await query(
    `INSERT INTO review_reviews (review_id, uid, stars, text) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE stars = VALUES(stars), text = VALUES(text)`,
    [reviewId, uid, stars, String(req.body?.text || '').slice(0, 1000) || null]
  );
  await query('UPDATE profiles SET points = points + 2 WHERE uid = ?', [uid]);
  res.json({ ok: true, points_earned: 2 });
});

export default router;
