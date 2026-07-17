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
| 📱 **Portable profile** | Optional: verify a WhatsApp number and the profile stops being a cookie — points, chosen doctors, badges and reviews follow the person to any device. Verifying a number that already owns a profile **merges** this device's history into it. |
| ⭐ **Reviews** | After choosing doctors, the next visit asks "רוצה לדרג?". 5 stars overall or five named domains × 5 stars, text or transcribed voice. Reviewers unlock others' reviews gradually (few → 3-4 random; 3+ → daily top). Review-on-review included. |
| 🛡️ **Review trust** | **✓ verified visit** on reviews whose author really contacted that doctor through the app; the doctor's **right of reply** shown next to the review; community **abuse flags** — 3 distinct reporters hide a review pending moderation. |
| 💬 **WhatsApp delivery** | Built-in: an issued questionnaire is really sent, on schedule, and asks the patient **one question at a time**; each reply is stored and the next question follows automatically; the last answer closes the run. Transport is pluggable — Meta Cloud API, your own bot, or dev log mode. |
| 🌐 **Languages & access** | Hebrew / English / Arabic / Russian with correct RTL–LTR switching (`?lang=en` or the 🌐 picker, remembered per profile); `prefers-reduced-motion` skips the splash and stills the animations; chips, stars and menus are keyboard- and screen-reader-operable. |
| 🧑‍⚕️ **Doctor platform** | JWT login, questionnaire builder (targeting by times/types/group/symptom, schedules, themes by age/indication), **super-questionnaires** blended 20% each (max 40%, own questions ≥60%), real WhatsApp/email delivery **and** the same run as **JSON instructions** for an external bot, answer webhooks, dashboard reports, review inbox with right-of-reply, GDPR-consented data sharing, joint runs & joint publication. |
| 📨 **Daily digest** | Each doctor gets one WhatsApp/email summary a day: new questionnaire answers, new reviews, new flags, still-pending runs. Silent when there's no news. |
| 🔐 **Roles** | `doctor` sees his own data; `clinic_owner` also sees his clinic's doctors; `trial_manager` sees doctors registered to his trial — plus anything explicitly shared with GDPR consent. A GDPR share grants **sight of research data only** — never the right to reply to reviews or act in the other doctor's name. |

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

Themes decide the brand, the open screen, the favicon and which interface the app wears
(`client/themes/<name>/theme.json`). Two roles, deliberately separate: **`allaroundme` is what
loads by default**, while **`canabolabs` is the base every theme is merged over** — so anything a
theme omits falls back there, which is why the base must stay complete.

| Try | What you get |
| --- | --- |
| *(nothing)* | the default `allaroundme` — the logo fading up over the live app and back off (`simplefade1`) |
| `?theme=seach` | the original "we care 4 u 2 C each other all around" movie (`textanimation1`) |
| `?theme=canabolabs` | the demo brand + base theme — background artwork with the logo on it |
| `?theme=canabolabs-maps` | same demo brand, `ui.type = 2` — the map screen drawn by Google Maps |
| `?ui=2` on `/map.html` | force the Google map for one visit, whatever the theme says |

`ui.type = 2` needs `GOOGLE_MAPS_BROWSER_KEY` in `.env.credentials` (see
`.env.credentials.example`). Without it those themes quietly fall back to the built-in map.

The live map and the finder need **Eshkolot-alphon running** (default `http://127.0.0.1:3070`,
key `ESHKOLOT_API_URL`); without it the app stays healthy and the finder uses a built-in
fallback tree. Voice analysis additionally needs the alphon's `OPENAI_API_KEY` + ffmpeg.

### Demo doctor logins (password `Doctor!2026`)
- `doctor@allaroundme.local` (doctor) · `cohen@allaroundme.local` (doctor)
- `clinic@allaroundme.local` (clinic_owner of both) · `trial@allaroundme.local` (trial_manager of Dr. Levi)
- `manager@allaroundme.local` (manager — ספר טלפונים + questionnaire assignments), after `seed:questionnaires`

## Scripts
`install:all` · `build`/`check` (syntax check, no build artifacts) · `db:init` (schema + column migrations, idempotent) ·
`db:seed` · `seed:questionnaires` · `start`/`prod` · `dev` · `digest` (send the daily doctor digests now; `-- --force` ignores "no news")

## After-visit questionnaires (30 real doctors)

`npm run seed:questionnaires` creates four after-visit questionnaires — **רפואת ילדים, אף אוזן גרון,
אונקולוגיה, כאב** — and assigns them to 30 real doctors from the Eshkolot phonebook. The doctors are
picked through the alphon's *public* API (`/api/public/directory`), so seeding can never reach around
its sharing rules; only doctors with a genuinely WhatsApp-reachable number are chosen, because that
is where their patients' answers get delivered. Re-running tops the set back up to 30 instead of
duplicating it. Needs the alphon running with `/public/directory` (added for this).

A doctor is assigned a questionnaire **without registering here** — the assignment points at his
alphon entity id (`questionnaire_assignments`).

