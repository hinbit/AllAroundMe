// Loads env from repo-root .env (without overriding process.env — PM2/projectctl wins).
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = __dirname;
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CLIENT_DIR = path.join(ROOT_DIR, 'client');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const e = process.env;

export const config = {
  port: Number(e.PORT || 4090),
  nodeEnv: e.NODE_ENV || 'development',
  jwtSecret: e.JWT_SECRET || 'dev-insecure-secret-change-me',
  tokenTtlHours: Number(e.TOKEN_TTL_HOURS || 12),
  publicUrl: e.PUBLIC_URL || '',
  eshkolotApi: String(e.ESHKOLOT_API_URL || 'http://127.0.0.1:3070/api').replace(/\/$/, ''),
  profileTtlDays: Number(e.PROFILE_TTL_DAYS || 90),
  whatsapp: {
    // 'log' = dev, print to server log · 'cloud' = Meta WhatsApp Cloud API ·
    // 'webhook' = POST each message to an external bot (WHATSAPP_BOT_URL)
    mode: ['cloud', 'webhook', 'log'].includes(e.WHATSAPP_MODE) ? e.WHATSAPP_MODE : 'log',
    token: e.WHATSAPP_TOKEN || '',
    phoneId: e.WHATSAPP_PHONE_ID || '',
    verifyToken: e.WHATSAPP_VERIFY_TOKEN || 'aam-verify',
    botUrl: e.WHATSAPP_BOT_URL || '',
  },
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
