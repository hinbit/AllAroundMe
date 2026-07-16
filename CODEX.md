# AllAroundMe · CODEX

## What this is
The seach Medical "מסביב" product: the round-table map UI + the Eshkolot alphon,
wrapped in the AllAroundMe experience (splash, sounds, points, reviews) and a
doctor questionnaire platform.

## Architecture
```
client/  static, no build step (vanilla JS, RTL/LTR, PWA)
  index.html    splash (full/short/none by cookie) + home + tag-tree finder + points + phone claim
  map.html      the round-table live map, adapted (tracking, uid on analyze, ?tags= deep link)
  reviews.html  rating flow (stars / 5 domains) + gated feed + review-on-review + flags + replies
  doctor.html   doctor dashboard (questionnaires, issue, reports, review inbox, shares, analytics, digest settings)
  js/app.js     AAM core: aam_uid cookie (rolling 90d), /api/session handshake, event queue, setUid
  js/i18n.js    he/en/ar/ru dictionary + dir switching + 🌐 picker (?lang= or #aam-lang)
  js/sound.js   press/release blips + per-page ambience + volume/mute widget
  js/fx.js      press/release burst animation (or per-element GIF)
server/  Express + MySQL
  index.js               static + health + /api/public/* proxy to Eshkolot (analyze intercepted) + scheduler
  routes/track.js        sessions, events, profile, points, badges, chosen doctors, action-taken,
                         phone OTP claim + cross-device merge, ui language
  routes/analyze.js      streaming proxy for /api/public/analyze + transcripts logging
  routes/tags.js         /api/tags/tree — alphon tags-tree with local fallback
  routes/reviews.js      reviews + visibility rules + meta-reviews + verified_visit + abuse flags
  routes/doctors.js      JWT auth, questionnaires, super-blend, issue+deliver, reports, review
                         inbox + right-of-reply, shares, analytics, digest settings
  routes/hooks.js        Meta webhook + generic wa-inbound + answers/sent webhooks (external bots)
  services/whatsapp.js   transport (log/cloud/webhook), outbox dispatch, one-question-at-a-time chat
  services/mailer.js     SMTP via nodemailer, log fallback
  services/digest.js     per-doctor daily summary (answers/reviews/flags/pending)
  services/scheduler.js  in-process: outbox every 60s + daily digests from DIGEST_HOUR
```

## Key rules encoded
- Splash: visits==0 → full, else short, skip_splash → none; `prefers-reduced-motion` → none.
  Cookie+profile expire after `PROFILE_TTL_DAYS` (90) days without use — then the person starts over.
- Points: +1 visit, +2 search, +3 choose doctor, +5 review, +2 meta-review. Badges in track.js.
- Review feed: 0 reviews → locked; 1-2 → 3-4 random; 3+ → daily top. `status='flagged'` (3 distinct
  flags) drops out of every public feed but stays visible to the doctor.
- `verified_visit` = a chosen_doctors row exists for (uid, entity_name) at review time — i.e. the
  reviewer really pressed WhatsApp/Waze/call on that doctor in the app.
- Phone claim (track.js): OTP over the WhatsApp transport; verifying a number that already owns a
  profile runs `mergeProfiles` — rows move by uid, counters sum, the old profile is deleted, and the
  client adopts the canonical uid via `AAM.setUid`.
- Super-questionnaire blend (doctors.js `blendQuestions`): each linked super = 20% of the
  issued questions, max two supers (40%); own questions fill the rest (≥60%). One super → 80/20.
- **Two scopes** (middleware/auth.js) — keep them apart:
  - `ownDoctorIds` = self + clinic/trial links. Who you may *act for*: review replies, digest.
  - `scopedDoctorIds` = ownDoctorIds + GDPR data_shares. What you may *read*: reports, questionnaires.
  A data share must never grant the right to speak in another doctor's name.
- Delivery: `issue` freezes the payload *and* enqueues wa_outbox rows (one per schedule entry).
  The scheduler dispatches due rows; `wa_conversations.question_pos` tracks the next question per
  phone; the final answer sets the run to `answered` and thanks the patient.

## Related repos
- Eshkolot-alphon — companion API (`/api/public/*`; `tags-tree` added for this app).
- the-round-table-map-helper — origin of map.html (kept there as the standalone demo).
