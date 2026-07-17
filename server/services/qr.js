// The desk QR (option a): a patient at the doctor's desk scans a code and is
// auto-assigned to that doctor's after-visit questionnaire, stamped with the
// moment of the scan — "החולה מיום שלישי בשעה 17:40".
//
// Why the QR rotates
// ------------------
// A static desk QR is a bearer token: photograph it once and you can file
// answers as that doctor's patient from anywhere, forever. So the code carries
// only a signature over the *current time window*, derived from a per-desk
// secret that never leaves this server:
//
//   /q/<assignment_id>?w=<window>&s=<hmac(desk_secret, "id:window")>
//
// The desk page redraws the QR every window, so what is on screen is always
// fresh, while a photo of it dies within QR_WINDOW_SEC. That is also exactly
// what makes the scan evidence of presence — and therefore what lets the visit
// slot stand in for the patient's identity towards the doctor.
import crypto from 'crypto';
import { config } from '../env.js';

export const QR_WINDOW_SEC = config.qr.windowSec;

// A scan is accepted one window either side of the current one: the patient
// needs a few seconds to raise the phone, and clocks drift.
const WINDOW_TOLERANCE = 1;

export function newDeskSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export function currentWindow(at = Date.now()) {
  return Math.floor(at / 1000 / QR_WINDOW_SEC);
}

function signWindow(secret, assignmentId, window) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${assignmentId}:${window}`)
    .digest('hex')
    .slice(0, 24);
}

// Constant-time compare of two attacker-influenced strings.
//
// The length guard MUST be on bytes, not on String.length: 'é'.length is 1 but
// it is 2 bytes, so a 24-character multi-byte signature passes a string-length
// check and then makes timingSafeEqual throw RangeError — which, on a public
// unauthenticated route, is one request away from taking the process down.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// The URL to encode in the desk QR right now.
//
// `base` must be absolute: a QR holding "/q/54?..." is unscannable — a camera
// has no origin to resolve it against. PUBLIC_URL is the answer in production;
// when it is unset (dev), the caller passes the request's own origin rather
// than letting us print a code that cannot work.
export function deskUrl(assignment, { at = Date.now(), base } = {}) {
  const w = currentWindow(at);
  const s = signWindow(assignment.desk_secret, assignment.id, w);
  const origin = String(base || config.publicUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(origin)) {
    throw new Error('PUBLIC_URL חסר או אינו כתובת מלאה — קוד QR חייב כתובת אבסולוטית');
  }
  return `${origin}/q/${assignment.id}?w=${w}&s=${s}`;
}

// Validate a scanned code against the desk secret. Returns {ok} or a reason:
// 'expired' — the window has passed (a photographed / forwarded QR)
// 'bad-signature' — not produced by this desk
export function verifyScan(assignment, window, sig, at = Date.now()) {
  const w = parseInt(window, 10);
  if (!Number.isInteger(w)) return { ok: false, reason: 'bad-signature' };
  if (Math.abs(currentWindow(at) - w) > WINDOW_TOLERANCE) return { ok: false, reason: 'expired' };

  const expected = signWindow(assignment.desk_secret, assignment.id, w);
  if (!safeEqual(sig, expected)) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}

// ------------------------------------------------------------ run tokens ----
// A QR patient has no account, so the run itself is the credential: this token
// is what lets an anonymous browser post answers to exactly one run.
export function signRunToken(runId) {
  const sig = crypto.createHmac('sha256', config.jwtSecret)
    .update(`run:${runId}`)
    .digest('hex')
    .slice(0, 32);
  return `${runId}.${sig}`;
}

export function verifyRunToken(token) {
  const [rawId, sig] = String(token || '').split('.');
  const runId = parseInt(rawId, 10);
  if (!runId || !sig) return null;
  const expected = signRunToken(runId).split('.')[1];
  if (!safeEqual(sig, expected)) return null;
  return runId;
}

// --------------------------------------------------------- the visit slot ---
// How the doctor recognises the patient without us telling him who it is:
// "החולה מיום שלישי בשעה 17:40", which he matches against his own appointment
// book. Always Asia/Jerusalem — the doctor reads this in clinic time, whatever
// the server's timezone happens to be.
//
// Built from formatToParts rather than by splitting the formatted string: the
// separator between weekday and time is a locale detail (he-IL uses a space,
// not the comma you would expect), and guessing it produces "בשעה undefined".
const SLOT_FMT = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  timeZone: 'Asia/Jerusalem',
});

export function visitSlotLabel(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d)) return '';
  const parts = SLOT_FMT.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday');
  const time = `${get('hour')}:${get('minute')}`;
  if (!weekday || time === ':') return '';
  return `החולה מ${weekday} בשעה ${time}`;
}
