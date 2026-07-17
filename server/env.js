// Loads env from repo-root .env (without overriding process.env — PM2/projectctl wins).
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = __dirname;
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CLIENT_DIR = path.join(ROOT_DIR, 'client');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(ROOT_DIR, '.env.credentials') });

const e = process.env;

export const config = {
  port: Number(e.PORT || 4090),
  nodeEnv: e.NODE_ENV || 'development',
  jwtSecret: e.JWT_SECRET || 'dev-insecure-secret-change-me',
  tokenTtlHours: Number(e.TOKEN_TTL_HOURS || 12),
  publicUrl: e.PUBLIC_URL || '',
  eshkolotApi: String(e.ESHKOLOT_API_URL || 'http://127.0.0.1:3070/api').replace(/\/$/, ''),
  profileTtlDays: Number(e.PROFILE_TTL_DAYS || 90),
  /* Browser key for the Google Maps JS API — only themes with ui.type 2 need it.
     Handed to the client by /api/config; empty = those themes fall back to the
     built-in map. Referrer-restrict it in the Google console.

     Deliberately NOT GOOGLE_MAPS_API_KEY: that one is the server-side,
     IP-restricted key and must never reach a browser. VITE_ is the name the
     credentials file already uses for the referrer-restricted browser key (a
     leftover from the sibling Vite app), so it is accepted as a fallback. */
  googleMapsBrowserKey: e.GOOGLE_MAPS_BROWSER_KEY || e.VITE_GOOGLE_MAPS_API_KEY || '',
  whatsapp: {
    // 'log' = dev, print to server log · 'cloud' = Meta WhatsApp Cloud API ·
    // 'webhook' = POST each message to an external bot (WHATSAPP_BOT_URL) ·
    // 'dialog360' = emit a JSON envelope to the system that owns the 360dialog
    //   number and actually delivers it (DIALOG360_EXECUTOR_URL)
    mode: ['cloud', 'webhook', 'dialog360', 'log'].includes(e.WHATSAPP_MODE) ? e.WHATSAPP_MODE : 'log',
    token: e.WHATSAPP_TOKEN || '',
    phoneId: e.WHATSAPP_PHONE_ID || '',
    verifyToken: e.WHATSAPP_VERIFY_TOKEN || 'aam-verify',
    botUrl: e.WHATSAPP_BOT_URL || '',
  },
  // The 360dialog number is the platform's *identity desk*: it verifies who a
  // patient is and nothing more. We never deliver clinical content through it —
  // that goes doctor<->patient directly (see PHI_RETENTION below).
  dialog360: {
    executorUrl: e.DIALOG360_EXECUTOR_URL || '',
    executorToken: e.DIALOG360_EXECUTOR_TOKEN || '',
    number: e.DIALOG360_NUMBER || '',          // the system-controlled WhatsApp number
    inboundSecret: e.DIALOG360_INBOUND_SECRET || '',
  },
  qr: {
    // How long a desk QR stays scannable. Short enough that a photo of the code
    // is worthless, long enough to survive a slow scan.
    windowSec: Math.max(30, Number(e.QR_WINDOW_SEC || 120)),
  },
  // 'deidentify' (default) — once answers reach the doctor's own channel, drop
  //   the patient identifiers here and keep only de-identified answers for the
  //   aggregate report. 'full' — keep everything (single-clinic self-hosting,
  //   where this database *is* the doctor's own record).
  phiRetention: e.PHI_RETENTION === 'full' ? 'full' : 'deidentify',
  smtp: {
    host: e.SMTP_HOST || '',
    port: Number(e.SMTP_PORT || 587),
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASS || '',
    from: e.SMTP_FROM || 'AllAroundMe <no-reply@allaroundme.local>',
  },
  digestHour: Number(e.DIGEST_HOUR || 8),
  schedulerEnabled: e.SCHEDULER_ENABLED !== '0',
  db: {
    host: e.DB_HOST || e.MYSQL_HOST || '127.0.0.1',
    port: Number(e.DB_PORT || e.MYSQL_PORT || 3306),
    user: e.DB_USER || e.MYSQL_USER || 'root',
    password: e.DB_PASSWORD || e.MYSQL_PASSWORD || '',
    database: e.DB_NAME || e.MYSQL_DATABASE || 'allaroundme',
  },
};
