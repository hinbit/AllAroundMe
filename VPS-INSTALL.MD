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

## Companion app (Eshkolot-alphon)

The alphon provides `/api/public/nearby`, `/api/public/filters`, `/api/public/analyze` and
`/api/public/tags-tree`. `ESHKOLOT_API_URL` accepts **either** form — both are tested:

```
# A. alphon installed on this same VPS (preferred: no TLS hop, no public traffic)
ESHKOLOT_API_URL='http://127.0.0.1:<eshkolot-PORT>/api'

# B. an alphon that already runs elsewhere, over its public origin
ESHKOLOT_API_URL='https://eshkolot.seach.co.il/api'
```

Form B works because the proxy picks `http`/`https` from the URL (`server/services/upstream.js`)
and sends the target's Host, so the alphon's nginx routes it correctly. Trade-offs: every map
query then leaves the VPS and depends on that domain's TLS + uptime, and the alphon must be
running a build that has `/api/public/tags-tree` (added for this app) — otherwise the tag finder
silently falls back to `client/data/tags-fallback.json`.

Voice analysis requires the alphon's `OPENAI_API_KEY` + ffmpeg (declared in the alphon's own
contract). Without any alphon this app still runs: health stays ok, the tag finder uses the
fallback tree, and the map shows a friendly "no connection" message.

Note `GET /api/health` reports `eshkolot: true` from the alphon's `/health` only — it does not
prove `/api/public/*` is reachable. After install, smoke-test the real path:

```bash
curl "http://127.0.0.1:<PORT>/api/public/filters"   # must return JSON, not an error page
```

## Basemap tiles (OpenStreetMap)

The map draws OSM raster tiles under the radial view, straight from the browser to
`tile.openstreetmap.org` — no key, no server config, no build step. Users can turn
the streets off (the 🗺️ button or `M`); the choice lives in `localStorage` and the
old grid backdrop returns. With no network the tiles simply fail and the map still
works.

Two things to know before this gets busy:

- **OSM's tile servers run on donated capacity** and their usage policy is aimed at
  light use. A high-traffic production site is expected to move to a paid provider
  (Mapbox, MapTiler, Thunderforest) or self-hosted tiles. Swapping is a one-line
  change to `TILE_URL` in `client/map.html` — but the attribution must stay.
- **Attribution is required** wherever the tiles are shown and is rendered bottom
  -left of the map. Keep it if you keep the tiles.

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