### How a patient reaches a questionnaire

**a · the desk QR.** The manager opens `/desk.html?assignment=<id>` on a screen at the doctor's desk.
The code encodes `/q/<assignment_id>?w=<window>&s=<signature>` and **rotates every `QR_WINDOW_SEC`**:
the signature is an HMAC of the current time window under a per-desk secret that never leaves the
server, so a photographed code stops working once its window passes. Scanning auto-assigns the patient
to that doctor's questionnaire and stamps the **visit slot** — the scan time — which is what identifies
the patient to the doctor ("החולה מיום שלישי בשעה 17:40"), matched against his own appointment book.
Nothing is asked of the patient: no name, no phone.

**b · the identified patient.** In the profile, **💬 אימות בוואטסאפ** opens a chat to the platform's
360dialog number with a one-time word pre-filled. When that message arrives, the sender's own number
is the proof — nothing had to be delivered and there is no code to intercept. A verified patient can
then send a doctor their answers (`POST /api/qr/identified/start`), and the doctor receives a number
he can reply to directly.

### The regulatory line

Personal patient content belongs in the doctor's own WhatsApp/email with his patient — not here. So a
completed questionnaire is handed over and let go of: the answers go straight down the wire to the
doctor's own channel (deliberately **not** through `wa_outbox`, which would keep a verbatim copy), and
the identifying fields are then dropped (`purged_at`). What stays is a de-identified husk — which
questions were answered — enough for the aggregate report and useless for re-identifying anyone.
Set `PHI_RETENTION='full'` only when self-hosting for a single clinic, where this database *is* the
doctor's record. A manager sees coverage counts and public cards; patient answers are never in scope.

## WhatsApp / email delivery

Out of the box `WHATSAPP_MODE='log'` — everything is printed to the server log, so the whole flow
(issue → send → patient answers → report) is testable locally with no account:

```bash
# simulate the patient's replies to the last questionnaire sent to that number
curl -X POST localhost:4090/api/hooks/wa-inbound -H 'Content-Type: application/json' \
     -d '{"from":"0501234567","text":"7"}'
```

For production set `WHATSAPP_MODE='cloud'` with `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`, and point the
Meta webhook at `https://<domain>/api/hooks/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`).
`WHATSAPP_MODE='webhook'` posts every outgoing message to your own bot (`WHATSAPP_BOT_URL`) instead.
Email needs `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`; without them mail also falls back to log mode.

### `WHATSAPP_MODE='dialog360'` — the protocol

We do not talk to 360dialog. We hand a JSON envelope to the system that owns the number, and it
performs the send. Everything that system needs in order to act — and to route the reply back — is in
the envelope, so the contract is this shape and nothing implicit:

```http
POST <DIALOG360_EXECUTOR_URL>
Authorization: Bearer <DIALOG360_EXECUTOR_TOKEN>
Content-Type: application/json
```
```json
{
  "protocol": "allaroundme.wa.v1",
  "channel": "whatsapp",
  "from": "<DIALOG360_NUMBER — the number under system control>",
  "to": "972501234567",
  "purpose": "verification | questionnaire | digest | system",
  "message": { "type": "text", "text": "…" },
  "context": { "kind": "otp | questionnaire | phi_handoff | digest", "run_id": 42 },
  "reply_to": {
    "method": "POST",
    "url": "<PUBLIC_URL>/api/hooks/wa-inbound",
    "body": { "from": "<sender msisdn>", "text": "<message text>", "secret": "<DIALOG360_INBOUND_SECRET>" }
  },
  "sent_at": "2026-07-17T09:00:00.000Z"
}
```

Any 2xx means *accepted for delivery*; anything else is an error and the caller decides whether to
retry. Inbound: POST whatever the patient wrote to `reply_to.url` — a message carrying a live
verification word claims the profile for the sender's number; anything else advances that number's
open questionnaire conversation.

The scheduler inside the app dispatches the outbox every minute and sends the daily digests from
`DIGEST_HOUR`. Set `SCHEDULER_ENABLED='0'` if a separate worker should own delivery.

## Multidev deployment
The repo follows the Multidev contract (`VPS-INSTALL.MD`, `PREINSTALL_REQUIREMENTS.md`, root scripts,
env templates). Health: `GET /api/health` → `{ ok, db, eshkolot }`. Install Eshkolot-alphon on the same
VPS and point `ESHKOLOT_API_URL` to its assigned port.

## Questionnaire payload / external bots
`POST /api/doctor/questionnaires/:id/issue` freezes the blended questions into a run `payload` —
self-describing JSON instructions (intro, schedule with absolute `send_at` times, questions with
`expected` hints and per-question `source`) **and** enqueues the real sends in `wa_outbox`.

An external bot can either let the built-in engine drive the chat (`WHATSAPP_MODE='webhook'` — it
only relays text), or take the payload and drive the conversation itself, posting back to
`POST /api/hooks/answers {run_id, answers:[{idx, answer}]}` with delivery confirmations to
`POST /api/hooks/sent {run_id}`. Both paths write to the same report.
