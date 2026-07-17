import express from 'express';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';
import { config } from '../env.js';
import { sendWhatsApp, normalizePhone } from '../services/whatsapp.js';
import { mergeProfiles } from '../services/identity.js';

const router = express.Router();

const BADGES = [
  { code: 'first-steps', label: 'צעדים ראשונים', icon: '👣', test: (p) => p.visits >= 1 },
  { code: 'regular', label: 'מבקר קבוע', icon: '📅', test: (p) => p.visits >= 5 },
  { code: 'explorer', label: 'חוקר מסביב', icon: '🧭', test: (p) => p.searches >= 10 },
  { code: 'search-master', label: 'אלוף החיפושים', icon: '🎯', test: (p) => p.searches >= 25 },
  { code: 'reviewer', label: 'מבקר מתחיל', icon: '⭐', test: (p) => p.reviews_given >= 1 },
  { code: 'top-reviewer', label: 'מבקר מוביל', icon: '🏆', test: (p) => p.reviews_given >= 5 },
  { code: 'point-collector', label: 'צובר נקודות', icon: '💎', test: (p) => p.points >= 100 },
];

async function grantBadges(uid) {
  const p = await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]);
  if (!p) return [];
  const earned = [];
  for (const b of BADGES) {
    if (!b.test(p)) continue;
    const r = await query(
      'INSERT IGNORE INTO badges (uid, code, label, icon) VALUES (?,?,?,?)',
      [uid, b.code, b.label, b.icon]
    );
    if (r.affectedRows) earned.push({ code: b.code, label: b.label, icon: b.icon });
  }
  return earned;
}

