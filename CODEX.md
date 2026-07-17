# AllAroundMe · CODEX

## What this is
The seach Medical "מסביב" product: the round-table map UI + the Eshkolot alphon,
wrapped in the AllAroundMe experience (splash, sounds, points, reviews) and a
doctor questionnaire platform.

## Architecture
```
client/  static, no build step (vanilla JS, RTL/LTR, PWA)
  index.html    open screen + home + tag-tree finder + points + phone claim
  map.html      the round-table live map, adapted (tracking, uid on analyze, ?tags= deep link)
  reviews.html  rating flow (stars / 5 domains) + gated feed + review-on-review + flags + replies
  doctor.html   doctor dashboard (questionnaires, issue, reports, review inbox, shares, analytics, digest settings)
  js/app.js     AAM core: aam_uid cookie (rolling 90d), /api/session handshake, event queue, setUid
  js/i18n.js    he/en/ar/ru dictionary + dir switching + 🌐 picker (?lang= or #aam-lang)
  js/theme.js   active theme, deep-merged over the canabolabs base (?theme=, ?ui=)
  js/splash.js  open-screen engine: plays the animation the theme names
  js/sound.js   press/release blips + per-page ambience + volume/mute widget
  js/fx.js      press/release burst animation (or per-element GIF)
  js/map/       map provider layer (ported from ClubMad's MapProviderFactory)
    mapTypes.js          constants + ui.type -> provider + the Google browser key
    factory.js           mounts the theme's provider; falls back to native if it cannot
    providers/native.js  ui.type 1 — the bespoke radial projection over OSM tiles
    providers/google.js  ui.type 2 — google_based (Maps JS API via a script tag)
  themes/<name>/theme.json   brand + ui.type + which open screen; canabolabs is the base
  animations/<id>.json       open screens: textanimation1 (the movie), simplefade1 (bg+logo fade)
server/  Express + MySQL
  index.js               static + health + /api/public/* proxy to Eshkolot (analyze intercepted) + scheduler
  routes/track.js        sessions, events, profile, points, badges, chosen doctors, action-taken,
                         phone OTP claim + cross-device merge, ui language
  routes/analyze.js      streaming proxy for /api/public/analyze + transcripts logging
  routes/tags.js         /api/tags/tree — alphon tags-tree with local fallback
  routes/reviews.js      reviews + visibility rules + meta-reviews + verified_visit + abuse flags
  routes/doctors.js      JWT auth, questionnaires, super-blend, issue+deliver, reports, review
                         inbox + right-of-reply, shares, analytics, digest settings
  routes/config.js       /api/config — public client config (Google Maps browser key). No secrets.
  routes/hooks.js        Meta webhook + generic wa-inbound + answers/sent webhooks (external bots)
  services/whatsapp.js   transport (log/cloud/webhook), outbox dispatch, one-question-at-a-time chat
  services/mailer.js     SMTP via nodemailer, log fallback
  services/digest.js     per-doctor daily summary (answers/reviews/flags/pending)
  services/scheduler.js  in-process: outbox every 60s + daily digests from DIGEST_HOUR
```

## Key rules encoded
- Themes: `client/themes/<name>/theme.json`, chosen by `?theme=` (remembered) → localStorage →
  `allaroundme`. Every theme is deep-merged **on top of canabolabs**, so anything it omits (asset,
  colour, open screen, favicon) resolves there — which is why canabolabs must stay complete.
  Default ≠ base: `allaroundme` is what loads, `canabolabs` is what fills the gaps.
- Brand assets: `themes/allaroundme/assets/` — the supplied PNGs with their painted-on white
  backgrounds flooded out from the border (a global near-white cut would eat the pale outer arc).
  `/icons/*` + `/favicon.ico` are the same mark rendered per size; `theme.js` swaps `rel=icon` to
  the active theme's, over a static link so the tab is never blank.
- Interface type: `theme.ui.type` — 1 = the built-in radial map, 2 = google_based. `?ui=1|2`
  overrides for one visit. A provider that cannot mount (no key, Google down) falls back to 1 and
  says so in the map subtitle: a map screen with no map is a dead end.
- Splash: the theme names the animation; the server still picks the variant — visits==0 → full,
  else short, skip_splash → none; `prefers-reduced-motion` → none. An opaque animation
  (textanimation1) hides the app until it ends; a transparent one (simplefade1) plays over it.
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
