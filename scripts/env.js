// Shared env loader for the scripts/ CLIs.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(ROOT_DIR, '.env.credentials') });

const e = process.env;

export const dbConfig = {
  host: e.DB_HOST || e.MYSQL_HOST || '127.0.0.1',
  port: Number(e.DB_PORT || e.MYSQL_PORT || 3306),
  user: e.DB_USER || e.MYSQL_USER || 'root',
  password: e.DB_PASSWORD || e.MYSQL_PASSWORD || '',
  database: e.DB_NAME || e.MYSQL_DATABASE || 'allaroundme',
};

export function log(...args) {
  console.log('[allaroundme]', ...args);
}
