# VPS Install Notes - AllAroundMe

This file is the Multidev install contract for the app.

## Shape

- Single Node runtime process (`server/index.js`) on the assigned `PORT`:
  - serves the static client (`client/`) — user app, map, reviews, doctor dashboard, PWA assets
  - own JSON API under `/api` (sessions, events, transcripts, reviews, doctor platform, hooks)
  - proxies `/api/public/*` to the Eshkolot-alphon app (`ESHKOLOT_API_URL`), so the browser only
    ever talks to this app's own origin (`/api/public/analyze` is intercepted to log the triage trail)
  - runs the delivery scheduler in-process (WhatsApp/email outbox every 60s + daily doctor digests
    from `DIGEST_HOUR`). No extra worker, no cron entry needed — set `SCHEDULER_ENABLED='0'` to
    disable it (e.g. if only one instance of a multi-instance deployment should send).
- Root `package.json` scripts are the stable install surface:
  - `install:all` installs deps (single package, no client build step)
  - `db:init` creates the schema (idempotent, `CREATE TABLE IF NOT EXISTS`)
  - `db:seed` seeds demo doctor accounts (all three roles) + demo questionnaires (idempotent)
  - `build` / `check` run `node --check server/index.js` (no build artifacts needed)
  - `start` / `prod` run the server
- Health check: `GET /api/health` returns `{ ok: true, service: "allaroundme", db: <bool>, eshkolot: <bool> }`
  (the app itself stays healthy even when the alphon upstream is down).

## DB

Uses local MySQL. Reads `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`
(falls back to `MYSQL_*`). Multidev must create the DB user + grants before `db:init`.

Recommended order: install deps -> create DB user/grants -> `db:init` -> `db:seed` -> `start`.

## Companion app

**Eshkolot-alphon should be installed on the same VPS** — it provides `/api/public/nearby`,
`/api/public/filters`, `/api/public/analyze` and `/api/public/tags-tree`. After installing both,
set this app's `ESHKOLOT_API_URL` to the alphon's local port:

```
ESHKOLOT_API_URL='http://127.0.0.1:<eshkolot-PORT>/api'
```

Voice analysis requires the alphon's `OPENAI_API_KEY` + ffmpeg (declared in the alphon's own
contract). Without the alphon, this app still runs: health stays ok, the tag finder falls back
to `client/data/tags-fallback.json`, and the map shows a friendly "no connection" message.

## Route hints

Everything (static client + `/api`) is served from one upstream port, so no extra nginx locations are needed.

```vps-install
{
  "proxy_routes": []
}
```

## WhatsApp / email (optional, off by default)

Delivery ships in `log` mode: nothing leaves the VPS and the app is fully functional (the whole
questionnaire flow is testable through `POST /api/hooks/wa-inbound`). To go live:

- `WHATSAPP_MODE='cloud'` + `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`, then register the Meta webhook
  at `https://<domain>/api/hooks/whatsapp` (GET verification uses `WHATSAPP_VERIFY_TOKEN`).
  The webhook is a normal route on the app port — no extra nginx location needed.
- or `WHATSAPP_MODE='webhook'` + `WHATSAPP_BOT_URL` to relay through your own bot.
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` for email questionnaires + digests.

## Notes

- Keep `PORT`, `DB_*`, `MYSQL_*`, `JWT_SECRET`, `PUBLIC_URL`, `API_BASE_URL`, `ESHKOLOT_API_URL`,
  `PROFILE_TTL_DAYS`, `WHATSAPP_*`, `SMTP_*`, `SCHEDULER_ENABLED`, `DIGEST_HOUR` in the env template.
- `db:init` also applies column migrations (`scripts/migrations.js`), so updating an existing
  install is just: pull → `install:all` → `db:init` → restart.
- Pages call the API with relative `/api` paths — no localhost baked into the client.
- The runtime process must stay alive under PM2.
- Default seeded doctor credentials are documented in `README.md`. Change them after first login.
- Geolocation, microphone and PWA install require HTTPS on mobile — fully functional only after
  the domain + TLS are wired.
