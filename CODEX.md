# AllAroundMe · CODEX

## What this is
The seach Medical "מסביב" product: the round-table map UI + the Eshkolot alphon,
wrapped in the AllAroundMe experience (splash, sounds, points, reviews) and a
doctor questionnaire platform.

## Architecture
```
client/  static, no build step (vanilla JS, RTL Hebrew, PWA)
  index.html    splash (full/short/none by cookie) + home + tag-tree finder + points
  map.html      the round-table live map, adapted (tracking, uid on analyze, ?tags= deep link)
  reviews.html  rating flow (stars / 5 domains) + gated community feed + review-on-review
  doctor.html   doctor dashboard (questionnaires, issue-as-JSON, reports, GDPR shares, analytics)
  js/app.js     AAM core: aam_uid cookie (rolling 90d), /api/session handshake, event queue
  js/sound.js   press/release blips + per-page ambience + volume/mute widget
  js/fx.js      press/release burst animation (or per-element GIF)
server/  Express + MySQL
  index.js            static + health + /api/public/* proxy to Eshkolot (analyze intercepted)
  routes/track.js     sessions, events, profile, points, badges, chosen doctors, action-taken
  routes/analyze.js   streaming proxy for /api/public/analyze + transcripts logging
  routes/tags.js      /api/tags/tree — alphon tags-tree with local fallback
  routes/reviews.js   reviews + visibility rules + meta-reviews
  routes/doctors.js   JWT auth, questionnaires, super-blend, issue, reports, shares, analytics
  routes/hooks.js     WhatsApp-bot/email answer + delivery webhooks
```

## Key rules encoded
- Splash: visits==0 → full, else short, skip_splash → none. Cookie+profile expire after
  `PROFILE_TTL_DAYS` (90) days without use — then the person starts over.
- Points: +1 visit, +2 search, +3 choose doctor, +5 review, +2 meta-review. Badges in track.js.
- Review feed: 0 reviews → locked; 1-2 → 3-4 random; 3+ → daily top.
- Super-questionnaire blend (doctors.js `blendQuestions`): each linked super = 20% of the
  issued questions, max two supers (40%); own questions fill the rest (≥60%). One super → 80/20.
- Scope (middleware/auth.js `scopedDoctorIds`): doctor = self; clinic_owner += 'clinic' links;
  trial_manager += 'trial' links; plus GDPR-consented rows in data_shares.

## Related repos
- Eshkolot-alphon — companion API (`/api/public/*`; `tags-tree` added for this app).
- the-round-table-map-helper — origin of map.html (kept there as the standalone demo).
