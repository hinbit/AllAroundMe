# AllAroundMe · מסביב 🎯

> **We are seach Medical · We Care 4 U 2 See each other All around**
> בעברית קוראים לזה **מסביב**.

AllAroundMe fuses two projects into one product:

- **[the-round-table-map-helper](https://github.com/hinbit/the-round-table-map-helper)** — the live map UI
  (voice → transcript → AI triage → proportional map → WhatsApp/Waze), embedded here as `client/map.html`.
- **[Eshkolot-alphon](https://github.com/hinbit/Eshkolot-alphon)** — the medical contacts alphon that powers it,
  reached through this app's `/api/public/*` proxy (nearby / filters / analyze / **tags-tree**).

On top of them it adds the full AllAroundMe experience:

| | |
|---|---|
| 🎬 **Splash** | Movie-style opening on a trembling waves background — full 10-stage show on the first visit, 3 quick stages on the next ones, none at all after "עזבו אותי". The C of *2 See* has a living eye that morphs into *C's*; *all around* ends with the 🎯 target motif. |
| 🍪 **Cookie profile** | `aam_uid` cookie with a rolling 90-day expiry (`PROFILE_TTL_DAYS`); 3 months of no use → the person starts over, server-side too. |
| 📒 **Session log** | Every session start is logged with everything the handshake yields: IP, user-agent, browser, OS, device, screen + viewport size, pixel ratio, language, timezone, referrer, and whether the app runs installed (PWA `standalone`) or as a plain web page — it works as **both** (manifest + service worker included). |
| 🎤 **Triage trail** | Every voice/text question is proxied to the alphon's transcriber+AI and logged: transcript → AI recommendation/tags/urgency → **what the person actually did** (`action_taken`). For learning how the app is really used. |
| 🔊 **Sounds** | Every interactive element clicks on press and release (WebAudio, no assets); each page carries quiet ambient music (generative pad by default, or any mp3 via `data-ambience`); floating volume slider + master mute. |
| 💥 **Press FX** | Every element, especially buttons, animates on press/release — target-rings burst by default, or a custom GIF via `data-press-gif` / `data-release-gif`. |
| 🌳 **Tag-tree finder** | All alphon tags arranged as a drill-down tree (specialty → body area → sub-tags). One selection can combine several sub-choices — e.g. foot-oncology + ankle-oncology + sarcoma — searched together on the map. |
| 💎 **Points & badges** | Per-cookie points for visits/searches/choices/reviews and excellence badges. |
| ⭐ **Reviews** | After choosing doctors, the next visit asks "רוצה לדרג?". 5 stars overall or five named domains × 5 stars, text or transcribed voice. Reviewers unlock others' reviews gradually (few → 3-4 random; 3+ → daily top). Review-on-review included. |
| 🧑‍⚕️ **Doctor platform** | JWT login, questionnaire builder (targeting by times/types/group/symptom, schedules, themes by age/indication), **super-questionnaires** blended 20% each (max 40%, own questions ≥60%), issued as **JSON instructions for a WhatsApp bot or email**, answer webhook, dashboard reports, GDPR-consented data sharing, joint runs & joint publication. |
| 🔐 **Roles** | `doctor` sees his own data; `clinic_owner` also sees his clinic's doctors; `trial_manager` sees doctors registered to his trial — plus anything explicitly shared with GDPR consent. |

## Quick start (local)

```bash
# 1. DB user (once)
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS allaroundme CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'allaroundme'@'localhost' IDENTIFIED BY 'allaroundme-secret';
GRANT ALL PRIVILEGES ON allaroundme.* TO 'allaroundme'@'localhost';
FLUSH PRIVILEGES;
SQL

# 2. env + install + schema + seed + run
cp .env.example .env
npm run install:all
npm run db:init
npm run db:seed
npm start
```

Open http://localhost:4090 — add `?splash=full` to replay the full opening.

The live map and the finder need **Eshkolot-alphon running** (default `http://127.0.0.1:3070`,
key `ESHKOLOT_API_URL`); without it the app stays healthy and the finder uses a built-in
fallback tree. Voice analysis additionally needs the alphon's `OPENAI_API_KEY` + ffmpeg.

### Demo doctor logins (password `Doctor!2026`)
- `doctor@allaroundme.local` (doctor) · `cohen@allaroundme.local` (doctor)
- `clinic@allaroundme.local` (clinic_owner of both) · `trial@allaroundme.local` (trial_manager of Dr. Levi)

## Scripts
`install:all` · `build`/`check` (syntax check, no build artifacts) · `db:init` · `db:seed` · `start`/`prod` · `dev`

## Multidev deployment
The repo follows the Multidev contract (`VPS-INSTALL.MD`, `PREINSTALL_REQUIREMENTS.md`, root scripts,
env templates). Health: `GET /api/health` → `{ ok, db, eshkolot }`. Install Eshkolot-alphon on the same
VPS and point `ESHKOLOT_API_URL` to its assigned port.

## WhatsApp bot / email integration
`POST /api/doctor/questionnaires/:id/issue` freezes the blended questions into a run `payload` —
self-describing JSON instructions (intro, schedule with absolute `send_at` times, questions with
`expected` hints and per-question `source`). The bot posts answers back to
`POST /api/hooks/answers {run_id, answers:[{idx, answer}]}` and delivery confirmations to
`POST /api/hooks/sent {run_id}`.