// POST /api/session — session start handshake.
// Creates/refreshes the profile (the uid cookie is set/renewed here with the
// PROFILE_TTL_DAYS rolling expiry), logs the full client fingerprint, and
// answers which splash variant to play + whether to prompt for ratings.
router.post('/session', async (req, res) => {
  const b = req.body || {};
  let uid = String(b.uid || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  let existing = uid ? await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]) : null;

  // expired = not seen for PROFILE_TTL_DAYS -> the person starts over
  if (existing) {
    const cutoff = Date.now() - config.profileTtlDays * 86400_000;
    if (new Date(existing.last_seen).getTime() < cutoff) {
      await query('DELETE FROM profiles WHERE uid = ?', [uid]);
      existing = null;
      uid = '';
    }
  }
  if (!uid || !existing) {
    uid = crypto.randomBytes(12).toString('hex');
    await query('INSERT INTO profiles (uid, visits) VALUES (?, 0)', [uid]);
    existing = await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]);
  }

  // splash decision: first visit = full show, later = short, opted out = none
  const splash = existing.skip_splash ? 'none' : existing.visits === 0 ? 'full' : 'short';

  await query(
    'UPDATE profiles SET visits = visits + 1, points = points + 1, last_seen = NOW() WHERE uid = ?',
    [uid]
  );

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const session = await query(
    `INSERT INTO app_sessions
       (uid, ip, user_agent, browser, os, device, screen_w, screen_h, viewport_w, viewport_h,
        pixel_ratio, lang, timezone, display_mode, referrer, splash_variant)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uid, ip.slice(0, 64), String(req.headers['user-agent'] || '').slice(0, 512),
      String(b.browser || '').slice(0, 120) || null, String(b.os || '').slice(0, 120) || null,
      String(b.device || '').slice(0, 120) || null,
      parseInt(b.screen_w, 10) || null, parseInt(b.screen_h, 10) || null,
      parseInt(b.viewport_w, 10) || null, parseInt(b.viewport_h, 10) || null,
      parseFloat(b.pixel_ratio) || null, String(b.lang || '').slice(0, 20) || null,
      String(b.timezone || '').slice(0, 64) || null,
      String(b.display_mode || 'browser').slice(0, 30),
      String(b.referrer || '').slice(0, 512) || null, splash,
    ]
  );

  const newBadges = await grantBadges(uid);
  const profile = await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]);
  const unrated = await query(
    'SELECT entity_name, entity_spec, chosen_at FROM chosen_doctors WHERE uid = ? AND rated = 0 ORDER BY chosen_at DESC LIMIT 5',
    [uid]
  );

  res.json({
    uid,
    session_id: session.insertId,
    splash,
    cookie_ttl_days: config.profileTtlDays,
    profile: {
      visits: profile.visits, searches: profile.searches, points: profile.points,
      reviews_given: profile.reviews_given, allow_reviews: !!profile.allow_reviews,
      skip_splash: !!profile.skip_splash, phone: profile.phone || null, ui_lang: profile.ui_lang || null,
    },
    new_badges: newBadges,
    rate_prompt: unrated,   // "would you like to rate the doctors you chose?"
  });
});

// POST /api/events — batched UX events (clicks, searches, choices...).
router.post('/events', async (req, res) => {
  const { uid, session_id, events } = req.body || {};
  const cleanUid = String(uid || '').slice(0, 24);
  if (!cleanUid || !Array.isArray(events) || !events.length) {
    return res.status(400).json({ error: 'חסרים uid או events' });
  }
  let searches = 0;
  for (const ev of events.slice(0, 50)) {
    const type = String(ev.type || 'event').slice(0, 60);
    if (type === 'search') searches += 1;
    await query(
      'INSERT INTO app_events (session_id, uid, type, page, element, data) VALUES (?,?,?,?,?,?)',
      [
        parseInt(session_id, 10) || null, cleanUid, type,
        String(ev.page || '').slice(0, 190) || null,
        String(ev.element || '').slice(0, 190) || null,
        ev.data ? JSON.stringify(ev.data).slice(0, 4000) : null,
      ]
    );
  }
  if (searches) {
    await query(
      'UPDATE profiles SET searches = searches + ?, points = points + ?, last_seen = NOW() WHERE uid = ?',
      [searches, searches * 2, cleanUid]
    );
  }
  const newBadges = await grantBadges(cleanUid);
  res.json({ ok: true, logged: Math.min(events.length, 50), new_badges: newBadges });
});

// POST /api/profile/skip-splash — "עזבו אותי": never show the splash again.
router.post('/profile/skip-splash', async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  if (!uid) return res.status(400).json({ error: 'חסר uid' });
  await query('UPDATE profiles SET skip_splash = 1 WHERE uid = ?', [uid]);
  res.json({ ok: true });
});

// POST /api/profile/chosen — the user picked a doctor (WhatsApp/Waze/call).
router.post('/profile/chosen', async (req, res) => {
  const { uid, entity_id, entity_name, entity_spec } = req.body || {};
  const cleanUid = String(uid || '').slice(0, 24);
  const name = String(entity_name || '').trim().slice(0, 190);
  if (!cleanUid || !name) return res.status(400).json({ error: 'חסרים uid או שם' });
  await query(
    `INSERT INTO chosen_doctors (uid, entity_id, entity_name, entity_spec) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE chosen_at = NOW(), entity_spec = VALUES(entity_spec)`,
    [cleanUid, parseInt(entity_id, 10) || null, name, String(entity_spec || '').slice(0, 190) || null]
  );
  await query('UPDATE profiles SET points = points + 3 WHERE uid = ?', [cleanUid]);
  res.json({ ok: true });
});

// POST /api/transcripts/:id/action — what the person actually did after triage.
router.post('/transcripts/action', async (req, res) => {
  const { uid, action } = req.body || {};
  const cleanUid = String(uid || '').slice(0, 24);
  if (!cleanUid || !action) return res.status(400).json({ error: 'חסרים uid או action' });
  await query(
    `UPDATE transcripts SET action_taken = ?, action_at = NOW()
      WHERE uid = ? AND action_taken IS NULL ORDER BY id DESC LIMIT 1`,
    [String(action).slice(0, 300), cleanUid]
  );
  res.json({ ok: true });
});

// ----------------------------------------------- phone claiming (OTP) -------
// The cookie loses people who switch phones; a verified WhatsApp number lets
// the profile (points, chosen doctors, reviews) follow the person.

// POST /api/profile/phone/request {uid, phone} — send a 6-digit code.
router.post('/profile/phone/request', async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  const phone = normalizePhone(req.body?.phone);
  if (!uid || !phone) return res.status(400).json({ error: 'נדרשים uid ומספר טלפון תקין' });
  const profile = await queryOne('SELECT uid FROM profiles WHERE uid = ?', [uid]);
  if (!profile) return res.status(404).json({ error: 'פרופיל לא נמצא' });

  const recent = await queryOne(
    'SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND created_at > NOW() - INTERVAL 1 HOUR',
    [phone]
  );
  if (Number(recent.n) >= 3) return res.status(429).json({ error: 'יותר מדי נסיונות — נסו שוב בעוד שעה' });

  const code = String(crypto.randomInt(100000, 1000000));
  await query(
    `INSERT INTO otp_codes (phone, uid, code, purpose, expires_at) VALUES (?,?,?,?, NOW() + INTERVAL 10 MINUTE)`,
    [phone, uid, code, 'claim']
  );
  try {
    await sendWhatsApp(phone, `מסביב 🎯 קוד האימות שלך: ${code}\nתקף ל-10 דקות.`, 'otp');
  } catch (e) {
    return res.status(502).json({ error: 'שליחת הקוד נכשלה: ' + e.message });
  }
  const dev = config.whatsapp.mode === 'log' && config.nodeEnv !== 'production';
  res.json({ ok: true, sent_to: phone, ...(dev ? { dev_code: code } : {}) });
});

// POST /api/profile/phone/verify {uid, phone, code} — claim the profile.
// If the phone already belongs to another profile, this device's history is
// merged into it and the canonical uid is returned (the client re-sets its cookie).
router.post('/profile/phone/verify', async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
  if (!uid || !phone || code.length !== 6) return res.status(400).json({ error: 'חסרים פרטים' });

  const otp = await queryOne(
    `SELECT id FROM otp_codes WHERE phone = ? AND code = ? AND used = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [phone, code]
  );
  if (!otp) return res.status(400).json({ error: 'קוד שגוי או שפג תוקפו' });
  await query('UPDATE otp_codes SET used = 1 WHERE id = ?', [otp.id]);

  const owner = await queryOne('SELECT uid FROM profiles WHERE phone = ?', [phone]);
  let canonical = uid, merged = false;
  if (owner && owner.uid !== uid) {
    await mergeProfiles(uid, owner.uid);   // this device joins the existing identity
    canonical = owner.uid;
    merged = true;
  } else {
    await query('UPDATE profiles SET phone = ?, phone_verified_at = NOW() WHERE uid = ?', [phone, uid]);
  }
  const profile = await queryOne('SELECT * FROM profiles WHERE uid = ?', [canonical]);
  res.json({
    ok: true, uid: canonical, merged, cookie_ttl_days: config.profileTtlDays,
    profile: {
      visits: profile.visits, searches: profile.searches, points: profile.points,
      reviews_given: profile.reviews_given, phone: profile.phone,
    },
  });
});

