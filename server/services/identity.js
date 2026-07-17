// Who a person is, across devices — and nothing about their health.
//
// Two ways in, both ending at the same place (profiles.phone + verified_at):
//   * the OTP we send them        (routes/track.js — phone/request + phone/verify)
//   * the message they send us     (claimByWhatsAppWord, below — option b)
import { query, queryOne } from '../db.js';
import { normalizePhone } from './waTransport.js';

// Move every uid-keyed row from `fromUid` onto `toUid` and sum the counters.
// Unique keys (badges, chosen, review_reviews, review_flags) merge with IGNORE.
export async function mergeProfiles(fromUid, toUid) {
  for (const [table, col] of [['app_sessions', 'uid'], ['app_events', 'uid'], ['transcripts', 'uid'], ['reviews', 'uid']]) {
    await query(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [toUid, fromUid]);
  }
  for (const table of ['badges', 'chosen_doctors', 'review_reviews', 'review_flags']) {
    await query(`UPDATE IGNORE ${table} SET uid = ? WHERE uid = ?`, [toUid, fromUid]);
    await query(`DELETE FROM ${table} WHERE uid = ?`, [fromUid]); // duplicates the IGNORE left behind
  }
  await query(
    `UPDATE profiles a JOIN profiles b ON b.uid = ?
        SET a.visits = a.visits + b.visits, a.searches = a.searches + b.searches,
            a.points = a.points + b.points, a.reviews_given = a.reviews_given + b.reviews_given,
            a.allow_reviews = GREATEST(a.allow_reviews, b.allow_reviews),
            a.skip_splash = GREATEST(a.skip_splash, b.skip_splash),
            a.last_seen = NOW()
      WHERE a.uid = ?`,
    [fromUid, toUid]
  );
  await query('DELETE FROM profiles WHERE uid = ?', [fromUid]);
}

// What the click-to-chat link pre-fills ("אימות מסביב: XV69KT"), or the bare
// word on its own for someone who retyped it.
//
// Deliberately not a loose \b[A-Z2-9]{6}\b anywhere in the text: this check runs
// before the questionnaire conversation, so a mid-questionnaire answer that
// happened to read like a word ("ABCDEF") would be swallowed as a claim instead
// of stored as an answer. The message has to *be* a verification message.
const WORD_RE = /^(?:אימות\s+מסביב\s*:?\s*)?([A-Z2-9]{6})$/;

// An inbound WhatsApp message that carries a live verification word claims the
// profile that asked for it, for the number it came from. Returns null when the
// message is not a claim, so the caller can treat it as questionnaire input.
export async function claimByWhatsAppWord(fromPhone, text) {
  const phone = normalizePhone(fromPhone);
  const match = WORD_RE.exec(String(text || '').trim().toUpperCase());
  if (!phone || !match) return null;

  const otp = await queryOne(
    `SELECT id, uid FROM otp_codes
      WHERE code = ? AND purpose = 'wa_claim' AND used = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [match[1]]
  );
  if (!otp) return null;

  await query('UPDATE otp_codes SET used = 1, phone = ? WHERE id = ?', [phone, otp.id]);

  const owner = await queryOne('SELECT uid FROM profiles WHERE phone = ?', [phone]);
  let canonical = otp.uid;
  let merged = false;
  if (owner && owner.uid !== otp.uid) {
    // this device joins the identity the number already has
    await mergeProfiles(otp.uid, owner.uid);
    canonical = owner.uid;
    merged = true;
  } else {
    await query(
      'UPDATE profiles SET phone = ?, phone_verified_at = NOW() WHERE uid = ?', [phone, otp.uid]
    );
  }
  return { uid: canonical, phone, merged };
}
