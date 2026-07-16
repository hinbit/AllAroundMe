// Email transport: nodemailer over SMTP when configured, otherwise the same
// log-mode behavior as the WhatsApp transport (dev-friendly, nothing breaks).
import nodemailer from 'nodemailer';
import { config } from '../env.js';

let transporter = null;

export function mailEnabled() {
  return !!config.smtp.host;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to, subject, text) {
  if (!to) throw new Error('אין כתובת אימייל');
  if (!mailEnabled()) {
    console.log(`[allaroundme] [mail:log] -> ${to} · ${subject}\n${text.split('\n').map((l) => '    ' + l).join('\n')}`);
    return { mode: 'log' };
  }
  await getTransporter().sendMail({ from: config.smtp.from, to, subject, text });
  return { mode: 'smtp' };
}