// ------------------------------------- WhatsApp identification (option b) ---
// The simple version, and the direction that matters: instead of us texting a
// code *to* the person, the person messages *us*. The WhatsApp button opens a
// chat to the platform's 360dialog number with a one-time word pre-filled; when
// that message arrives, the sender's own number is the proof — we never had to
// deliver anything, and there is no code to intercept or mistype.
//
// That number is an identity desk and nothing else: it verifies who someone is,
// and clinical content never flows through it (see services/phi.js).

// POST /api/profile/whatsapp/link {uid} — the click-to-chat link + its word.
router.post('/profile/whatsapp/link', async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  if (!uid) return res.status(400).json({ error: 'חסר uid' });
  const profile = await queryOne('SELECT uid FROM profiles WHERE uid = ?', [uid]);
  if (!profile) return res.status(404).json({ error: 'פרופיל לא נמצא' });

  const number = normalizePhone(config.dialog360.number);
  if (!number) {
    return res.status(503).json({ error: 'אימות בוואטסאפ אינו מוגדר בשרת (DIALOG360_NUMBER)' });
  }

  const recent = await queryOne(
    `SELECT COUNT(*) AS n FROM otp_codes
      WHERE uid = ? AND purpose = 'wa_claim' AND created_at > NOW() - INTERVAL 1 HOUR`, [uid]
  );
  if (Number(recent.n) >= 5) return res.status(429).json({ error: 'יותר מדי נסיונות — נסו שוב בעוד שעה' });

  // unambiguous over WhatsApp: no 0/O or 1/I to misread, and it fits CHAR(6)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const word = Array.from(crypto.randomBytes(6)).map((b) => alphabet[b % alphabet.length]).join('');
  await query(
    `INSERT INTO otp_codes (phone, uid, code, purpose, expires_at)
     VALUES ('', ?, ?, 'wa_claim', NOW() + INTERVAL 30 MINUTE)`,
    [uid, word]
  );

  const text = `אימות מסביב: ${word}`;
  res.json({
    ok: true,
    word,
    number,
    // the patient sends this message; the reply lands on /api/hooks/wa-inbound
    link: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    expires_in_min: 30,
  });
});

// GET /api/profile/whatsapp/status?uid= — did their message land yet?
// The client polls this while the person is off in WhatsApp.
router.get('/profile/whatsapp/status', async (req, res) => {
  const uid = String(req.query.uid || '').slice(0, 24);
  if (!uid) return res.status(400).json({ error: 'חסר uid' });
  const profile = await queryOne('SELECT phone, phone_verified_at FROM profiles WHERE uid = ?', [uid]);
  if (!profile) return res.status(404).json({ error: 'פרופיל לא נמצא' });
  res.json({
    verified: !!profile.phone_verified_at,
    phone: profile.phone || null,
    verified_at: profile.phone_verified_at || null,
  });
});

// POST /api/profile/lang {uid, lang} — persist the UI language choice.
router.post('/profile/lang', async (req, res) => {
  const uid = String(req.body?.uid || '').slice(0, 24);
  const lang = ['he', 'en', 'ar', 'ru'].includes(req.body?.lang) ? req.body.lang : null;
  if (!uid || !lang) return res.status(400).json({ error: 'חסרים uid או שפה' });
  await query('UPDATE profiles SET ui_lang = ? WHERE uid = ?', [lang, uid]);
  res.json({ ok: true });
});

// GET /api/profile/me?uid= — points, badges, unrated doctors.
router.get('/profile/me', async (req, res) => {
  const uid = String(req.query.uid || '').slice(0, 24);
  const profile = uid ? await queryOne('SELECT * FROM profiles WHERE uid = ?', [uid]) : null;
  if (!profile) return res.status(404).json({ error: 'פרופיל לא נמצא' });
  const badges = await query('SELECT code, label, icon, earned_at FROM badges WHERE uid = ? ORDER BY earned_at', [uid]);
  const unrated = await query(
    'SELECT entity_name, entity_spec, chosen_at FROM chosen_doctors WHERE uid = ? AND rated = 0 ORDER BY chosen_at DESC LIMIT 5',
    [uid]
  );
  res.json({
    profile: {
      visits: profile.visits, searches: profile.searches, points: profile.points,
      reviews_given: profile.reviews_given, allow_reviews: !!profile.allow_reviews,
      phone: profile.phone || null, ui_lang: profile.ui_lang || null,
    },
    badges, rate_prompt: unrated,
  });
});

export default router;
